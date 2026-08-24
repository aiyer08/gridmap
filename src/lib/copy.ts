import { FUEL_LABELS } from "./emissions";
import { formatGrams } from "./format";
import type {
  Appliance,
  FuelMix,
  FuelType,
  IntensityPoint,
  RunWindow,
  SeriesStats,
} from "./types";

/**
 * The plain-English layer. Anything the app says to a person is written here so
 * the tone stays consistent: concrete, encouraging, never guilt-tripping, and
 * understandable by someone who has never heard the phrase "carbon intensity".
 */

export type Tone = "clean" | "okay" | "dirty";

/**
 * Two ways of judging an hour, both of which the user needs:
 *
 * - `relative` compares the hour to the rest of *this* week on *this* grid.
 *   This is what makes shifting worthwhile, and it is the honest basis for
 *   "cleaner than usual".
 * - `absolute` compares to US grids generally, so we don't tell someone on a
 *   coal-heavy grid that 600 g/kWh is "clean" just because it's their best hour.
 */
export interface Verdict {
  tone: Tone;
  /** Short headline, e.g. "The grid is unusually clean right now". */
  headline: string;
  /** One supporting sentence with the number in it. */
  detail: string;
  /** Relative standing, 0–100, where 100 = cleanest hour of the week. */
  cleanlinessPercentile: number;
}

/**
 * Absolute bands in gCO2e/kWh, placed in the *empty gaps* between real US grids
 * rather than at arbitrary round numbers, so an edge never splits one grid's
 * typical range down the middle.
 *
 * Derived by `npx tsx scripts/derive-bands.ts` from the 25 committed profiles.
 * Hourly means as of 2026-08-24, cleanest grid to dirtiest: BPA 63–83, CAISO
 * 157–296, PacifiCorp West 273–335, NYISO 313–341, ISO-NE 324–374, ERCOT
 * 285–460, PJM 417–468, MISO 503–598, PacifiCorp East 500–806, Santee Cooper
 * 835–944, LG&E 925–973.
 *
 * Each edge below sits inside a real gap where no grid's hourly mean falls:
 *   150  in the 83→157 gap  (hydro grids alone are "very clean")
 *   300  in the 296→313 gap (California, and only California, is "clean")
 *   480  in the 468→500 gap (the big middle: New York through PJM)
 *   700  in the 629→806 gap (coal-dominated grids stand apart)
 *
 * **These must be re-derived whenever an emissions factor changes.** They were
 * last recut after the coal and oil factors were corrected upward, which moved
 * every coal-heavy grid by roughly 18% and would otherwise have left MISO and
 * New England sharing a label.
 */
export const ABSOLUTE_BANDS = {
  veryClean: 150,
  clean: 300,
  moderate: 480,
  dirty: 700,
} as const;

export function absoluteLabel(gPerKWh: number): string {
  if (gPerKWh <= ABSOLUTE_BANDS.veryClean) return "very clean";
  if (gPerKWh <= ABSOLUTE_BANDS.clean) return "clean";
  if (gPerKWh <= ABSOLUTE_BANDS.moderate) return "middling";
  if (gPerKWh <= ABSOLUTE_BANDS.dirty) return "carbon-heavy";
  return "very carbon-heavy";
}

/** Where this hour sits within the week's spread, 0–100. */
export function percentileWithin(value: number, stats: SeriesStats): number {
  const span = stats.max - stats.min;
  if (span <= 0) return 50;
  const fromClean = (value - stats.min) / span;
  return Math.round((1 - fromClean) * 100);
}

