import { describe, expect, it } from "vitest";
import { projectSeries } from "./climatology";
import { applyDemandCorrection } from "./demand";
import { buildDemandCorrection } from "./snapshot";
import { HOURS_PER_WEEK } from "./time";
import type { RegionProfile } from "./types";

/**
 * Regression tests for a bug that inverted the app's headline claim.
 *
 * EIA publishes actual demand (`D`) and a day-ahead demand forecast (`DF`).
 * They are not on the same basis: measured over 337 overlapping hours, PJM's DF
 * tracked D to within 4.3% and ERCOT's to 1.2%, but CISO's ran 17–30% *below*
 * metered demand. Because the hour-of-week demand normals are built from `D`,
 * comparing raw `DF` against them made a hot Sunday afternoon in California —
 * when demand was 10% *above* normal — look like demand was 8% *below* normal.
 * That flipped the correction's sign and reported the dirtiest stretch of the
 * week as its cleanest hour, at 84 gCO2/kWh instead of ~175.
 */

const TIMEZONE = "America/Los_Angeles";

function makeProfile(): RegionProfile {
  // Flat 200 g/kWh and flat 30,000 MWh normals so any movement in the output is
  // unambiguously the demand correction and not the diurnal shape.
  const slots = Array.from({ length: HOURS_PER_WEEK }, () => ({
    gCO2PerKWh: 200,
    fuelMix: { gas: 0.6, solar: 0.4 },
    carbonFreeShare: 0.4,
    weight: 10,
    samples: 40,
  }));
  return {
    ba: "TEST",
    timezone: TIMEZONE,
    source: "eia",
    generatedAt: "2026-08-23T00:00:00.000Z",
    targetDate: "2026-08-23",
    hoursOfHistory: 8760,
    slots,
    stats: { min: 200, max: 200, mean: 200, p10: 200, p90: 200 },
    demandSlots: Array.from({ length: HOURS_PER_WEEK }, () => 30_000),
    demandSensitivity: {
      slope: 4.6,
      intercept: -18.9,
      r: 0.74,
      n: 2145,
      baselineRmse: 86,
      correctedRmse: 45,
      applied: true,
    },
    notes: [],
  };
}

const START = "2026-08-23T21:00:00.000Z"; // 2 PM Sunday in Los Angeles

function hoursFrom(startIso: string, count: number, from = 0): string[] {
  const base = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) =>
    new Date(base + (from + i) * 3_600_000).toISOString(),
  );
}

