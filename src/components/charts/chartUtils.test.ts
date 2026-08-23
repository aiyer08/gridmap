import { describe, expect, it } from "vitest";
import { niceTicks } from "./chartUtils";

/**
 * Regression test for a chart bug that clipped the data.
 *
 * `niceTicks` generated ticks up to the last step *below* the requested top, so
 * a CISO week peaking at 362 gCO2/kWh (requested top 391) produced [0, 200].
 * The plot clamped every value above 200, drawing the dirtiest stretch of the
 * week as a flat line across the top of the chart — visually the calmest part.
 */
describe("niceTicks", () => {
  it("always produces a top tick at or above the requested max", () => {
    for (const max of [1, 8, 52, 95, 137, 200, 362, 391, 500, 1500, 9_999]) {
      for (const count of [2, 3, 4, 5]) {
        const ticks = niceTicks(max, count);
        expect(
          ticks[ticks.length - 1],
          `max=${max} count=${count} produced ${JSON.stringify(ticks)}`,
        ).toBeGreaterThanOrEqual(max);
      }
    }
  });

  it("covers the case that caused the bug", () => {
    expect(niceTicks(391, 4)).toEqual([0, 100, 200, 300, 400]);
    // The old implementation returned [0, 200] here.
    expect(niceTicks(391, 3)).toEqual([0, 200, 400]);
  });

  it("starts at zero, because an area chart needs a zero baseline", () => {
    expect(niceTicks(362, 4)[0]).toBe(0);
  });

  it("is evenly spaced", () => {
    const ticks = niceTicks(362, 4);
    const step = ticks[1] - ticks[0];
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i] - ticks[i - 1]).toBe(step);
    }
  });

  it("stays within a sensible number of ticks", () => {
    for (const max of [8, 52, 95, 362, 1500]) {
      const ticks = niceTicks(max, 4);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(7);
    }
  });

  it("degrades safely on nonsense input", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(-5)).toEqual([0]);
    expect(niceTicks(Number.NaN)).toEqual([0]);
  });
});
