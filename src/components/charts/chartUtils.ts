import type { FuelType, IntensityPoint } from "@/lib/types";

/* ==========================================================================
   Carbon-intensity scale
   --------------------------------------------------------------------------
   Absolute gCO2/kWh means nothing to a homeowner and varies 3x between US
   grids, so every chart bins against the range of the series it is showing.
   Five bins, 1 = cleanest. The bins are also monotone in lightness, so the
   ordering survives greyscale, CVD and print.
   ========================================================================== */

export type IntensityLevel = 1 | 2 | 3 | 4 | 5;

export const INTENSITY_LEVELS: readonly IntensityLevel[] = [1, 2, 3, 4, 5];

export const INTENSITY_COLORS: Record<IntensityLevel, string> = {
  1: "var(--gm-i1)",
  2: "var(--gm-i2)",
  3: "var(--gm-i3)",
  4: "var(--gm-i4)",
  5: "var(--gm-i5)",
};

export const INTENSITY_SOFT: Record<IntensityLevel, string> = {
  1: "var(--gm-i1-soft)",
  2: "var(--gm-i2-soft)",
  3: "var(--gm-i3-soft)",
  4: "var(--gm-i4-soft)",
  5: "var(--gm-i5-soft)",
};

/** Plain-English name for each bin. No jargon, no traffic-light words. */
export const INTENSITY_LABELS: Record<IntensityLevel, string> = {
  1: "Cleanest",
  2: "Clean",
  3: "Average",
  4: "High",
  5: "Highest",
};

export interface IntensityScale {
  /** Bottom of the colour range (5th percentile of the series). */
  lo: number;
  /** Top of the colour range (95th percentile). */
  hi: number;
  median: number;
  min: number;
  max: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function makeIntensityScale(values: readonly number[]): IntensityScale {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return { lo: 0, hi: 1, median: 0, min: 0, max: 1 };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const lo = quantile(sorted, 0.05);
  const hi = quantile(sorted, 0.95);
  return {
    lo,
    hi: hi > lo ? hi : lo + 1,
    median: quantile(sorted, 0.5),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function scaleFromPoints(points: readonly IntensityPoint[]): IntensityScale {
  return makeIntensityScale(points.map((p) => p.gCO2PerKWh));
}

export function levelFor(value: number, scale: IntensityScale): IntensityLevel {
  const span = scale.hi - scale.lo;
  if (!(span > 0)) return 3;
  const t = Math.min(1, Math.max(0, (value - scale.lo) / span));
  const idx = Math.min(4, Math.floor(t * 5));
  return (idx + 1) as IntensityLevel;
}

export function colorFor(value: number, scale: IntensityScale): string {
  return INTENSITY_COLORS[levelFor(value, scale)];
}

export interface Verdict {
  /** Sentence-case phrase, ready to drop into a tooltip. */
  text: string;
  /** −100…+100. Negative is cleaner than the week's median. */
  vsMedianPercent: number;
  level: IntensityLevel;
}

/** "Cleaner than usual" beats "312 gCO2/kWh" for everybody who isn't an analyst. */
export function verdictFor(value: number, scale: IntensityScale): Verdict {
  const level = levelFor(value, scale);
  const median = scale.median || value || 1;
  const ratio = value / median;
  const vsMedianPercent = Math.round((ratio - 1) * 100);
  let text: string;
  if (ratio <= 0.75) text = "Much cleaner than usual";
  else if (ratio <= 0.9) text = "Cleaner than usual";
  else if (ratio < 1.1) text = "About average for your grid";
  else if (ratio < 1.25) text = "Dirtier than usual";
  else text = "Much dirtier than usual";
  return { text, vsMedianPercent, level };
}

/* ==========================================================================
   Fuel identity
   --------------------------------------------------------------------------
   Nine fixed slots in one fixed stacking order — renewables, then the residual
   bucket, then fossil. Never cycled, never reassigned by rank.
   ========================================================================== */

export const FUEL_ORDER: readonly FuelType[] = [
  "solar",
  "wind",
  "hydro",
  "nuclear",
  "storage",
  "other",
  "oil",
  "gas",
  "coal",
];

export const FUEL_COLORS: Record<FuelType, string> = {
  solar: "var(--gm-fuel-solar)",
  wind: "var(--gm-fuel-wind)",
  hydro: "var(--gm-fuel-hydro)",
  nuclear: "var(--gm-fuel-nuclear)",
  storage: "var(--gm-fuel-storage)",
  other: "var(--gm-fuel-other)",
  oil: "var(--gm-fuel-oil)",
  gas: "var(--gm-fuel-gas)",
  coal: "var(--gm-fuel-coal)",
};

/* ==========================================================================
   Formatting
   ========================================================================== */

const HOUR_FMT = new Map<string, Intl.DateTimeFormat>();
const DAY_FMT = new Map<string, Intl.DateTimeFormat>();
const FULL_FMT = new Map<string, Intl.DateTimeFormat>();

function hourFormatter(timeZone: string) {
  let f = HOUR_FMT.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: true,
      timeZone,
    });
    HOUR_FMT.set(timeZone, f);
  }
  return f;
}

