import { describe, expect, it } from "vitest";
import { carbonFreeShare, intensityFromMix } from "../emissions";
import {
  buildProfile,
  normaliseMix,
  recencyWeight,
  seasonalWeight,
} from "./climatology";
import type { HourlySample } from "./types";

describe("recencyWeight", () => {
  it("is 1 for a sample with zero age", () => {
    const now = Date.parse("2026-08-23T00:00:00.000Z");
    expect(recencyWeight(now, now, 90)).toBe(1);
  });

  it("is ~0.5 at exactly one half-life of age", () => {
    const halfLifeDays = 90;
    const reference = Date.parse("2026-08-23T00:00:00.000Z");
    const sample = reference - halfLifeDays * 86_400_000;
    expect(recencyWeight(sample, reference, halfLifeDays)).toBeCloseTo(0.5, 6);
  });

  it("is ~0.25 at two half-lives", () => {
    const halfLifeDays = 90;
    const reference = Date.parse("2026-08-23T00:00:00.000Z");
    const sample = reference - 2 * halfLifeDays * 86_400_000;
    expect(recencyWeight(sample, reference, halfLifeDays)).toBeCloseTo(0.25, 6);
  });

  it("treats a future-dated sample as having zero age rather than negative age", () => {
    // Provisional EIA rows or clock skew can put a sample "after" the
    // reference instant; it must not out-weigh everything else.
    const reference = Date.parse("2026-08-23T00:00:00.000Z");
    const future = reference + 10 * 86_400_000;
    expect(recencyWeight(future, reference, 90)).toBe(1);
  });

  it("is 0 for anything but a zero-age sample when the half-life is 0", () => {
    const reference = Date.parse("2026-08-23T00:00:00.000Z");
    expect(recencyWeight(reference, reference, 0)).toBe(1);
    expect(recencyWeight(reference - 86_400_000, reference, 0)).toBe(0);
  });

  it("returns 0 for non-finite inputs rather than NaN", () => {
    expect(recencyWeight(NaN, 0, 90)).toBe(0);
  });
});

describe("seasonalWeight", () => {
  it("is 1 for a same-day sample", () => {
    expect(seasonalWeight(200, 200, 30)).toBe(1);
  });

  it("treats Dec 31 and Jan 1 as near-neighbours via circular distance", () => {
    // Day-of-year 365 (Dec 31 in a non-leap year) and day 1 (Jan 1) are one
    // day apart on the calendar, not 364 days apart.
    const wrapped = seasonalWeight(365, 1, 30);
    const trueNeighbour = seasonalWeight(2, 1, 30); // also ~1 day away
    const linearlyFar = seasonalWeight(200, 1, 30); // genuinely far away
    expect(wrapped).toBeCloseTo(trueNeighbour, 2);
    expect(wrapped).toBeGreaterThan(0.9);
    expect(wrapped).toBeGreaterThan(linearlyFar);
  });

  it("decays to exp(-0.5) at exactly one sigma of distance", () => {
    const sigma = 30;
    expect(seasonalWeight(1 + sigma, 1, sigma)).toBeCloseTo(Math.exp(-0.5), 6);
  });

  it("is symmetric in the two days", () => {
    expect(seasonalWeight(50, 80, 30)).toBeCloseTo(seasonalWeight(80, 50, 30), 10);
  });
});

describe("normaliseMix", () => {
  it("rescales shares so they sum to 1", () => {
    const mix = normaliseMix({ gas: 2, solar: 1, wind: 1 });
    const total = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBeCloseTo(1, 5);
    expect(mix.gas).toBeCloseTo(0.5, 5);
  });

  it("drops zero, negative and non-finite entries before normalising", () => {
    const mix = normaliseMix({ gas: 1, solar: 0, wind: -1, coal: NaN });
    expect(mix.solar).toBeUndefined();
    expect(mix.wind).toBeUndefined();
    expect(mix.coal).toBeUndefined();
    expect(mix.gas).toBe(1);
  });

  it("returns an empty mix for an all-zero or empty input, rather than dividing by zero", () => {
    expect(normaliseMix({})).toEqual({});
    expect(normaliseMix({ gas: 0, solar: 0 })).toEqual({});
  });
});

