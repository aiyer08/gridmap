// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import "@/test/setup";
import type { IntensityPoint } from "@/lib/types";
import { CarbonRibbon } from "./CarbonRibbon";

const START = Date.parse("2026-08-23T00:00:00.000Z");

/** Builds `count` hourly points with a single, deliberate peak so the
 * generated summary has a predictable "highest" hour to assert against. */
function buildPoints(count: number, peakIndex: number): IntensityPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: new Date(START + i * 3_600_000).toISOString(),
    gCO2PerKWh: i === peakIndex ? 900 : 300 + (i % 5) * 10,
    source: "forecast" as const,
    confidence: "medium" as const,
  }));
}

describe("CarbonRibbon", () => {
  test("renders without crashing for a 24-point series", () => {
    const points = buildPoints(24, 18);
    render(
      <CarbonRibbon points={points} now={points[0].ts} timeZone="UTC" height={200} showLegend={false} />,
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  test("renders without crashing for a 168-point (full week) series", () => {
    const points = buildPoints(168, 140);
    render(
      <CarbonRibbon points={points} now={points[0].ts} timeZone="UTC" height={200} showLegend={false} />,
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  test("the generated aria-label mentions the peak (highest) hour's value", () => {
    const points = buildPoints(24, 18);
    render(
      <CarbonRibbon points={points} now={points[0].ts} timeZone="UTC" height={200} showLegend={false} />,
    );
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/highest/i);
    // The peak point was forced to 900 g/kWh — the summary should surface it.
    expect(label).toMatch(/900/);
  });

  test("the generated aria-label mentions the cleanest hour and current value", () => {
    const points = buildPoints(24, 18);
    render(
      <CarbonRibbon points={points} now={points[0].ts} timeZone="UTC" height={200} showLegend={false} />,
    );
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/cleanest/i);
    expect(label).toMatch(/right now/i);
  });

  test("mentions suggested windows in the summary when windows are passed", () => {
    const points = buildPoints(24, 18);
    const windows = [
      {
        id: "w1",
        startTs: points[2].ts,
        endTs: points[4].ts,
        avgIntensity: 250,
        gramsCO2: 100,
        baselineGrams: 150,
        savingsPercent: 33,
        rank: 1,
        quality: "best" as const,
        label: "Tonight, 2 AM – 4 AM",
        shortLabel: "Tonight",
        confidence: "high" as const,
      },
    ];
    render(
      <CarbonRibbon
        points={points}
        now={points[0].ts}
        timeZone="UTC"
        height={200}
        windows={windows}
        showLegend={false}
      />,
    );
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/1 suggested window/i);
  });

  test("renders a fallback message and no chart when there are no points", () => {
    render(<CarbonRibbon points={[]} now={new Date().toISOString()} timeZone="UTC" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/no forecast/i)).toBeInTheDocument();
  });

  test("an explicit ariaLabel overrides the generated summary", () => {
    const points = buildPoints(24, 18);
    render(
      <CarbonRibbon
        points={points}
        now={points[0].ts}
        timeZone="UTC"
        ariaLabel="Custom description"
        showLegend={false}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Custom description");
  });
});
