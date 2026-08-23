import { describe, expect, it } from "vitest";
import {
  dayKeyInZone,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatGrams,
  formatGramsLong,
  formatIntensity,
  formatKWh,
  formatRelativeTime,
  hourInZone,
  relativeDayName,
  weekdayInZone,
} from "./format";

/**
 * Every number and time the user reads goes through this module, so a bug here
 * is visible on the front page. Timestamps are fixed and timezones explicit so
 * these assertions don't depend on where the test runs.
 */

const LA = "America/Los_Angeles";
const NY = "America/New_York";
const PHOENIX = "America/Phoenix"; // no DST — a useful control

describe("formatGrams", () => {
  it("uses grams below a kilo and kilos above", () => {
    expect(formatGrams(0)).toBe("0 g");
    expect(formatGrams(145)).toBe("145 g");
    expect(formatGrams(999)).toBe("999 g");
    expect(formatGrams(1000)).toBe("1.0 kg");
    expect(formatGrams(4500)).toBe("4.5 kg");
  });

  it("drops the decimal once the number is large", () => {
    expect(formatGrams(100_000)).toBe("100 kg");
    expect(formatGrams(1_500_000)).toBe("1,500 kg");
  });

  it("never shows a negative saving", () => {
    // Declined actions and forecast noise must never read as a loss.
    expect(formatGrams(-500)).toBe("0 g");
  });

  it("has a long form for prose", () => {
    expect(formatGramsLong(145)).toBe("145 grams");
    expect(formatGramsLong(4500)).toBe("4.5 kilograms");
    expect(formatGramsLong(45_000)).toBe("45 kilograms");
  });
});

describe("formatIntensity and formatKWh", () => {
  it("rounds intensity to whole grams", () => {
    expect(formatIntensity(148.6)).toBe("149 g/kWh");
  });

  it("keeps one decimal for small appliance loads", () => {
    expect(formatKWh(1.2)).toBe("1.2 kWh");
    expect(formatKWh(0.6)).toBe("0.6 kWh");
    // An EV charge doesn't need a decimal.
    expect(formatKWh(30)).toBe("30 kWh");
  });
});

describe("formatDuration", () => {
  it("reads the way a person would say it", () => {
    expect(formatDuration(1)).toBe("1 hour");
    expect(formatDuration(2)).toBe("2 hours");
    expect(formatDuration(0.5)).toBe("30 minutes");
    expect(formatDuration(1.5)).toBe("1 hr 30 min");
    expect(formatDuration(6)).toBe("6 hours");
  });
});

describe("formatClock", () => {
  it("names noon and midnight instead of printing 12", () => {
    // 19:00Z is noon in Los Angeles.
    expect(formatClock("2026-08-23T19:00:00Z", LA)).toBe("Noon");
    // 07:00Z is midnight in Los Angeles.
    expect(formatClock("2026-08-23T07:00:00Z", LA)).toBe("Midnight");
  });

  it("drops :00 but keeps real minutes", () => {
    expect(formatClock("2026-08-23T21:00:00Z", LA)).toBe("2 PM");
    expect(formatClock("2026-08-23T21:30:00Z", LA)).toBe("2:30 PM");
  });

  it("renders in the region's zone, not the machine's", () => {
    const ts = "2026-08-23T21:00:00Z";
    expect(formatClock(ts, LA)).toBe("2 PM");
    expect(formatClock(ts, NY)).toBe("5 PM");
    expect(formatClock(ts, PHOENIX)).toBe("2 PM");
  });

  it("accepts a Date as well as a string", () => {
    expect(formatClock(new Date("2026-08-23T21:00:00Z"), LA)).toBe("2 PM");
  });
});

describe("hourInZone", () => {
  it("returns 0-23 in local time", () => {
    expect(hourInZone("2026-08-23T07:00:00Z", LA)).toBe(0);
    expect(hourInZone("2026-08-23T19:00:00Z", LA)).toBe(12);
    expect(hourInZone("2026-08-24T06:00:00Z", LA)).toBe(23);
  });

  it("differs across zones for the same instant", () => {
    const ts = "2026-08-24T02:00:00Z";
    expect(hourInZone(ts, LA)).toBe(19);
    expect(hourInZone(ts, NY)).toBe(22);
  });
});

describe("dayKeyInZone", () => {
  it("groups by local day, not UTC day", () => {
    // 2026-08-24T05:00Z is still Sunday 10 PM in Los Angeles.
    expect(dayKeyInZone("2026-08-24T05:00:00Z", LA)).toBe("2026-08-23");
    expect(dayKeyInZone("2026-08-24T05:00:00Z", NY)).toBe("2026-08-24");
  });

  it("produces a sortable ISO date", () => {
    expect(dayKeyInZone("2026-01-05T12:00:00Z", NY)).toBe("2026-01-05");
  });
});

