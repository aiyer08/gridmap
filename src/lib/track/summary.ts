/**
 * Impact maths for the tracker.
 *
 * Everything here is pure: same inputs, same outputs, no clocks, no randomness.
 * That matters for two reasons — the numbers are testable, and the copy is
 * stable across server and client renders (React would scream about a
 * `Math.random()` one-liner that changed during hydration).
 *
 * Tone rule that shapes this whole file: a declined suggestion is a normal,
 * fine outcome. Declines are stored so the UI can say "no problem", and are
 * then excluded from every total, streak and breakdown. Nothing here can
 * produce a negative saving.
 */

import type {
  Appliance,
  Habit,
  LoggedAction,
  TrackerSummary,
} from "@/lib/types";
import { localDayKey, safeTimeZone } from "@/lib/grid/time";

/**
 * Weeks and days are only meaningful in the user's own clock, but a default has
 * to be deterministic on both sides of a render — so it is UTC rather than
 * `Intl…resolvedOptions().timeZone`, which differs between server and browser.
 * Callers pass `region.timezone`.
 */
export const DEFAULT_TIMEZONE = "UTC";

/** Weeks in the sparkline, including the current (partial) week. */
export const WEEKS_IN_BREAKDOWN = 8;

/** Days in the daily strip, including today. */
export const DAYS_IN_BREAKDOWN = 14;

const MS_PER_DAY = 86_400_000;

/**
 * Real-world equivalences, so "3.4 kg" means something.
 *
 * - `gramsPerMile` 400 — EPA, "Greenhouse Gas Emissions from a Typical
 *   Passenger Vehicle" (EPA-420-F-18-008): ~404 g CO2/mile tailpipe for the
 *   average US passenger vehicle. Rounded down to 400 so the claim is
 *   conservative.
 * - `gramsPerPhoneCharge` 8 — EPA Greenhouse Gas Equivalencies Calculator:
 *   one smartphone charge is ~0.012 kWh, which is ~8 g CO2e at the US average
 *   grid intensity.
 * - `gramsPerTreeDay` 58 — a mature tree absorbs roughly 21 kg CO2 per year
 *   (US Forest Service / Arbor Day Foundation ballpark), i.e. 21000/365 ≈ 57.5
 *   g per day. "Tree-days" is used instead of "trees planted" because it is an
 *   honest unit for a household-scale number.
 */
export const EQUIVALENCE = {
  gramsPerMile: 400,
  gramsPerPhoneCharge: 8,
  gramsPerTreeDay: 58,
} as const;

export interface WeekBucket {
  /** Monday of the week, "YYYY-MM-DD" in the caller's timezone. */
  weekStart: string;
  gramsSaved: number;
  actionCount: number;
}

export interface DayBucket {
  /** "YYYY-MM-DD" in the caller's timezone. */
  date: string;
  gramsSaved: number;
  actionCount: number;
}

export type ReportTone =
  | "starting" // nothing logged, ever
  | "first-week" // their first week with logs
  | "up" // more than last week
  | "steady" // about the same
  | "lighter" // less than last week (never framed as failure)
  | "resting"; // nothing this week, which is fine

export interface WeeklyReport {
  /** Monday, "YYYY-MM-DD" local. */
  weekStart: string;
  /** Sunday, "YYYY-MM-DD" local. */
  weekEnd: string;
  gramsSaved: number;
  actionCount: number;
  previousGramsSaved: number;
  /** This week minus last week, in grams. Can be negative; the copy stays kind. */
  deltaGrams: number;
  /** Percent change vs last week, or null when last week was empty. */
  deltaPercent: number | null;
  /** The single most impactful thing they did this week. */
  biggestWin: { label: string; gramsSaved: number; kind: LoggedAction["kind"] } | null;
  /** Most-logged appliance this week (shifts only — habits aren't appliances). */
  topAppliance: { id: string; label: string; count: number; gramsSaved: number } | null;
  equivalents: TrackerSummary["equivalents"];
  /** One encouraging line, chosen deterministically from the tone-checked set. */
  message: string;
  tone: ReportTone;
}

