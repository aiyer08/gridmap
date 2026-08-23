import { describe, expect, it } from "vitest";
import {
  archetypeForBa,
  buildFallbackProfile,
  hashString,
  type GridArchetype,
} from "./fallback";
import { hourOfSlot, weekdayOfSlot } from "./time";

/**
 * The archetype models are the floor GridMap stands on with zero API keys, so
 * they have to be trustworthy on their own, deterministic across renders, and
 * — the one that is easy to get backwards — shaped by what actually drives
 * *that* grid's margin, not by an assumption that midday is always cleanest.
 */

const TZ = "America/Chicago";

function slotAt(archetype: GridArchetype, ba: string, weekday: number, hour: number) {
  const profile = buildFallbackProfile(ba, TZ, {
    archetype,
    generatedAt: new Date("2026-08-23T00:00:00.000Z"),
  });
  return profile.slots[weekday * 24 + hour];
}

describe("buildFallbackProfile shape", () => {
  const archetypes: GridArchetype[] = [
    "solar-heavy",
    "wind-heavy",
    "hydro-heavy",
    "coal-heavy",
    "gas-nuclear",
    "mixed",
  ];

  for (const archetype of archetypes) {
    it(`produces 168 plausible slots with a mix summing to ~1 for ${archetype}`, () => {
      const profile = buildFallbackProfile("TESTBA", TZ, { archetype });
      expect(profile.slots).toHaveLength(168);
      for (const slot of profile.slots) {
        expect(slot.hourOfWeek).toBeGreaterThanOrEqual(0);
        expect(slot.hourOfWeek).toBeLessThan(168);
        // Plausible lifecycle intensity range: cleaner than pure nuclear/wind,
        // dirtier than pure coal is impossible, but leave headroom either way.
        expect(slot.gCO2PerKWh).toBeGreaterThan(0);
        expect(slot.gCO2PerKWh).toBeLessThan(900);
        const total = Object.values(slot.fuelMix).reduce((a, b) => a + (b ?? 0), 0);
        expect(total).toBeGreaterThan(0.98);
        expect(total).toBeLessThan(1.02);
        expect(slot.sampleCount).toBe(0);
        expect(slot.weight).toBe(0);
      }
    });
  }

  it("labels every archetype's profile source as modelled, never as measured", () => {
    const profile = buildFallbackProfile("TESTBA", TZ, { archetype: "mixed" });
    expect(profile.source).toBe("modelled");
    expect(profile.notes[0]).toMatch(/Modelled estimate/);
  });
});

describe("determinism", () => {
  it("is byte-identical for the same BA across repeated calls (no Math.random)", () => {
    const generatedAt = new Date("2026-08-23T12:00:00.000Z");
    const first = buildFallbackProfile("CISO", TZ, { generatedAt });
    const second = buildFallbackProfile("CISO", TZ, { generatedAt });
    expect(second.slots).toEqual(first.slots);
  });

  it("hashString is a pure function of its input", () => {
    expect(hashString("CISO:solar-heavy")).toBe(hashString("CISO:solar-heavy"));
    expect(hashString("CISO:solar-heavy")).not.toBe(hashString("AZPS:solar-heavy"));
  });

  it("is stable regardless of how many times it has already been called", () => {
    // Guards against any hidden call-counter or module-level mutable state
    // masquerading as determinism.
    const generatedAt = new Date("2026-08-23T12:00:00.000Z");
    for (let i = 0; i < 5; i += 1) {
      buildFallbackProfile("CISO", TZ, { generatedAt }); // warm up / perturb
    }
    const warmed = buildFallbackProfile("CISO", TZ, { generatedAt });
    const cold = buildFallbackProfile("CISO", TZ, { generatedAt });
    expect(warmed.slots).toEqual(cold.slots);
  });

  it("gives two different BAs of the same archetype visibly different intensities", () => {
    // CISO and AZPS are both solar-heavy but carry different per-BA tilts
    // (AZPS has a fossil/coal tilt CISO does not), and each gets its own
    // deterministic jitter seeded from its own BA code.
    const ciso = buildFallbackProfile("CISO", TZ);
    const azps = buildFallbackProfile("AZPS", TZ);
    expect(ciso.slots).not.toEqual(azps.slots);
    const cisoMean = ciso.stats.mean;
    const azpsMean = azps.stats.mean;
    // Not wildly different (same archetype shape) but not identical either.
    expect(Math.abs(cisoMean - azpsMean)).toBeGreaterThan(1);
  });
});

