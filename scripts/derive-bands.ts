/**
 * Propose `ABSOLUTE_BANDS` edges from the profiles actually on disk.
 *
 *   npx tsx scripts/derive-bands.ts
 *
 * The bands turn a number into a word on the app's headline ("clean",
 * "middling", "carbon-heavy"), so they have to sit in the *gaps* between real US
 * grids rather than at round numbers. They also have to be re-derived whenever
 * an emissions factor changes, because every profile's intensities are computed
 * with those factors — which is exactly what caught us out when the coal and oil
 * factors were corrected upward.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BALANCING_AUTHORITIES } from "../src/lib/grid/data/balancingAuthorities";
import type { RegionProfile } from "../src/lib/grid/types";

const DIR = path.join(process.cwd(), "src/lib/grid/data/profiles");

interface Row {
  ba: string;
  name: string;
  min: number;
  max: number;
  mean: number;
  population: number;
}

function load(): Row[] {
  const rows: Row[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    const profile = JSON.parse(
      readFileSync(path.join(DIR, file), "utf8"),
    ) as RegionProfile;
    // Mean intensity per local hour of day, which is what a user experiences.
    const byHour = new Map<number, number[]>();
    profile.slots.forEach((slot, index) => {
      const hour = index % 24;
      const list = byHour.get(hour) ?? [];
      list.push(slot.gCO2PerKWh);
      byHour.set(hour, list);
    });
    const hourly = [...byHour.values()].map(
      (v) => v.reduce((a, b) => a + b, 0) / v.length,
    );
    const meta = BALANCING_AUTHORITIES.find((b) => b.ba === profile.ba);
    rows.push({
      ba: profile.ba,
      name: meta?.shortName ?? profile.ba,
      min: Math.min(...hourly),
      max: Math.max(...hourly),
      mean: hourly.reduce((a, b) => a + b, 0) / hourly.length,
      population: meta?.populationMillions ?? 0,
    });
  }
  return rows.sort((a, b) => a.mean - b.mean);
}

/** The widest gap between consecutive values in a sorted list. */
function widestGapIn(values: number[], lo: number, hi: number) {
  const inRange = values.filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
  let best = { edge: (lo + hi) / 2, gap: -1, between: [0, 0] as [number, number] };
  for (let i = 1; i < inRange.length; i += 1) {
    const gap = inRange[i] - inRange[i - 1];
    if (gap > best.gap) {
      best = {
        edge: Math.round((inRange[i - 1] + inRange[i]) / 2),
        gap,
        between: [inRange[i - 1], inRange[i]],
      };
    }
  }
  return best;
}

const rows = load();
console.log(
  `Hourly means from ${rows.length} committed profiles (current emissions factors):\n`,
);
console.log("  BA     range          mean   region");
for (const r of rows) {
  console.log(
    `  ${r.ba.padEnd(6)} ${String(Math.round(r.min)).padStart(4)}-${String(
      Math.round(r.max),
    ).padEnd(5)} ${String(Math.round(r.mean)).padStart(6)}   ${r.name}`,
  );
}

// Candidate edges are the boundaries between regions, so a band edge never
// splits a single grid's typical range down the middle.
const edges = rows.flatMap((r) => [r.min, r.max]);
console.log("\nWidest gaps between real grids, by search window:");
for (const [label, lo, hi] of [
  ["veryClean", 60, 260],
  ["clean", 240, 400],
  ["moderate", 380, 560],
  ["dirty", 540, 900],
] as const) {
  const best = widestGapIn(edges, lo, hi);
  console.log(
    `  ${label.padEnd(10)} -> ${String(best.edge).padStart(4)}  (${best.gap.toFixed(
      0,
    )} g gap, between ${best.between[0].toFixed(0)} and ${best.between[1].toFixed(0)})`,
  );
}

console.log(
  "\nSanity check — how each grid's mean would be labelled at those edges:",
);