describe("buildProfile filling sparse slots from coarser priors", () => {
  const TZ = "UTC";
  // 2026-08-23 is a Sunday (confirmed against windows.test.ts's own fixture),
  // so Aug 24 = Monday, Aug 26 = Wednesday, Aug 29 = Saturday.
  const monday1500 = Date.UTC(2026, 7, 24, 15);
  const wednesday1500 = Date.UTC(2026, 7, 26, 15);
  const saturday1500 = Date.UTC(2026, 7, 29, 15);
  const now = new Date(Date.UTC(2026, 7, 30, 0, 0, 0));

  function sampleAt(epochMs: number, mix: Record<string, number>): HourlySample {
    return {
      ts: new Date(epochMs).toISOString(),
      epochMs,
      fuelMix: mix,
      gCO2PerKWh: intensityFromMix(mix),
      carbonFreeShare: carbonFreeShare(mix),
      totalMwh: 1000,
    };
  }

  // Two weekday observations at 15:00 (gas-only, ~490 gCO2/kWh) and one
  // weekend observation at 15:00 (solar-only, ~48 gCO2/kWh). No samples exist
  // at any other hour at all.
  const samples: HourlySample[] = [
    sampleAt(monday1500, { gas: 1 }),
    sampleAt(wednesday1500, { gas: 1 }),
    sampleAt(saturday1500, { solar: 1 }),
  ];

  const profile = buildProfile(samples, {
    ba: "TEST",
    timezone: TZ,
    now,
    // Wide seasonal window and long half-life so every sample gets a weight
    // close to 1 and the arithmetic above is easy to reason about.
    seasonalSigmaDays: 365,
    recencyHalfLifeDays: 3650,
  });

  it("keeps a directly-observed slot close to what was actually observed", () => {
    const mondaySlot = profile.slots[1 * 24 + 15];
    expect(mondaySlot.sampleCount).toBeGreaterThan(0);
    expect(mondaySlot.gCO2PerKWh).toBeGreaterThan(400);
  });

  it("fills an unobserved weekday slot from the weekday (not weekend) prior", () => {
    // Tuesday 15:00 has no direct sample, but Monday and Wednesday at 15:00
    // (both weekdays) do, so it should read close to the gas value (~490),
    // not the solar value (~48) contributed only by Saturday.
    const tuesdaySlot = profile.slots[2 * 24 + 15];
    expect(tuesdaySlot.sampleCount).toBe(0);
    expect(tuesdaySlot.gCO2PerKWh).toBeGreaterThan(300);
  });

  it("fills an unobserved weekend slot from the weekend (not weekday) prior", () => {
    // Sunday 15:00 has no direct sample either, but Saturday at 15:00 (also a
    // weekend day) does, so it should read close to the solar value (~48),
    // clearly lower than the weekday-filled slot above.
    const sundaySlot = profile.slots[0 * 24 + 15];
    const tuesdaySlot = profile.slots[2 * 24 + 15];
    expect(sundaySlot.sampleCount).toBe(0);
    expect(sundaySlot.gCO2PerKWh).toBeLessThan(tuesdaySlot.gCO2PerKWh);
  });

  it("falls all the way back to the global mean when even the day-type prior is empty", () => {
    // Hour 3 has no sample on any day of any type, so neither the slot nor
    // the day-type prior has anything to offer; it must fall back to the
    // all-hours global mean rather than reading as zero.
    const emptyHourSlot = profile.slots[4 * 24 + 3]; // Thursday 03:00
    expect(emptyHourSlot.sampleCount).toBe(0);
    expect(emptyHourSlot.gCO2PerKWh).toBeGreaterThan(0);
    // Between the pure-solar (~48) and pure-gas (~490) extremes.
    expect(emptyHourSlot.gCO2PerKWh).toBeGreaterThan(48);
    expect(emptyHourSlot.gCO2PerKWh).toBeLessThan(490);
  });

  it("notes an entirely empty history rather than silently returning zeros", () => {
    const empty = buildProfile([], { ba: "TEST", timezone: TZ, now });
    expect(empty.notes.join(" ")).toMatch(/No usable history/);
    expect(empty.slots).toHaveLength(168);
    expect(empty.slots.every((s) => s.gCO2PerKWh === 0)).toBe(true);
  });
});
