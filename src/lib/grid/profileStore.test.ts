import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegionInfo } from "../types";
import {
  clearProfileCaches,
  MIN_USABLE_HOURS,
  resolveProfile,
} from "./profileStore";
import type { EiaRow } from "./eia";
import type { FetchLike, FetchLikeResponse, RegionProfile } from "./types";

/**
 * Resolution order under test: memory -> disk cache -> bundled -> live EIA ->
 * parent-region aggregate -> modelled archetype. Every tier writes its own
 * `.cache/`-shaped file, so all filesystem access here goes through a fresh
 * temp directory — never the real `.cache/grid-profiles`.
 */

function region(ba: string, timezone = "America/Los_Angeles"): RegionInfo {
  return {
    ba,
    name: ba,
    shortName: ba,
    timezone,
    state: "CA",
    approximate: false,
    matchedBy: "zip",
  };
}

function jsonResponse(status: number, body: unknown): FetchLikeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeStoredProfile(ba: string, timezone: string, generatedAt: string): RegionProfile {
  const slots = Array.from({ length: 168 }, (_, hourOfWeek) => ({
    hourOfWeek,
    gCO2PerKWh: 123,
    fuelMix: { gas: 1 },
    carbonFreeShare: 0,
    sampleCount: 10,
    weight: 5,
  }));
  return {
    ba,
    timezone,
    source: "eia",
    generatedAt,
    targetDate: generatedAt.slice(0, 10),
    hoursOfHistory: 8760,
    slots,
    stats: { min: 123, max: 123, mean: 123, p10: 123, p90: 123 },
    notes: ["from disk cache fixture"],
  };
}

function safeZone(timezone: string): string {
  return timezone.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * A fake EIA fetch that generates one row per (hour, fuel) between the
 * request's `start`/`end` window for a chosen set of "good" respondents, and
 * a much shorter window (too sparse to use) for everyone else. Region-data
 * (demand) requests are answered with an empty page, which is a normal,
 * harmless outcome the real demand pull already tolerates.
 */
function fakeEiaFetch(options: { sufficientRespondents: Set<string>; sparseHours?: number }): FetchLike {
  const sparseHours = options.sparseHours ?? 48;
  return async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes("region-data")) {
      return jsonResponse(200, { response: { data: [], total: 0 } });
    }
    const respondent = parsed.searchParams.get("facets[respondent][]") ?? "";
    const start = Date.parse(`${parsed.searchParams.get("start")}:00:00Z`);
    const end = Date.parse(`${parsed.searchParams.get("end")}:00:00Z`);
    const offset = Number(parsed.searchParams.get("offset") ?? "0");
    const length = Number(parsed.searchParams.get("length") ?? "5000");
    const fullHours = Math.max(0, Math.round((end - start) / 3_600_000));
    const usableHours = options.sufficientRespondents.has(respondent) ? fullHours : sparseHours;
    const fuels = ["NG", "SUN", "WND", "NUC"];
    const rows: EiaRow[] = [];
    for (let h = 0; h < usableHours; h += 1) {
      const ts = new Date(start + h * 3_600_000).toISOString().slice(0, 13);
      for (const fuel of fuels) {
        rows.push({ period: ts, respondent, fueltype: fuel, value: 100 + h });
      }
    }
    const page = rows.slice(offset, offset + length);
    return jsonResponse(200, { response: { total: rows.length, data: page } });
  };
}

let cacheDir: string;

beforeEach(async () => {
  clearProfileCaches();
  cacheDir = await fs.mkdtemp(join(tmpdir(), "gridmap-profile-test-"));
});

