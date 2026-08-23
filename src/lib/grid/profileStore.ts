/**
 * Where profiles come from, in order of how fast they are.
 *
 * A full year of EIA history for one BA is ~76,000 rows across 16 paged
 * requests and takes about 20 seconds. That is fine for a nightly job and
 * completely unacceptable on a page load, so profile resolution is tiered and
 * a first-time visitor is never made to wait for the slow path:
 *
 *  1. **In-memory** — same server process, 24h TTL. Free.
 *  2. **Disk cache** (`.cache/grid-profiles/<BA>.json`, 24h TTL). One file read.
 *  3. **Committed profile** (`src/lib/grid/data/profiles/<BA>.json`, bundled at
 *     build time for the top ~25 BAs). Zero network, covers most US households.
 *  4. **Short EIA fetch** — 90 days, ~4 requests, ~5s. Real data, good enough to
 *     model with, and we schedule the full year in the background.
 *  5. **Parent regional aggregate** (`CISO` -> `CAL`, `GVL` -> `FLA`). Real
 *     measured data for a bigger footprint, which beats a synthetic model.
 *  6. **Modelled archetype** — always available, always labelled as modelled.
 *
 * Every tier records what it did so `GridSnapshot.notes` and `providers[]` can
 * tell the user the truth about where their number came from.
 */

import type { RegionInfo } from "../types";
import { buildProfile } from "./climatology";
import { bundledProfile } from "./data/profiles";
import { buildDemandModel, fetchDemandHistory } from "./demand";
import {
  EiaError,
  fetchHourlyHistory,
  isRegionAggregate,
  parentRegionForBa,
} from "./eia";
import { buildFallbackProfile } from "./fallback";
import type { FetchLike, RegionProfile } from "./types";

/** How old a profile may be before we rebuild it. */
export const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
/** Committed profiles older than this get a background refresh. */
export const BUNDLED_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Below this many distinct hours a profile is too thin to trust. */
export const MIN_USABLE_HOURS = 24 * 14;

export const DEFAULT_CACHE_DIR = ".cache/grid-profiles";

export type ProfileTier =
  | "memory"
  | "disk"
  | "bundled"
  | "eia"
  | "eia-region"
  | "modelled";

export interface ResolvedProfile {
  profile: RegionProfile;
  tier: ProfileTier;
  /** The EIA respondent the data actually describes (may be an aggregate). */
  respondent: string;
  /** One sentence, safe to show a user. */
  detail: string;
  /** True when a full-year rebuild is running in the background. */
  upgrading: boolean;
}

export interface ResolveProfileOptions {
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  now?: Date;
  /** Set to null to disable the disk cache entirely. */
  cacheDir?: string | null;
  /** Never touch the network (tests, offline dev). */
  offline?: boolean;
  /** Days fetched on the synchronous cold path. */
  coldPathDays?: number;
  /** Days fetched by the background upgrade. */
  fullHistoryDays?: number;
  /** Off in tests, so nothing outlives the assertion. */
  backgroundUpgrade?: boolean;
  /** Force a rebuild, ignoring every cache. */
  refresh?: boolean;
}

interface CacheEntry {
  profile: RegionProfile;
  storedAtMs: number;
  respondent: string;
  tier: ProfileTier;
}

const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ResolvedProfile>>();
const upgrading = new Set<string>();

/** Test hook — drops every in-process cache. */
export function clearProfileCaches(): void {
  memoryCache.clear();
  inFlight.clear();
  upgrading.clear();
}

function cacheKey(ba: string, timezone: string): string {
  // The timezone is part of the identity: the same history bucketed into a
  // different local clock is a different profile.
  return `${ba.toUpperCase()}|${timezone}`;
}

function isFresh(generatedAt: string, nowMs: number, ttlMs = PROFILE_TTL_MS): boolean {
  const parsed = Date.parse(generatedAt);
  if (Number.isNaN(parsed)) return false;
  return nowMs - parsed < ttlMs;
}

