import { describe, expect, it } from "vitest";
import type { LoggedAction } from "@/lib/types";
import { APPLIANCES, HABITS, getAppliance, getHabit } from "@/lib/appliances";
import {
  EQUIVALENCE,
  REPORT_MESSAGES,
  addDays,
  dailyBreakdown,
  daysBetween,
  equivalentsFor,
  formatGrams,
  pickMessage,
  summarise,
  valueHabit,
  valueShift,
  weekStartOf,
  weeklyBreakdown,
  weeklyReport,
} from "./summary";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

let seq = 0;
function act(partial: Partial<LoggedAction> = {}): LoggedAction {
  seq += 1;
  return {
    id: `a-${seq}`,
    kind: "shift",
    subjectId: "dishwasher",
    label: "Dishwasher",
    loggedAt: "2026-08-26T18:00:00.000Z",
    gramsSaved: 100,
    status: "done",
    ...partial,
  };
}

/** Wednesday 26 Aug 2026, noon in Los Angeles. Week runs Mon 24 – Sun 30. */
const NOW = "2026-08-26T19:00:00.000Z";

describe("calendar helpers", () => {
  it("puts week starts on Monday", () => {
    expect(weekStartOf("2026-08-26")).toBe("2026-08-24"); // Wednesday
    expect(weekStartOf("2026-08-24")).toBe("2026-08-24"); // Monday itself
    expect(weekStartOf("2026-08-23")).toBe("2026-08-17"); // Sunday belongs to the week before
    expect(weekStartOf("2026-08-30")).toBe("2026-08-24"); // Sunday closes the week
  });

  it("does calendar arithmetic across month and year ends", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(daysBetween("2026-08-24", "2026-08-31")).toBe(7);
    expect(daysBetween("2026-08-31", "2026-08-24")).toBe(-7);
  });
});

describe("summarise", () => {
  it("returns honest zeros for an empty history", () => {
    const summary = summarise([], NOW, LA);
    expect(summary).toMatchObject({
      totalGramsSaved: 0,
      actionCount: 0,
      weekGramsSaved: 0,
      weekActionCount: 0,
      streakDays: 0,
    });
    expect(summary.equivalents).toEqual({ milesDriven: 0, phoneCharges: 0, treeDays: 0 });
  });

  it("totals done actions and counts them", () => {
    const summary = summarise(
      [
        act({ gramsSaved: 250.4 }),
        act({ gramsSaved: 100.2, loggedAt: "2026-08-25T18:00:00.000Z" }),
      ],
      NOW,
      LA,
    );
    expect(summary.totalGramsSaved).toBe(350.6);
    expect(summary.actionCount).toBe(2);
  });

  it("excludes declined actions from every total, and never counts them against the user", () => {
    const summary = summarise(
      [act({ gramsSaved: 500 }), act({ status: "declined", gramsSaved: 0 })],
      NOW,
      LA,
    );
    expect(summary.totalGramsSaved).toBe(500);
    expect(summary.actionCount).toBe(1);
    expect(summary.weekActionCount).toBe(1);
  });

  it("ignores stray negative or non-finite grams rather than subtracting them", () => {
    const summary = summarise(
      [
        act({ gramsSaved: 200 }),
        act({ gramsSaved: -500 }),
        act({ gramsSaved: Number.NaN }),
      ],
      NOW,
      LA,
    );
    expect(summary.totalGramsSaved).toBe(200);
  });

  it("survives an unparseable timestamp instead of throwing", () => {
    const summary = summarise([act({ loggedAt: "not a date", gramsSaved: 90 })], NOW, LA);
    expect(summary.totalGramsSaved).toBe(90);
    expect(summary.weekActionCount).toBe(0); // 1970 is not this week
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(summarise([act()], NOW, "Mars/Olympus_Mons").weekActionCount).toBe(1);
  });
});

