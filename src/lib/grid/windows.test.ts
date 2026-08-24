import { describe, expect, it } from "vitest";
import { getAppliance } from "../appliances";
import type {
  GridSnapshot,
  IntensityPoint,
  RegionInfo,
  SeriesStats,
} from "../types";
import { seriesStats } from "./stats";
import {
  dailyBest,
  hourWeights,
  NOW_IS_GREAT_THRESHOLD,
  planWindows,
  typicalCleanestHour,
  windowPhrase,
} from "./windows";

const CISO: RegionInfo = {
  ba: "CISO",
  name: "California Independent System Operator",
  shortName: "California grid (CAISO)",
  timezone: "America/Los_Angeles",
  state: "CA",
  approximate: false,
  matchedBy: "zip",
};

/** Fixed start so every assertion is timezone- and clock-independent. */
const START = "2026-08-23T07:00:00.000Z"; // midnight local in Los Angeles

function makeSnapshot(
  shape: (localHour: number, hourIndex: number) => number,
  options: { region?: RegionInfo; hours?: number; start?: string } = {},
): GridSnapshot {
  const region = options.region ?? CISO;
  const hours = options.hours ?? 168;
  const startMs = Date.parse(options.start ?? START);
  const series: IntensityPoint[] = [];
  for (let i = 0; i < hours; i += 1) {
    const ts = new Date(startMs + i * 3_600_000);
    const localHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: region.timezone,
        hour: "numeric",
        hour12: false,
      }).format(ts),
    );
    series.push({
      ts: ts.toISOString(),
      gCO2PerKWh: shape(localHour % 24, i),
      source: i < 24 ? "blend" : "climatology",
      confidence: i < 24 ? "high" : i < 72 ? "medium" : "low",
    });
  }
  const stats: SeriesStats = seriesStats(series.map((p) => p.gCO2PerKWh));
  return {
    region,
    now: series[0],
    series,
    stats,
    providers: [],
    generatedAt: series[0].ts,
    ttlSeconds: 900,
    notes: [],
  };
}

/** California-like: deep midday solar trough, dirty overnight. */
const solarShape = (h: number) => (h >= 9 && h <= 15 ? 150 : 290);
/** SPP-like: cleanest in the small hours, dirtiest mid-afternoon. */
const windShape = (h: number) => (h >= 1 && h <= 5 ? 337 : h >= 14 && h <= 18 ? 447 : 390);

describe("hourWeights", () => {
  it("splits a part-hour run across the clock hours it touches", () => {
    expect(hourWeights(1)).toEqual([1]);
    expect(hourWeights(2)).toEqual([1, 1]);
    expect(hourWeights(1.5)).toEqual([1, 0.5]);
    expect(hourWeights(4)).toEqual([1, 1, 1, 1]);
  });

  it("never returns an empty set of weights", () => {
    expect(hourWeights(0).length).toBeGreaterThan(0);
    expect(hourWeights(-3).length).toBeGreaterThan(0);
  });
});

