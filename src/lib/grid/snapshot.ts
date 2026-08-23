/**
 * The blender: turn a profile plus whatever live data we can get into the
 * `GridSnapshot` the whole app reads.
 *
 * The honest shape of the problem is that we have four signals with very
 * different freshness and very different horizons:
 *
 *  | signal                        | freshness | horizon |
 *  |-------------------------------|-----------|---------|
 *  | Our hour-of-week climatology  | daily     | forever |
 *  | EIA fuel mix                  | 9-12h lag | none    |
 *  | EIA live demand (`D`)         | ~1h lag   | none    |
 *  | EIA day-ahead demand (`DF`)   | now       | 13-16h  |
 *  | Electricity Maps latest       | minutes   | none    |
 *  | Electricity Maps forecast     | minutes   | ~24h    |
 *
 * So: climatology provides the whole week's shape, the demand nowcast corrects
 * the near term where the fit earns it, and Electricity Maps — being an actual
 * measurement of intensity rather than a proxy — overrides both when we have a
 * token. Corrections decay back to pure climatology rather than stopping dead,
 * and every point says which of those it is.
 *
 * WattTime is deliberately *not* blended into the series: MOER is marginal
 * emissions, our series is average intensity, and silently mixing the two would
 * be misleading. It appears as an independent cross-check instead.
 */

import { credentialStatus, eiaApiKey, electricityMapsToken, wattTimeCredentials } from "../env";
import { CARBON_FREE_FUELS } from "../emissions";
import type {
  Confidence,
  DataSource,
  FuelMix,
  FuelType,
  GridSnapshot,
  IntensityPoint,
  ProviderAttribution,
  RegionInfo,
} from "../types";
import { projectSeries, type ClimatologyPoint } from "./climatology";
import {
  applyDemandCorrection,
  demandResidualPercent,
  fetchDemandForecast,
  fetchLiveDemand,
  type DemandPoint,
} from "./demand";
import { fetchElectricityMaps } from "./electricityMaps";
import { resolveProfile, type ProfileTier, type ResolveProfileOptions } from "./profileStore";
import { cleanlinessPercentile, clamp, round, seriesStats } from "./stats";
import { addHours, floorToHourUtc, HOURS_PER_WEEK, MS_PER_HOUR, zonedParts } from "./time";
import type { FetchLike, RegionProfile } from "./types";
import { fetchWattTime, type WattTimeCredentials } from "./wattTime";

/** How long an Electricity Maps live anchor keeps influencing the forecast. */
export const DEFAULT_CORRECTION_DECAY_HOURS = 30;
/** A live reading more than this far from our model is more likely a mismatch. */
const MAX_ANCHOR_RATIO = 2;
const MIN_ANCHOR_RATIO = 0.5;
/** Taper the demand correction over the last few hours of the DF window. */
const DF_TAPER_HOURS = 4;