export function verdictForNow(
  now: IntensityPoint,
  stats: SeriesStats,
): Verdict {
  const pct = now.cleanlinessPercentile ?? percentileWithin(now.gCO2PerKWh, stats);
  const absolute = absoluteLabel(now.gCO2PerKWh);

  if (pct >= 85) {
    return {
      tone: "clean",
      headline: "Right now is one of the cleanest hours all week",
      detail: `Your grid is running at ${Math.round(now.gCO2PerKWh)} g of CO₂ per unit of electricity — ${absolute} for this region. If you've been putting something off, this is the moment.`,
      cleanlinessPercentile: pct,
    };
  }
  if (pct >= 66) {
    return {
      tone: "clean",
      headline: "The grid is cleaner than usual right now",
      detail: `About ${Math.round(now.gCO2PerKWh)} g of CO₂ per unit of electricity — below this week's average for your area, and ${absolute} by national standards too.`,
      cleanlinessPercentile: pct,
    };
  }
  if (pct >= 33) {
    return {
      tone: "okay",
      headline: "The grid is about average right now",
      detail: `Around ${Math.round(now.gCO2PerKWh)} g of CO₂ per unit of electricity — ${absolute} by national standards, and typical for your own area this week. There are cleaner hours coming up — worth a look before you start something big.`,
      cleanlinessPercentile: pct,
    };
  }
  return {
    tone: "dirty",
    headline: "The grid is running dirty right now",
    detail: `About ${Math.round(now.gCO2PerKWh)} g of CO₂ per unit of electricity — near the top of this week's range, and ${absolute} by national standards too. Waiting a few hours makes a real difference.`,
    cleanlinessPercentile: pct,
  };
}

/** "Mostly solar and natural gas" — what's actually making the electricity. */
export function describeMix(mix: FuelMix, limit = 2): string {
  const ranked = (Object.entries(mix) as [FuelType, number][])
    .filter(([fuel, share]) => fuel !== "storage" && share > 0.02)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  if (ranked.length === 0) return "We don't have a fuel breakdown for this hour.";
  const names = ranked.map(([fuel]) => FUEL_LABELS[fuel].toLowerCase());
  if (names.length === 1) return `Mostly ${names[0]}.`;
  return `Mostly ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
}

/** The one-liner the plan asks for in step 6, plus the raw grams beneath it. */
export function savingsSentence(
  window: RunWindow,
  appliance: Appliance,
): { headline: string; parenthetical: string } {
  if (window.savingsPercent < 1) {
    return {
      headline: `Running your ${appliance.label.toLowerCase()} then is about the same as running it now.`,
      parenthetical: `${formatGrams(window.baselineGrams)} now vs ${formatGrams(window.gramsCO2)} then`,
    };
  }
  return {
    headline: `You'd release ${Math.round(window.savingsPercent)}% less CO₂ by waiting.`,
    parenthetical: `${formatGrams(window.baselineGrams)} if you ran it now, down to ${formatGrams(window.gramsCO2)}`,
  };
}

/** Why this window is clean, in words a person would use. */
export function whyThisWindow(window: RunWindow): string {
  switch (window.drivenBy) {
    case "solar":
      return "The sun is doing most of the work at that hour.";
    case "wind":
      return "Wind output is high then, so less gas has to run.";
    case "hydro":
      return "Hydro and other low-carbon sources cover more of the load then.";
    case "nuclear":
      return "Demand is low then, so the always-on clean plants cover more of it.";
    default:
      return "Fewer fossil plants are needed to meet demand at that hour.";
  }
}

/** Encouragement after a logged win. Deterministic — index by action count. */
const CHEERS = [
  "Nice one. That's a real reduction, not a rounding error.",
  "Logged. Small moves, repeated, are how this actually adds up.",
  "That's one more load the gas plants didn't have to cover.",
  "Counted. You just did the cheapest climate action there is: waiting.",
  "Saved. Your future self, and the grid, both approve.",
  "Done. This is what it looks like to time the grid instead of fighting it.",
] as const;

export function cheerFor(actionCount: number): string {
  return CHEERS[actionCount % CHEERS.length];
}

/** Reassurance when someone declines a suggested window. Never a guilt trip. */
const DECLINES = [
  "Totally fine — life happens. Nothing counted against you.",
  "No problem. We'll find you another window.",
  "Skipped, no harm done. Your total is untouched.",
] as const;

export function declineMessage(index = 0): string {
  return DECLINES[index % DECLINES.length];
}

export interface Tip {
  id: string;
  title: string;
  body: string;
  emoji: string;
  /** Roughly how much this saves, for honest prioritisation. */
  impact: "big" | "medium" | "small";
}

/**
 * Habit tips, ordered so the genuinely high-impact ones come first. People are
 * usually told to unplug their phone charger and never told about their dryer;
 * this list tries to fix that.
 */
