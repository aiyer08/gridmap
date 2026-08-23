/**
 * Bundled archetype profiles — the reason GridMap works with zero API keys.
 *
 * These are *modelled* hour-of-week profiles, not measurements. For each
 * balancing authority we pick a grid archetype and synthesise a plausible
 * hourly fuel mix; the carbon intensity then falls out of `intensityFromMix`,
 * so the number on the dial and the "what's powering the grid" breakdown can
 * never disagree with each other.
 *
 * Two deliberate choices:
 *
 *  - **Shape over level.** The product answer is "when should I run this", which
 *    depends on the diurnal *shape*. Absolute levels are tuned to be plausible
 *    but they sit somewhat below import-inclusive sources such as Electricity
 *    Maps, because (like EIA's fuel-type dataset) we only model generation
 *    inside the BA and ignore imports.
 *  - **Deterministic jitter.** Per-BA variation is seeded from a hash of the BA
 *    code, never `Math.random()`, so a given region always looks the same
 *    across renders, servers and test runs.
 *
 * Everything produced here is labelled `source: "modelled"` / confidence "low"
 * and carries a note saying so. We would rather be honest and useful than
 * silently pretend a model is a measurement.
 */

import { carbonFreeShare, intensityFromMix } from "../emissions";
import type { FuelMix, FuelType } from "../types";
import { round, seriesStats } from "./stats";
import {
  HOURS_PER_WEEK,
  hourOfSlot,
  isWeekendDay,
  safeTimeZone,
  weekdayOfSlot,
} from "./time";
import type { ProfileSlot, RegionProfile } from "./types";

export type GridArchetype =
  | "solar-heavy"
  | "wind-heavy"
  | "hydro-heavy"
  | "coal-heavy"
  | "gas-nuclear"
  | "mixed";

export const ARCHETYPE_LABELS: Record<GridArchetype, string> = {
  "solar-heavy": "Solar-heavy grid",
  "wind-heavy": "Wind-heavy grid",
  "hydro-heavy": "Hydro-heavy grid",
  "coal-heavy": "Coal-heavy grid",
  "gas-nuclear": "Gas and nuclear grid",
  mixed: "Mixed grid",
};

/** One-line "why does the curve look like this" copy for the UI. */
export const ARCHETYPE_DESCRIPTIONS: Record<GridArchetype, string> = {
  "solar-heavy":
    "Huge midday solar output, then a sharp gas ramp when the sun sets — the classic duck curve.",
  "wind-heavy":
    "Wind blows hardest overnight, so the small hours are cleanest and afternoons lean on gas.",
  "hydro-heavy":
    "Dams run most of the day, so this grid is unusually clean and unusually flat.",
  "coal-heavy":
    "Coal runs around the clock here, so the day is dirtier overall with a mild afternoon peak.",
  "gas-nuclear":
    "Steady nuclear baseload with gas following demand, so evenings are the dirtiest hours.",
  mixed: "A blend of sources, with a mild evening peak as demand rises.",
};

/** Raw (un-normalised) fuel shares for one local hour. */
type RawShares = Partial<Record<FuelType, number>>;

interface ArchetypeSpec {
  /** Shares before per-BA tilts and normalisation. */
  shares: (hour: number, isWeekend: boolean) => RawShares;
  /** How much wind wanders hour-to-hour, as a relative fraction. */
  windNoise: number;
}

/**
 * Gaussian bump on the 24-hour clock, using *circular* hour distance so that a
 * feature centred at 21:00 correctly bleeds into the small hours.
 */
function hourBell(hour: number, center: number, width: number): number {
  const raw = Math.abs(hour - center);
  const distance = Math.min(raw, 24 - raw);
  return Math.exp(-(distance * distance) / (2 * width * width));
}

/**
 * Single smooth diurnal cycle peaking at `peakHour`, in [0, 1]. Better than a
 * Gaussian for features that genuinely rise and fall once a day (wind, demand),
 * because it never flattens to zero on the far side of the clock.
 */
function dailyCycle(hour: number, peakHour: number): number {
  return 0.5 * (1 + Math.cos((2 * Math.PI * (hour - peakHour)) / 24));
}