describe("planWindows on a solar-shaped grid", () => {
  const snapshot = makeSnapshot(solarShape);
  const plan = planWindows(snapshot, getAppliance("dishwasher"));

  it("uses running-it-now as the baseline, not the dirtiest hour", () => {
    // Midnight local is in the dirty band, so the baseline is 290.
    expect(plan.baseline.avgIntensity).toBe(290);
    expect(plan.baseline.gramsCO2).toBe(Math.round(1.2 * 290));
  });

  it("recommends the midday trough", () => {
    const best = plan.windows[0];
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: CISO.timezone,
        hour: "numeric",
        hour12: false,
      }).format(new Date(best.startTs)),
    );
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThanOrEqual(14);
  });

  it("reports a saving that matches the underlying numbers", () => {
    const best = plan.windows[0];
    expect(best.avgIntensity).toBe(150);
    expect(best.savingsPercent).toBeCloseTo(((290 - 150) / 290) * 100, 0);
    expect(best.gramsCO2).toBe(Math.round(1.2 * 150));
    expect(best.baselineGrams).toBe(Math.round(1.2 * 290));
  });

  it("offers three genuinely different windows, cleanest first", () => {
    expect(plan.windows).toHaveLength(3);
    const intensities = plan.windows.map((w) => w.avgIntensity);
    expect([...intensities].sort((a, b) => a - b)).toEqual(intensities);
    const starts = plan.windows.map((w) => Date.parse(w.startTs));
    for (let i = 0; i < starts.length; i += 1) {
      for (let j = i + 1; j < starts.length; j += 1) {
        expect(Math.abs(starts[i] - starts[j])).toBeGreaterThanOrEqual(
          4 * 3_600_000,
        );
      }
    }
  });

  it("spreads suggestions across different days", () => {
    const days = new Set(
      plan.windows.map((w) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: CISO.timezone,
          dateStyle: "short",
        }).format(new Date(w.startTs)),
      ),
    );
    expect(days.size).toBeGreaterThan(1);
  });

  it("prefers the sooner of two equally clean windows", () => {
    // Every day has an identical trough, so the best pick must be day one.
    const best = plan.windows.find((w) => w.rank === 1)!;
    const hoursOut = (Date.parse(best.startTs) - Date.parse(START)) / 3_600_000;
    expect(hoursOut).toBeLessThan(24);
  });

  it("ranks and tiers the options", () => {
    expect(plan.windows[0].quality).toBe("best");
    expect(plan.windows.map((w) => w.rank)).toEqual([1, 2, 3]);
  });

  it("does not claim now is great when there is a real saving", () => {
    expect(plan.nowIsGreat).toBe(false);
  });

  it("labels windows the way a person would say them", () => {
    for (const w of plan.windows) {
      expect(w.label).toMatch(/(morning|afternoon|Tonight|night|day)/i);
      expect(w.label).toMatch(/–/);
      expect(w.shortLabel.length).toBeLessThan(24);
    }
  });

  it("carries the weakest confidence of the hours it spans", () => {
    const late = plan.windows.find(
      (w) => Date.parse(w.startTs) - Date.parse(START) > 72 * 3_600_000,
    );
    if (late) expect(late.confidence).toBe("low");
  });
});

describe("planWindows on a wind-shaped grid", () => {
  // SPP: the answer is 3 AM, and nothing in the engine may assume midday.
  const snapshot = makeSnapshot(windShape, {
    region: { ...CISO, ba: "SWPP", shortName: "Great Plains grid (SPP)" },
  });
  const plan = planWindows(snapshot, getAppliance("dishwasher"));

  it("recommends the small hours, not the afternoon", () => {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: CISO.timezone,
        hour: "numeric",
        hour12: false,
      }).format(new Date(plan.windows[0].startTs)),
    );
    expect(hour).toBeGreaterThanOrEqual(1);
    expect(hour).toBeLessThanOrEqual(5);
    expect(plan.windows[0].avgIntensity).toBe(337);
  });

  it("agrees with typicalCleanestHour", () => {
    const hour = typicalCleanestHour(snapshot);
    expect(hour).not.toBeNull();
    expect(hour!).toBeGreaterThanOrEqual(1);
    expect(hour!).toBeLessThanOrEqual(5);
  });
});