describe("archetypeForBa", () => {
  it("maps known BAs to their real dominant-generation archetype", () => {
    expect(archetypeForBa("CISO")).toBe("solar-heavy");
    expect(archetypeForBa("ERCO")).toBe("wind-heavy");
    expect(archetypeForBa("BPAT")).toBe("hydro-heavy");
    expect(archetypeForBa("MISO")).toBe("coal-heavy");
    expect(archetypeForBa("ISNE")).toBe("gas-nuclear");
  });

  it("falls back to 'mixed' for a BA we know nothing about", () => {
    expect(archetypeForBa("NOT-A-REAL-BA")).toBe("mixed");
  });
});

describe("solar-heavy archetype shape (CAISO-like duck curve)", () => {
  // Pick a weekday (Wednesday = weekday 3) so the weekend demand discount
  // does not confound the comparison.
  const weekday = 3;
  const midday = slotAt("solar-heavy", "CISO", weekday, 12);
  const overnight = slotAt("solar-heavy", "CISO", weekday, 3);
  const evening = slotAt("solar-heavy", "CISO", weekday, 19);

  it("has a midday solar trough that is cleaner than overnight", () => {
    expect(midday.gCO2PerKWh).toBeLessThan(overnight.gCO2PerKWh);
  });

  it("has an evening peak driven by the gas ramp, dirtier than midday", () => {
    expect(evening.gCO2PerKWh).toBeGreaterThan(midday.gCO2PerKWh);
  });

  it("actually shows solar as the dominant midday source", () => {
    expect(midday.fuelMix.solar ?? 0).toBeGreaterThan(0.3);
  });
});

describe("wind-heavy archetype shape (SPP-like — the inverse of California)", () => {
  // Real SPP EIA-930 data: cleanest hour of the day is ~03:00 at 341 gCO2/kWh,
  // dirtiest is ~14:00 at 447 gCO2/kWh — the opposite ranking from a
  // solar-heavy grid. Nothing in the fallback model may assume midday is
  // clean.
  const weekday = 3;
  const overnight = slotAt("wind-heavy", "SWPP", weekday, 3);
  const midAfternoon = slotAt("wind-heavy", "SWPP", weekday, 14);
  const midday = slotAt("wind-heavy", "SWPP", weekday, 12);

  it("is cleanest overnight, not at midday", () => {
    expect(overnight.gCO2PerKWh).toBeLessThan(midday.gCO2PerKWh);
    expect(overnight.gCO2PerKWh).toBeLessThan(midAfternoon.gCO2PerKWh);
  });

  it("is dirtiest in the mid-afternoon", () => {
    expect(midAfternoon.gCO2PerKWh).toBeGreaterThan(overnight.gCO2PerKWh);
  });

  it("finds its minimum in the small hours and its maximum in the afternoon across the full day", () => {
    const profile = buildFallbackProfile("SWPP", TZ, {
      generatedAt: new Date("2026-08-23T00:00:00.000Z"),
    });
    const wednesdaySlots = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      value: profile.slots[weekday * 24 + hour].gCO2PerKWh,
    }));
    const minHour = wednesdaySlots.reduce((a, b) => (b.value < a.value ? b : a));
    const maxHour = wednesdaySlots.reduce((a, b) => (b.value > a.value ? b : a));
    expect(minHour.hour).toBeGreaterThanOrEqual(0);
    expect(minHour.hour).toBeLessThanOrEqual(6);
    expect(maxHour.hour).toBeGreaterThanOrEqual(12);
    expect(maxHour.hour).toBeLessThanOrEqual(19);
  });

  it("has wind as the dominant overnight source", () => {
    expect(overnight.fuelMix.wind ?? 0).toBeGreaterThan(0.3);
  });
});

describe("hourOfSlot / weekdayOfSlot agree with the profile's own indexing", () => {
  it("recovers the same weekday and hour used to build the slot index", () => {
    const index = 3 * 24 + 14;
    expect(weekdayOfSlot(index)).toBe(3);
    expect(hourOfSlot(index)).toBe(14);
  });
});