export interface BuildSnapshotOptions {
  now?: Date;
  /** Points to emit. Defaults to a full week. */
  hours?: number;
  fetchImpl?: FetchLike;
  /** Explicit credentials; omit to read from the environment. */
  eiaApiKey?: string | null;
  electricityMapsToken?: string | null;
  wattTimeCredentials?: WattTimeCredentials | null;
  /** Use this profile instead of resolving one (tests, scripts). */
  profile?: RegionProfile;
  profileTier?: ProfileTier;
  profileOptions?: ResolveProfileOptions;
  /** Skip every network call. */
  offline?: boolean;
  correctionDecayHours?: number;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function weakerOf(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

/** Largest share in a mix, optionally restricted to carbon-free fuels. */
export function dominantFuel(
  mix: FuelMix | undefined,
  options: { cleanOnly?: boolean; minShare?: number } = {},
): FuelType | undefined {
  if (!mix) return undefined;
  const minShare = options.minShare ?? 0.1;
  let best: FuelType | undefined;
  let bestShare = 0;
  for (const [fuel, share] of Object.entries(mix) as [FuelType, number][]) {
    if (!Number.isFinite(share) || share <= 0) continue;
    if (options.cleanOnly && !CARBON_FREE_FUELS.includes(fuel)) continue;
    if (share > bestShare) {
      bestShare = share;
      best = fuel;
    }
  }
  return bestShare >= minShare ? best : undefined;
}

function indexForTimestamp(ts: string, startMs: number, hours: number): number | null {
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return null;
  // Snap to the hour so a ":30" provider timestamp still lands in a bucket.
  const index = Math.round((parsed - startMs) / MS_PER_HOUR);
  return index >= 0 && index < hours ? index : null;
}

interface DemandCorrection {
  /** Percentage deviation from normal demand, by series index. */
  residualByIndex: Map<number, number>;
  /** Correction strength (0-1) by series index, for the DF taper. */
  strengthByIndex: Map<number, number>;
  liveDemandTs: string | null;
  forecastHorizonHours: number;
  detail: string;
  used: boolean;
}

/**
 * Turn live `D` and day-ahead `DF` into per-hour demand deviations.
 *
 * The current hour usually has no actual reading yet (D lags ~1h), so we fall
 * back to DF and then to persistence — a demand deviation an hour old is a
 * better estimate of right now than assuming "perfectly normal".
 */
export function buildDemandCorrection(options: {
  profile: RegionProfile;
  livePoints: DemandPoint[];
  forecastPoints: DemandPoint[];
  climatologyPoints: ClimatologyPoint[];
  startMs: number;
  hours: number;
}): DemandCorrection {
  const empty: DemandCorrection = {
    residualByIndex: new Map(),
    strengthByIndex: new Map(),
    liveDemandTs: null,
    forecastHorizonHours: 0,
    detail: "",
    used: false,
  };
  const sensitivity = options.profile.demandSensitivity;
  const demandSlots = options.profile.demandSlots;
  if (!sensitivity?.applied || !demandSlots || demandSlots.length !== HOURS_PER_WEEK) {
    return empty;
  }

  const normalFor = (index: number): number | null => {
    const point = options.climatologyPoints[index];
    if (!point) return null;
    const normal = demandSlots[point.hourOfWeek];
    return Number.isFinite(normal) && normal > 0 ? normal : null;
  };

  const residualByIndex = new Map<number, number>();
  const strengthByIndex = new Map<number, number>();

  /** Hour-of-week normal for any timestamp, including ones before the series. */
  const normalForTs = (ts: string): number | null => {
    const parsed = Date.parse(ts);
    if (Number.isNaN(parsed)) return null;
    const parts = zonedParts(new Date(parsed), options.profile.timezone);
    const normal = demandSlots[parts.weekday * 24 + parts.hour];
    return Number.isFinite(normal) && normal > 0 ? normal : null;
  };

  const forecastByTs = new Map(options.forecastPoints.map((p) => [p.ts, p.mwh]));
  const actualByTs = new Map(options.livePoints.map((p) => [p.ts, p.mwh]));

  /**
   * Anchor the day-ahead forecast to the freshest *actual* reading.
   *
   * `D` (actual demand) and `DF` (day-ahead forecast) are not interchangeable.
   * Measured over 337 overlapping hours: PJM's DF tracks D to 4.3% and ERCOT's
   * to 1.2%, but CISO's ran 17-30% *below* actual on 2026-08-23 — CAISO's
   * day-ahead number simply isn't on the same basis as its metered demand.
   * Since `demandSlots` are built from `D`, feeding raw `DF` into them inherits
   * that bias wholesale: it read as demand being 8% *below* normal when actual
   * demand was 10% *above*, flipping the sign of the correction and reporting
   * the afternoon as the cleanest hour of the week when it was one of the
   * dirtiest.
   *
   * So we use DF only for its *shape* — the hour-to-hour change from now — and
   * take the level from real metered demand. A constant forecast bias cancels
   * exactly, and a drifting one only affects the delta.
   */
  let anchorTs: string | null = null;
  for (const point of options.livePoints) {
    if (!forecastByTs.has(point.ts)) continue;
    if (!anchorTs || Date.parse(point.ts) > Date.parse(anchorTs)) {
      anchorTs = point.ts;
    }
  }

  let anchorResidual: number | null = null;
  if (anchorTs) {
    const normal = normalForTs(anchorTs);
    const actual = actualByTs.get(anchorTs);
    if (normal !== null && actual !== undefined) {
      anchorResidual = demandResidualPercent(actual, normal);
    }
  }

  // Day-ahead forecast: covers the whole 13-16h horizon.
  let maxForecastIndex = -1;
  const anchorForecast = anchorTs ? forecastByTs.get(anchorTs) : undefined;
  for (const point of options.forecastPoints) {
    const index = indexForTimestamp(point.ts, options.startMs, options.hours);
    if (index === null) continue;
    const normal = normalFor(index);
    if (normal === null) continue;
    if (
      anchorResidual !== null &&
      anchorForecast !== undefined &&
      anchorForecast > 0
    ) {
      // Level from metered demand, shape from the forecast.
      const deltaPercent = ((point.mwh - anchorForecast) / normal) * 100;
      residualByIndex.set(index, anchorResidual + deltaPercent);
    } else {
      // No overlap to anchor against — the raw forecast is all we have.
      residualByIndex.set(index, demandResidualPercent(point.mwh, normal));
    }
    if (index > maxForecastIndex) maxForecastIndex = index;
  }

  // Actual demand wins wherever we have it (only the current hour, in practice).
  let liveDemandTs: string | null = null;
  let latestLiveResidual: number | null = null;
  for (const point of options.livePoints) {
    const index = indexForTimestamp(point.ts, options.startMs, options.hours);
    const normal = index === null ? null : normalFor(index);
    if (index !== null && normal !== null) {
      residualByIndex.set(index, demandResidualPercent(point.mwh, normal));
    }
    // Track the freshest reading even when it predates the series start.
    if (!liveDemandTs || Date.parse(point.ts) > Date.parse(liveDemandTs)) {
      liveDemandTs = point.ts;
    }
  }
  // Persistence for the current hour when nothing else covers it.
  if (!residualByIndex.has(0) && options.livePoints.length > 0) {
    const latest = options.livePoints[options.livePoints.length - 1];
    const hourOfWeek = options.climatologyPoints[0]?.hourOfWeek;
    // Compare last hour's demand against last hour's normal, not this hour's.
    const previousSlot = hourOfWeek === undefined ? null : (hourOfWeek + HOURS_PER_WEEK - 1) % HOURS_PER_WEEK;
    const normal = previousSlot === null ? null : demandSlots[previousSlot];
    if (normal && normal > 0) {
      latestLiveResidual = demandResidualPercent(latest.mwh, normal);
      residualByIndex.set(0, latestLiveResidual);
      // Persistence is a weaker claim than a real reading, so soften it.
      strengthByIndex.set(0, 0.7);
    }
  }

  // Taper toward zero across the last few DF hours so the correction does not
  // fall off a cliff when the forecast window ends.
  for (const index of residualByIndex.keys()) {
    if (strengthByIndex.has(index)) continue;
    if (maxForecastIndex < 0 || index > maxForecastIndex) {
      strengthByIndex.set(index, 1);
      continue;
    }
    const remaining = maxForecastIndex - index;
    strengthByIndex.set(
      index,
      remaining >= DF_TAPER_HOURS ? 1 : (remaining + 1) / (DF_TAPER_HOURS + 1),
    );
  }

  const horizon = maxForecastIndex + 1;
  return {
    residualByIndex,
    strengthByIndex,
    liveDemandTs,
    forecastHorizonHours: Math.max(0, horizon),
    detail:
      `Live demand${liveDemandTs ? ` to ${liveDemandTs}` : ""}` +
      (horizon > 0 ? ` plus a ${horizon}h day-ahead demand forecast` : "") +
      ` (fit r=${sensitivity.r.toFixed(2)}, ${sensitivity.baselineRmse}→${sensitivity.correctedRmse} gCO2/kWh).`,
    used: residualByIndex.size > 0,
  };
}

/**
 * Build the snapshot the UI reads.
 *
 * Never throws for provider reasons: a missing key, a rate limit or a network
 * failure downgrades the answer and shows up in `providers[]` and `notes[]`,
 * because a modelled week is far more useful to a homeowner than an error.
 */
export async function buildSnapshot(
  region: RegionInfo,
  options: BuildSnapshotOptions = {},
): Promise<GridSnapshot> {
  const now = options.now ?? new Date();
  const hours = Math.max(1, Math.floor(options.hours ?? HOURS_PER_WEEK));
  const start = floorToHourUtc(now);
  const startMs = start.getTime();
  const offline = options.offline === true;
  const apiKey =
    options.eiaApiKey !== undefined ? options.eiaApiKey : eiaApiKey();
  const emToken =
    options.electricityMapsToken !== undefined
      ? options.electricityMapsToken
      : electricityMapsToken();
  const wtCredentials =
    options.wattTimeCredentials !== undefined
      ? options.wattTimeCredentials
      : wattTimeCredentials();
  const decayHours = Math.max(
    1,
    options.correctionDecayHours ?? DEFAULT_CORRECTION_DECAY_HOURS,
  );

  // 1. Profile.
  const resolved = options.profile
    ? {
        profile: options.profile,
        tier: options.profileTier ?? ("bundled" as ProfileTier),
        respondent: options.profile.ba,
        detail: options.profile.notes[0] ?? "Supplied profile.",
        upgrading: false,
      }
    : await resolveProfile(region, {
        apiKey,
        fetchImpl: options.fetchImpl,
        now,
        offline,
        ...options.profileOptions,
      });
  const profile = resolved.profile;
  const isModelled = profile.source === "modelled";

  // 2. Climatology skeleton for the whole horizon.
  const climatology = projectSeries(profile, { start, hours });

  // 3. Everything optional, in parallel. Demand is only worth fetching when the
  //    fitted sensitivity says demand actually predicts intensity here.
  const wantDemand =
    !offline && apiKey !== null && profile.demandSensitivity?.applied === true;
  const [electricityMaps, wattTime, liveDemand, demandForecast] = await Promise.all([
    offline
      ? null
      : fetchElectricityMaps({
          token: emToken,
          ba: region.ba,
          zone: region.electricityMapsZone,
          fetchImpl: options.fetchImpl,
        }),
    offline
      ? null
      : fetchWattTime({
          credentials: wtCredentials,
          ba: region.ba,
          fetchImpl: options.fetchImpl,
        }),
    wantDemand
      ? fetchLiveDemand({
          apiKey: apiKey!,
          ba: resolved.respondent,
          now,
          fetchImpl: options.fetchImpl,
        }).catch(() => null)
      : null,
    wantDemand
      ? fetchDemandForecast({
          apiKey: apiKey!,
          ba: resolved.respondent,
          now,
          fetchImpl: options.fetchImpl,
        }).catch(() => null)
      : null,
  ]);

  const demand = buildDemandCorrection({
    profile,
    livePoints: liveDemand?.points ?? [],
    forecastPoints: demandForecast?.points ?? [],
    climatologyPoints: climatology,
    startMs,
    hours,
  });

  // 4. Provider forecast points, indexed by series position.
  const emForecastByIndex = new Map<number, number>();
  for (const point of electricityMaps?.forecast ?? []) {
    const index = indexForTimestamp(point.ts, startMs, hours);
    if (index !== null) emForecastByIndex.set(index, point.gCO2PerKWh);
  }

  // 5. Values, in precedence order: climatology -> demand nowcast ->
  //    Electricity Maps forecast -> Electricity Maps live anchor.
  const sources: DataSource[] = [];
  const values: number[] = [];
  for (let index = 0; index < hours; index += 1) {
    const base = climatology[index].gCO2PerKWh;
    let value = base;
    let source: DataSource = "climatology";

    const residual = demand.residualByIndex.get(index);
    if (residual !== undefined) {
      const corrected = applyDemandCorrection(
        base,
        residual,
        profile.demandSensitivity,
        { strength: demand.strengthByIndex.get(index) ?? 1 },
      );
      if (corrected.corrected) {
        value = corrected.value;
        source = "blend";
      }
    }

    // Electricity Maps measures intensity directly, so where it has a forecast
    // it beats a demand proxy outright.
    const forecast = emForecastByIndex.get(index);
    if (forecast !== undefined && forecast > 0) {
      value = forecast;
      source = "forecast";
    }

    values.push(value);
    sources.push(source);
  }

  // 6. Live anchor. A multiplicative correction (rather than additive) keeps the
  //    shape of the week intact, and decays linearly to nothing so the far end
  //    of the forecast is pure climatology again.
  const liveReading = electricityMaps?.live ?? null;
  let anchorRatio: number | null = null;
  if (liveReading && values[0] > 0) {
    const ratio = liveReading.gCO2PerKWh / values[0];
    if (Number.isFinite(ratio)) {
      anchorRatio = clamp(ratio, MIN_ANCHOR_RATIO, MAX_ANCHOR_RATIO);
    }
  }
  if (anchorRatio !== null && Math.abs(anchorRatio - 1) > 0.001) {
    for (let index = 0; index < hours; index += 1) {
      const decay = Math.max(0, 1 - index / decayHours);
      if (decay <= 0) break;
      const factor = 1 + (anchorRatio - 1) * decay;
      values[index] = values[index] * factor;
      if (sources[index] === "climatology") sources[index] = "blend";
    }
    sources[0] = "live";
  }

  // 7. Stats and percentiles over the whole window.
  const rounded = values.map((value) => round(value, 1));
  const stats = seriesStats(rounded);
  const hasNearTermAnchor = anchorRatio !== null || demand.residualByIndex.has(0);
  const confidenceCap: Confidence = isModelled ? "low" : "high";

  const series: IntensityPoint[] = rounded.map((value, index) => {
    const point = climatology[index];
    const source = sources[index];
    let confidence: Confidence;
    if (source === "live") confidence = "high";
    else if (source === "forecast") confidence = index <= 24 ? "high" : "medium";
    else if (hasNearTermAnchor && index <= 24) confidence = "high";
    else if (index <= 72) confidence = "medium";
    else confidence = "low";
    // A modelled archetype can still carry a genuinely live first point, but
    // everything downstream of it is still a model.
    if (source !== "live" && source !== "forecast") {
      confidence = weakerOf(confidence, confidenceCap);
    }
    const fuelMix =
      index === 0 && liveReading?.fuelMix ? liveReading.fuelMix : point.fuelMix;
    return {
      ts: point.ts,
      gCO2PerKWh: value,
      source,
      confidence,
      fuelMix,
      carbonFreeShare:
        index === 0 && liveReading?.carbonFreeShare !== undefined
          ? round(liveReading.carbonFreeShare, 4)
          : point.carbonFreeShare,
      cleanlinessPercentile: cleanlinessPercentile(value, rounded),
    };
  });

  // 8. Honest attribution for every provider, used or not.
  const providers: ProviderAttribution[] = [];
  providers.push({
    id: "eia",
    label: "U.S. Energy Information Administration",
    role: "Hourly generation by fuel type, averaged into a week-shaped forecast",
    used: profile.source === "eia",
    detail: resolved.detail,
  });
  providers.push({
    id: "eia-demand",
    label: "EIA grid demand",
    role: "Nowcast for the current hour and the next ~15 hours",
    used: demand.used,
    detail: demand.used
      ? demand.detail
      : profile.demandSensitivity
        ? `Not used: on this grid intensity is driven by wind and solar, not demand (fit r=${profile.demandSensitivity.r.toFixed(2)}).`
        : apiKey
          ? "No demand history available for this region."
          : "Needs an EIA API key.",
  });
  if (electricityMaps) providers.push(electricityMaps.attribution);
  else {
    providers.push({
      id: "electricity-maps",
      label: "Electricity Maps",
      role: "Live intensity and 24h forecast",
      used: false,
      detail: "Skipped (offline mode).",
    });
  }
  if (wattTime) providers.push(wattTime.attribution);
  else {
    providers.push({
      id: "watttime",
      label: "WattTime",
      role: "Independent cleanliness ranking (marginal emissions)",
      used: false,
      detail: "Skipped (offline mode).",
    });
  }
  providers.push({
    id: "fallback",
    label: "GridMap model",
    role: "Physically plausible archetype for regions with no usable data",
    used: isModelled,
    detail: isModelled
      ? (profile.notes[0] ?? "Modelled estimate.")
      : "Not needed — we had real data for this region.",
  });

  // 9. Notes: only things a person would actually want to know.
  const notes: string[] = [];
  if (isModelled) {
    notes.push(
      "These numbers are a modelled estimate for a grid like yours, not a measurement.",
    );
  }
  notes.push(...profile.notes);
  if (resolved.tier === "eia-region") {
    notes.push(
      `${region.ba} does not publish a full fuel mix, so this uses real data for the wider ${resolved.respondent} region.`,
    );
  }
  if (resolved.upgrading) {
    notes.push("A fuller year of history is being loaded in the background.");
  }
  if (!liveReading) {
    notes.push(
      demand.used
        ? "EIA's fuel-mix data runs about half a day behind, so the current hour is nowcast from live grid demand."
        : "EIA's fuel-mix data runs about half a day behind, so the current hour is modelled from history rather than measured.",
    );
  }
  if (wattTime?.rawIndex !== null && wattTime?.rawIndex !== undefined) {
    notes.push(
      `WattTime independently ranks right now at ${Math.round(wattTime.cleanlinessPercentile ?? 0)}/100 for cleanliness among the next 24 hours.`,
    );
  }
  const credentials = credentialStatus();
  if (!credentials.electricityMaps && !isModelled) {
    notes.push(
      "Add an Electricity Maps token for a minute-by-minute live reading.",
    );
  }

  // 10. Cache lifetime tracks the freshest thing we used.
  const ttlSeconds = liveReading ? 900 : demand.used ? 1800 : 3600;

  return {
    region,
    now: series[0],
    series,
    stats,
    providers,
    generatedAt: now.toISOString(),
    ttlSeconds,
    notes,
  };
}

/** Series index for a timestamp, or -1. Handy for the UI and for tests. */
export function seriesIndexFor(snapshot: GridSnapshot, ts: string | Date): number {
  if (snapshot.series.length === 0) return -1;
  const startMs = Date.parse(snapshot.series[0].ts);
  const target = typeof ts === "string" ? Date.parse(ts) : ts.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(target)) return -1;
  const index = Math.round((target - startMs) / MS_PER_HOUR);
  return index >= 0 && index < snapshot.series.length ? index : -1;
}

/** The hour with the lowest intensity in the window, for "next clean window" copy. */
export function cleanestPoint(snapshot: GridSnapshot): IntensityPoint | null {
  let best: IntensityPoint | null = null;
  for (const point of snapshot.series) {
    if (!best || point.gCO2PerKWh < best.gCO2PerKWh) best = point;
  }
  return best;
}

/** Convenience for the hero copy: what is carrying the grid right now. */
export function nowDrivenBy(snapshot: GridSnapshot): {
  dominant?: FuelType;
  dominantClean?: FuelType;
} {
  return {
    dominant: dominantFuel(snapshot.now.fuelMix, { minShare: 0.15 }),
    dominantClean: dominantFuel(snapshot.now.fuelMix, {
      cleanOnly: true,
      minShare: 0.15,
    }),
  };
}
