/**
 * Demand nowcasting.
 *
 * EIA's fuel-mix dataset lags 9-12 hours (measured 2026-08-23: CISO 9h, PJM
 * 12h, ERCO 11h), so it cannot tell us what the grid is doing *right now* —
 * which is the app's headline number. But the sibling `region-data` dataset,
 * on the same API key, is far fresher:
 *
 *  - `D`  (actual demand) lags about **1 hour**.
 *  - `DF` (day-ahead demand forecast) runs **13-16 hours into the future**.
 *
 * Demand is not carbon intensity, but in demand-driven grids it is a strong
 * proxy: extra load is met by marginal fossil plant, so intensity rises with
 * demand. Fitted on 90 days of real data, the residual regression gives
 * CAISO r=0.79 (RMSE 65.7 -> 40.2 gCO2/kWh, -39%) and PJM r=0.83 (25.6 -> 14.2,
 * -44%). In wind-driven grids the relationship simply is not there: SPP r=0.01,
 * ERCOT r=-0.19. So we fit per BA and **only apply the correction when the fit
 * earns it** — no hand-tuned per-region rules, so this self-calibrates as grids
 * change.
 */

import { round } from "./stats";
import { buildScalarClimatology } from "./climatology";
import {
  EIA_REGION_DATA_PATH,
  fetchEiaRows,
  parseEiaPeriod,
  type EiaFetchOptions,
} from "./eia";
import { zonedParts } from "./time";
import type { DemandSensitivity, FetchLike, HourlySample } from "./types";

/** `type` facet values in the region-data dataset. */
export const REGION_DATA_TYPES = {
  demand: "D",
  demandForecast: "DF",
  netGeneration: "NG",
  totalInterchange: "TI",
} as const;

/** |r| below this and we do not trust the relationship at all. */
export const MIN_DEMAND_FIT_R = 0.4;
/** Fewer hours than this and the correlation is not evidence of anything. */
export const MIN_DEMAND_FIT_SAMPLES = 500;
/** Demand deviations beyond this are extrapolation, so we clip the input. */
export const MAX_DEMAND_RESIDUAL_PERCENT = 30;
/** And the output can never move the answer by more than this fraction. */
export const MAX_CORRECTION_FRACTION = 0.35;

/** One row of the region-data dataset. Note `type`, not `fueltype`. */
export interface RegionDataRow {
  period: string;
  respondent?: string;
  type: string;
  "type-name"?: string;
  value: number | string | null;
  "value-units"?: string;
}

export interface DemandPoint {
  ts: string;
  epochMs: number;
  mwh: number;
}

export function rowsToDemandPoints(rows: RegionDataRow[]): DemandPoint[] {
  const byHour = new Map<number, number>();
  for (const row of rows) {
    if (!row) continue;
    const epochMs = parseEiaPeriod(row.period);
    if (epochMs === null) continue;
    const raw = typeof row.value === "string" ? Number(row.value) : row.value;
    if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
    // Demand is never legitimately negative; a negative row is bad data.
    if (raw <= 0) continue;
    // Later pages can repeat an hour after a revision; last write wins because
    // rows arrive newest-first.
    if (!byHour.has(epochMs)) byHour.set(epochMs, raw);
  }
  return [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([epochMs, mwh]) => ({ ts: new Date(epochMs).toISOString(), epochMs, mwh }));
}

export interface FetchDemandOptions extends EiaFetchOptions {
  apiKey: string;
  ba: string;
  type?: string;
  start: Date;
  end: Date;
}

export interface FetchDemandResult {
  points: DemandPoint[];
  warnings: string[];
  truncated: boolean;
}

async function fetchDemandRows(
  options: FetchDemandOptions,
): Promise<FetchDemandResult> {
  const { rows, warnings, truncated } = await fetchEiaRows<RegionDataRow>(
    {
      apiKey: options.apiKey,
      path: EIA_REGION_DATA_PATH,
      facets: {
        respondent: [options.ba.toUpperCase()],
        type: [options.type ?? REGION_DATA_TYPES.demand],
      },
      start: options.start,
      end: options.end,
    },
    options,
  );
  return { points: rowsToDemandPoints(rows), warnings, truncated };
}