describe("planWindows on a flat grid", () => {
  // New England only swings ~12%; a 1% swing must not be dressed up.
  const snapshot = makeSnapshot((h) => (h === 3 ? 299 : 302));
  const plan = planWindows(snapshot, getAppliance("washing-machine"));

  it("says now is great rather than inventing a difference", () => {
    expect(plan.nowIsGreat).toBe(true);
    expect(plan.windows[0].savingsPercent).toBeLessThan(
      NOW_IS_GREAT_THRESHOLD,
    );
  });

  it("still offers options so the user isn't stuck", () => {
    expect(plan.windows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("planWindows when right now is already the cleanest hour", () => {
  const snapshot = makeSnapshot((_h, i) => 150 + i);
  const plan = planWindows(snapshot, getAppliance("dishwasher"));

  it("never reports a negative saving", () => {
    for (const w of plan.windows) {
      expect(w.savingsPercent).toBeGreaterThanOrEqual(0);
    }
    expect(plan.nowIsGreat).toBe(true);
  });
});

describe("planWindows with a run longer than the forecast", () => {
  const snapshot = makeSnapshot(() => 200, { hours: 2 });
  const plan = planWindows(snapshot, getAppliance("pool-pump")); // 6 hours

  it("degrades to an empty, honest plan", () => {
    expect(plan.windows).toEqual([]);
    expect(plan.nowIsGreat).toBe(true);
    expect(plan.baseline.gramsCO2).toBe(0);
  });
});

describe("long appliance runs", () => {
  it("weights an EV charge across its whole 4-hour window", () => {
    const snapshot = makeSnapshot(solarShape);
    const plan = planWindows(snapshot, getAppliance("ev"));
    const best = plan.windows[0];
    // The trough is 7 hours wide, so a 4-hour charge can sit entirely inside it.
    expect(best.avgIntensity).toBe(150);
    expect(best.gramsCO2).toBe(Math.round(30 * 150));
    // 30 kWh at a 140 g/kWh improvement is a meaningful, checkable number.
    expect(best.baselineGrams - best.gramsCO2).toBeGreaterThan(4000);
  });

  it("blends the part-hour of a run that doesn't land on a whole hour", () => {
    // No catalogue appliance has a fractional duration today, so use a synthetic
    // 90-minute load. One hour clean, everything else dirty: the run must land
    // between the two, weighted by how much of it falls in each clock hour.
    const ninetyMinutes = {
      ...getAppliance("dryer"),
      id: "synthetic-90min",
      durationHours: 1.5,
    };
    const snapshot = makeSnapshot((h) => (h === 12 ? 100 : 300));
    const plan = planWindows(snapshot, ninetyMinutes);
    const best = plan.windows[0];
    // Starting at 12:00 → 1h at 100 plus 0.5h at 300, weighted = 166.7.
    expect(best.avgIntensity).toBeCloseTo((100 * 1 + 300 * 0.5) / 1.5, 0);
  });
});

describe("dailyBest", () => {
  const snapshot = makeSnapshot(solarShape);
  const rows = dailyBest(snapshot, getAppliance("dishwasher"));

  it("returns one row per local day of the forecast", () => {
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.length).toBeLessThanOrEqual(8);
  });

  it("is ordered by time, not by cleanliness", () => {
    const times = rows.map((r) => Date.parse(r.startTs));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("picks the trough on each day", () => {
    for (const row of rows.slice(0, 7)) {
      expect(row.avgIntensity).toBe(150);
    }
  });
});

describe("windowPhrase", () => {
  const tz = "America/Los_Angeles";
  const now = new Date("2026-08-23T19:00:00.000Z"); // noon local, a Sunday

  it("names parts of today the way people do", () => {
    expect(windowPhrase(new Date("2026-08-23T16:00:00Z"), now, tz)).toBe(
      "This morning",
    );
    expect(windowPhrase(new Date("2026-08-23T21:00:00Z"), now, tz)).toBe(
      "This afternoon",
    );
    expect(windowPhrase(new Date("2026-08-24T02:00:00Z"), now, tz)).toBe(
      "Tonight",
    );
  });

  it("handles tomorrow and later days", () => {
    expect(windowPhrase(new Date("2026-08-24T17:00:00Z"), now, tz)).toBe(
      "Tomorrow morning",
    );
    expect(windowPhrase(new Date("2026-08-25T21:00:00Z"), now, tz)).toBe(
      "Tuesday afternoon",
    );
  });

  it("crosses midnight in local time, not UTC", () => {
    // 2026-08-24T05:00Z is 10 PM Sunday in Los Angeles — still "Tonight".
    expect(windowPhrase(new Date("2026-08-24T05:00:00Z"), now, tz)).toBe(
      "Tonight",
    );
  });
});
