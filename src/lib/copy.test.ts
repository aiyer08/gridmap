import { describe, expect, it } from "vitest";
import { getAppliance } from "./appliances";
import {
  ABSOLUTE_BANDS,
  absoluteLabel,
  cheerFor,
  declineMessage,
  describeMix,
  FAQ,
  percentileWithin,
  savingsSentence,
  TIPS,
  verdictForNow,
  whyThisWindow,
} from "./copy";
import type { IntensityPoint, RunWindow, SeriesStats } from "./types";

/**
 * The copy layer is the app's voice. These tests protect two things that are
 * easy to break by accident: that the numbers in a sentence match the numbers
 * they describe, and that the tone never turns into a telling-off.
 */

function point(gCO2PerKWh: number, percentile?: number): IntensityPoint {
  return {
    ts: "2026-08-23T21:00:00.000Z",
    gCO2PerKWh,
    source: "blend",
    confidence: "high",
    cleanlinessPercentile: percentile,
  };
}

// Roughly a real CISO week: 120 cleanest, 362 dirtiest.
const CISO_STATS: SeriesStats = {
  min: 120,
  max: 362,
  mean: 222,
  p10: 153,
  p90: 277,
};

describe("percentileWithin", () => {
  it("puts the cleanest hour at 100 and the dirtiest at 0", () => {
    expect(percentileWithin(120, CISO_STATS)).toBe(100);
    expect(percentileWithin(362, CISO_STATS)).toBe(0);
  });

  it("is monotonic — cleaner is always a higher percentile", () => {
    let previous = -1;
    for (const value of [362, 300, 250, 200, 150, 120]) {
      const pct = percentileWithin(value, CISO_STATS);
      expect(pct).toBeGreaterThan(previous);
      previous = pct;
    }
  });

  it("returns the midpoint for a perfectly flat week rather than dividing by zero", () => {
    const flat: SeriesStats = { min: 300, max: 300, mean: 300, p10: 300, p90: 300 };
    expect(percentileWithin(300, flat)).toBe(50);
  });
});

describe("absolute bands", () => {
  it("orders the thresholds", () => {
    expect(ABSOLUTE_BANDS.veryClean).toBeLessThan(ABSOLUTE_BANDS.clean);
    expect(ABSOLUTE_BANDS.clean).toBeLessThan(ABSOLUTE_BANDS.moderate);
    expect(ABSOLUTE_BANDS.moderate).toBeLessThan(ABSOLUTE_BANDS.dirty);
  });

  it("labels real US grids the way a person would", () => {
    // Hourly means from the committed profiles, current emissions factors.
    expect(absoluteLabel(74)).toBe("very clean"); // BPA, Pacific NW hydro
    expect(absoluteLabel(233)).toBe("clean"); // CAISO
    expect(absoluteLabel(344)).toBe("middling"); // ISO-NE
    expect(absoluteLabel(439)).toBe("middling"); // PJM
    expect(absoluteLabel(545)).toBe("carbon-heavy"); // MISO
    expect(absoluteLabel(953)).toBe("very carbon-heavy"); // LG&E, Kentucky coal
  });

  it("puts every edge inside a gap where no real grid sits", () => {
    // If an edge landed inside a grid's range, that grid's label would flip
    // back and forth hour to hour for no reason a user could perceive.
    const occupiedRanges: [number, number][] = [
      [63, 83], // BPAT
      [157, 296], // CISO
      [313, 341], // NYIS
      [417, 468], // PJM
      [503, 598], // MISO
      [835, 944], // SC
      [925, 973], // LGEE
    ];
    for (const edge of Object.values(ABSOLUTE_BANDS)) {
      for (const [lo, hi] of occupiedRanges) {
        expect(
          edge < lo || edge > hi,
          `band edge ${edge} falls inside a real grid range ${lo}-${hi}`,
        ).toBe(true);
      }
    }
  });

  it("never calls a coal-heavy grid clean, and keeps it distinct from a mild one", () => {
    // MISO's *cleanest* hour (503) must not read as clean just because it is
    // that grid's best, and it must not share a label with New England's
    // typical hour (344). This pair is why the bands get re-derived.
    expect(absoluteLabel(503)).toBe("carbon-heavy");
    expect(absoluteLabel(344)).toBe("middling");
    expect(absoluteLabel(503)).not.toBe(absoluteLabel(344));
  });

  it("gives every value a label", () => {
    for (const value of [0, 50, 150, 300, 450, 650, 900, 1200]) {
      expect(absoluteLabel(value).length).toBeGreaterThan(3);
    }
  });
});

