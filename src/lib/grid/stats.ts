/** Small statistics helpers shared by the profile builder and the blender. */

import type { SeriesStats } from "../types";

const EMPTY_STATS: SeriesStats = { min: 0, max: 0, mean: 0, p10: 0, p90: 0 };

/**
 * Linear-interpolated percentile over an ascending array.
 * `p` is a fraction (0.1 = p10). Matches numpy's default "linear" method.
 */
export function percentileOfSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.min(1, Math.max(0, p));
  const position = clamped * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

export function seriesStats(values: number[]): SeriesStats {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { ...EMPTY_STATS };
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = finite.reduce((acc, v) => acc + v, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / finite.length,
    p10: percentileOfSorted(sorted, 0.1),
    p90: percentileOfSorted(sorted, 0.9),
  };
}

/**
 * "Cleanliness percentile": what share of the window is *dirtier* than this
 * value, 0-100. Higher is cleaner, which is what `IntensityPoint` documents.
 *
 * Ties count for half so that a perfectly flat week reads 50 everywhere rather
 * than 0 or 100 — an honest "nothing to choose between these hours".
 */
export function cleanlinessPercentile(value: number, all: number[]): number {
  if (all.length === 0) return 50;
  let dirtier = 0;
  let equal = 0;
  for (const other of all) {
    if (!Number.isFinite(other)) continue;
    // Sub-gram differences are noise from the model, not a real ranking.
    if (other > value + 0.5) dirtier += 1;
    else if (other >= value - 0.5) equal += 1;
  }
  const total = all.filter((v) => Number.isFinite(v)).length;
  if (total === 0) return 50;
  return round((dirtier + equal / 2) / total * 100, 0);
}

/** Round to `digits` decimals without float dust (0.1 + 0.2 style). */
export function round(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
