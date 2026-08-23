import type { FuelMix, FuelType } from "./types";

/**
 * Lifecycle carbon intensity by fuel, in grams CO2-equivalent per kWh.
 *
 * Values are IPCC AR5 (WG3 Annex III) medians for lifecycle emissions, which is
 * also what Electricity Maps reports by default. Lifecycle (rather than
 * stack-only) numbers are used so that solar, wind and nuclear are small but
 * non-zero, which is both more honest and easier to explain.
 */
export const LIFECYCLE_FACTORS: Record<FuelType, number> = {
  coal: 820,
  gas: 490,
  oil: 650,
  nuclear: 12,
  hydro: 24,
  solar: 48,
  wind: 11,
  // EIA's "other" bucket is a mix of biomass, geothermal, waste heat and
  // unclassified units. 300 sits between biomass (230) and waste-to-energy.
  other: 300,
  // Batteries move energy rather than making it; charge/discharge shows up as
  // negative/positive net generation and is excluded from the mix.
  storage: 0,
};

/** Direct combustion-only factors, kept for the "how we calculate" panel. */
export const DIRECT_FACTORS: Record<FuelType, number> = {
  coal: 1000,
  gas: 450,
  oil: 850,
  nuclear: 0,
  hydro: 0,
  solar: 0,
  wind: 0,
  other: 230,
  storage: 0,
};

export const CARBON_FREE_FUELS: FuelType[] = [
  "nuclear",
  "hydro",
  "solar",
  "wind",
];

/**
 * EIA-930 fuel-type codes to our normalised buckets.
 *
 * Verified against the live facet list at
 * api.eia.gov/v2/electricity/rto/fuel-type-data/facet/fueltype (Aug 2026):
 * NUC, BAT, COL, OES, GEO, UNK, WNB, OIL, SNB, NG, PS, WND, OTH, WAT, SUN, UES.
 * WNB/SNB are wind/solar farms with co-located batteries, so they belong with
 * their generation source rather than with storage.
 */
export const EIA_FUEL_CODE_MAP: Record<string, FuelType> = {
  COL: "coal",
  NG: "gas",
  OIL: "oil",
  NUC: "nuclear",
  WAT: "hydro",
  SUN: "solar",
  SNB: "solar",
  WND: "wind",
  WNB: "wind",
  GEO: "other",
  BIO: "other",
  OTH: "other",
  UNK: "other",
  BAT: "storage",
  PS: "storage",
  OES: "storage",
  UES: "storage",
};

/**
 * Per-EIA-code lifecycle factors, used in preference to the bucket factor when
 * we know the exact code. This matters most for geothermal, which EIA reports
 * separately (GEO) but which we display inside the "Other" bucket: at 38
 * gCO2e/kWh it is nearly clean, while the mixed "Other" bucket sits at 300, so
 * bucketing it would overstate emissions in geothermal-heavy grids like CAISO.
 */
export const EIA_CODE_FACTORS: Record<string, number> = {
  GEO: 38,
  BIO: 230,
  OTH: 300,
  UNK: 300,
};

/** Lifecycle factor for a raw EIA fuel code. */
export function factorForEiaCode(code: string): number {
  const upper = code.toUpperCase();
  return EIA_CODE_FACTORS[upper] ?? LIFECYCLE_FACTORS[normaliseEiaFuelCode(upper)];
}

export function normaliseEiaFuelCode(code: string): FuelType {
  return EIA_FUEL_CODE_MAP[code.toUpperCase()] ?? "other";
}

/**
 * Intensity straight from raw EIA rows, using code-level factors.
 * `generation` maps EIA fuel codes to MWh for a single hour.
 */
export function intensityFromEiaGeneration(
  generation: Record<string, number>,
): number {
  let mwh = 0;
  let grams = 0;
  for (const [code, value] of Object.entries(generation)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    mwh += value;
    grams += value * factorForEiaCode(code);
  }
  return mwh > 0 ? grams / mwh : 0;
}

/** Weighted-average intensity of a fuel mix, in gCO2e/kWh. */
export function intensityFromMix(
  mix: FuelMix,
  factors: Record<FuelType, number> = LIFECYCLE_FACTORS,
): number {
  let total = 0;
  let weighted = 0;
  for (const [fuel, share] of Object.entries(mix) as [FuelType, number][]) {
    if (!Number.isFinite(share) || share <= 0) continue;
    total += share;
    weighted += share * factors[fuel];
  }
  if (total <= 0) return 0;
  return weighted / total;
}

/** Share of a mix coming from carbon-free sources (0–1). */
export function carbonFreeShare(mix: FuelMix): number {
  let total = 0;
  let clean = 0;
  for (const [fuel, share] of Object.entries(mix) as [FuelType, number][]) {
    if (!Number.isFinite(share) || share <= 0) continue;
    total += share;
    if (CARBON_FREE_FUELS.includes(fuel)) clean += share;
  }
  return total > 0 ? clean / total : 0;
}

/** Turn raw MWh-per-fuel into normalised shares, dropping storage discharge noise. */
export function mixFromGeneration(
  generation: Partial<Record<FuelType, number>>,
): FuelMix {
  const mix: FuelMix = {};
  let total = 0;
  for (const [fuel, mwh] of Object.entries(generation) as [
    FuelType,
    number,
  ][]) {
    if (!Number.isFinite(mwh) || mwh <= 0) continue;
    total += mwh;
  }
  if (total <= 0) return mix;
  for (const [fuel, mwh] of Object.entries(generation) as [
    FuelType,
    number,
  ][]) {
    if (!Number.isFinite(mwh) || mwh <= 0) continue;
    mix[fuel] = mwh / total;
  }
  return mix;
}

/** Human-friendly labels for fuel buckets. */
export const FUEL_LABELS: Record<FuelType, string> = {
  coal: "Coal",
  gas: "Natural gas",
  oil: "Oil",
  nuclear: "Nuclear",
  hydro: "Hydro",
  solar: "Solar",
  wind: "Wind",
  other: "Other",
  storage: "Batteries",
};