describe("week boundaries across timezones", () => {
  // 06:30 UTC Monday is still 23:30 Sunday in California — the same instant
  // belongs to different weeks depending on whose clock we use.
  const edge = act({ loggedAt: "2026-08-24T06:30:00.000Z", gramsSaved: 400 });

  it("counts the instant in the current week in UTC", () => {
    const summary = summarise([edge], NOW, "UTC");
    expect(summary.weekGramsSaved).toBe(400);
    expect(summary.weekActionCount).toBe(1);
  });

  it("counts the same instant in the previous week in Los Angeles", () => {
    const summary = summarise([edge], NOW, LA);
    expect(summary.totalGramsSaved).toBe(400); // lifetime total is unaffected
    expect(summary.weekGramsSaved).toBe(0);
    expect(summary.weekActionCount).toBe(0);
  });

  it("keeps Sunday in the week that just ended", () => {
    // Sunday 30 Aug 23:00 local is still "this week"; Monday 31 Aug is not.
    const sunday = act({ loggedAt: "2026-08-31T06:00:00.000Z", gramsSaved: 10 }); // Sun 23:00 LA
    const monday = act({ loggedAt: "2026-08-31T18:00:00.000Z", gramsSaved: 20 }); // Mon 11:00 LA
    const summary = summarise([sunday, monday], "2026-08-31T06:30:00.000Z", LA);
    expect(summary.weekGramsSaved).toBe(10);
  });
});

describe("daylight saving transitions", () => {
  it("groups the spring-forward day as one day", () => {
    // 01:30 EST, 04:30 EDT and 23:00 EDT on 8 March 2026 — the day the clocks
    // jumped — are all the same local day.
    const actions = [
      act({ loggedAt: "2026-03-08T06:30:00.000Z", gramsSaved: 10 }),
      act({ loggedAt: "2026-03-08T08:30:00.000Z", gramsSaved: 20 }),
      act({ loggedAt: "2026-03-09T03:00:00.000Z", gramsSaved: 30 }),
    ];
    const days = dailyBreakdown(actions, "2026-03-10T16:00:00.000Z", NY);
    const march8 = days.find((d) => d.date === "2026-03-08");
    expect(march8).toEqual({ date: "2026-03-08", gramsSaved: 60, actionCount: 3 });
    expect(days.filter((d) => d.actionCount > 0)).toHaveLength(1);
  });

  it("keeps 14 consecutive days across a 23-hour day", () => {
    const days = dailyBreakdown([], "2026-03-10T16:00:00.000Z", NY);
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-02-25");
    expect(days[13].date).toBe("2026-03-10");
    for (let i = 1; i < days.length; i += 1) {
      expect(daysBetween(days[i - 1].date, days[i].date)).toBe(1);
    }
  });

  it("groups the repeated hour of the fall-back day as one day", () => {
    // 01:30 happens twice on 1 November 2026 (EDT then EST).
    const actions = [
      act({ loggedAt: "2026-11-01T05:30:00.000Z", gramsSaved: 5 }),
      act({ loggedAt: "2026-11-01T06:30:00.000Z", gramsSaved: 5 }),
    ];
    const summary = summarise(actions, "2026-11-01T20:00:00.000Z", NY);
    expect(summary.streakDays).toBe(1);
    expect(summary.weekGramsSaved).toBe(10);
  });
});

describe("streaks", () => {
  const on = (day: string, extra: Partial<LoggedAction> = {}) =>
    // 12:00 local in LA is 19:00 UTC, safely inside the day either side.
    act({ loggedAt: `${day}T19:00:00.000Z`, ...extra });

  it("counts consecutive days ending today", () => {
    const actions = [on("2026-08-26"), on("2026-08-25"), on("2026-08-24")];
    expect(summarise(actions, NOW, LA).streakDays).toBe(3);
  });

  it("counts several actions on one day once", () => {
    const actions = [on("2026-08-26"), on("2026-08-26"), on("2026-08-25")];
    expect(summarise(actions, NOW, LA).streakDays).toBe(2);
  });

  it("keeps the streak alive when today has nothing logged yet", () => {
    // Losing a streak at 00:01 before the day has even started would be unkind
    // and wrong — the run may still be coming.
    const actions = [on("2026-08-25"), on("2026-08-24")];
    expect(summarise(actions, NOW, LA).streakDays).toBe(2);
  });

  it("stops at a gap", () => {
    const actions = [on("2026-08-26"), on("2026-08-24"), on("2026-08-23")];
    expect(summarise(actions, NOW, LA).streakDays).toBe(1);
  });

  it("is zero once two whole days have passed", () => {
    expect(summarise([on("2026-08-24")], NOW, LA).streakDays).toBe(0);
  });

  it("does not count a day that only has declines", () => {
    const actions = [
      on("2026-08-26", { status: "declined", gramsSaved: 0 }),
      on("2026-08-25"),
      on("2026-08-24"),
    ];
    // Streak ends yesterday and keeps its length: declining costs nothing.
    expect(summarise(actions, NOW, LA).streakDays).toBe(2);
  });

  it("is zero when the only history is declines", () => {
    const actions = [on("2026-08-26", { status: "declined", gramsSaved: 0 })];
    expect(summarise(actions, NOW, LA).streakDays).toBe(0);
  });

  it("counts a streak that runs across a month boundary", () => {
    const actions = [on("2026-09-01"), on("2026-08-31"), on("2026-08-30")];
    expect(summarise(actions, "2026-09-01T19:00:00.000Z", LA).streakDays).toBe(3);
  });
});