function looksLikeProfile(value: unknown): value is RegionProfile {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RegionProfile>;
  return (
    typeof record.ba === "string" &&
    typeof record.timezone === "string" &&
    Array.isArray(record.slots) &&
    record.slots.length === 168
  );
}

/**
 * All filesystem access is best-effort. Serverless filesystems are read-only,
 * `.cache` may not exist, and none of that is worth failing a page render over.
 */
async function fsModule(): Promise<typeof import("node:fs/promises") | null> {
  try {
    return await import("node:fs/promises");
  } catch {
    return null;
  }
}

function cachePath(cacheDir: string, ba: string, timezone: string): string {
  // Timezones contain "/", so flatten them into the filename.
  const safeZone = timezone.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${cacheDir}/${ba.toUpperCase()}.${safeZone}.json`;
}

function resolveCacheDir(options: ResolveProfileOptions): string | null {
  if (options.cacheDir === null) return null;
  if (options.cacheDir) return options.cacheDir;
  if (typeof process === "undefined" || typeof process.cwd !== "function") return null;
  return `${process.cwd()}/${DEFAULT_CACHE_DIR}`;
}

async function readDiskCache(
  cacheDir: string,
  ba: string,
  timezone: string,
): Promise<RegionProfile | null> {
  const fs = await fsModule();
  if (!fs) return null;
  try {
    const raw = await fs.readFile(cachePath(cacheDir, ba, timezone), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return looksLikeProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeDiskCache(
  cacheDir: string,
  profile: RegionProfile,
): Promise<void> {
  const fs = await fsModule();
  if (!fs) return;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      cachePath(cacheDir, profile.ba, profile.timezone),
      JSON.stringify(profile),
      "utf8",
    );
  } catch {
    // Read-only filesystem: the in-memory cache still does its job.
  }
}

interface BuildFromEiaResult {
  profile: RegionProfile;
  respondent: string;
  hours: number;
  truncated: boolean;
}

async function buildFromEia(options: {
  respondent: string;
  timezone: string;
  apiKey: string;
  days: number;
  now: Date;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
  /** Skip the demand pull (tests, or when we only want the mix). */
  skipDemand?: boolean;
}): Promise<BuildFromEiaResult | null> {
  // Both pulls run together: demand is one value per hour, so it is a single
  // extra page and adds well under a second to the build.
  const [history, demand] = await Promise.all([
    fetchHourlyHistory({
      apiKey: options.apiKey,
      ba: options.respondent,
      days: options.days,
      now: options.now,
      fetchImpl: options.fetchImpl,
      requestTimeoutMs: options.requestTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs,
    }),
    options.skipDemand
      ? Promise.resolve(null)
      : fetchDemandHistory({
          apiKey: options.apiKey,
          ba: options.respondent,
          days: options.days,
          now: options.now,
          fetchImpl: options.fetchImpl,
          requestTimeoutMs: options.requestTimeoutMs,
          totalTimeoutMs: options.totalTimeoutMs,
          // A failed demand pull must never fail the profile build.
        }).catch(() => null),
  ]);
  if (history.hours < MIN_USABLE_HOURS) return null;
  const profile = buildProfile(history.samples, {
    ba: options.respondent,
    timezone: options.timezone,
    now: options.now,
    source: "eia",
    notes: [
      `Built from ${history.hours.toLocaleString("en-US")} hours of EIA-930 generation data for ${options.respondent}.`,
      ...(history.truncated
        ? ["EIA paging was cut short by our time budget, so history is partial."]
        : []),
    ],
  });

  if (demand && demand.points.length > 0) {
    const model = buildDemandModel(
      history.samples,
      demand.points,
      profile.slots.map((slot) => slot.gCO2PerKWh),
      { timezone: options.timezone, now: options.now },
    );
    profile.demandSlots = model.demandSlots;
    profile.demandSensitivity = model.sensitivity;
    profile.notes.push(
      model.sensitivity.applied
        ? `Demand nowcast enabled: intensity tracks demand here (r=${model.sensitivity.r.toFixed(2)} over ${model.sensitivity.n.toLocaleString("en-US")} hours), cutting forecast error from ${model.sensitivity.baselineRmse} to ${model.sensitivity.correctedRmse} gCO2/kWh.`
        : `Demand nowcast disabled: on this grid intensity is set by wind and solar output, not demand (r=${model.sensitivity.r.toFixed(2)}), so demand adds no information.`,
    );
  }

  return {
    profile,
    respondent: options.respondent,
    hours: history.hours,
    truncated: history.truncated,
  };
}

/**
 * Rebuild with the full year and store it, without making anyone wait.
 *
 * Fire-and-forget promises can be cut short when a serverless invocation ends;
 * that is acceptable because the next request simply tries again, and the user
 * always already has a good answer in hand.
 */
function scheduleUpgrade(options: {
  key: string;
  respondent: string;
  timezone: string;
  apiKey: string;
  days: number;
  fetchImpl?: FetchLike;
  cacheDir: string | null;
}): boolean {
  if (upgrading.has(options.key)) return true;
  upgrading.add(options.key);
  void (async () => {
    try {
      const built = await buildFromEia({
        respondent: options.respondent,
        timezone: options.timezone,
        apiKey: options.apiKey,
        days: options.days,
        now: new Date(),
        fetchImpl: options.fetchImpl,
        requestTimeoutMs: 20_000,
        totalTimeoutMs: 120_000,
      });
      if (!built) return;
      memoryCache.set(options.key, {
        profile: built.profile,
        storedAtMs: Date.now(),
        respondent: built.respondent,
        tier: "eia",
      });
      if (options.cacheDir) await writeDiskCache(options.cacheDir, built.profile);
    } catch {
      // Nothing to do: the served answer was already good enough.
    } finally {
      upgrading.delete(options.key);
    }
  })();
  return true;
}

async function resolveUncached(
  region: RegionInfo,
  options: ResolveProfileOptions,
  key: string,
): Promise<ResolvedProfile> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const ba = region.ba.toUpperCase();
  const timezone = region.timezone;
  const cacheDir = resolveCacheDir(options);
  const apiKey = options.apiKey?.trim() || null;
  const coldPathDays = options.coldPathDays ?? 90;
  const fullHistoryDays = options.fullHistoryDays ?? 365;
  const allowBackground = options.backgroundUpgrade !== false && apiKey !== null;

  // 1 + 2. Disk cache, if it is still inside its TTL.
  if (!options.refresh && cacheDir) {
    const cached = await readDiskCache(cacheDir, ba, timezone);
    if (cached && isFresh(cached.generatedAt, nowMs)) {
      memoryCache.set(key, {
        profile: cached,
        storedAtMs: nowMs,
        respondent: cached.ba,
        tier: "disk",
      });
      return {
        profile: cached,
        tier: "disk",
        respondent: cached.ba,
        detail: `Cached EIA profile for ${cached.ba}, rebuilt daily.`,
        upgrading: false,
      };
    }
  }

  // 3. Committed profile. Real data, instant, and good for most US households.
  if (!options.refresh) {
    const bundled = bundledProfile(ba);
    if (bundled) {
      // A committed profile is bucketed in the BA's own local clock. That is the
      // clock the grid actually runs on, so we keep it and only use the user's
      // timezone for labels.
      const stale = !isFresh(bundled.generatedAt, nowMs, BUNDLED_STALE_MS);
      const isUpgrading =
        stale && allowBackground
          ? scheduleUpgrade({
              key,
              respondent: ba,
              timezone: bundled.timezone,
              apiKey: apiKey!,
              days: fullHistoryDays,
              fetchImpl: options.fetchImpl,
              cacheDir,
            })
          : false;
      memoryCache.set(key, {
        profile: bundled,
        storedAtMs: nowMs,
        respondent: ba,
        tier: "bundled",
      });
      return {
        profile: bundled,
        tier: "bundled",
        respondent: ba,
        detail: `Pre-built EIA profile for ${ba} (${bundled.hoursOfHistory.toLocaleString("en-US")} hours of history).`,
        upgrading: isUpgrading,
      };
    }
  }

  // 4. Short live fetch for this BA. ~90 days is enough to model and fast
  //    enough to serve, and the full year follows in the background.
  if (apiKey && !options.offline) {
    try {
      const built = await buildFromEia({
        respondent: ba,
        timezone,
        apiKey,
        days: coldPathDays,
        now,
        fetchImpl: options.fetchImpl,
        requestTimeoutMs: 8_000,
        totalTimeoutMs: 12_000,
      });
      if (built) {
        memoryCache.set(key, {
          profile: built.profile,
          storedAtMs: nowMs,
          respondent: ba,
          tier: "eia",
        });
        if (cacheDir) await writeDiskCache(cacheDir, built.profile);
        const isUpgrading = allowBackground
          ? scheduleUpgrade({
              key,
              respondent: ba,
              timezone,
              apiKey,
              days: fullHistoryDays,
              fetchImpl: options.fetchImpl,
              cacheDir,
            })
          : false;
        return {
          profile: built.profile,
          tier: "eia",
          respondent: ba,
          detail: `Live EIA history for ${ba} — ${built.hours.toLocaleString("en-US")} hours over the last ${coldPathDays} days.`,
          upgrading: isUpgrading,
        };
      }
    } catch (error) {
      if (!(error instanceof EiaError)) throw error;
      // Fall through: a parent aggregate or the model still beats an error page.
    }

    // 5. Parent regional aggregate. Small BAs like Seattle City Light report
    //    only one fuel type, which is unusable; the Northwest aggregate they
    //    belong to is complete, and real data beats a synthetic model.
    const parent = isRegionAggregate(ba) ? null : parentRegionForBa(ba);
    if (parent) {
      try {
        const built = await buildFromEia({
          respondent: parent,
          timezone,
          apiKey,
          days: coldPathDays,
          now,
          fetchImpl: options.fetchImpl,
          requestTimeoutMs: 8_000,
          totalTimeoutMs: 12_000,
        });
        if (built) {
          memoryCache.set(key, {
            profile: built.profile,
            storedAtMs: nowMs,
            respondent: parent,
            tier: "eia-region",
          });
          if (cacheDir) await writeDiskCache(cacheDir, built.profile);
          return {
            profile: built.profile,
            tier: "eia-region",
            respondent: parent,
            detail: `${ba} does not report a full fuel mix, so this uses real EIA data for the wider ${parent} region.`,
            upgrading: false,
          };
        }
      } catch (error) {
        if (!(error instanceof EiaError)) throw error;
      }
    }
  }

  // 6. Modelled archetype. Always works, always labelled.
  const modelled = buildFallbackProfile(ba, timezone, { generatedAt: now });
  memoryCache.set(key, {
    profile: modelled,
    storedAtMs: nowMs,
    respondent: ba,
    tier: "modelled",
  });
  return {
    profile: modelled,
    tier: "modelled",
    respondent: ba,
    detail: modelled.notes[0] ?? "Modelled estimate.",
    upgrading: false,
  };
}

/**
 * Get the best profile available for a region right now.
 *
 * Concurrent calls for the same region share one build, so a burst of traffic
 * never turns into a burst of 76,000-row EIA fetches.
 */
export async function resolveProfile(
  region: RegionInfo,
  options: ResolveProfileOptions = {},
): Promise<ResolvedProfile> {
  const key = cacheKey(region.ba, region.timezone);
  const nowMs = (options.now ?? new Date()).getTime();

  if (!options.refresh) {
    const cached = memoryCache.get(key);
    if (cached && nowMs - cached.storedAtMs < PROFILE_TTL_MS) {
      return {
        profile: cached.profile,
        tier: cached.tier === "modelled" ? "modelled" : "memory",
        respondent: cached.respondent,
        detail:
          cached.tier === "modelled"
            ? (cached.profile.notes[0] ?? "Modelled estimate.")
            : `Cached profile for ${cached.respondent}.`,
        upgrading: upgrading.has(key),
      };
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
  }

  const promise = resolveUncached(region, options, key).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
