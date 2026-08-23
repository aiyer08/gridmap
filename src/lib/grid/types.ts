/**
 * Types internal to the grid data engine.
 *
 * `src/lib/types.ts` holds the contract the UI reads. These are the
 * intermediate shapes the engine passes between fetching, modelling and
 * blending — they are exported so tests can build fixtures without network.
 */

import type {
  Confidence,
  FuelMix,
  ProviderAttribution,
  SeriesStats,
} from "../types";

/** Minimal `fetch` shape, injected everywhere so tests never hit the network. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    /** Set by callers that enforce a timeout. Real `fetch` honours it. */
    signal?: AbortSignal;
  },
) => Promise<FetchLikeResponse>;

/** The parts of `Response` we actually use. */
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}

/** One hour of observed generation, already normalised into fuel shares. */
export interface HourlySample {
  /** ISO-8601 UTC timestamp for the start of the hour. */
  ts: string;
  /** Milliseconds since epoch for the start of the hour (cached for maths). */
  epochMs: number;
  fuelMix: FuelMix;
  gCO2PerKWh: number;
  carbonFreeShare: number;
  /** Total generation in MWh across all fuels, used to weight/spot outliers. */
  totalMwh: number;
}

/**
 * One of 168 hour-of-week buckets. Index is `localDayOfWeek * 24 + localHour`
 * with Sunday = 0, computed in the region's timezone (so DST is handled by
 * whatever the local clock said at that moment).
 */
export interface ProfileSlot {
  hourOfWeek: number;
  gCO2PerKWh: number;
  fuelMix: FuelMix;
  carbonFreeShare: number;
  /** Number of historical hours that landed in this bucket. */
  sampleCount: number;
  /** Sum of recency x seasonal weights — a better confidence proxy than count. */
  weight: number;
}

/**
 * How strongly this grid's carbon intensity tracks demand.
 *
 * Fitted per BA from history rather than assumed, because the answer is
 * completely different depending on what sets the margin. In demand-driven
 * grids (CAISO r=0.79, PJM r=0.83) above-normal demand means more marginal gas
 * and measurably higher intensity. In wind-driven grids (SPP r=0.01,
 * ERCOT r=-0.19) demand carries no signal at all, so we must not pretend it
 * does — hence `applied`.
 */
export interface DemandSensitivity {
  /** gCO2/kWh per 1 percentage point of demand above the hour's normal. */
  slope: number;
  /** OLS intercept, in gCO2/kWh. Near zero by construction. */
  intercept: number;
  /** Pearson correlation of the two residual series. This is the gate. */
  r: number;
  /** Hours that went into the fit. */
  n: number;
  /** Root-mean-square intensity residual before the correction, gCO2/kWh. */
  baselineRmse: number;
  /** RMSE after applying the fit — lower is the whole point. */
  correctedRmse: number;
  /** True when the fit is strong enough that we actually use it. */
  applied: boolean;
}

/** A serialisable hour-of-week climatology for one balancing authority. */
export interface RegionProfile {
  ba: string;
  /** IANA timezone the hour-of-week buckets are defined in. */
  timezone: string;
  /** "eia" = built from real history, "modelled" = archetype fallback. */
  source: "eia" | "modelled";
  /** ISO-8601 timestamp the profile was computed. */
  generatedAt: string;
  /** ISO date the seasonal kernel was centred on. */
  targetDate: string;
  /** How many distinct historical hours fed the model (0 for archetypes). */
  hoursOfHistory: number;
  /** Always 168 entries, indexed by hour-of-week. */
  slots: ProfileSlot[];
  /** Distribution of the 168 slot intensities. */
  stats: SeriesStats;
  /**
   * Hour-of-week mean demand in MWh, parallel to `slots`. Needed to turn a live
   * demand reading into a *deviation from normal*, which is the only form the
   * regression can use. Absent when the demand pull failed.
   */
  demandSlots?: number[];
  demandSensitivity?: DemandSensitivity | null;
  notes: string[];
}

/** A forecast point contributed by an external provider. */
export interface ProviderForecastPoint {
  /** ISO-8601 UTC timestamp for the start of the hour. */
  ts: string;
  gCO2PerKWh: number;
}

/** What an optional provider managed to return, plus honest attribution. */
export interface ProviderResult<T> {
  data: T | null;
  attribution: ProviderAttribution;
}

/** Live "right now" reading from a provider. */
export interface LiveReading {
  ts: string;
  gCO2PerKWh: number;
  fuelMix?: FuelMix;
  carbonFreeShare?: number;
  confidence: Confidence;
}