describe("equivalents", () => {
  it("uses the documented constants", () => {
    expect(EQUIVALENCE).toEqual({
      gramsPerMile: 400,
      gramsPerPhoneCharge: 8,
      gramsPerTreeDay: 58,
    });
  });

  it("converts grams into things people can picture", () => {
    // 4 kg avoided: 10 miles not driven, 500 phone charges, ~69 tree-days.
    expect(equivalentsFor(4000)).toEqual({
      milesDriven: 10,
      phoneCharges: 500,
      treeDays: 69,
    });
  });

  it("rounds miles and tree-days to one decimal and charges to whole units", () => {
    expect(equivalentsFor(1000)).toEqual({
      milesDriven: 2.5,
      phoneCharges: 125,
      treeDays: 17.2,
    });
  });

  it("never reports negative equivalents", () => {
    expect(equivalentsFor(-100)).toEqual({ milesDriven: 0, phoneCharges: 0, treeDays: 0 });
    expect(equivalentsFor(Number.NaN).treeDays).toBe(0);
  });

  it("formats mass the way the copy needs it", () => {
    expect(formatGrams(0)).toBe("0 g");
    expect(formatGrams(842.4)).toBe("842 g");
    expect(formatGrams(1240)).toBe("1.2 kg");
    expect(formatGrams(24_600)).toBe("25 kg");
    expect(formatGrams(-50)).toBe("0 g");
  });
});

describe("valueHabit", () => {
  const airDry = getHabit("air-dry")!;

  it("values saved kWh at the region's intensity", () => {
    expect(valueHabit(airDry, 400)).toBe(1000); // 2.5 kWh * 400 g
  });

  it("returns zero rather than guessing when intensity is unknown", () => {
    expect(valueHabit(airDry, 0)).toBe(0);
    expect(valueHabit(airDry, -100)).toBe(0);
    expect(valueHabit(airDry, Number.NaN)).toBe(0);
  });

  it("works for every habit in the catalogue and never goes negative", () => {
    for (const habit of HABITS) {
      expect(valueHabit(habit, 350)).toBeGreaterThan(0);
    }
  });
});

describe("valueShift", () => {
  const dishwasher = getAppliance("dishwasher"); // 1.2 kWh

  it("prices the baseline and the chosen window", () => {
    const valued = valueShift(dishwasher, { avgIntensity: 200 }, { avgIntensity: 500 });
    expect(valued).toEqual({
      actualGrams: 240,
      baselineGrams: 600,
      gramsSaved: 360,
      savingsPercent: 60,
    });
  });

  it("floors savings at zero when the forecast moved the wrong way", () => {
    // The user did the right thing; the grid changed its mind. That is never
    // their debt to carry.
    const valued = valueShift(dishwasher, { avgIntensity: 600 }, { avgIntensity: 500 });
    expect(valued.gramsSaved).toBe(0);
    expect(valued.savingsPercent).toBe(0);
    // The raw numbers are still there for honest copy.
    expect(valued.actualGrams).toBe(720);
    expect(valued.baselineGrams).toBe(600);
  });

  it("handles a missing baseline without dividing by zero", () => {
    const valued = valueShift(dishwasher, { avgIntensity: 300 }, { avgIntensity: 0 });
    expect(valued).toEqual({
      actualGrams: 360,
      baselineGrams: 0,
      gramsSaved: 0,
      savingsPercent: 0,
    });
  });

  it("scales with appliance energy", () => {
    const ev = getAppliance("ev"); // 30 kWh
    const valued = valueShift(ev, { avgIntensity: 100 }, { avgIntensity: 400 });
    expect(valued.gramsSaved).toBe(9000);
    expect(valued.savingsPercent).toBe(75);
  });

  it("never produces a negative saving for any appliance", () => {
    for (const appliance of APPLIANCES) {
      const valued = valueShift(appliance, { avgIntensity: 900 }, { avgIntensity: 50 });
      expect(valued.gramsSaved).toBe(0);
      expect(valued.savingsPercent).toBe(0);
    }
  });
});

