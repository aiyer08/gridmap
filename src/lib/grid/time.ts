/**
 * Timezone helpers for the climatology model.
 *
 * The whole forecast is keyed on *local* hour-of-week: "6 PM in California" is
 * the interesting fact, not "01:00 UTC". Using `Intl.DateTimeFormat` with an
 * IANA zone means DST is handled for free — we simply ask what the local clock
 * said at that instant, which is exactly the thing a homeowner experiences.
 */

export const HOURS_PER_WEEK = 168;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  /** 0 = Sunday, matching `Date#getUTCDay`. */
  weekday: number;
  /** 1-366. */
  dayOfYear: number;
}

// Building a DateTimeFormat is expensive and we call this ~9k times per
// profile build, so keep one formatter per timezone.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(timeZone, created);
  return created;
}

/** True when the runtime accepts this IANA zone. Bad zones fall back to UTC. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | undefined | null): string {
  if (!timeZone) return "UTC";
  return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

function daysFromCivil(year: number, month: number, day: number): number {
  // Date.UTC handles the calendar for us; we only ever use the result as a
  // day counter, so the epoch offset is irrelevant.
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Wall-clock fields for `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(safeTimeZone(timeZone)).formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    switch (part.type) {
      case "year":
        year = Number(part.value);
        break;
      case "month":
        month = Number(part.value);
        break;
      case "day":
        day = Number(part.value);
        break;
      case "hour":
        // Some ICU builds still emit "24" for midnight despite h23.
        hour = Number(part.value) % 24;
        break;
      case "minute":
        minute = Number(part.value);
        break;
    }
  }
  const dayNumber = daysFromCivil(year, month, day);
  // 1970-01-01 was a Thursday (getUTCDay === 4).
  const weekday = (((dayNumber % 7) + 7) % 7 + 4) % 7;
  const dayOfYear = dayNumber - daysFromCivil(year, 1, 1) + 1;
  return { year, month, day, hour, minute, weekday, dayOfYear };
}

/** 0-167, Sunday 00:00 local = 0. */
export function hourOfWeek(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return p.weekday * 24 + p.hour;
}

export function hourOfWeekFrom(weekday: number, hour: number): number {
  return (((weekday % 7) + 7) % 7) * 24 + (((hour % 24) + 24) % 24);
}

export function weekdayOfSlot(hourOfWeekIndex: number): number {
  return Math.floor(hourOfWeekIndex / 24) % 7;
}

export function hourOfSlot(hourOfWeekIndex: number): number {
  return hourOfWeekIndex % 24;
}

/** Saturday/Sunday. Grid demand shape differs enough to be worth modelling. */
export function isWeekendDay(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

/** Local calendar day as "YYYY-MM-DD", used to group the 7-day view. */
export function localDayKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

/**
 * Shortest distance in days between two days-of-year, wrapping around the new
 * year. Without this, a 1 January forecast would treat late December — the most
 * relevant history there is — as 364 days away.
 */
export function circularDayDistance(a: number, b: number, yearLength = 365.25): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, yearLength - raw);
}

/** Floor to the top of the hour, in UTC. Every series point is hour-aligned. */
export function floorToHourUtc(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_PER_HOUR) * MS_PER_HOUR);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * MS_PER_HOUR);
}

/** ISO-8601 UTC to the second, e.g. "2026-08-23T17:00:00.000Z". */
export function isoHour(date: Date): string {
  return floorToHourUtc(date).toISOString();
}