/**
 * Weekends shave a few percent off demand, and the marginal unit is nearly
 * always gas or coal, so the whole grid gets slightly cleaner.
 */
function weekendFossilFactor(isWeekend: boolean): number {
  return isWeekend ? 0.9 : 1;
}

const ARCHETYPES: Record<GridArchetype, ArchetypeSpec> = {
  // CAISO-like. Solar peaks near 40% of in-state generation at noon and is gone
  // by 8 PM, exactly when demand peaks — hence the steep evening gas ramp.
  "solar-heavy": {
    windNoise: 0.05,
    shares: (hour, isWeekend) => ({
      solar: 0.44 * hourBell(hour, 12.4, 3.2),
      wind: 0.06 + 0.05 * hourBell(hour, 21, 5),
      hydro: 0.06 + 0.02 * hourBell(hour, 15, 5),
      nuclear: 0.075,
      other: 0.045,
      coal: 0.004,
      oil: 0.002,
      gas:
        (0.36 + 0.32 * hourBell(hour, 19.5, 3) - 0.15 * hourBell(hour, 12.4, 3.4)) *
        weekendFossilFactor(isWeekend),
    }),
  },
  // SPP/ERCOT-like. Wind peaks overnight and falls away through the day, so the
  // cleanest hours are 2-5 AM and the dirtiest are late afternoon. Deliberately
  // NOT a flattened duck curve: measured SPP data has its *dirtiest* hour at
  // 4 PM and its cleanest at 3 AM, the opposite of California.
  "wind-heavy": {
    windNoise: 0.09,
    shares: (hour, isWeekend) => ({
      wind: 0.18 + 0.32 * dailyCycle(hour, 3.5),
      solar: 0.15 * hourBell(hour, 12.6, 3.3),
      nuclear: 0.06,
      hydro: 0.008,
      other: 0.012,
      oil: 0.001,
      coal: 0.2 * weekendFossilFactor(isWeekend),
      gas: (0.26 + 0.18 * dailyCycle(hour, 18)) * weekendFossilFactor(isWeekend),
    }),
  },
  // Pacific Northwest. Dams follow load a little, but the mix barely moves, so
  // there is genuinely not much to be gained by shifting a load here.
  "hydro-heavy": {
    windNoise: 0.07,
    shares: (hour, isWeekend) => ({
      hydro: 0.72 + 0.06 * hourBell(hour, 18, 5),
      wind: 0.13 - 0.03 * hourBell(hour, 15, 5),
      nuclear: 0.05,
      solar: 0.012 * hourBell(hour, 12.5, 3.2),
      other: 0.012,
      oil: 0.001,
      coal: 0.008 * weekendFossilFactor(isWeekend),
      gas: (0.07 + 0.04 * hourBell(hour, 19, 3)) * weekendFossilFactor(isWeekend),
    }),
  },
  // MISO-like. Coal is committed for the whole day, so the curve is high and
  // flat with only a mild afternoon bump as gas peakers come on.
  "coal-heavy": {
    windNoise: 0.08,
    shares: (hour, isWeekend) => ({
      wind:
        0.16 + 0.05 * hourBell(hour, 3, 6.5) - 0.03 * hourBell(hour, 15, 4.5),
      solar: 0.05 * hourBell(hour, 12.6, 3.2),
      nuclear: 0.12,
      hydro: 0.02,
      other: 0.015,
      oil: 0.002,
      coal: (0.38 + 0.05 * hourBell(hour, 16, 4.5)) * weekendFossilFactor(isWeekend),
      gas: (0.26 + 0.08 * hourBell(hour, 18.5, 3.5)) * weekendFossilFactor(isWeekend),
    }),
  },
  // Northeast / Southeast. Nuclear holds the floor and gas does all the
  // following, so the shape tracks demand: cleanest overnight, worst at 7 PM.
  "gas-nuclear": {
    windNoise: 0.06,
    shares: (hour, isWeekend) => ({
      nuclear: 0.28,
      hydro: 0.05,
      solar: 0.09 * hourBell(hour, 12.5, 3.2),
      wind: 0.045 + 0.02 * hourBell(hour, 3, 6),
      other: 0.03,
      oil: 0.004,
      coal: 0.03 * weekendFossilFactor(isWeekend),
      gas: (0.44 + 0.2 * hourBell(hour, 19, 3.2)) * weekendFossilFactor(isWeekend),
    }),
  },
  // The honest default when we know nothing specific about a BA.
  mixed: {
    windNoise: 0.07,
    shares: (hour, isWeekend) => ({
      wind: 0.11 + 0.04 * hourBell(hour, 3, 6),
      solar: 0.09 * hourBell(hour, 12.5, 3.2),
      nuclear: 0.17,
      hydro: 0.07,
      other: 0.025,
      oil: 0.003,
      coal: 0.16 * weekendFossilFactor(isWeekend),
      gas: (0.41 + 0.16 * hourBell(hour, 19, 3.2)) * weekendFossilFactor(isWeekend),
    }),
  },
};

