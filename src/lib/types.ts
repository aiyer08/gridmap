/**
 * GridMap shared contracts.
 *
 * Everything in the app speaks these types. Providers (EIA, Electricity Maps,
 * WattTime) normalise into `IntensityPoint`; the UI only ever reads
 * `GridSnapshot` and `RunWindow`.
 */

/** Normalised fuel buckets. EIA-930 respondent codes map into these. */
export type FuelType =
  | "coal"
  | "gas"
  | "oil"
  | "nuclear"
  | "hydro"
  | "solar"
  | "wind"
  | "other"
  | "storage";

/** Fraction of generation (0–1) per fuel bucket. Sums to ~1. */
export type FuelMix = Partial<Record<FuelType, number>>;

/** Where a number came from, so the UI can be honest about confidence. */
export type DataSource =
  | "live" // measured right now by a provider
  | "forecast" // provider-published forward-looking number
  | "climatology" // our own model built from a year of history
  | "blend"; // climatology nudged by live/forecast data

export type Confidence = "high" | "medium" | "low";

export interface RegionInfo {
  /** EIA-930 balancing-authority code, e.g. "CISO". */
  ba: string;
  /** Official BA name, e.g. "California Independent System Operator". */
  name: string;
  /** Short human label used in the UI, e.g. "California grid (CAISO)". */
  shortName: string;
  /** IANA timezone the user's clock should be shown in. */
  timezone: string;
  /** Two-letter state code the ZIP resolved to. */
  state: string;
  /** Electricity Maps zone key, when one exists for this BA. */
  electricityMapsZone?: string;
  lat?: number;
  lon?: number;
  /** True when we inferred the BA from state-level data rather than a direct match. */
  approximate: boolean;
  /** How the region was determined, shown in the "where does this come from" panel. */
  matchedBy: "zip" | "zip3" | "state" | "manual" | "default";
}

export interface IntensityPoint {
  /** ISO-8601 UTC timestamp for the start of the hour. */
  ts: string;
  /** Carbon intensity in grams CO2-equivalent per kWh (lifecycle basis). */
  gCO2PerKWh: number;
  source: DataSource;
  confidence: Confidence;
  /** Present when derived from a fuel mix (EIA path). */
  fuelMix?: FuelMix;
  /** 0–100, share of hours in the next week that are dirtier than this one. */
  cleanlinessPercentile?: number;
  /** Share of generation from carbon-free sources (0–1), for the "clean" storyline. */
  carbonFreeShare?: number;
}

export interface ProviderAttribution {
  id:
    | "eia"
    // EIA's region-data feed: live demand (1h lag) and the day-ahead demand
    // forecast, used to nowcast the current hour. Separate from "eia" because
    // it is a different dataset with very different freshness.
    | "eia-demand"
    | "electricity-maps"
    | "watttime"
    | "fallback";
  label: string;
  /** What this provider contributed to the answer the user is looking at. */
  role: string;
  /** False when the provider was unavailable (missing key, error, rate limit). */
  used: boolean;
  detail?: string;
}

export interface SeriesStats {
  min: number;
  max: number;
  mean: number;
  p10: number;
  p90: number;
}

export interface GridSnapshot {
  region: RegionInfo;
  /** Intensity for the current hour. */
  now: IntensityPoint;
  /** Hourly points covering the forecast horizon, starting at the current hour. */
  series: IntensityPoint[];
  stats: SeriesStats;
  providers: ProviderAttribution[];
  /** ISO-8601 timestamp the snapshot was computed. */
  generatedAt: string;
  /** Cache/lifecycle hint in seconds. */
  ttlSeconds: number;
  /** Non-fatal problems worth surfacing quietly (e.g. "using modelled data"). */
  notes: string[];
}

export type ApplianceCategory =
  | "laundry"
  | "kitchen"
  | "climate"
  | "vehicle"
  | "water"
  | "other";

export interface Appliance {
  id: string;
  label: string;
  emoji: string;
  category: ApplianceCategory;
  /** Total energy for one typical run, in kWh. */
  kWhPerRun: number;
  /** How long one run takes, in hours (used to size the window). */
  durationHours: number;
  /** Rough plain-English description of the assumption, shown on hover. */
  assumption: string;
  /** False for things that must run when they must run (kept for honesty). */
  shiftable: boolean;
}

export type WindowQuality = "best" | "great" | "good";

export interface RunWindow {
  id: string;
  /** ISO-8601 UTC start of the window. */
  startTs: string;
  /** ISO-8601 UTC end of the window (start + appliance duration). */
  endTs: string;
  /** Mean gCO2/kWh across the window. */
  avgIntensity: number;
  /** Grams of CO2e for running the appliance in this window. */
  gramsCO2: number;
  /** Grams of CO2e for running it right now (the thing we compare against). */
  baselineGrams: number;
  /** 0–100. Positive means cleaner than the baseline. */
  savingsPercent: number;
  /** 1 = cleanest offered. */
  rank: number;
  quality: WindowQuality;
  /** Human label in the region's local time, e.g. "Tonight, 11 PM – 1 AM". */
  label: string;
  /** Shorter label for chips, e.g. "Tonight". */
  shortLabel: string;
  /** Dominant clean source during the window, e.g. "solar", for the copy. */
  drivenBy?: FuelType;
  confidence: Confidence;
}

export interface WindowPlan {
  appliance: Appliance;
  region: RegionInfo;
  /** Best windows, cleanest first, spread across different times of day. */
  windows: RunWindow[];
  /** The "if you ran it right now" reference point. */
  baseline: {
    startTs: string;
    endTs: string;
    avgIntensity: number;
    gramsCO2: number;
  };
  /** True when right now is already about as clean as it gets. */
  nowIsGreat: boolean;
}

/** A logged action the user took (or declined). */
export interface LoggedAction {
  id: string;
  kind: "shift" | "habit";
  /** Appliance id for shifts, habit id for habits. */
  subjectId: string;
  label: string;
  /** ISO-8601 timestamp of when the user logged it. */
  loggedAt: string;
  /** Grams of CO2e avoided. Zero for declined items (never negative). */
  gramsSaved: number;
  /** Grams the run would have produced at the baseline time. */
  baselineGrams?: number;
  /** Grams the run actually produced. */
  actualGrams?: number;
  status: "done" | "declined";
  regionBa?: string;
}

export interface Habit {
  id: string;
  label: string;
  emoji: string;
  /** Grams of CO2e avoided per log, using regional average intensity. */
  kWhSaved: number;
  detail: string;
}

export interface TrackerSummary {
  totalGramsSaved: number;
  actionCount: number;
  weekGramsSaved: number;
  weekActionCount: number;
  streakDays: number;
  /** Equivalences for the "what does that mean" copy. */
  equivalents: {
    milesDriven: number;
    phoneCharges: number;
    treeDays: number;
  };
}