describe("weeklyBreakdown", () => {
  it("returns 8 zero-filled weeks, oldest first, all starting on Monday", () => {
    const weeks = weeklyBreakdown([], NOW, LA);
    expect(weeks).toHaveLength(8);
    expect(weeks[0].weekStart).toBe("2026-07-06");
    expect(weeks[7].weekStart).toBe("2026-08-24");
    for (const week of weeks) {
      expect(weekStartOf(week.weekStart)).toBe(week.weekStart);
      expect(week.gramsSaved).toBe(0);
    }
  });

  it("buckets actions into their local week", () => {
    const weeks = weeklyBreakdown(
      [
        act({ loggedAt: "2026-08-26T19:00:00.000Z", gramsSaved: 100 }),
        act({ loggedAt: "2026-08-20T19:00:00.000Z", gramsSaved: 50 }),
        act({ status: "declined", gramsSaved: 0, loggedAt: "2026-08-26T20:00:00.000Z" }),
      ],
      NOW,
      LA,
    );
    expect(weeks[7]).toEqual({ weekStart: "2026-08-24", gramsSaved: 100, actionCount: 1 });
    expect(weeks[6]).toEqual({ weekStart: "2026-08-17", gramsSaved: 50, actionCount: 1 });
  });

  it("drops anything outside the window instead of piling it into the edge bucket", () => {
    const weeks = weeklyBreakdown(
      [
        act({ loggedAt: "2026-01-01T19:00:00.000Z", gramsSaved: 999 }), // long past
        act({ loggedAt: "2027-01-01T19:00:00.000Z", gramsSaved: 999 }), // clock skew
      ],
      NOW,
      LA,
    );
    expect(weeks.every((w) => w.gramsSaved === 0)).toBe(true);
  });
});

describe("dailyBreakdown", () => {
  it("returns 14 zero-filled days ending today", () => {
    const days = dailyBreakdown([], NOW, LA);
    expect(days).toHaveLength(14);
    expect(days[13].date).toBe("2026-08-26");
    expect(days[0].date).toBe("2026-08-13");
  });

  it("sums a day and skips declines", () => {
    const days = dailyBreakdown(
      [
        act({ loggedAt: "2026-08-26T17:00:00.000Z", gramsSaved: 30 }),
        act({ loggedAt: "2026-08-26T22:00:00.000Z", gramsSaved: 12.5 }),
        act({ loggedAt: "2026-08-26T23:00:00.000Z", status: "declined", gramsSaved: 0 }),
      ],
      NOW,
      LA,
    );
    expect(days[13]).toEqual({ date: "2026-08-26", gramsSaved: 42.5, actionCount: 2 });
  });
});