const FOSSIL_FUELS: FuelType[] = ["coal", "gas", "oil"];

interface BaSpec {
  archetype: GridArchetype;
  /** Multiplier on coal/gas/oil shares — raises or lowers the whole curve. */
  fossilTilt?: number;
  /** Multiplier on coal specifically, for legacy-coal outliers. */
  coalTilt?: number;
  /** Multiplier on the carbon-free shares; <1 makes the grid dirtier. */
  cleanTilt?: number;
}

/**
 * BA -> archetype. Assignments follow each BA's dominant generation as reported
 * in recent EIA-930 data. Anything not listed falls back to "mixed".
 */
export const BA_ARCHETYPES: Record<string, BaSpec> = {
  // --- Solar-heavy: Southwest and California -------------------------------
  CISO: { archetype: "solar-heavy" },
  AZPS: { archetype: "solar-heavy", fossilTilt: 1.15, coalTilt: 6 },
  SRP: { archetype: "solar-heavy", fossilTilt: 1.1, coalTilt: 8 },
  PNM: { archetype: "solar-heavy", fossilTilt: 1.1, coalTilt: 6 },
  IID: { archetype: "solar-heavy", cleanTilt: 1.2 },
  // LDWP still imports from the coal-fired Intermountain plant.
  LDWP: { archetype: "solar-heavy", coalTilt: 10, fossilTilt: 1.1 },
  TEPC: { archetype: "solar-heavy", fossilTilt: 1.15, coalTilt: 7 },
  EPE: { archetype: "solar-heavy", fossilTilt: 1.15 },
  NEVP: { archetype: "solar-heavy", fossilTilt: 1.2, coalTilt: 2 },
  DEAA: { archetype: "solar-heavy", fossilTilt: 1.1 },
  GRIF: { archetype: "solar-heavy", fossilTilt: 1.2 },
  GRMA: { archetype: "solar-heavy", fossilTilt: 1.1 },
  HGMA: { archetype: "solar-heavy", fossilTilt: 1.1 },

  // --- Wind-heavy: Texas and the Plains ------------------------------------
  ERCO: { archetype: "wind-heavy" },
  SWPP: { archetype: "wind-heavy", coalTilt: 1.5 },
  PSCO: { archetype: "wind-heavy", coalTilt: 1.3 },
  WACM: { archetype: "wind-heavy", coalTilt: 1.4 },
  GWA: { archetype: "wind-heavy", coalTilt: 1.5 },
  WWA: { archetype: "wind-heavy", coalTilt: 1.3 },
  WAUW: { archetype: "wind-heavy", coalTilt: 1.4 },
  GRID: { archetype: "wind-heavy" },

  // --- Hydro-heavy: Pacific Northwest --------------------------------------
  BPAT: { archetype: "hydro-heavy" },
  SCL: { archetype: "hydro-heavy", cleanTilt: 1.15 },
  IPCO: { archetype: "hydro-heavy", fossilTilt: 2.2 },
  PACW: { archetype: "hydro-heavy", fossilTilt: 2.6 },
  NWMT: { archetype: "hydro-heavy", fossilTilt: 2, coalTilt: 8 },
  CHPD: { archetype: "hydro-heavy", cleanTilt: 1.2 },
  DOPD: { archetype: "hydro-heavy", cleanTilt: 1.2 },
  GCPD: { archetype: "hydro-heavy", cleanTilt: 1.2 },
  TPWR: { archetype: "hydro-heavy", cleanTilt: 1.1 },
  AVA: { archetype: "hydro-heavy", fossilTilt: 2.4 },
  AVRN: { archetype: "hydro-heavy", fossilTilt: 1.8 },
  YAD: { archetype: "hydro-heavy", cleanTilt: 1.3 },

  // --- Coal-heavy: Midwest, Appalachia, Tennessee Valley -------------------
  MISO: { archetype: "coal-heavy" },
  PACE: { archetype: "coal-heavy", coalTilt: 1.2 },
  LGEE: { archetype: "coal-heavy", coalTilt: 1.4, cleanTilt: 0.5 },
  AECI: { archetype: "coal-heavy", coalTilt: 1.2 },
  EEI: { archetype: "coal-heavy", coalTilt: 1.3, cleanTilt: 0.4 },
  OVEC: { archetype: "coal-heavy", coalTilt: 1.6, cleanTilt: 0.2 },
  CPLW: { archetype: "coal-heavy", cleanTilt: 1.4 },
  SPA: { archetype: "coal-heavy", cleanTilt: 1.6 },
  // TVA runs a lot of nuclear alongside its coal fleet.
  TVA: { archetype: "coal-heavy", coalTilt: 0.6, cleanTilt: 1.6 },

  // --- Gas + nuclear: Northeast, Mid-Atlantic, Southeast, Florida ----------
  ISNE: { archetype: "gas-nuclear" },
  NYIS: { archetype: "gas-nuclear", cleanTilt: 1.2 },
  PJM: { archetype: "gas-nuclear", coalTilt: 4.5 },
  SOCO: { archetype: "gas-nuclear", coalTilt: 3.5 },
  DUK: { archetype: "gas-nuclear", coalTilt: 2.5, cleanTilt: 1.1 },
  CPLE: { archetype: "gas-nuclear", coalTilt: 2, cleanTilt: 1.1 },
  SCEG: { archetype: "gas-nuclear", coalTilt: 2, cleanTilt: 1.1 },
  SC: { archetype: "gas-nuclear", coalTilt: 3, cleanTilt: 0.9 },
  // Florida: gas and nuclear, almost no hydro or wind.
  FPL: { archetype: "gas-nuclear", fossilTilt: 1.25, cleanTilt: 0.6, coalTilt: 0.6 },
  TEC: { archetype: "gas-nuclear", fossilTilt: 1.3, cleanTilt: 0.4, coalTilt: 1.5 },
  JEA: { archetype: "gas-nuclear", fossilTilt: 1.3, cleanTilt: 0.3, coalTilt: 2 },
  FMPP: { archetype: "gas-nuclear", fossilTilt: 1.3, cleanTilt: 0.4 },
  FPC: { archetype: "gas-nuclear", fossilTilt: 1.2, cleanTilt: 0.5 },
  GVL: { archetype: "gas-nuclear", fossilTilt: 1.2, cleanTilt: 0.5 },
  HST: { archetype: "gas-nuclear", fossilTilt: 1.3, cleanTilt: 0.3 },
  NSB: { archetype: "gas-nuclear", fossilTilt: 1.3, cleanTilt: 0.3 },
  SEC: { archetype: "gas-nuclear", fossilTilt: 1.2, cleanTilt: 0.4 },
  TAL: { archetype: "gas-nuclear", fossilTilt: 1.3, cleanTilt: 0.3 },
  SEPA: { archetype: "gas-nuclear", cleanTilt: 2 },

  // --- Mixed ---------------------------------------------------------------
  PGE: { archetype: "mixed", cleanTilt: 1.3 },
  PSEI: { archetype: "mixed", cleanTilt: 1.4 },
};

