/**
 * The forecast model.
 *
 * The EIA publishes hourly generation by fuel type, but no forecast. What it
 * does give us is a year of history, and the grid is strongly periodic: the
 * single best predictor of "how clean is 2 PM next Tuesday" is "how clean was
 * 2 PM on recent Tuesdays". So we build an **hour-of-week climatology** — 168
 * buckets of local time — and weight each historical hour by two things:
 *
 *  - **Recency** (exponential, ~90 day half-life). Grid mix moves fast: CAISO
 *    added gigawatts of batteries and solar in a single year, so a hour from
 *    last month tells us much more than the same hour last spring.
 *  - **Seasonality** (Gaussian on *circular* day-of-year distance, sigma ~30d).
 *    July solar looks nothing like January solar. The circular distance matters
 *    so that a 2 January forecast can learn from late December.
 *
 * Sparse buckets are shrunk toward a coarser "day-type x hour-of-day" prior
 * (weekday vs weekend), which fills missing hours and quietens the noise you
 * get from averaging only a handful of samples.
 *
 * Everything here is pure: give it samples, get a serialisable profile back.
 */

import { carbonFreeShare, intensityFromMix } from "../emissions";
import type { FuelMix, FuelType } from "../types";
import { round, seriesStats } from "./stats";
import {
  addHours,
  circularDayDistance,
  floorToHourUtc,
  HOURS_PER_WEEK,
  hourOfSlot,
  isWeekendDay,
  MS_PER_DAY,
  safeTimeZone,
  weekdayOfSlot,
  zonedParts,
} from "./time";
import type { HourlySample, ProfileSlot, RegionProfile } from "./types";

/** Recent mix matters more; ~3 months is the timescale grids visibly change on. */
export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 90;
/** A month either side captures "this time of year" without over-narrowing. */
export const DEFAULT_SEASONAL_SIGMA_DAYS = 30;
/**
 * Pseudo-weight given to the coarse prior. A well-populated bucket carries a
 * weight of roughly 4-5, so 1.5 means the prior contributes ~25% smoothing and
 * takes over entirely when a bucket is empty.
 */
export const DEFAULT_SHRINKAGE_WEIGHT = 1.5;
/** Below this, a sample's contribution is rounding error — skip the work. */
const NEGLIGIBLE_WEIGHT = 1e-4;

export interface BuildProfileOptions {
  ba: string;
  timezone: string;
  /** Day the seasonal kernel is centred on. Defaults to `now`. */
  targetDate?: Date;
  /** Reference point for recency decay. Defaults to `targetDate` or now. */
  now?: Date;
  recencyHalfLifeDays?: number;
  seasonalSigmaDays?: number;
  shrinkageWeight?: number;
  source?: "eia" | "modelled";
  notes?: string[];
}

/** One projected hour, before any live/forecast blending. */
export interface ClimatologyPoint {
  ts: string;
  epochMs: number;
  gCO2PerKWh: number;
  fuelMix: FuelMix;
  carbonFreeShare: number;
  /** Weight behind the bucket this came from; low means "we are guessing". */
  slotWeight: number;
  hourOfWeek: number;
}

/** Exponential decay: weight halves every `halfLifeDays` of age. */
export function recencyWeight(
  sampleEpochMs: number,
  referenceEpochMs: number,
  halfLifeDays: number = DEFAULT_RECENCY_HALF_LIFE_DAYS,
): number {
  if (!Number.isFinite(sampleEpochMs) || !Number.isFinite(referenceEpochMs)) {
    return 0;
  }
  // Future-dated samples happen (provisional EIA rows, clock skew). Treat them
  // as "now" rather than letting them out-weigh everything else.
  const ageDays = Math.max(0, (referenceEpochMs - sampleEpochMs) / MS_PER_DAY);
  if (halfLifeDays <= 0) return ageDays === 0 ? 1 : 0;
  return Math.pow(2, -ageDays / halfLifeDays);
}

/** Gaussian kernel on circular day-of-year distance. */
export function seasonalWeight(
  sampleDayOfYear: number,
  targetDayOfYear: number,
  sigmaDays: number = DEFAULT_SEASONAL_SIGMA_DAYS,
): number {
  if (sigmaDays <= 0) return sampleDayOfYear === targetDayOfYear ? 1 : 0;
  const distance = circularDayDistance(sampleDayOfYear, targetDayOfYear);
  return Math.exp(-(distance * distance) / (2 * sigmaDays * sigmaDays));
}