/** Historical actual demand, for fitting. */
export function fetchDemandHistory(options: {
  apiKey: string;
  ba: string;
  days?: number;
  now?: Date;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
  baseUrl?: string;
}): Promise<FetchDemandResult> {
  const now = options.now ?? new Date();
  const days = Math.max(1, Math.floor(options.days ?? 90));
  return fetchDemandRows({
    apiKey: options.apiKey,
    ba: options.ba,
    type: REGION_DATA_TYPES.demand,
    start: new Date(now.getTime() - days * 86_400_000),
    end: new Date(now.getTime() + 3_600_000),
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    // One value per hour, so 90 days is ~2,160 rows: a single page.
    pageSize: 5000,
    maxPages: options.days && options.days > 200 ? 4 : 2,
    requestTimeoutMs: options.requestTimeoutMs ?? 8_000,
    totalTimeoutMs: options.totalTimeoutMs ?? 12_000,
  });
}

/** The freshest actual demand reading — usually the hour just gone. */
export function fetchLiveDemand(options: {
  apiKey: string;
  ba: string;
  hours?: number;
  now?: Date;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): Promise<FetchDemandResult> {
  const now = options.now ?? new Date();
  const hours = Math.max(1, Math.floor(options.hours ?? 8));
  return fetchDemandRows({
    apiKey: options.apiKey,
    ba: options.ba,
    type: REGION_DATA_TYPES.demand,
    start: new Date(now.getTime() - hours * 3_600_000),
    end: new Date(now.getTime() + 3_600_000),
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    pageSize: 200,
    maxPages: 1,
    requestTimeoutMs: 5_000,
    totalTimeoutMs: 6_000,
  });
}

/** Day-ahead demand forecast, i.e. the only free forward-looking signal we get. */
export function fetchDemandForecast(options: {
  apiKey: string;
  ba: string;
  hoursAhead?: number;
  now?: Date;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): Promise<FetchDemandResult> {
  const now = options.now ?? new Date();
  const ahead = Math.max(1, Math.floor(options.hoursAhead ?? 36));
  return fetchDemandRows({
    apiKey: options.apiKey,
    ba: options.ba,
    type: REGION_DATA_TYPES.demandForecast,
    // Reach back a little so we always capture the current hour too.
    start: new Date(now.getTime() - 4 * 3_600_000),
    end: new Date(now.getTime() + ahead * 3_600_000),
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    pageSize: 500,
    maxPages: 1,
    requestTimeoutMs: 5_000,
    totalTimeoutMs: 6_000,
  });
}

export interface BuildDemandModelOptions {
  timezone: string;
  targetDate?: Date;
  now?: Date;
  recencyHalfLifeDays?: number;
  seasonalSigmaDays?: number;
  shrinkageWeight?: number;
  /** Override the gate in tests. */
  minR?: number;
  minSamples?: number;
}

export interface DemandModel {
  /** Hour-of-week mean demand in MWh. */
  demandSlots: number[];
  sensitivity: DemandSensitivity;
}

/** Percentage deviation of an observed demand from its hour-of-week normal. */
export function demandResidualPercent(mwh: number, normalMwh: number): number {
  if (!Number.isFinite(mwh) || !Number.isFinite(normalMwh) || normalMwh <= 0) return 0;
  return ((mwh - normalMwh) / normalMwh) * 100;
}

/**
 * Fit `intensityResidual = intercept + slope * demandResidualPercent` by OLS.
 *
 * Both series are residuals against their own hour-of-week climatology, which
 * is what strips out the diurnal and weekly shape and leaves only the "today is
 * unusual" part. `applied` is set from |r| and n, never by hand.
 */
export function buildDemandModel(
  intensitySamples: HourlySample[],
  demandPoints: DemandPoint[],
  intensitySlots: number[],
  options: BuildDemandModelOptions,
): DemandModel {
  const timezone = options.timezone;
  const demandClimatology = buildScalarClimatology(
    demandPoints.map((point) => ({ epochMs: point.epochMs, value: point.mwh })),
    options,
  );
  const demandByHour = new Map<number, number>();
  for (const point of demandPoints) demandByHour.set(point.epochMs, point.mwh);

  const xs: number[] = [];
  const ys: number[] = [];
  for (const sample of intensitySamples) {
    const demand = demandByHour.get(sample.epochMs);
    if (demand === undefined) continue;
    const parts = zonedParts(new Date(sample.epochMs), timezone);
    const slot = parts.weekday * 24 + parts.hour;
    const normalDemand = demandClimatology.slots[slot];
    const normalIntensity = intensitySlots[slot];
    if (!normalDemand || !normalIntensity) continue;
    xs.push(demandResidualPercent(demand, normalDemand));
    ys.push(sample.gCO2PerKWh - normalIntensity);
  }

  const n = xs.length;
  const empty: DemandSensitivity = {
    slope: 0,
    intercept: 0,
    r: 0,
    n,
    baselineRmse: 0,
    correctedRmse: 0,
    applied: false,
  };
  if (n < 2) return { demandSlots: demandClimatology.slots, sensitivity: empty };

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) {
    return { demandSlots: demandClimatology.slots, sensitivity: { ...empty, n } };
  }
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = sxy / Math.sqrt(sxx * syy);

  let baselineSq = 0;
  let correctedSq = 0;
  for (let i = 0; i < n; i += 1) {
    baselineSq += ys[i] * ys[i];
    const residual = ys[i] - (intercept + slope * xs[i]);
    correctedSq += residual * residual;
  }

  const minR = options.minR ?? MIN_DEMAND_FIT_R;
  const minSamples = options.minSamples ?? MIN_DEMAND_FIT_SAMPLES;
  return {
    demandSlots: demandClimatology.slots,
    sensitivity: {
      slope: round(slope, 4),
      intercept: round(intercept, 4),
      r: round(r, 4),
      n,
      baselineRmse: round(Math.sqrt(baselineSq / n), 2),
      correctedRmse: round(Math.sqrt(correctedSq / n), 2),
      // A negative correlation is still a usable relationship, so gate on |r|.
      applied: Math.abs(r) >= minR && n >= minSamples,
    },
  };
}

/**
 * Nudge a climatology intensity using a demand deviation.
 *
 * Returns the climatology value untouched when the fit was not good enough, and
 * clamps hard in both directions: the demand input is clipped to +-30% and the
 * resulting move to +-35% of the climatology value, so a data glitch or a heat
 * wave can never produce a physically absurd number.
 */
export function applyDemandCorrection(
  climatologyIntensity: number,
  residualPercent: number,
  sensitivity: DemandSensitivity | null | undefined,
  options: { strength?: number } = {},
): { value: number; corrected: boolean } {
  if (!sensitivity?.applied || !Number.isFinite(climatologyIntensity)) {
    return { value: climatologyIntensity, corrected: false };
  }
  const strength = Math.min(1, Math.max(0, options.strength ?? 1));
  if (strength <= 0) return { value: climatologyIntensity, corrected: false };
  const clippedResidual = Math.min(
    MAX_DEMAND_RESIDUAL_PERCENT,
    Math.max(-MAX_DEMAND_RESIDUAL_PERCENT, residualPercent),
  );
  /**
   * Slope only — the intercept is deliberately left out.
   *
   * `intercept` is not a demand effect: it's the level offset between the
   * profile (a recency- and season-weighted, shrunk climatology) and the plain
   * mean of the window the regression was fitted over. For CISO it comes out
   * around -19 gCO2/kWh. Applying it here would subtract that offset from the
   * hours that happen to get a demand correction and not from their neighbours,
   * putting a ~19 g step in the middle of the series and making a corrected
   * hour look artificially cleaner than the uncorrected hour beside it. The
   * slope term is the part that actually answers "is today unusual?".
   */
  const raw = sensitivity.slope * clippedResidual * strength;
  const limit = Math.abs(climatologyIntensity) * MAX_CORRECTION_FRACTION;
  const delta = Math.min(limit, Math.max(-limit, raw));
  const value = Math.max(1, climatologyIntensity + delta);
  // Sub-gram moves are not worth relabelling a point as a nowcast.
  return { value, corrected: Math.abs(delta) >= 0.5 };
}
