/**
 * Formatting helpers. Every number a user sees goes through here so that units,
 * rounding and tone stay consistent across the app.
 */

/** Grams of CO2 in the unit a person can hold in their head. */
export function formatGrams(grams: number): string {
  const g = Math.max(0, grams);
  if (g < 1000) return `${Math.round(g)} g`;
  if (g < 100_000) return `${(g / 1000).toFixed(1)} kg`;
  return `${Math.round(g / 1000).toLocaleString("en-US")} kg`;
}

/** Longer form for the "what does that mean" copy, e.g. "1.4 kilograms". */
export function formatGramsLong(grams: number): string {
  const g = Math.max(0, grams);
  if (g < 1000) return `${Math.round(g)} grams`;
  const kg = g / 1000;
  return `${kg < 10 ? kg.toFixed(1) : Math.round(kg).toLocaleString("en-US")} kilograms`;
}

export function formatIntensity(gPerKWh: number): string {
  return `${Math.round(gPerKWh)} g/kWh`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function formatKWh(kWh: number): string {
  return kWh < 10 ? `${kWh.toFixed(1)} kWh` : `${Math.round(kWh)} kWh`;
}

/** "2 hours", "90 minutes", "1 hour 30 min" — whichever reads best. */
export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (Number.isInteger(hours)) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  return `${whole} hr ${mins} min`;
}

/** Local clock time in a region's timezone: "1 PM", "1:30 PM", "Noon". */
export function formatClock(ts: string | Date, timezone: string): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const h24 = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(date),
  );
  if (h24 === 12 && minute === "00") return "Noon";
  if (h24 === 0 && minute === "00") return "Midnight";
  return minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

/** "Sat, Aug 23" — for day labels on the weekly view. */
export function formatDayLabel(ts: string | Date, timezone: string): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Hour of day 0–23 in a given timezone. */
export function hourInZone(ts: string | Date, timezone: string): number {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(date),
  );
}

/** YYYY-MM-DD in a given timezone, for grouping by local day. */
export function dayKeyInZone(ts: string | Date, timezone: string): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 0 = Sunday. Day of week in a given timezone. */
export function weekdayInZone(ts: string | Date, timezone: string): number {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** "Today", "Tomorrow", "Sunday" — relative day naming in local time. */
export function relativeDayName(
  ts: string | Date,
  now: string | Date,
  timezone: string,
): string {
  const target = dayKeyInZone(ts, timezone);
  const today = dayKeyInZone(now, timezone);
  const nowDate = typeof now === "string" ? new Date(now) : now;
  const tomorrow = dayKeyInZone(
    new Date(nowDate.getTime() + 24 * 3600_000),
    timezone,
  );
  if (target === today) return "Today";
  if (target === tomorrow) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(typeof ts === "string" ? new Date(ts) : ts);
}

/** "in 3 hours", "in 40 minutes", "now". */
export function formatRelativeTime(ts: string | Date, now: string | Date): string {
  const target = (typeof ts === "string" ? new Date(ts) : ts).getTime();
  const from = (typeof now === "string" ? new Date(now) : now).getTime();
  const mins = Math.round((target - from) / 60_000);
  if (mins <= 5) return "now";
  if (mins < 90) return `in ${mins} minutes`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}