export function archetypeForBa(ba: string): GridArchetype {
  return BA_ARCHETYPES[ba.toUpperCase()]?.archetype ?? "mixed";
}

export function baSpecFor(ba: string): BaSpec {
  return BA_ARCHETYPES[ba.toUpperCase()] ?? { archetype: "mixed" };
}

/** FNV-1a, 32-bit. Stable across runtimes, unlike anything hash-ish in stdlib. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Small, fast, seeded PRNG. Deterministic given the same seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_FUELS: FuelType[] = [
  "coal",
  "gas",
  "oil",
  "nuclear",
  "hydro",
  "solar",
  "wind",
  "other",
];

export interface FallbackProfileOptions {
  /** Overrides the archetype we would pick from the BA code. */
  archetype?: GridArchetype;
  /** ISO timestamp to stamp on the profile. Defaults to now. */
  generatedAt?: Date;
  /** Extra notes appended after the standard "this is modelled" note. */
  notes?: string[];
}

/**
 * Deterministically synthesise a 168-slot profile for a BA.
 *
 * Same BA + same archetype always produces byte-identical output, which is what
 * lets us bundle these, cache them and assert on them in tests.
 */
export function buildFallbackProfile(
  ba: string,
  timezone: string,
  options: FallbackProfileOptions = {},
): RegionProfile {
  const code = ba.toUpperCase();
  const spec = baSpecFor(code);
  const archetype = options.archetype ?? spec.archetype;
  const archetypeSpec = ARCHETYPES[archetype];
  const random = mulberry32(hashString(`${code}:${archetype}`));

  // One jitter multiplier per fuel, drawn once per BA. +-12% keeps regions
  // visibly distinct without breaking the archetype's character.
  const fuelJitter = new Map<FuelType, number>();
  for (const fuel of ALL_FUELS) {
    fuelJitter.set(fuel, 0.88 + random() * 0.24);
  }
  // Wind is not really diurnal, so we let it wander across the week. Kept small
  // on purpose: this is modelled data and we do not want invented "best hours".
  const windWobble = Array.from({ length: HOURS_PER_WEEK }, () => (random() - 0.5) * 2);

  const slots: ProfileSlot[] = [];
  for (let index = 0; index < HOURS_PER_WEEK; index += 1) {
    const weekday = weekdayOfSlot(index);
    const hour = hourOfSlot(index);
    const weekend = isWeekendDay(weekday);
    const raw = archetypeSpec.shares(hour, weekend);

    const tilted: FuelMix = {};
    let total = 0;
    for (const fuel of ALL_FUELS) {
      let share = raw[fuel] ?? 0;
      if (share <= 0) continue;
      share *= fuelJitter.get(fuel) ?? 1;
      if (FOSSIL_FUELS.includes(fuel)) share *= spec.fossilTilt ?? 1;
      else share *= spec.cleanTilt ?? 1;
      if (fuel === "coal") share *= spec.coalTilt ?? 1;
      if (fuel === "wind") {
        share *= 1 + windWobble[index] * archetypeSpec.windNoise;
      }
      if (share <= 0) continue;
      tilted[fuel] = share;
      total += share;
    }

    const fuelMix: FuelMix = {};
    if (total > 0) {
      for (const [fuel, share] of Object.entries(tilted) as [FuelType, number][]) {
        fuelMix[fuel] = round(share / total, 5);
      }
    }

    slots.push({
      hourOfWeek: index,
      fuelMix,
      gCO2PerKWh: round(intensityFromMix(fuelMix), 1),
      carbonFreeShare: round(carbonFreeShare(fuelMix), 4),
      // Modelled slots have no observations behind them, and saying so keeps
      // downstream confidence logic honest.
      sampleCount: 0,
      weight: 0,
    });
  }

  const generatedAt = options.generatedAt ?? new Date();
  return {
    ba: code,
    timezone: safeTimeZone(timezone),
    source: "modelled",
    generatedAt: generatedAt.toISOString(),
    targetDate: generatedAt.toISOString().slice(0, 10),
    hoursOfHistory: 0,
    slots,
    stats: seriesStats(slots.map((slot) => slot.gCO2PerKWh)),
    notes: [
      `Modelled estimate for a ${ARCHETYPE_LABELS[archetype].toLowerCase()} — no live data for ${code} yet.`,
      ARCHETYPE_DESCRIPTIONS[archetype],
      ...(options.notes ?? []),
    ],
  };
}