export const TIPS: Tip[] = [
  {
    id: "shift-big-loads",
    title: "Shift your biggest loads, not your smallest",
    body: "An EV charge or a dryer cycle uses more electricity than a week of phone charging. Moving one big load to a clean hour beats a dozen small gestures.",
    emoji: "🔀",
    impact: "big",
  },
  {
    id: "skip-the-dryer",
    title: "Let the air do the drying",
    body: "A clothes dryer is one of the hungriest things in a house — roughly 2.5 kWh a load. A drying rack costs nothing and skips it entirely.",
    emoji: "🪢",
    impact: "big",
  },
  {
    id: "cold-wash",
    title: "Wash in cold water",
    body: "Most of a wash cycle's energy goes into heating water, not spinning the drum. Modern detergents work fine cold.",
    emoji: "🧊",
    impact: "big",
  },
  {
    id: "thermostat",
    title: "Move the thermostat two degrees",
    body: "Heating and cooling are the largest slice of most electricity bills. Two degrees is roughly 2–5% of that, and you'll barely notice it.",
    emoji: "🌡️",
    impact: "big",
  },
  {
    id: "precool",
    title: "Pre-cool or pre-heat while the grid is clean",
    body: "Run the AC hard in the clean afternoon, then coast through the dirty evening peak. Your house is a battery you already own.",
    emoji: "🏠",
    impact: "medium",
  },
  {
    id: "delay-start",
    title: "Use the delay-start button you already have",
    body: "Most dishwashers and washing machines have a timer. Set it once tonight for the clean window and you never think about it again.",
    emoji: "⏲️",
    impact: "medium",
  },
  {
    id: "full-loads",
    title: "Wait for a full load",
    body: "A half-empty dishwasher uses nearly the same energy as a full one. Fewer, fuller cycles is free savings.",
    emoji: "📦",
    impact: "medium",
  },
  {
    id: "water-heater",
    title: "Turn the water heater down to 120°F",
    body: "An electric water heater is among the biggest energy users in a home — comparable to space heating — and it holds heat all day whether you use it or not.",
    emoji: "🚿",
    impact: "medium",
  },
  {
    id: "led",
    title: "Swap the last few bulbs for LEDs",
    body: "An LED uses about a fifth of what an incandescent does and lasts years longer. One-time effort, permanent saving.",
    emoji: "💡",
    impact: "small",
  },
  {
    id: "standby",
    title: "Unplug the things that are never really off",
    body: "Game consoles, set-top boxes and old chargers quietly draw power all day. Standby is around 5–10% of home electricity.",
    emoji: "🔌",
    impact: "small",
  },
];

/** Answers to the questions a thoughtful person will actually ask. */
export const FAQ: { q: string; a: string }[] = [
  {
    q: "Why does the time of day matter at all?",
    a: "Electricity has to be made the instant you use it. When the sun is high, a lot of it comes from solar. When everyone gets home and the sun sets, the grid fires up gas plants to keep up. Same kilowatt-hour, very different emissions.",
  },
  {
    q: "Where do these numbers come from?",
    a: "The US Energy Information Administration publishes what every regional grid generated each hour, by fuel type. We pull a year of that history for your grid, weight recent and same-season hours most heavily, and multiply each fuel by its lifecycle emissions factor. Where a live forecast is available, we blend it in for the next day or so.",
  },
  {
    q: "How accurate is the forecast?",
    a: "The next 24 hours are usually close. Further out, it's a well-informed pattern — your grid's typical shape for that hour and day, not a weather-aware prediction. We label how confident we are, and we'd rather admit that than pretend.",
  },
  {
    q: "Does this save me money too?",
    a: "Often yes. If you're on a time-of-use rate, the expensive hours and the dirty hours are usually the same evening peak. Check your utility's rate plan — the overlap is not perfect, but it's close.",
  },
  {
    q: "Does one dishwasher load really matter?",
    a: "On its own, it's small — a few dozen grams. The point is that it's free, it repeats, and it's a real reduction rather than an offset. A household that shifts its big loads all year saves on the order of tens of kilograms of CO₂, and grids with many people doing it need fewer peaking plants.",
  },
  {
    q: "What if I can't run it at the suggested time?",
    a: "Then skip it. We always offer more than one window, and declining costs you nothing — your total is untouched. This is meant to be useful, not another thing nagging you.",
  },
];