function dayFormatter(timeZone: string) {
  let f = DAY_FMT.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });
    DAY_FMT.set(timeZone, f);
  }
  return f;
}

function fullFormatter(timeZone: string) {
  let f = FULL_FMT.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      hour12: true,
      timeZone,
    });
    FULL_FMT.set(timeZone, f);
  }
  return f;
}

/** 0–23 in the given zone. */
export function hourIn(ts: string | number | Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

/** "8 AM" · "Noon" · "8 PM" · "Midnight" — the way people actually say it. */
export function formatHourLabel(
  ts: string | number | Date,
  timeZone: string,
): string {
  const h = hourIn(ts, timeZone);
  if (h === 12) return "Noon";
  if (h === 0) return "Midnight";
  return hourFormatter(timeZone).format(new Date(ts)).replace(/ /g, " ");
}

/** "Today" · "Tomorrow" · "Wed". */
export function formatDayLabel(
  ts: string | number | Date,
  now: string | number | Date,
  timeZone: string,
): string {
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(d);
  const target = dayKey(new Date(ts));
  const today = dayKey(new Date(now));
  if (target === today) return "Today";
  const tomorrow = dayKey(new Date(new Date(now).getTime() + 86_400_000));
  if (target === tomorrow) return "Tomorrow";
  return dayFormatter(timeZone).format(new Date(ts));
}

/** "Wed 8 PM" — used in tooltips where the day matters. */
export function formatDayHour(
  ts: string | number | Date,
  now: string | number | Date,
  timeZone: string,
): string {
  const day = formatDayLabel(ts, now, timeZone);
  return `${day}, ${formatHourLabel(ts, timeZone)}`;
}

export function formatFull(
  ts: string | number | Date,
  timeZone: string,
): string {
  return fullFormatter(timeZone).format(new Date(ts)).replace(/ /g, " ");
}

/** Whole grams under a kilo, then kilograms. Never "0.4 kg". */
export function formatGrams(grams: number): string {
  const g = Math.abs(grams);
  if (g < 1000) return `${Math.round(grams)} g`;
  if (g < 10_000) return `${(grams / 1000).toFixed(1)} kg`;
  return `${Math.round(grams / 1000).toLocaleString("en-US")} kg`;
}

export function formatIntensity(g: number): string {
  return Math.round(g).toLocaleString("en-US");
}

export function formatPercent(p: number): string {
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(Math.round(p))}%`;
}

/* ==========================================================================
   Geometry helpers
   ========================================================================== */

/** Round axis maximum + evenly spaced ticks. */
export function niceTicks(max: number, count = 3): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v));
  return ticks;
}

/**
 * Catmull-Rom smoothed polyline, clamped so the curve can never dip below the
 * data (an area chart that overshoots is a lie).
 */
export function smoothPath(
  pts: readonly { x: number; y: number }[],
  tension = 0.16,
): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = Math.min(hi, Math.max(lo, p1.y + (p2.y - p0.y) * tension));
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = Math.min(hi, Math.max(lo, p2.y - (p3.y - p1.y) * tension));
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Index of the point whose hour contains `now`, or the nearest one. */
export function nowIndex(
  points: readonly IntensityPoint[],
  now: string | number | Date,
): number {
  if (points.length === 0) return -1;
  const t = new Date(now).getTime();
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < points.length; i++) {
    const delta = Math.abs(new Date(points[i].ts).getTime() - t);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}
