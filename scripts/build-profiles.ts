/**
 * Build committed grid profiles from real EIA history.
 *
 *   npm run build:profiles                  # top 25 balancing authorities
 *   npm run build:profiles -- --only=CISO,PJM
 *   npm run build:profiles -- --days=180
 *
 * A full year for one BA is ~76,000 rows over 16 paged requests and about 20
 * seconds, which is fine here and far too slow on a request path — that's the
 * whole reason this script exists. The output lands in
 * `src/lib/grid/data/profiles/` and ships with the app, so the common case is a
 * zero-network lookup.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOP_BALANCING_AUTHORITIES } from "../src/lib/grid/data/balancingAuthorities";
import { buildProfile } from "../src/lib/grid/climatology";
import { buildDemandModel, fetchDemandHistory } from "../src/lib/grid/demand";
import { fetchFuelTypeRows, rowsToSamples } from "../src/lib/grid/eia";
import type { RegionProfile } from "../src/lib/grid/types";

const OUT_DIR = path.join(process.cwd(), "src/lib/grid/data/profiles");

/** Window the demand regression is fitted over. See buildOne for why. */
const DEMAND_FIT_DAYS = 90;

/** Minimal .env reader — not worth a dependency for four keys. */
function loadEnvLocal(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const [, key, rawValue] = match;
        const value = rawValue.replace(/^["']|["']$/g, "");
        if (value && !process.env[key]) process.env[key] = value;
      }
    } catch {
      // Missing file is fine.
    }
  }
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

/** Cleanest and dirtiest local hour, so the operator can eyeball the result. */
function summarise(profile: RegionProfile) {
  const byHour = new Map<number, { total: number; count: number }>();
  for (let slot = 0; slot < profile.slots.length; slot += 1) {
    // Slots are hour-of-week in *local* time (weekday * 24 + local hour), so
    // the local hour is just the remainder. Converting through UTC here would
    // shift every reading by the region's offset.
    const hour = slot % 24;
    const entry = byHour.get(hour) ?? { total: 0, count: 0 };
    entry.total += profile.slots[slot].gCO2PerKWh;
    entry.count += 1;
    byHour.set(hour, entry);
  }
  let cleanest = { hour: -1, value: Infinity };
  let dirtiest = { hour: -1, value: -Infinity };
  for (const [hour, { total, count }] of byHour) {
    const mean = total / count;
    if (mean < cleanest.value) cleanest = { hour, value: mean };
    if (mean > dirtiest.value) dirtiest = { hour, value: mean };
  }
  const swing =
    dirtiest.value > 0
      ? ((dirtiest.value - cleanest.value) / dirtiest.value) * 100
      : 0;
  return { cleanest, dirtiest, swing };
}

