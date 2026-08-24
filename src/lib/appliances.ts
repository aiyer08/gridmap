import type { Appliance, Habit } from "./types";

/**
 * Typical household loads. Energy figures are per-run averages for modern
 * US appliances (ENERGY STAR / EIA RECS ballparks) — good enough to make the
 * comparison meaningful without pretending to be a meter.
 */
export const APPLIANCES: Appliance[] = [
  {
    id: "dishwasher",
    label: "Dishwasher",
    emoji: "🍽️",
    category: "kitchen",
    kWhPerRun: 1.2,
    durationHours: 2,
    assumption: "One normal cycle with heated dry, about 1.2 kWh over 2 hours.",
    shiftable: true,
  },
  {
    id: "washing-machine",
    label: "Washing machine",
    emoji: "🧺",
    category: "laundry",
    kWhPerRun: 0.6,
    durationHours: 1,
    assumption: "One warm-wash load, about 0.6 kWh over an hour.",
    shiftable: true,
  },
  {
    id: "dryer",
    label: "Clothes dryer",
    emoji: "🌀",
    category: "laundry",
    kWhPerRun: 2.5,
    durationHours: 1,
    assumption: "One electric dryer load, about 2.5 kWh over roughly an hour.",
    shiftable: true,
  },
  {
    id: "ev",
    label: "EV charging",
    emoji: "🚗",
    category: "vehicle",
    kWhPerRun: 30,
    durationHours: 4,
    assumption: "A Level 2 top-up of about 30 kWh — roughly 100 miles of range.",
    shiftable: true,
  },
  {
    id: "water-heater",
    label: "Water heater",
    emoji: "🚿",
    category: "water",
    kWhPerRun: 7,
    durationHours: 2,
    assumption:
      "A full electric tank reheat, about 7 kWh over 2 hours. From the physics: a 40-gallon tank raised 70°F needs 40 × 8.34 × 70 ÷ 3412 ≈ 6.8 kWh.",
    shiftable: true,
  },
  {
    id: "ac-precool",
    label: "Pre-cool the house",
    emoji: "❄️",
    category: "climate",
    kWhPerRun: 6,
    durationHours: 2,
    assumption: "Running central AC hard for 2 hours, about 6 kWh.",
    shiftable: true,
  },
  {
    id: "heat-pump",
    label: "Heat pump boost",
    emoji: "🔥",
    category: "climate",
    kWhPerRun: 5,
    durationHours: 2,
    assumption: "Two hours of heat-pump heating, about 5 kWh.",
    shiftable: true,
  },
  {
    id: "oven",
    label: "Electric oven",
    emoji: "🥘",
    category: "kitchen",
    kWhPerRun: 2.3,
    durationHours: 1,
    assumption:
      "Preheating plus an hour of baking at 350°F, about 2.3 kWh. Steady baking alone is nearer 2 kWh — the element cycles rather than running flat out.",
    shiftable: true,
  },
  {
    id: "pool-pump",
    label: "Pool pump",
    emoji: "🏊",
    category: "other",
    kWhPerRun: 7.5,
    durationHours: 6,
    assumption:
      "A 1.25 kW variable-speed pump on its daily 6-hour filter cycle. An older single-speed pump draws 1.5–2.5 kW, so it would use roughly double this.",
    shiftable: true,
  },
  {
    id: "battery-charge",
    label: "Charge home battery",
    emoji: "🔋",
    category: "other",
    kWhPerRun: 10,
    durationHours: 3,
    assumption: "Filling about 10 kWh of home battery storage.",
    shiftable: true,
  },
  {
    id: "devices",
    label: "Charge devices",
    emoji: "💻",
    category: "other",
    kWhPerRun: 0.3,
    durationHours: 2,
    assumption: "A laptop, a tablet and a couple of phones, about 0.3 kWh.",
    shiftable: true,
  },
  {
    id: "vacuum",
    label: "Vacuum / chores",
    emoji: "🧹",
    category: "other",
    kWhPerRun: 0.8,
    durationHours: 1,
    assumption: "An hour of vacuuming and general cleaning, about 0.8 kWh.",
    shiftable: true,
  },
];

export const DEFAULT_APPLIANCE_ID = "dishwasher";

export function getAppliance(id: string): Appliance {
  return (
    APPLIANCES.find((a) => a.id === id) ??
    APPLIANCES.find((a) => a.id === DEFAULT_APPLIANCE_ID)!
  );
}

/**
 * Small everyday wins. These aren't time-shifted — they're straight energy
 * you didn't use — so they're valued at the region's average intensity.
 */
export const HABITS: Habit[] = [
  {
    id: "lights-off",
    label: "Turned off lights you weren't using",
    emoji: "💡",
    kWhSaved: 0.1,
    detail: "Three 9-watt LED bulbs left off for an evening.",
  },
  {
    id: "cold-wash",
    label: "Washed a load in cold water",
    emoji: "🧊",
    kWhSaved: 0.5,
    detail: "Skipping the water heating is most of a wash cycle's energy.",
  },
  {
    id: "air-dry",
    label: "Air-dried laundry instead of the dryer",
    emoji: "🪢",
    kWhSaved: 2.5,
    detail: "A dryer load is one of the biggest single loads in a house.",
  },
  {
    id: "thermostat",
    label: "Nudged the thermostat 2°F",
    emoji: "🌡️",
    kWhSaved: 1.5,
    detail: "Two degrees for a day is roughly 2–5% of heating or cooling energy.",
  },
  {
    id: "unplug",
    label: "Unplugged idle electronics",
    emoji: "🔌",
    kWhSaved: 0.4,
    detail: "Standby power is about 5–10% of a typical home's electricity.",
  },
  {
    id: "shorter-shower",
    label: "Took a shorter hot shower",
    emoji: "⏱️",
    kWhSaved: 1.2,
    detail: "Three fewer minutes of electric water heating.",
  },
  {
    id: "full-loads",
    label: "Waited for a full load",
    emoji: "📦",
    kWhSaved: 1.2,
    detail: "One fewer half-empty dishwasher or washer cycle.",
  },
  {
    id: "line-of-sight",
    label: "Opened blinds instead of lights",
    emoji: "🪟",
    kWhSaved: 0.2,
    detail: "Daylight is free; overhead lighting isn't.",
  },
];

export function getHabit(id: string): Habit | undefined {
  return HABITS.find((h) => h.id === id);
}