describe("verdictForNow", () => {
  it("celebrates a genuinely clean hour", () => {
    const v = verdictForNow(point(125, 95), CISO_STATS);
    expect(v.tone).toBe("clean");
    expect(v.headline).toMatch(/cleanest/i);
    expect(v.cleanlinessPercentile).toBe(95);
  });

  it("is neutral, not negative, about an average hour", () => {
    const v = verdictForNow(point(230, 50), CISO_STATS);
    expect(v.tone).toBe("okay");
    expect(v.headline).toMatch(/average/i);
  });

  it("tells the truth about a dirty hour without scolding", () => {
    const v = verdictForNow(point(350, 5), CISO_STATS);
    expect(v.tone).toBe("dirty");
    expect(v.headline).toMatch(/dirty/i);
    // It should point at the fix, not at the user.
    expect(v.detail).toMatch(/waiting/i);
  });

  it("always states the actual number so the claim is checkable", () => {
    for (const [value, pct] of [
      [125, 95],
      [200, 70],
      [230, 50],
      [350, 5],
    ] as const) {
      const v = verdictForNow(point(value, pct), CISO_STATS);
      expect(v.detail).toContain(String(Math.round(value)));
    }
  });

  it("falls back to computing the percentile when the point lacks one", () => {
    const v = verdictForNow(point(120), CISO_STATS);
    expect(v.cleanlinessPercentile).toBe(100);
  });

  it("keeps the tone and the headline consistent", () => {
    // A high percentile must never produce a "running dirty" headline.
    for (const pct of [0, 10, 33, 50, 66, 85, 100]) {
      const v = verdictForNow(point(200, pct), CISO_STATS);
      if (v.tone === "clean") expect(v.headline).not.toMatch(/dirty/i);
      if (v.tone === "dirty") expect(v.headline).not.toMatch(/cleaner|cleanest/i);
    }
  });
});