describe("weeklyReport", () => {
  const thisWeek = (grams: number, extra: Partial<LoggedAction> = {}) =>
    act({ loggedAt: "2026-08-25T19:00:00.000Z", gramsSaved: grams, ...extra });
  const lastWeek = (grams: number, extra: Partial<LoggedAction> = {}) =>
    act({ loggedAt: "2026-08-18T19:00:00.000Z", gramsSaved: grams, ...extra });

  it("frames the week with local Monday-to-Sunday dates", () => {
    const report = weeklyReport([], NOW, LA);
    expect(report.weekStart).toBe("2026-08-24");
    expect(report.weekEnd).toBe("2026-08-30");
  });

  it("compares against last week", () => {
    const report = weeklyReport([thisWeek(300), lastWeek(200)], NOW, LA);
    expect(report.gramsSaved).toBe(300);
    expect(report.previousGramsSaved).toBe(200);
    expect(report.deltaGrams).toBe(100);
    expect(report.deltaPercent).toBe(50);
    expect(report.tone).toBe("up");
  });

  it("has no percentage to report when last week was empty", () => {
    const report = weeklyReport([thisWeek(300)], NOW, LA);
    expect(report.deltaPercent).toBeNull();
    expect(report.tone).toBe("first-week");
  });

  it("calls a small change steady", () => {
    const report = weeklyReport([thisWeek(205), lastWeek(200)], NOW, LA);
    expect(report.tone).toBe("steady");
  });

  it("calls a smaller week lighter, never a failure", () => {
    const report = weeklyReport([thisWeek(100), lastWeek(400)], NOW, LA);
    expect(report.deltaGrams).toBe(-300);
    expect(report.tone).toBe("lighter");
    expect(report.gramsSaved).toBe(100); // still a win, still counted
  });

  it("treats a week with nothing logged as rest, not failure", () => {
    const report = weeklyReport([lastWeek(400)], NOW, LA);
    expect(report.actionCount).toBe(0);
    expect(report.gramsSaved).toBe(0);
    expect(report.tone).toBe("resting");
    expect(report.deltaGrams).toBe(-400);
  });

  it("welcomes a brand new user", () => {
    expect(weeklyReport([], NOW, LA).tone).toBe("starting");
  });

  it("treats a declines-only week as rest", () => {
    const report = weeklyReport(
      [thisWeek(0, { status: "declined" }), lastWeek(100)],
      NOW,
      LA,
    );
    expect(report.tone).toBe("resting");
    expect(report.biggestWin).toBeNull();
  });

  it("picks the biggest single win of the week", () => {
    const report = weeklyReport(
      [
        thisWeek(120, { label: "Dishwasher" }),
        thisWeek(900, { label: "EV charging", subjectId: "ev" }),
        thisWeek(400, { label: "Clothes dryer", subjectId: "dryer" }),
      ],
      NOW,
      LA,
    );
    expect(report.biggestWin).toEqual({ label: "EV charging", gramsSaved: 900, kind: "shift" });
  });

  it("can credit a habit as the biggest win", () => {
    const report = weeklyReport(
      [
        thisWeek(50),
        thisWeek(600, { kind: "habit", subjectId: "air-dry", label: "Air-dried laundry" }),
      ],
      NOW,
      LA,
    );
    expect(report.biggestWin?.kind).toBe("habit");
  });

  it("names the most-used appliance, counting runs before grams", () => {
    const report = weeklyReport(
      [
        thisWeek(50, { subjectId: "washing-machine", label: "Washing machine" }),
        thisWeek(50, { subjectId: "washing-machine", label: "Washing machine" }),
        thisWeek(900, { subjectId: "ev", label: "EV charging" }),
      ],
      NOW,
      LA,
    );
    expect(report.topAppliance).toEqual({
      id: "washing-machine",
      label: "Washing machine",
      count: 2,
      gramsSaved: 100,
    });
  });

  it("does not count habits as appliances", () => {
    const report = weeklyReport(
      [
        thisWeek(10, { kind: "habit", subjectId: "lights-off", label: "Lights off" }),
        thisWeek(10, { kind: "habit", subjectId: "lights-off", label: "Lights off" }),
        thisWeek(10, { subjectId: "oven", label: "Electric oven" }),
      ],
      NOW,
      LA,
    );
    expect(report.topAppliance?.id).toBe("oven");
  });

  it("has no appliance to name when nothing was shifted", () => {
    expect(weeklyReport([], NOW, LA).topAppliance).toBeNull();
  });

  it("includes equivalents for the week's total", () => {
    expect(weeklyReport([thisWeek(800)], NOW, LA).equivalents.milesDriven).toBe(2);
  });
});

describe("report copy", () => {
  const allMessages = Object.values(REPORT_MESSAGES).flat();

  it("offers several variants for every tone", () => {
    for (const [tone, variants] of Object.entries(REPORT_MESSAGES)) {
      expect(variants.length, tone).toBeGreaterThanOrEqual(3);
      expect(new Set(variants).size, tone).toBe(variants.length);
    }
  });

  it("never uses guilt-inducing language", () => {
    // The whole product falls apart if the weekly summary nags.
    const forbidden = [
      "should",
      "only",
      "fail",
      "miss",
      "guilt",
      "sorry",
      "unfortunately",
      "worse",
      "behind",
      "lazy",
      "bad",
      "shame",
      "must",
      "try harder",
      "disappoint",
    ];
    for (const message of allMessages) {
      const lower = message.toLowerCase();
      for (const word of forbidden) {
        expect(lower.includes(word), `"${message}" contains "${word}"`).toBe(false);
      }
    }
  });

  it("keeps lines short enough for one line of UI", () => {
    for (const message of allMessages) {
      expect(message.length, message).toBeLessThanOrEqual(90);
    }
  });

  it("picks deterministically — the same week always reads the same", () => {
    const actions = [act({ loggedAt: "2026-08-25T19:00:00.000Z", gramsSaved: 300 })];
    const first = weeklyReport(actions, NOW, LA);
    const second = weeklyReport(actions, "2026-08-26T23:00:00.000Z", LA);
    expect(second.message).toBe(first.message);
    expect(REPORT_MESSAGES[first.tone]).toContain(first.message);
  });

  it("spreads seeds across the variants instead of always picking the first", () => {
    const picked = new Set(
      Array.from({ length: 40 }, (_, i) => pickMessage("up", `seed-${i}`)),
    );
    expect(picked.size).toBeGreaterThan(1);
    for (const message of picked) expect(REPORT_MESSAGES.up).toContain(message);
  });
});
