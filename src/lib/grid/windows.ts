/**
 * The recommendation engine: given a week of hourly intensity and one appliance,
 * pick the handful of time windows worth telling a person about.
 *
 * This module is deliberately **pure and browser-safe** — no `fs`, no `env`, no
 * imports that reach the EIA client. The server fetches one `GridSnapshot`; the
 * browser re-plans instantly every time the user picks a different appliance.
 *
 * Two judgement calls are baked in, both in the user's favour:
 *
 *  - The baseline is **running it right now**, not the week's dirtiest hour.
 *    Comparing against the worst possible moment would inflate every number.
 *  - When two windows are within a rounding error of each other we offer the
 *    **earlier** one, because "tonight" beats "Thursday" for a person holding a
 *    basket of laundry.
 */

import { CARBON_FREE_FUELS } from "../emissions";
import { formatClock, relativeDayName } from "../format";
import type {
  Appliance,
  Confidence,
  FuelMix,
  FuelType,
  GridSnapshot,
  RunWindow,
  WindowPlan,
  WindowQuality,
} from "../types";
import { hourOfSlot, localDayKey, MS_PER_HOUR, zonedParts } from "./time";

/** Below this, "waiting" isn't a real saving — it's noise in our own forecast. */
export const NOW_IS_GREAT_THRESHOLD = 5;
/** Offer an earlier window when it's within this many points of the best one. */
export const EARLIER_BIAS_POINTS = 1.5;
/** Nudge against stacking every suggestion on one day. */
export const SAME_DAY_PENALTY_POINTS = 2;
/** Keep suggestions this far apart so they're genuinely different choices. */
export const MIN_SEPARATION_HOURS = 4;

export interface PlanOptions {
  /** Defaults to the first point in the series. */
  now?: Date;
  /** How many windows to offer. */
  count?: number;
  minSeparationHours?: number;
  /** Only consider windows starting within this many hours. */
  horizonHours?: number;
  earlierBiasPoints?: number;
  sameDayPenaltyPoints?: number;
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * How much of the run lands in each clock hour.
 *
 * A 90-minute dryer cycle started at 2 PM spends one full hour in the 2 PM
 * price and half an hour in the 3 PM one, so the hours are weighted rather than
 * averaged flat. Assumes steady power draw across the run, which is close
 * enough for every appliance we model.
 */
export function hourWeights(durationHours: number): number[] {
  const duration = Math.max(0.25, durationHours);
  const weights: number[] = [];
  let remaining = duration;
  while (remaining > 0) {
    weights.push(Math.min(1, remaining));
    remaining -= 1;
  }
  return weights;
}

interface Candidate {
  index: number;
  avgIntensity: number;
  savingsPercent: number;
}

/** Energy-weighted mean intensity for a run starting at `index`. */
function windowAverage(
  values: number[],
  index: number,
  weights: number[],
): number | null {
  let total = 0;
  let weight = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const value = values[index + i];
    if (value === undefined || !Number.isFinite(value)) return null;
    total += value * weights[i];
    weight += weights[i];
  }
  return weight > 0 ? total / weight : null;
}

/** Weakest confidence across the hours a run touches — the honest summary. */
function windowConfidence(
  snapshot: GridSnapshot,
  index: number,
  span: number,
): Confidence {
  let worst: Confidence = "high";
  for (let i = 0; i < span; i += 1) {
    const point = snapshot.series[index + i];
    if (!point) continue;
    if (CONFIDENCE_RANK[point.confidence] < CONFIDENCE_RANK[worst]) {
      worst = point.confidence;
    }
  }
  return worst;
}

/**
 * The clean fuel doing the most work across the window, for copy like
 * "the sun is doing most of the work at that hour".
 */