/* ------------------------------------------------------------------ *
 * Rounding
 * ------------------------------------------------------------------ */

/** Grams to one decimal. Keeps sums free of float dust without losing detail. */
export function roundGrams(grams: number): number {
  if (!Number.isFinite(grams)) return 0;
  return Math.round(grams * 10) / 10;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * Calendar helpers — civil dates only
 * ------------------------------------------------------------------ */

/**
 * Day keys ("YYYY-MM-DD") are compared and shifted as civil dates, never as
 * instants. That is what makes DST a non-event here: we ask the timezone once
 * what day it was, then do plain calendar arithmetic on the answer.
 */
function keyToDayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function dayNumberToKey(dayNumber: number): string {
  const date = new Date(dayNumber * MS_PER_DAY);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

export function addDays(key: string, days: number): string {
  return dayNumberToKey(keyToDayNumber(key) + days);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return keyToDayNumber(to) - keyToDayNumber(from);
}

/**
 * Monday of the week containing `key`. Monday because that is how people talk
 * about "this week", and it keeps the weekend in one bucket.
 */
export function weekStartOf(key: string): string {
  // 1970-01-01 was a Thursday, so dayNumber % 7 === 4 means Thursday.
  const dayNumber = keyToDayNumber(key);
  const weekday = ((((dayNumber % 7) + 7) % 7) + 4) % 7; // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7; // Monday = 0 … Sunday = 6
  return dayNumberToKey(dayNumber - sinceMonday);
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  // A bad timestamp shouldn't take the page down; treat it as the epoch and let
  // the caller's data look empty rather than throw mid-render.
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** Local calendar day an action belongs to. */
export function actionDayKey(action: LoggedAction, timezone: string): string {
  return localDayKey(toDate(action.loggedAt), safeTimeZone(timezone));
}

function doneActions(actions: LoggedAction[]): LoggedAction[] {
  // The one place declines are filtered out. Everything downstream is "done".
  return actions.filter((a) => a.status === "done");
}

/* ------------------------------------------------------------------ *
 * Equivalences
 * ------------------------------------------------------------------ */

/** "What does that mean?" numbers for a gram total. */
export function equivalentsFor(grams: number): TrackerSummary["equivalents"] {
  const safe = Number.isFinite(grams) && grams > 0 ? grams : 0;
  return {
    milesDriven: round1(safe / EQUIVALENCE.gramsPerMile),
    // Whole charges: "12.4 phone charges" reads like a rounding error.
    phoneCharges: Math.round(safe / EQUIVALENCE.gramsPerPhoneCharge),
    treeDays: round1(safe / EQUIVALENCE.gramsPerTreeDay),
  };
}

/** "1.4 kg" / "820 g" — one shared format so the copy never disagrees. */
export function formatGrams(grams: number): string {
  const safe = Number.isFinite(grams) ? Math.max(0, grams) : 0;
  if (safe < 1000) return `${Math.round(safe)} g`;
  const kg = safe / 1000;
  return `${kg < 10 ? round1(kg) : Math.round(kg)} kg`;
}

/* ------------------------------------------------------------------ *
 * Valuation
 * ------------------------------------------------------------------ */

/**
 * A habit is energy that simply didn't get used, so it is valued at whatever
 * the grid happened to cost at the time — no baseline, no shifting.
 */
export function valueHabit(habit: Habit, gridIntensityGPerKWh: number): number {
  if (!Number.isFinite(gridIntensityGPerKWh) || gridIntensityGPerKWh <= 0) return 0;
  return roundGrams(Math.max(0, habit.kWhSaved) * gridIntensityGPerKWh);
}

export interface ShiftValuation {
  gramsSaved: number;
  baselineGrams: number;
  actualGrams: number;
  /** 0–100. Never negative — see the note below. */
  savingsPercent: number;
}

/**
 * A shifted run: same kilowatt-hours, cleaner hours.
 *
 * `gramsSaved` is floored at 0 on purpose. Forecasts move, and a user who did
 * the right thing shouldn't be handed a negative score because the wind died
 * down. The UI can compare `actualGrams` to `baselineGrams` itself if it wants
 * to say something honest and gentle about it.
 */
export function valueShift(
  appliance: Appliance,
  window: { avgIntensity: number },
  baseline: { avgIntensity: number },
): ShiftValuation {
  const kWh = Math.max(0, appliance.kWhPerRun);
  const windowIntensity = Math.max(0, numberOr(window?.avgIntensity, 0));
  const baselineIntensity = Math.max(0, numberOr(baseline?.avgIntensity, 0));

  const actualGrams = roundGrams(kWh * windowIntensity);
  const baselineGrams = roundGrams(kWh * baselineIntensity);
  const gramsSaved = roundGrams(Math.max(0, baselineGrams - actualGrams));
  const savingsPercent =
    baselineGrams > 0 ? round1(Math.max(0, (gramsSaved / baselineGrams) * 100)) : 0;

  return { gramsSaved, baselineGrams, actualGrams, savingsPercent };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

/**
 * Headline numbers: lifetime, this week, and the streak.
 *
 * The streak counts consecutive local days with at least one `done` action and
 * may end *yesterday* — otherwise every user would watch their streak
 * disappear at midnight before they'd had a chance to run anything today.
 */
export function summarise(
  actions: LoggedAction[],
  now: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
): TrackerSummary {
  const tz = safeTimeZone(timezone);
  const done = doneActions(actions);
  const today = localDayKey(toDate(now), tz);
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);

  let totalGramsSaved = 0;
  let weekGramsSaved = 0;
  let weekActionCount = 0;
  const activeDays = new Set<string>();

  for (const action of done) {
    const grams = Math.max(0, numberOr(action.gramsSaved, 0));
    totalGramsSaved += grams;
    const day = actionDayKey(action, tz);
    activeDays.add(day);
    if (day >= weekStart && day <= weekEnd) {
      weekGramsSaved += grams;
      weekActionCount += 1;
    }
  }

  totalGramsSaved = roundGrams(totalGramsSaved);

  return {
    totalGramsSaved,
    actionCount: done.length,
    weekGramsSaved: roundGrams(weekGramsSaved),
    weekActionCount,
    streakDays: streakFrom(activeDays, today),
    equivalents: equivalentsFor(totalGramsSaved),
  };
}

/** Consecutive active days ending today or yesterday. 0 when the chain is broken. */
function streakFrom(activeDays: Set<string>, today: string): number {
  const yesterday = addDays(today, -1);
  let cursor = activeDays.has(today)
    ? today
    : activeDays.has(yesterday)
      ? yesterday
      : null;
  if (!cursor) return 0;

  let streak = 0;
  while (activeDays.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* ------------------------------------------------------------------ *
 * Breakdowns
 * ------------------------------------------------------------------ */

/** Last `WEEKS_IN_BREAKDOWN` weeks, oldest first, zero-filled for the sparkline. */
export function weeklyBreakdown(
  actions: LoggedAction[],
  now: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
  weeks: number = WEEKS_IN_BREAKDOWN,
): WeekBucket[] {
  const tz = safeTimeZone(timezone);
  const thisWeek = weekStartOf(localDayKey(toDate(now), tz));
  const buckets: WeekBucket[] = [];
  const index = new Map<string, WeekBucket>();

  for (let i = weeks - 1; i >= 0; i -= 1) {
    const bucket: WeekBucket = {
      weekStart: addDays(thisWeek, -7 * i),
      gramsSaved: 0,
      actionCount: 0,
    };
    buckets.push(bucket);
    index.set(bucket.weekStart, bucket);
  }

  for (const action of doneActions(actions)) {
    const bucket = index.get(weekStartOf(actionDayKey(action, tz)));
    if (!bucket) continue; // older than the window, or dated in the future
    bucket.gramsSaved += Math.max(0, numberOr(action.gramsSaved, 0));
    bucket.actionCount += 1;
  }

  for (const bucket of buckets) bucket.gramsSaved = roundGrams(bucket.gramsSaved);
  return buckets;
}

/** Last `DAYS_IN_BREAKDOWN` days, oldest first, zero-filled. */
export function dailyBreakdown(
  actions: LoggedAction[],
  now: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
  days: number = DAYS_IN_BREAKDOWN,
): DayBucket[] {
  const tz = safeTimeZone(timezone);
  const today = localDayKey(toDate(now), tz);
  const buckets: DayBucket[] = [];
  const index = new Map<string, DayBucket>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const bucket: DayBucket = { date: addDays(today, -i), gramsSaved: 0, actionCount: 0 };
    buckets.push(bucket);
    index.set(bucket.date, bucket);
  }

  for (const action of doneActions(actions)) {
    const bucket = index.get(actionDayKey(action, tz));
    if (!bucket) continue;
    bucket.gramsSaved += Math.max(0, numberOr(action.gramsSaved, 0));
    bucket.actionCount += 1;
  }

  for (const bucket of buckets) bucket.gramsSaved = roundGrams(bucket.gramsSaved);
  return buckets;
}

/* ------------------------------------------------------------------ *
 * Weekly report copy
 * ------------------------------------------------------------------ */

/**
 * Encouraging one-liners, grouped by what the data actually says.
 *
 * Rules every line here follows: no guilt, no "should", no "only", no comparing
 * the user to anyone else, and nothing that treats a quiet week as a failure.
 * A lighter week is a lighter week — the total they've already built is still
 * theirs.
 */
export const REPORT_MESSAGES: Record<ReportTone, readonly string[]> = {
  starting: [
    "Nothing logged yet — one well-timed load is all it takes to start.",
    "Your tracker is ready when you are. Pick a clean window and go.",
    "This is the empty page before the good part. One load begins it.",
  ],
  "first-week": [
    "You're on the board — that's real CO2 that never happened.",
    "Great start. The grid was a little cleaner because you watched the clock.",
    "First week logged. Small, well-timed choices stack up fast.",
  ],
  up: [
    "Your strongest week yet — you're getting good at reading the grid.",
    "Up from last week. That's momentum, and it compounds.",
    "More saved than last week. The clean hours are clearly working for you.",
  ],
  steady: [
    "Right on pace with last week — steady is what actually adds up.",
    "Another solid week. Consistent beats dramatic every time.",
    "Holding your rhythm. This is exactly how the total grows.",
  ],
  lighter: [
    "A lighter week — and every gram you've already saved still counts.",
    "Life gets busy. Your total kept every bit of its progress.",
    "Quieter than last week, which is fine. The clean hours will be there.",
  ],
  resting: [
    "A rest week. Your total is still yours, waiting for whenever you're back.",
    "Nothing logged this week, and that's completely okay.",
    "No logs this week — the grid keeps cycling, and so can you.",
  ],
};

/**
 * Deterministic pick, so the same week always shows the same line (SSR-safe and
 * it stops the copy flickering on every re-render). FNV-1a over a seed built
 * from the week's own numbers.
 */
export function pickMessage(tone: ReportTone, seed: string): string {
  const variants = REPORT_MESSAGES[tone];
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return variants[Math.abs(hash) % variants.length];
}

/** Change big enough to call "up" or "lighter" rather than "steady". */
const STEADY_BAND_PERCENT = 10;

/**
 * The weekly summary the app promises in the plan: what happened, what stood
 * out, and one line that makes the user want to keep going.
 */
export function weeklyReport(
  actions: LoggedAction[],
  now: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
): WeeklyReport {
  const tz = safeTimeZone(timezone);
  const today = localDayKey(toDate(now), tz);
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekStart, -1);

  const done = doneActions(actions);
  const thisWeek: LoggedAction[] = [];
  let previousGramsSaved = 0;

  for (const action of done) {
    const day = actionDayKey(action, tz);
    if (day >= weekStart && day <= weekEnd) thisWeek.push(action);
    else if (day >= previousWeekStart && day <= previousWeekEnd) {
      previousGramsSaved += Math.max(0, numberOr(action.gramsSaved, 0));
    }
  }

  const gramsSaved = roundGrams(
    thisWeek.reduce((sum, a) => sum + Math.max(0, numberOr(a.gramsSaved, 0)), 0),
  );
  previousGramsSaved = roundGrams(previousGramsSaved);
  const deltaGrams = roundGrams(gramsSaved - previousGramsSaved);
  const deltaPercent =
    previousGramsSaved > 0 ? round1((deltaGrams / previousGramsSaved) * 100) : null;

  const tone = toneFor({
    gramsSaved,
    actionCount: thisWeek.length,
    previousGramsSaved,
    deltaPercent,
    hasAnyHistory: done.length > 0,
  });

  return {
    weekStart,
    weekEnd,
    gramsSaved,
    actionCount: thisWeek.length,
    previousGramsSaved,
    deltaGrams,
    deltaPercent,
    biggestWin: biggestWinOf(thisWeek),
    topAppliance: topApplianceOf(thisWeek),
    equivalents: equivalentsFor(gramsSaved),
    message: pickMessage(tone, `${weekStart}|${thisWeek.length}|${Math.round(gramsSaved)}`),
    tone,
  };
}

function toneFor(input: {
  gramsSaved: number;
  actionCount: number;
  previousGramsSaved: number;
  deltaPercent: number | null;
  hasAnyHistory: boolean;
}): ReportTone {
  if (!input.hasAnyHistory) return "starting";
  // A quiet week is its own tone: never compared, never scored.
  if (input.actionCount === 0) return "resting";
  if (input.previousGramsSaved <= 0) return "first-week";
  const delta = input.deltaPercent ?? 0;
  if (delta > STEADY_BAND_PERCENT) return "up";
  if (delta < -STEADY_BAND_PERCENT) return "lighter";
  return "steady";
}

/** Biggest single saving this week. Ties break on the earlier log, for stability. */
function biggestWinOf(weekActions: LoggedAction[]): WeeklyReport["biggestWin"] {
  let best: LoggedAction | null = null;
  for (const action of weekActions) {
    const grams = Math.max(0, numberOr(action.gramsSaved, 0));
    if (grams <= 0) continue;
    const bestGrams = best ? Math.max(0, numberOr(best.gramsSaved, 0)) : -1;
    if (grams > bestGrams || (grams === bestGrams && best && action.loggedAt < best.loggedAt)) {
      best = action;
    }
  }
  if (!best) return null;
  return {
    label: best.label,
    gramsSaved: roundGrams(Math.max(0, numberOr(best.gramsSaved, 0))),
    kind: best.kind,
  };
}

/** Most-logged appliance this week; count first, then grams, then id for determinism. */
function topApplianceOf(weekActions: LoggedAction[]): WeeklyReport["topAppliance"] {
  const tally = new Map<string, { id: string; label: string; count: number; gramsSaved: number }>();
  for (const action of weekActions) {
    if (action.kind !== "shift") continue;
    const entry = tally.get(action.subjectId) ?? {
      id: action.subjectId,
      label: action.label,
      count: 0,
      gramsSaved: 0,
    };
    entry.count += 1;
    entry.gramsSaved += Math.max(0, numberOr(action.gramsSaved, 0));
    tally.set(action.subjectId, entry);
  }

  let top: { id: string; label: string; count: number; gramsSaved: number } | null = null;
  for (const entry of tally.values()) {
    if (
      !top ||
      entry.count > top.count ||
      (entry.count === top.count && entry.gramsSaved > top.gramsSaved) ||
      (entry.count === top.count && entry.gramsSaved === top.gramsSaved && entry.id < top.id)
    ) {
      top = entry;
    }
  }
  return top ? { ...top, gramsSaved: roundGrams(top.gramsSaved) } : null;
}