describe("describeMix", () => {
  it("names the two biggest sources in plain words", () => {
    expect(describeMix({ solar: 0.5, gas: 0.3, wind: 0.2 })).toBe(
      "Mostly solar and natural gas.",
    );
  });

  it("handles a single dominant source", () => {
    // A 1% sliver is below the reporting threshold, so hydro stands alone.
    expect(describeMix({ hydro: 0.99, gas: 0.01 })).toBe("Mostly hydro.");
    // 5% is worth mentioning, though.
    expect(describeMix({ hydro: 0.95, gas: 0.05 })).toBe(
      "Mostly hydro and natural gas.",
    );
  });

  it("ignores slivers and storage", () => {
    // Batteries move energy rather than making it, so they're never "powering" it.
    expect(describeMix({ storage: 0.6, gas: 0.3, coal: 0.1 })).toBe(
      "Mostly natural gas and coal.",
    );
    expect(describeMix({ gas: 0.98, solar: 0.01 })).toBe("Mostly natural gas.");
  });

  it("says so rather than inventing a mix it doesn't have", () => {
    expect(describeMix({})).toMatch(/don't have/i);
  });
});

describe("savingsSentence", () => {
  const dishwasher = getAppliance("dishwasher");

  function window(savingsPercent: number, grams: number, baseline: number): RunWindow {
    return {
      id: "w",
      startTs: "2026-08-24T17:00:00.000Z",
      endTs: "2026-08-24T19:00:00.000Z",
      avgIntensity: 150,
      gramsCO2: grams,
      baselineGrams: baseline,
      savingsPercent,
      rank: 1,
      quality: "best",
      label: "Tomorrow morning, 10 AM – Noon",
      shortLabel: "Tomorrow morning",
      confidence: "high",
    };
  }

  it("leads with the percentage and puts the raw grams underneath", () => {
    // This shape is what PLAN.md asks for in step 6.
    const { headline, parenthetical } = savingsSentence(
      window(32, 145, 213),
      dishwasher,
    );
    expect(headline).toBe("You'd release 32% less CO₂ by waiting.");
    expect(parenthetical).toContain("213 g");
    expect(parenthetical).toContain("145 g");
  });

  it("says plainly when waiting wouldn't help", () => {
    const { headline } = savingsSentence(window(0, 210, 213), dishwasher);
    expect(headline).toMatch(/about the same/i);
    expect(headline).not.toMatch(/0% less/);
  });

  it("names the appliance in lower case mid-sentence", () => {
    const { headline } = savingsSentence(window(0, 210, 213), dishwasher);
    expect(headline).toContain("dishwasher");
    expect(headline).not.toContain("Dishwasher");
  });
});

describe("whyThisWindow", () => {
  it("explains solar and wind in cause-and-effect terms", () => {
    const base = {
      id: "w",
      startTs: "2026-08-24T17:00:00.000Z",
      endTs: "2026-08-24T19:00:00.000Z",
      avgIntensity: 150,
      gramsCO2: 145,
      baselineGrams: 213,
      savingsPercent: 32,
      rank: 1 as const,
      quality: "best" as const,
      label: "l",
      shortLabel: "s",
      confidence: "high" as const,
    };
    expect(whyThisWindow({ ...base, drivenBy: "solar" })).toMatch(/sun/i);
    expect(whyThisWindow({ ...base, drivenBy: "wind" })).toMatch(/wind/i);
    // Always says something, even with no dominant clean fuel.
    expect(whyThisWindow(base).length).toBeGreaterThan(20);
  });
});

describe("tone", () => {
  const FORBIDDEN =
    /\b(should have|only|failed|fail|guilt|sorry|unfortunately|worse|behind|lazy|shame|must|try harder|disappoint)\b/i;

  it("never scolds when celebrating a logged action", () => {
    for (let i = 0; i < 12; i += 1) {
      const message = cheerFor(i);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(FORBIDDEN);
    }
  });

  it("is reliably deterministic, so the same state reads the same", () => {
    expect(cheerFor(3)).toBe(cheerFor(3));
  });

  it("makes declining explicitly costless", () => {
    for (let i = 0; i < 6; i += 1) {
      const message = declineMessage(i);
      expect(message).not.toMatch(FORBIDDEN);
      // The whole point is that saying no is fine.
      expect(message).toMatch(/fine|no problem|no harm|skipped/i);
    }
  });

  it("keeps the tips and FAQ free of blame", () => {
    for (const tip of TIPS) {
      expect(tip.body).not.toMatch(FORBIDDEN);
      expect(tip.title.length).toBeLessThan(60);
    }
    for (const entry of FAQ) {
      expect(entry.a).not.toMatch(FORBIDDEN);
    }
  });
});

describe("content completeness", () => {
  it("orders tips with the high-impact ones first", () => {
    // People are told to unplug chargers and never told about their dryer.
    const rank = { big: 0, medium: 1, small: 2 };
    const impacts = TIPS.map((t) => rank[t.impact]);
    expect([...impacts].sort((a, b) => a - b)).toEqual(impacts);
  });

  it("answers the sceptical questions, not just the easy ones", () => {
    const questions = FAQ.map((f) => f.q.toLowerCase()).join(" ");
    expect(questions).toMatch(/accurate/);
    expect(questions).toMatch(/really matter|does one/);
    expect(questions).toMatch(/where do these numbers|come from/);
  });

  it("gives every tip and answer real substance", () => {
    for (const tip of TIPS) expect(tip.body.length).toBeGreaterThan(60);
    for (const entry of FAQ) expect(entry.a.length).toBeGreaterThan(80);
  });
});