describe("weekdayInZone", () => {
  it("uses 0 for Sunday", () => {
    // 2026-08-23 is a Sunday.
    expect(weekdayInZone("2026-08-23T19:00:00Z", LA)).toBe(0);
    expect(weekdayInZone("2026-08-24T19:00:00Z", LA)).toBe(1);
  });

  it("respects the local day boundary", () => {
    // Late Sunday in LA is already Monday in UTC and in New York.
    expect(weekdayInZone("2026-08-24T05:00:00Z", LA)).toBe(0);
    expect(weekdayInZone("2026-08-24T05:00:00Z", NY)).toBe(1);
  });
});

describe("relativeDayName", () => {
  const now = "2026-08-23T19:00:00Z"; // Sunday noon in LA

  it("says Today and Tomorrow", () => {
    expect(relativeDayName("2026-08-23T22:00:00Z", now, LA)).toBe("Today");
    expect(relativeDayName("2026-08-24T19:00:00Z", now, LA)).toBe("Tomorrow");
  });

  it("names the weekday further out", () => {
    expect(relativeDayName("2026-08-25T19:00:00Z", now, LA)).toBe("Tuesday");
    expect(relativeDayName("2026-08-28T19:00:00Z", now, LA)).toBe("Friday");
  });

  it("treats late evening as still today in local time", () => {
    // 10 PM Sunday in LA is Monday 05:00 UTC — it must not become "Tomorrow".
    expect(relativeDayName("2026-08-24T05:00:00Z", now, LA)).toBe("Today");
  });

  it("crosses a month boundary", () => {
    expect(
      relativeDayName("2026-09-01T19:00:00Z", "2026-08-31T19:00:00Z", LA),
    ).toBe("Tomorrow");
  });
});

describe("formatDayLabel", () => {
  it("gives a short, scannable day", () => {
    expect(formatDayLabel("2026-08-23T19:00:00Z", LA)).toBe("Sun, Aug 23");
  });

  it("uses the local day", () => {
    expect(formatDayLabel("2026-08-24T05:00:00Z", LA)).toBe("Sun, Aug 23");
    expect(formatDayLabel("2026-08-24T05:00:00Z", NY)).toBe("Mon, Aug 24");
  });
});

describe("formatRelativeTime", () => {
  const now = "2026-08-23T19:00:00Z";

  it("collapses anything imminent to 'now'", () => {
    expect(formatRelativeTime("2026-08-23T19:00:00Z", now)).toBe("now");
    expect(formatRelativeTime("2026-08-23T19:04:00Z", now)).toBe("now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(formatRelativeTime("2026-08-23T19:40:00Z", now)).toBe("in 40 minutes");
    expect(formatRelativeTime("2026-08-23T22:00:00Z", now)).toBe("in 3 hours");
    expect(formatRelativeTime("2026-08-25T19:00:00Z", now)).toBe("in 2 days");
  });

  it("says tomorrow rather than 'in 1 days'", () => {
    expect(formatRelativeTime("2026-08-24T19:00:00Z", now)).toBe("tomorrow");
  });
});

describe("daylight saving transitions", () => {
  // US DST ends 2026-11-01, when 1 AM local repeats in New York.
  it("keeps local hours correct through the fall-back", () => {
    // 05:00Z is 1 AM EDT, 06:00Z is 1 AM EST — the same local hour twice.
    expect(hourInZone("2026-11-01T05:00:00Z", NY)).toBe(1);
    expect(hourInZone("2026-11-01T06:00:00Z", NY)).toBe(1);
    expect(dayKeyInZone("2026-11-01T06:00:00Z", NY)).toBe("2026-11-01");
  });

  // DST begins 2026-03-08, when 2 AM local does not exist.
  it("keeps local hours correct through the spring-forward", () => {
    expect(hourInZone("2026-03-08T06:00:00Z", NY)).toBe(1);
    // 07:00Z skips straight to 3 AM local.
    expect(hourInZone("2026-03-08T07:00:00Z", NY)).toBe(3);
  });

  it("is unaffected in a zone without DST", () => {
    expect(hourInZone("2026-11-01T05:00:00Z", PHOENIX)).toBe(22);
    expect(hourInZone("2026-03-08T07:00:00Z", PHOENIX)).toBe(0);
  });
});
