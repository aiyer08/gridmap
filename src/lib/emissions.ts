import type { FuelMix, FuelType } from "./types";

/**
 * Lifecycle carbon intensity by fuel, in grams CO2-equivalent per kWh.
 *
 * Non-fossil values are IPCC AR5 (WG3 Annex III) lifecycle medians, the same
 * basis Electricity Maps reports on. Lifecycle rather than stack-only, so solar,
 * wind and nuclear come out small but non-zero — more honest, and easier to
 * explain than a zero.
 *
 * The three fossil values are **US-fleet-specific and deliberately not AR5**,
 * because AR5's medians are global figures for representative modern plants and
 * two of them turned out to be *lower than the US fleet's measured
 * combustion-only* emissions — which is impossible for the same fleet, since
 * lifecycle must include combustion. Using EIA's measured 2023 US generation
 * (Electric Power Annual / EIA FAQ, converted at 453.59237 g/lb):
 *
 *   coal 2.31 lb/kWh = 1048 g/kWh combustion   (AR5 lifecycle said 820)
 *   oil  2.46 lb/kWh = 1116 g/kWh combustion   (AR5 lifecycle said 650)
 *   gas  0.96 lb/kWh =  435 g/kWh combustion
 *
 * So each fossil factor is the measured US combustion figure plus an upstream
 * (extraction, processing, transport, construction) allowance:
 *
 *   coal 1048 + ~60  -> 1100
 *   oil  1116 + ~85  -> 1200
 *   gas   435 + ~91  ->  530
 *
 * The gas uplift of 91 is AR5's own implied lifecycle premium over combined-cycle
 * combustion (490 - 399, using EIA's 7,548 Btu/kWh CCGT heat rate and its
 * 52.91 kg CO2/MMBtu carbon coefficient). Applying it to the *fleet average*
 * rather than to CCGT alone matters here, because EIA reports every gas plant
 * under one `NG` code — combined-cycle at ~399 g/kWh combustion alongside
 * simple-cycle peakers at ~582 — and peakers are exactly what covers the evening
 * ramp this app tells people to avoid. A flat 490 understated that peak.
 *
 * What we deliberately do *not* do is vary the gas factor by hour. It would be
 * physically right, but EIA-930 carries no technology split to condition on;
 * doing it properly needs EIA-860/923 plant-level data joined to hourly output.
 */
export const LIFECYCLE_FACTORS: Record<FuelType, number> = {
  coal: 1100,
  gas: 530,
  oil: 1200,
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
  for (const mwh of Object.values(generation)) {
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