function windowCleanDriver(
  snapshot: GridSnapshot,
  index: number,
  span: number,
): FuelType | undefined {
  const totals = new Map<FuelType, number>();
  let hours = 0;
  for (let i = 0; i < span; i += 1) {
    const mix: FuelMix | undefined = snapshot.series[index + i]?.fuelMix;
    if (!mix) continue;
    hours += 1;
    for (const [fuel, share] of Object.entries(mix) as [FuelType, number][]) {
      if (!Number.isFinite(share) || share <= 0) continue;
      if (!CARBON_FREE_FUELS.includes(fuel)) continue;
      totals.set(fuel, (totals.get(fuel) ?? 0) + share);
    }
  }
  if (hours === 0) return undefined;
  let best: FuelType | undefined;
  let bestShare = 0;
  for (const [fuel, sum] of totals) {
    const share = sum / hours;
    if (share > bestShare) {
      bestShare = share;
      best = fuel;
    }
  }
  // Below ~15% it isn't "driven by" anything in particular.
  return bestShare >= 0.15 ? best : undefined;
}

type DayPart = "morning" | "afternoon" | "evening" | "night";

function dayPartFor(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/**
 * "Tonight", "Tomorrow morning", "Sunday afternoon" — the phrase a person would
 * actually say, rather than a timestamp.
 */
export function windowPhrase(
  start: Date,
  now: Date,
  timezone: string,
): string {
  const hour = zonedParts(start, timezone).hour;
  const part = dayPartFor(hour);
  const day = relativeDayName(start, now, timezone);

  if (day === "Today") {
    if (part === "morning") return "This morning";
    if (part === "afternoon") return "This afternoon";
    return "Tonight";
  }
  if (day === "Tomorrow") {
    return part === "night" ? "Tomorrow night" : `Tomorrow ${part}`;
  }
  return `${day} ${part}`;
}

function labelFor(
  start: Date,
  end: Date,
  now: Date,
  timezone: string,
): { label: string; shortLabel: string } {
  const shortLabel = windowPhrase(start, now, timezone);
  const from = formatClock(start, timezone);
  const to = formatClock(end, timezone);
  return { label: `${shortLabel}, ${from} – ${to}`, shortLabel };
}

function qualityFor(rank: number, savings: number, bestSavings: number): WindowQuality {
  if (rank === 1) return "best";
  if (bestSavings > 0 && savings >= bestSavings * 0.6) return "great";
  return "good";
}

/**
 * Round savings for display without ever manufacturing a difference: a window
 * that is fractionally dirtier than now reads as 0, not as a negative.
 */
function displaySavings(raw: number): number {
  if (raw <= 0) return 0;
  return Math.round(raw * 10) / 10;
}

function buildWindow(
  snapshot: GridSnapshot,
  appliance: Appliance,
  candidate: Candidate,
  baselineGrams: number,
  weights: number[],
  now: Date,
  rank: number,
  bestSavings: number,
): RunWindow {
  const point = snapshot.series[candidate.index];
  const start = new Date(point.ts);
  const end = new Date(start.getTime() + appliance.durationHours * MS_PER_HOUR);
  const { label, shortLabel } = labelFor(
    start,
    end,
    now,
    snapshot.region.timezone,
  );
  const savings = displaySavings(candidate.savingsPercent);
  return {
    id: `${appliance.id}-${point.ts}`,
    startTs: start.toISOString(),
    endTs: end.toISOString(),
    avgIntensity: Math.round(candidate.avgIntensity * 10) / 10,
    gramsCO2: Math.round(appliance.kWhPerRun * candidate.avgIntensity),
    baselineGrams: Math.round(baselineGrams),
    savingsPercent: savings,
    rank,
    quality: qualityFor(rank, savings, bestSavings),
    label,
    shortLabel,
    drivenBy: windowCleanDriver(snapshot, candidate.index, weights.length),
    confidence: windowConfidence(snapshot, candidate.index, weights.length),
  };
}

/**
 * Pick `count` windows that are clean *and* meaningfully different from each
 * other, so someone who can't do 2 AM has a real second choice.
 */
function selectDiverse(
  candidates: Candidate[],
  snapshot: GridSnapshot,
  count: number,
  minSeparationHours: number,
  earlierBias: number,
  sameDayPenalty: number,
): Candidate[] {
  const timezone = snapshot.region.timezone;
  const dayOf = (index: number) =>
    localDayKey(new Date(snapshot.series[index].ts), timezone);

  const picked: Candidate[] = [];
  const pickedDays = new Set<string>();
  const remaining = [...candidates];

  while (picked.length < count && remaining.length > 0) {
    const eligible = remaining.filter((c) =>
      picked.every((p) => Math.abs(p.index - c.index) >= minSeparationHours),
    );
    if (eligible.length === 0) break;

    // Score for *selection* only: penalise a day we've already offered so the
    // three suggestions don't all land on the same afternoon.
    const scored = eligible.map((c) => ({
      candidate: c,
      score:
        c.savingsPercent -
        (pickedDays.has(dayOf(c.index)) ? sameDayPenalty : 0),
    }));
    const bestScore = Math.max(...scored.map((s) => s.score));

    // Among the near-ties, take the soonest — sooner is more useful.
    const contenders = scored.filter((s) => s.score >= bestScore - earlierBias);
    const chosen = contenders.reduce((a, b) =>
      b.candidate.index < a.candidate.index ? b : a,
    ).candidate;

    picked.push(chosen);
    pickedDays.add(dayOf(chosen.index));
    remaining.splice(remaining.indexOf(chosen), 1);
  }

  // Present cleanest-first even though we selected with a recency bias.
  return picked.sort((a, b) => a.avgIntensity - b.avgIntensity);
}

/**
 * The main entry point. Returns the baseline ("if you ran it now") and the
 * windows worth offering, cleanest first.
 */
export function planWindows(
  snapshot: GridSnapshot,
  appliance: Appliance,
  options: PlanOptions = {},
): WindowPlan {
  const {
    count = 3,
    minSeparationHours = MIN_SEPARATION_HOURS,
    earlierBiasPoints = EARLIER_BIAS_POINTS,
    sameDayPenaltyPoints = SAME_DAY_PENALTY_POINTS,
  } = options;

  const series = snapshot.series;
  const now = options.now ?? new Date(series[0]?.ts ?? Date.now());
  const values = series.map((p) => p.gCO2PerKWh);
  const weights = hourWeights(appliance.durationHours);
  const span = weights.length;

  const baselineAvg = windowAverage(values, 0, weights);
  const baselineStart = new Date(series[0]?.ts ?? now.toISOString());
  const baselineEnd = new Date(
    baselineStart.getTime() + appliance.durationHours * MS_PER_HOUR,
  );

  // Not enough forecast to plan against — say nothing rather than guess.
  if (baselineAvg === null) {
    return {
      appliance,
      region: snapshot.region,
      windows: [],
      baseline: {
        startTs: baselineStart.toISOString(),
        endTs: baselineEnd.toISOString(),
        avgIntensity: 0,
        gramsCO2: 0,
      },
      nowIsGreat: true,
    };
  }

  const baselineGrams = appliance.kWhPerRun * baselineAvg;
  const horizon = Math.min(
    options.horizonHours ?? series.length,
    series.length - span + 1,
  );

  const candidates: Candidate[] = [];
  for (let index = 0; index < horizon; index += 1) {
    const avg = windowAverage(values, index, weights);
    if (avg === null) continue;
    candidates.push({
      index,
      avgIntensity: avg,
      savingsPercent:
        baselineAvg > 0 ? ((baselineAvg - avg) / baselineAvg) * 100 : 0,
    });
  }
  candidates.sort((a, b) => a.avgIntensity - b.avgIntensity);

  const bestRaw = candidates[0]?.savingsPercent ?? 0;
  const nowIsGreat = displaySavings(bestRaw) < NOW_IS_GREAT_THRESHOLD;

  const selected = selectDiverse(
    candidates,
    snapshot,
    count,
    minSeparationHours,
    earlierBiasPoints,
    sameDayPenaltyPoints,
  );
  const bestSavings = displaySavings(selected[0]?.savingsPercent ?? 0);

  const windows = selected.map((candidate, i) =>
    buildWindow(
      snapshot,
      appliance,
      candidate,
      baselineGrams,
      weights,
      now,
      i + 1,
      bestSavings,
    ),
  );

  return {
    appliance,
    region: snapshot.region,
    windows,
    baseline: {
      startTs: baselineStart.toISOString(),
      endTs: baselineEnd.toISOString(),
      avgIntensity: Math.round(baselineAvg * 10) / 10,
      gramsCO2: Math.round(baselineGrams),
    },
    nowIsGreat,
  };
}

/**
 * The single best window on each local day, for the week-at-a-glance view.
 * One row per day means someone can plan around a busy Tuesday.
 */
export function dailyBest(
  snapshot: GridSnapshot,
  appliance: Appliance,
  options: PlanOptions = {},
): RunWindow[] {
  const series = snapshot.series;
  if (series.length === 0) return [];

  const timezone = snapshot.region.timezone;
  const now = options.now ?? new Date(series[0].ts);
  const values = series.map((p) => p.gCO2PerKWh);
  const weights = hourWeights(appliance.durationHours);
  const span = weights.length;

  const baselineAvg = windowAverage(values, 0, weights) ?? 0;
  const baselineGrams = appliance.kWhPerRun * baselineAvg;

  const bestByDay = new Map<string, Candidate>();
  for (let index = 0; index <= series.length - span; index += 1) {
    const avg = windowAverage(values, index, weights);
    if (avg === null) continue;
    const day = localDayKey(new Date(series[index].ts), timezone);
    const candidate: Candidate = {
      index,
      avgIntensity: avg,
      savingsPercent:
        baselineAvg > 0 ? ((baselineAvg - avg) / baselineAvg) * 100 : 0,
    };
    const existing = bestByDay.get(day);
    if (!existing || candidate.avgIntensity < existing.avgIntensity) {
      bestByDay.set(day, candidate);
    }
  }

  const ordered = [...bestByDay.values()].sort((a, b) => a.index - b.index);
  const bestSavings = displaySavings(
    Math.max(0, ...ordered.map((c) => c.savingsPercent)),
  );

  return ordered.map((candidate, i) =>
    buildWindow(
      snapshot,
      appliance,
      candidate,
      baselineGrams,
      weights,
      now,
      i + 1,
      bestSavings,
    ),
  );
}

/**
 * Which hour of the day is typically cleanest on this grid, as a plain number.
 * Used for the "on your grid, the sweet spot is usually mid-afternoon" line —
 * deliberately derived from the forecast rather than assumed, because wind
 * grids like SPP are cleanest at 3 AM and solar grids at noon.
 */
export function typicalCleanestHour(snapshot: GridSnapshot): number | null {
  if (snapshot.series.length === 0) return null;
  const timezone = snapshot.region.timezone;
  const sums = new Map<number, { total: number; count: number }>();
  for (const point of snapshot.series) {
    const hour = zonedParts(new Date(point.ts), timezone).hour;
    const entry = sums.get(hour) ?? { total: 0, count: 0 };
    entry.total += point.gCO2PerKWh;
    entry.count += 1;
    sums.set(hour, entry);
  }
  let bestHour: number | null = null;
  let bestMean = Infinity;
  for (const [hour, { total, count }] of sums) {
    const mean = total / count;
    if (mean < bestMean) {
      bestMean = mean;
      bestHour = hour;
    }
  }
  return bestHour;
}

/** Exposed for tests that want to reason about hour-of-week slots. */
export { hourOfSlot };