/** Drop empty/negative buckets and rescale so the shares sum to 1. */
export function normaliseMix(mix: FuelMix): FuelMix {
  let total = 0;
  for (const share of Object.values(mix)) {
    if (Number.isFinite(share) && (share as number) > 0) total += share as number;
  }
  if (total <= 0) return {};
  const out: FuelMix = {};
  for (const [fuel, share] of Object.entries(mix) as [FuelType, number][]) {
    if (!Number.isFinite(share) || share <= 0) continue;
    out[fuel] = round(share / total, 5);
  }
  return out;
}

/** Weighted average of several fuel mixes (each is renormalised first). */
export function blendMixes(
  entries: { mix: FuelMix; weight: number }[],
): FuelMix {
  const totals = new Map<FuelType, number>();
  let weightSum = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) continue;
    const normalised = normaliseMix(entry.mix);
    if (Object.keys(normalised).length === 0) continue;
    weightSum += entry.weight;
    for (const [fuel, share] of Object.entries(normalised) as [
      FuelType,
      number,
    ][]) {
      totals.set(fuel, (totals.get(fuel) ?? 0) + share * entry.weight);
    }
  }
  if (weightSum <= 0) return {};
  const out: FuelMix = {};
  for (const [fuel, weighted] of totals) {
    out[fuel] = weighted / weightSum;
  }
  return normaliseMix(out);
}

interface Accumulator {
  weight: number;
  count: number;
  fuels: Map<FuelType, number>;
  /** Weight-weighted sum of the samples' own intensities. */
  intensitySum: number;
}

function emptyAccumulator(): Accumulator {
  return { weight: 0, count: 0, fuels: new Map(), intensitySum: 0 };
}

function accumulate(
  acc: Accumulator,
  mix: FuelMix,
  weight: number,
  intensity: number,
): void {
  const normalised = normaliseMix(mix);
  if (Object.keys(normalised).length === 0) return;
  acc.weight += weight;
  acc.count += 1;
  acc.intensitySum += intensity * weight;
  for (const [fuel, share] of Object.entries(normalised) as [
    FuelType,
    number,
  ][]) {
    acc.fuels.set(fuel, (acc.fuels.get(fuel) ?? 0) + share * weight);
  }
}

function accumulatorMix(acc: Accumulator): FuelMix {
  if (acc.weight <= 0) return {};
  const mix: FuelMix = {};
  for (const [fuel, weighted] of acc.fuels) mix[fuel] = weighted / acc.weight;
  return normaliseMix(mix);
}

function accumulatorIntensity(acc: Accumulator): number {
  return acc.weight > 0 ? acc.intensitySum / acc.weight : 0;
}

/**
 * Build a 168-bucket hour-of-week climatology from observed hourly samples.
 *
 * Samples may be sparse or have gaps; every bucket still comes out populated
 * because empty ones inherit the day-type prior (and, failing that, the
 * all-hours mean).
 */
