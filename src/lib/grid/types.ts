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
  init?: { method?: string; headers?: Record<string, string> },
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