async function buildOne(
  ba: string,
  timezone: string,
  apiKey: string,
  days: number,
): Promise<RegionProfile | null> {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86_400_000);

  const fuel = await fetchFuelTypeRows(
    { apiKey, ba, start, end: now },
    { pageSize: 5000, maxPages: 30, totalTimeoutMs: 180_000 },
  );
  const samples = rowsToSamples(fuel.rows);
  if (samples.length < 24 * 14) {
    console.log(
      `  ${ba}: only ${samples.length} usable hours — skipping (needs 336+)`,
    );
    return null;
  }

  const profile = buildProfile(samples, {
    ba,
    timezone,
    now,
    source: "eia",
    notes: [`Built from ${samples.length} hours of EIA-930 history.`],
  });

  // Demand is what lets us nowcast the current hour, so fetch it alongside.
  try {
    const demand = await fetchDemandHistory({
      apiKey,
      ba,
      days: Math.min(days, 365),
      now,
      requestTimeoutMs: 20_000,
      totalTimeoutMs: 90_000,
    });
    if (demand.points.length >= 24 * 14) {
      /**
       * Fit the demand sensitivity on recent history only.
       *
       * The profile's seasonal kernel is centred on *today*, so it predicts
       * this month well and last February badly. Regressing a full year
       * against it buries the demand signal under seasonal error — fitting
       * CISO over 365 days gave r=0.18, while the same fit over the recent
       * window gives r≈0.79. Restricting the fit to the window the profile
       * actually describes is what makes the correlation meaningful.
       */
      const fitWindowMs = DEMAND_FIT_DAYS * 86_400_000;
      const cutoff = now.getTime() - fitWindowMs;
      const recentSamples = samples.filter((s) => s.epochMs >= cutoff);
      const recentDemand = demand.points.filter((p) => p.epochMs >= cutoff);
      const model = buildDemandModel(
        recentSamples,
        recentDemand,
        profile.slots.map((s) => s.gCO2PerKWh),
        { timezone, now },
      );
      profile.demandSlots = model.demandSlots;
      profile.demandSensitivity = model.sensitivity;
    } else {
      profile.notes.push("Demand history too sparse for a nowcast.");
    }
  } catch (error) {
    profile.notes.push(
      `Demand pull failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return profile;
}

/**
 * Rewrite the index from **every** profile on disk, not just the ones built in
 * this run. `--only=SRP,TEC` would otherwise drop the other 23 from the bundle
 * while leaving their JSON files sitting there unreferenced.
 */
function writeIndex(): void {
  const sorted = readdirSync(OUT_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
  const imports = sorted
    .map((ba) => `import ${ba} from "./${ba}.json";`)
    .join("\n");
  const entries = sorted
    .map((ba) => `  ${ba}: ${ba} as unknown as RegionProfile,`)
    .join("\n");
  const body = `/**
 * Pre-built EIA profiles committed to the repo.
 *
 * Generated by \`npm run build:profiles\` — do not edit by hand. Static imports
 * (rather than a runtime directory read) keep this working in every Next.js
 * runtime and make the common case a zero-network, zero-filesystem lookup.
 */

import type { RegionProfile } from "../../types";
${imports ? `\n${imports}\n` : ""}
export const BUNDLED_PROFILES: Record<string, RegionProfile> = {
${entries}
};

export function bundledProfile(ba: string): RegionProfile | null {
  return BUNDLED_PROFILES[ba.toUpperCase()] ?? null;
}
`;
  writeFileSync(path.join(OUT_DIR, "index.ts"), body);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    console.log(
      "No EIA_API_KEY found. Add one to .env.local (free, instant:\n" +
        "https://www.eia.gov/opendata/register.php) and re-run.\n" +
        "The app still works without this — it falls back to modelled profiles.",
    );
    return;
  }

  const days = Number(arg("days") ?? 365);
  const only = arg("only")
    ?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const targets = TOP_BALANCING_AUTHORITIES.filter(
    (meta) => !only || only.includes(meta.ba),
  );

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `Building ${targets.length} profile(s) from ${days} days of EIA history.\n`,
  );

  const built: string[] = [];
  for (const [i, meta] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${meta.ba}`;
    const startedAt = Date.now();
    try {
      const profile = await buildOne(meta.ba, meta.timezone, apiKey, days);
      if (!profile) continue;
      writeFileSync(
        path.join(OUT_DIR, `${meta.ba}.json`),
        `${JSON.stringify(profile)}\n`,
      );
      built.push(meta.ba);
      const { cleanest, dirtiest, swing } = summarise(profile);
      const sens = profile.demandSensitivity;
      console.log(
        `${label} ${profile.hoursOfHistory}h history · ` +
          `cleanest ${String(cleanest.hour).padStart(2, "0")}:00 = ${Math.round(cleanest.value)} · ` +
          `dirtiest ${String(dirtiest.hour).padStart(2, "0")}:00 = ${Math.round(dirtiest.value)} · ` +
          `swing ${swing.toFixed(0)}% · ` +
          (sens
            ? `demand r=${sens.r.toFixed(2)} ${sens.applied ? "APPLIED" : "not used"}`
            : "no demand model") +
          ` (${((Date.now() - startedAt) / 1000).toFixed(0)}s)`,
      );
    } catch (error) {
      console.log(
        `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  writeIndex();
  console.log(
    `\nBuilt ${built.length} profile(s) this run; index.ts now lists every profile on disk.`,
  );
}

void main();