export function buildProfile(
  samples: HourlySample[],
  options: BuildProfileOptions,
): RegionProfile {
  const timezone = safeTimeZone(options.timezone);
  const targetDate = options.targetDate ?? options.now ?? new Date();
  const referenceMs = (options.now ?? targetDate).getTime();
  const halfLife = options.recencyHalfLifeDays ?? DEFAULT_RECENCY_HALF_LIFE_DAYS;
  const sigma = options.seasonalSigmaDays ?? DEFAULT_SEASONAL_SIGMA_DAYS;
  const shrinkage = options.shrinkageWeight ?? DEFAULT_SHRINKAGE_WEIGHT;
  const targetDayOfYear = zonedParts(targetDate, timezone).dayOfYear;

  const slotAcc: Accumulator[] = Array.from({ length: HOURS_PER_WEEK }, emptyAccumulator);
  // Coarser priors: [weekend?][hour-of-day], then everything.
  const dayTypeAcc: Accumulator[][] = [
    Array.from({ length: 24 }, emptyAccumulator),
    Array.from({ length: 24 }, emptyAccumulator),
  ];
  const globalAcc = emptyAccumulator();
  let usedHours = 0;

  for (const sample of samples) {
    if (!Number.isFinite(sample.epochMs)) continue;
    const parts = zonedParts(new Date(sample.epochMs), timezone);
    const weight =
      recencyWeight(sample.epochMs, referenceMs, halfLife) *
      seasonalWeight(parts.dayOfYear, targetDayOfYear, sigma);
    if (!Number.isFinite(weight) || weight < NEGLIGIBLE_WEIGHT) continue;
    const slot = parts.weekday * 24 + parts.hour;
    // Intensity is averaged directly rather than recomputed from the averaged
    // mix. EIA rows give us code-level accuracy (geothermal at 38 g rather than
    // the 300 g "other" bucket), and that correction would be lost if we only
    // carried the display buckets forward.
    accumulate(slotAcc[slot], sample.fuelMix, weight, sample.gCO2PerKWh);
    accumulate(
      dayTypeAcc[isWeekendDay(parts.weekday) ? 1 : 0][parts.hour],
      sample.fuelMix,
      weight,
      sample.gCO2PerKWh,
    );
    accumulate(globalAcc, sample.fuelMix, weight, sample.gCO2PerKWh);
    usedHours += 1;
  }

  const globalMix = accumulatorMix(globalAcc);
  const globalIntensity = accumulatorIntensity(globalAcc);
  const slots: ProfileSlot[] = [];
  for (let index = 0; index < HOURS_PER_WEEK; index += 1) {
    const acc = slotAcc[index];
    const weekday = weekdayOfSlot(index);
    const hour = hourOfSlot(index);
    const prior = dayTypeAcc[isWeekendDay(weekday) ? 1 : 0][hour];
    const hasPrior = prior.weight > 0;
    const priorMix = hasPrior ? accumulatorMix(prior) : globalMix;
    const priorIntensity = hasPrior
      ? accumulatorIntensity(prior)
      : globalIntensity;
    const fuelMix = blendMixes([
      { mix: accumulatorMix(acc), weight: acc.weight },
      { mix: priorMix, weight: shrinkage },
    ]);
    // Shrink the intensity toward the same prior, by the same weights, so the
    // number and the breakdown tell a consistent story.
    const denominator = acc.weight + shrinkage;
    const shrunkIntensity =
      denominator > 0
        ? (accumulatorIntensity(acc) * acc.weight + priorIntensity * shrinkage) /
          denominator
        : 0;
    slots.push({
      hourOfWeek: index,
      fuelMix,
      // Fall back to the mix when there is no observed intensity at all, which
      // is how modelled archetypes and empty regions behave.
      gCO2PerKWh: round(shrunkIntensity > 0 ? shrunkIntensity : intensityFromMix(fuelMix), 1),
      carbonFreeShare: round(carbonFreeShare(fuelMix), 4),
      sampleCount: acc.count,
      weight: round(acc.weight, 4),
    });
  }

  const notes = [...(options.notes ?? [])];
  if (usedHours === 0) {
    notes.push("No usable history for this region — the profile is empty.");
  }

  return {
    ba: options.ba,
    timezone,
    source: options.source ?? "eia",
    generatedAt: new Date(referenceMs).toISOString(),
    targetDate: targetDate.toISOString().slice(0, 10),
    hoursOfHistory: samples.length,
    slots,
    stats: seriesStats(slots.map((slot) => slot.gCO2PerKWh)),
    notes,
  };
}

/** The bucket a given instant falls into, in the profile's timezone. */
export function slotAt(profile: RegionProfile, date: Date): ProfileSlot {
  const parts = zonedParts(date, profile.timezone);
  const index = parts.weekday * 24 + parts.hour;
  return profile.slots[index] ?? profile.slots[0];
}

export interface ProjectSeriesOptions {
  /** First hour of the series; floored to the hour in UTC. */
  start: Date;
  /** How many hourly points to emit. Defaults to a full week. */
  hours?: number;
}

/**
 * Turn a profile into an hourly series starting at `start`. Each future hour is
 * mapped back to its local hour-of-week, so DST transitions land on the right
 * bucket automatically.
 */
export function projectSeries(
  profile: RegionProfile,
  options: ProjectSeriesOptions,
): ClimatologyPoint[] {
  const start = floorToHourUtc(options.start);
  const hours = Math.max(1, Math.floor(options.hours ?? HOURS_PER_WEEK));
  const points: ClimatologyPoint[] = [];
  for (let index = 0; index < hours; index += 1) {
    const at = addHours(start, index);
    const parts = zonedParts(at, profile.timezone);
    const slotIndex = parts.weekday * 24 + parts.hour;
    const slot = profile.slots[slotIndex] ?? profile.slots[0];
    points.push({
      ts: at.toISOString(),
      epochMs: at.getTime(),
      gCO2PerKWh: slot?.gCO2PerKWh ?? 0,
      fuelMix: slot?.fuelMix ?? {},
      carbonFreeShare: slot?.carbonFreeShare ?? 0,
      slotWeight: slot?.weight ?? 0,
      hourOfWeek: slotIndex,
    });
  }
  return points;
}

/** Effective sample size behind a profile — used to decide whether to trust it. */
export function profileCoverage(profile: RegionProfile): {
  populatedSlots: number;
  medianWeight: number;
} {
  const weights = profile.slots.map((slot) => slot.weight).sort((a, b) => a - b);
  const populatedSlots = profile.slots.filter((slot) => slot.sampleCount > 0).length;
  const median =
    weights.length === 0
      ? 0
      : weights[Math.floor(weights.length / 2)];
  return { populatedSlots, medianWeight: round(median, 3) };
}