afterEach(async () => {
  clearProfileCaches();
  await fs.rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("memory tier", () => {
  it("serves a second call for the same region from memory without touching the fetch", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const fetchImpl = vi.fn(fakeEiaFetch({ sufficientRespondents: new Set() }));
    const r = region("CISO");
    const first = await resolveProfile(r, {
      cacheDir,
      offline: true,
      now,
      backgroundUpgrade: false,
      fetchImpl,
    });
    expect(first.tier).toBe("bundled"); // CISO ships a committed profile
    const second = await resolveProfile(r, { cacheDir, offline: true, now, fetchImpl });
    expect(second.tier).toBe("memory");
    expect(second.profile).toBe(first.profile);
  });

  it("shares one in-flight build across concurrent callers for the same region", async () => {
    // A BA with no bundled profile, so the two calls really do race to build
    // one from scratch, and only one fetch pass should happen.
    const fetchImpl = vi.fn(
      fakeEiaFetch({ sufficientRespondents: new Set(["AVA"]) }),
    );
    const r = region("AVA");
    const [a, b] = await Promise.all([
      resolveProfile(r, { cacheDir, apiKey: "key", now: new Date("2026-08-23T12:00:00.000Z"), fetchImpl, backgroundUpgrade: false }),
      resolveProfile(r, { cacheDir, apiKey: "key", now: new Date("2026-08-23T12:00:00.000Z"), fetchImpl, backgroundUpgrade: false }),
    ]);
    expect(a.profile).toBe(b.profile);
  });
});

describe("disk cache tier", () => {
  it("reads a fresh disk-cached profile before touching bundled or live data", async () => {
    const stored = makeStoredProfile("AVA", "America/Los_Angeles", "2026-08-23T06:00:00.000Z");
    await fs.writeFile(
      join(cacheDir, `AVA.${safeZone("America/Los_Angeles")}.json`),
      JSON.stringify(stored),
      "utf8",
    );
    const fetchImpl = vi.fn(fakeEiaFetch({ sufficientRespondents: new Set() }));
    const result = await resolveProfile(region("AVA"), {
      cacheDir,
      offline: true,
      now: new Date("2026-08-23T12:00:00.000Z"), // 6h after generatedAt, inside the 24h TTL
      fetchImpl,
    });
    expect(result.tier).toBe("disk");
    expect(result.profile.notes).toContain("from disk cache fixture");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a disk entry once it is past its TTL", async () => {
    const stored = makeStoredProfile("AVA", "America/Los_Angeles", "2026-08-01T00:00:00.000Z");
    await fs.writeFile(
      join(cacheDir, `AVA.${safeZone("America/Los_Angeles")}.json`),
      JSON.stringify(stored),
      "utf8",
    );
    const result = await resolveProfile(region("AVA"), {
      cacheDir,
      offline: true, // no bundled AVA profile and no network -> must fall to modelled
      now: new Date("2026-08-23T12:00:00.000Z"), // ~22 days later, well past the 24h TTL
    });
    expect(result.tier).not.toBe("disk");
    expect(result.tier).toBe("modelled");
  });

  it("degrades to in-memory-only rather than throwing when the cache directory cannot be written", async () => {
    // Create a plain file where the cache directory should be, so
    // fs.mkdir(cacheDir, {recursive:true}) fails with ENOTDIR.
    const blockedPath = join(cacheDir, "blocked-by-a-file");
    await fs.writeFile(blockedPath, "not a directory", "utf8");
    const nestedCacheDir = join(blockedPath, "nested");

    const first = await resolveProfile(region("AVA"), {
      cacheDir: nestedCacheDir,
      offline: true,
    });
    expect(first.tier).toBe("modelled");

    // A second call for the same region must still work, served from the
    // in-memory cache (same object) rather than by touching the filesystem
    // again — a modelled profile always reports its tier as "modelled", so
    // object identity is what actually proves the memory cache was hit.
    const second = await resolveProfile(region("AVA"), {
      cacheDir: nestedCacheDir,
      offline: true,
    });
    expect(second.tier).toBe("modelled");
    expect(second.profile).toBe(first.profile);
  });

  it("degrades gracefully when the cache file exists but is not valid JSON", async () => {
    await fs.writeFile(
      join(cacheDir, `AVA.${safeZone("America/Los_Angeles")}.json`),
      "{ not valid json",
      "utf8",
    );
    await expect(
      resolveProfile(region("AVA"), { cacheDir, offline: true }),
    ).resolves.toMatchObject({ tier: "modelled" });
  });
});

describe("bundled tier", () => {
  it("uses the committed profile for a BA that ships one, with no network access", async () => {
    const fetchImpl = vi.fn(fakeEiaFetch({ sufficientRespondents: new Set() }));
    const result = await resolveProfile(region("CISO"), {
      cacheDir,
      offline: true,
      fetchImpl,
    });
    expect(result.tier).toBe("bundled");
    expect(result.profile.ba).toBe("CISO");
    expect(result.profile.source).toBe("eia");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("live EIA tier", () => {
  it("builds directly from EIA when the BA itself returns enough usable hours", async () => {
    const fetchImpl = fakeEiaFetch({ sufficientRespondents: new Set(["AVA"]) });
    const result = await resolveProfile(region("AVA"), {
      cacheDir,
      apiKey: "test-key",
      coldPathDays: 20, // 480 hours, comfortably over MIN_USABLE_HOURS (336)
      now: new Date("2026-08-23T12:00:00.000Z"),
      fetchImpl,
      backgroundUpgrade: false,
    });
    expect(result.tier).toBe("eia");
    expect(result.respondent).toBe("AVA");
    expect(result.profile.source).toBe("eia");
  });

  it("respects MIN_USABLE_HOURS: too few hours for the BA is treated as unusable", async () => {
    // AVA returns far fewer hours than MIN_USABLE_HOURS and has no parent
    // mapping override here (we still exercise the gate, not the fallback
    // chain) by also starving the parent aggregate of usable hours.
    const fetchImpl = fakeEiaFetch({ sufficientRespondents: new Set(), sparseHours: 48 });
    expect(48).toBeLessThan(MIN_USABLE_HOURS);
    const result = await resolveProfile(region("AVA"), {
      cacheDir,
      apiKey: "test-key",
      coldPathDays: 20,
      now: new Date("2026-08-23T12:00:00.000Z"),
      fetchImpl,
      backgroundUpgrade: false,
    });
    // AVA has a parent (NW) which is also starved here, so this must bottom
    // out at the modelled archetype rather than throwing or hanging.
    expect(result.tier).toBe("modelled");
  });
});

describe("parent-region aggregate tier", () => {
  it("falls back to the BA's parent region when the BA itself has too little data", async () => {
    // AVA (a real, small Pacific Northwest BA) reports too little to model on
    // its own, but its parent aggregate "NW" has plenty.
    const fetchImpl = fakeEiaFetch({ sufficientRespondents: new Set(["NW"]), sparseHours: 48 });
    const result = await resolveProfile(region("AVA"), {
      cacheDir,
      apiKey: "test-key",
      coldPathDays: 20,
      now: new Date("2026-08-23T12:00:00.000Z"),
      fetchImpl,
      backgroundUpgrade: false,
    });
    expect(result.tier).toBe("eia-region");
    expect(result.respondent).toBe("NW");
    expect(result.detail).toMatch(/AVA/);
    expect(result.detail).toMatch(/NW/);
  });
});

describe("modelled archetype tier (the zero-key floor)", () => {
  it("is reached with no api key, no cache, and offline network access", async () => {
    const result = await resolveProfile(region("AVA"), { cacheDir, offline: true });
    expect(result.tier).toBe("modelled");
    expect(result.profile.source).toBe("modelled");
    expect(result.profile.slots).toHaveLength(168);
  });

  it("is reached even with an api key when every EIA tier is starved of data", async () => {
    const fetchImpl = fakeEiaFetch({ sufficientRespondents: new Set(), sparseHours: 10 });
    const result = await resolveProfile(region("AVA"), {
      cacheDir,
      apiKey: "test-key",
      fetchImpl,
      backgroundUpgrade: false,
      now: new Date("2026-08-23T12:00:00.000Z"),
    });
    expect(result.tier).toBe("modelled");
  });
});