describe("day-ahead demand forecast anchoring", () => {
  const profile = makeProfile();
  const climatologyPoints = projectSeries(profile, {
    start: new Date(START),
    hours: 12,
  });
  const startMs = Date.parse(START);

  // Actual demand 10% above normal, through the hour before the series starts.
  const livePoints = hoursFrom(START, 4, -3).map((ts) => ({
    ts,
    epochMs: Date.parse(ts),
    mwh: 33_000,
  }));

  /**
   * A forecast that is biased 20% low but has the right *shape*: flat, matching
   * its own level. Overlaps the live readings so it can be anchored.
   */
  const biasedForecast = hoursFrom(START, 12, -3).map((ts) => ({
    ts,
    epochMs: Date.parse(ts),
    mwh: 26_400, // 20% below the 33,000 actual
  }));

  it("reports demand as above normal when actual demand is above normal", () => {
    const correction = buildDemandCorrection({
      profile,
      livePoints,
      forecastPoints: biasedForecast,
      climatologyPoints,
      startMs,
      hours: 12,
    });
    const residual = correction.residualByIndex.get(0);
    expect(residual).toBeDefined();
    // Actual is 33,000 vs a 30,000 normal: +10%, not the -12% raw DF implies.
    expect(residual!).toBeGreaterThan(5);
    expect(residual!).toBeLessThan(15);
  });

  it("moves intensity up, not down, on a high-demand day", () => {
    const correction = buildDemandCorrection({
      profile,
      livePoints,
      forecastPoints: biasedForecast,
      climatologyPoints,
      startMs,
      hours: 12,
    });
    const { value, corrected } = applyDemandCorrection(
      200,
      correction.residualByIndex.get(0)!,
      profile.demandSensitivity,
      { strength: correction.strengthByIndex.get(0) ?? 1 },
    );
    expect(corrected).toBe(true);
    // This is the assertion the bug failed: dirtier, not cleaner.
    expect(value).toBeGreaterThan(200);
  });

  it("keeps the forecast's shape while taking its level from actual demand", () => {
    // Forecast still biased 20% low, but now rising 10% across the window.
    const risingForecast = hoursFrom(START, 12, -3).map((ts, i) => ({
      ts,
      epochMs: Date.parse(ts),
      mwh: 26_400 + i * 264,
    }));
    const correction = buildDemandCorrection({
      profile,
      livePoints,
      forecastPoints: risingForecast,
      climatologyPoints,
      startMs,
      hours: 12,
    });
    const first = correction.residualByIndex.get(0)!;
    const later = correction.residualByIndex.get(5)!;
    // The level is anchored to actual demand...
    expect(first).toBeGreaterThan(5);
    // ...and the rise the forecast predicts is preserved.
    expect(later).toBeGreaterThan(first);
  });

  it("falls back to the raw forecast when there is no overlap to anchor to", () => {
    const noOverlap = hoursFrom(START, 6, 2).map((ts) => ({
      ts,
      epochMs: Date.parse(ts),
      mwh: 33_000,
    }));
    const correction = buildDemandCorrection({
      profile,
      livePoints: [],
      forecastPoints: noOverlap,
      climatologyPoints,
      startMs,
      hours: 12,
    });
    // 33,000 against a 30,000 normal is +10% either way.
    expect(correction.residualByIndex.get(2)).toBeCloseTo(10, 0);
  });

  it("does nothing at all when the fit was too weak to trust", () => {
    const weak: RegionProfile = {
      ...profile,
      demandSensitivity: { ...profile.demandSensitivity!, r: 0.01, applied: false },
    };
    const correction = buildDemandCorrection({
      profile: weak,
      livePoints,
      forecastPoints: biasedForecast,
      climatologyPoints,
      startMs,
      hours: 12,
    });
    expect(correction.used).toBe(false);
    expect(correction.residualByIndex.size).toBe(0);
  });
});

describe("applyDemandCorrection", () => {
  const sensitivity = {
    slope: 4.6,
    intercept: -18.9,
    r: 0.74,
    n: 2145,
    baselineRmse: 86,
    correctedRmse: 45,
    applied: true,
  };

  it("leaves a normal-demand hour where the climatology put it", () => {
    // The intercept is excluded on purpose: it is a profile level offset, not a
    // demand effect, and applying it only to corrected hours put a ~19 g step
    // in the middle of the series.
    const { value } = applyDemandCorrection(200, 0, sensitivity);
    expect(value).toBe(200);
  });

  it("is symmetric about normal demand", () => {
    const up = applyDemandCorrection(200, 10, sensitivity).value;
    const down = applyDemandCorrection(200, -10, sensitivity).value;
    expect(up - 200).toBeCloseTo(200 - down, 6);
  });

  it("clamps an implausible demand spike", () => {
    const extreme = applyDemandCorrection(200, 500, sensitivity).value;
    // Never more than the correction-fraction cap above the climatology.
    expect(extreme).toBeLessThanOrEqual(200 * 1.35 + 0.001);
  });

  it("never returns a negative intensity", () => {
    expect(applyDemandCorrection(50, -500, sensitivity).value).toBeGreaterThan(0);
  });

  it("scales with the taper strength", () => {
    const full = applyDemandCorrection(200, 10, sensitivity, { strength: 1 }).value;
    const half = applyDemandCorrection(200, 10, sensitivity, { strength: 0.5 }).value;
    expect(half - 200).toBeCloseTo((full - 200) / 2, 6);
  });
});
