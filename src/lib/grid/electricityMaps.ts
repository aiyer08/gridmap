/**
 * Electricity Maps (optional provider).
 *
 * Gives us two things EIA cannot: a genuinely live "right now" number, and a
 * short published forecast. We use it to anchor and correct our climatology
 * rather than to replace it — its horizon is 24h, ours is a week.
 *
 * Shapes verified 2026-08-23 against the live API and
 * https://app.electricitymaps.com/docs (the older docs.electricitymaps.com and
 * portal.electricitymaps.com/docs/api now redirect there):
 *
 *  - Auth header is `auth-token: <token>`. `X-BLOBR-KEY` belonged to the retired
 *    api-access.electricitymaps.com host and is no longer honoured. Sending the
 *    wrong header name returns "Please provide a valid authentication header",
 *    while a bad token returns "The provided token is invalid" — useful for
 *    telling a config bug from a bad key.
 *  - GET /v3/carbon-intensity/latest?zone=US-CAL-CISO
 *      { zone, carbonIntensity, datetime, updatedAt, createdAt,
 *        emissionFactorType: "lifecycle"|"direct", isEstimated, estimationMethod }
 *    `carbonIntensity` is gCO2eq/kWh and can be null.
 *  - GET /v3/carbon-intensity/forecast?zone=...
 *      { zone, forecast: [{ carbonIntensity, datetime }], updatedAt,
 *        temporalGranularity, _disclaimer? }
 *    25 hourly points (24h inclusive). NOT included in the free personal tier,
 *    so a 401/403 here is an expected, non-fatal outcome.
 *  - GET /v3/power-breakdown/latest?zone=...
 *      { powerConsumptionBreakdown: { nuclear, geothermal, biomass, coal, wind,
 *        solar, hydro, gas, oil, unknown, "hydro discharge",
 *        "battery discharge" }, powerProductionBreakdown: {...},
 *        fossilFreePercentage, renewablePercentage, powerConsumptionTotal, ... }
 *    Note the literal spaces in two keys, and that every value is nullable.
 *
 * Error bodies come in three shapes: `{error, message}` (401),
 * `{status: "error", message}` (400 unknown zone) and `{error}` (some routes),
 * so we read defensively. Zone validation runs *before* auth, meaning a bad
 * zone returns 400 even with no token at all.
 *
 * v4 exists and is what the docs now describe (power-breakdown becomes
 * electricity-mix, with a `{unit, data[]}` envelope). v3 still works and has the
 * flatter shape, so we stay on v3 until we have a token to test v4 against.
 */

import { carbonFreeShare } from "../emissions";
import type { FuelMix, FuelType, ProviderAttribution } from "../types";
import type {
  FetchLike,
  FetchLikeResponse,
  LiveReading,
  ProviderForecastPoint,
} from "./types";

export const ELECTRICITY_MAPS_BASE_URL = "https://api.electricitymaps.com/v3";

const PROVIDER_ID = "electricity-maps" as const;
const PROVIDER_LABEL = "Electricity Maps";

/**
 * EIA balancing authority -> Electricity Maps zone key.
 * Pulled from the public `GET /v3/zones` endpoint (no auth required) on
 * 2026-08-23. The format is `US-<EIA region>-<EIA BA code>`.
 */
export const ELECTRICITY_MAPS_ZONES: Record<string, string> = {
  // California
  BANC: "US-CAL-BANC", CISO: "US-CAL-CISO", IID: "US-CAL-IID",
  LDWP: "US-CAL-LDWP", TIDC: "US-CAL-TIDC",
  // Carolinas
  CPLE: "US-CAR-CPLE", CPLW: "US-CAR-CPLW", DUK: "US-CAR-DUK",
  SC: "US-CAR-SC", SCEG: "US-CAR-SCEG", YAD: "US-CAR-YAD",
  // Central
  SPA: "US-CENT-SPA", SWPP: "US-CENT-SWPP",
  // Florida
  FMPP: "US-FLA-FMPP", FPC: "US-FLA-FPC", FPL: "US-FLA-FPL",
  GVL: "US-FLA-GVL", HST: "US-FLA-HST", JEA: "US-FLA-JEA",
  SEC: "US-FLA-SEC", TAL: "US-FLA-TAL", TEC: "US-FLA-TEC",
  // Mid-Atlantic / Midwest
  PJM: "US-MIDA-PJM", AECI: "US-MIDW-AECI", LGEE: "US-MIDW-LGEE",
  MISO: "US-MIDW-MISO",
  // New England / New York
  ISNE: "US-NE-ISNE", NYIS: "US-NY-NYIS",
  // Northwest
  AVA: "US-NW-AVA", BPAT: "US-NW-BPAT", CHPD: "US-NW-CHPD",
  DOPD: "US-NW-DOPD", GCPD: "US-NW-GCPD", GRID: "US-NW-GRID",
  IPCO: "US-NW-IPCO", NEVP: "US-NW-NEVP", NWMT: "US-NW-NWMT",
  PACE: "US-NW-PACE", PACW: "US-NW-PACW", PGE: "US-NW-PGE",
  PSCO: "US-NW-PSCO", PSEI: "US-NW-PSEI", SCL: "US-NW-SCL",
  TPWR: "US-NW-TPWR", WACM: "US-NW-WACM", WAUW: "US-NW-WAUW",
  // Southeast / Southwest
  SEPA: "US-SE-SEPA", SOCO: "US-SE-SOCO", AZPS: "US-SW-AZPS",
  EPE: "US-SW-EPE", PNM: "US-SW-PNM", SRP: "US-SW-SRP",
  TEPC: "US-SW-TEPC", WALC: "US-SW-WALC",
  // Tennessee Valley / Texas
  TVA: "US-TEN-TVA", ERCO: "US-TEX-ERCO",
};

export function electricityMapsZoneForBa(ba: string): string | null {
  return ELECTRICITY_MAPS_ZONES[ba.toUpperCase()] ?? null;
}

/** Electricity Maps fuel keys -> our buckets. */
const EM_FUEL_MAP: Record<string, FuelType> = {
  nuclear: "nuclear",
  geothermal: "other",
  biomass: "other",
  coal: "coal",
  wind: "wind",
  solar: "solar",
  hydro: "hydro",
  gas: "gas",
  oil: "oil",
  unknown: "other",
  // Discharge is stored energy coming back out — a transfer, not a source. We
  // drop it for the same reason we drop EIA's BAT/PS rows.
  "hydro discharge": "storage",
  "battery discharge": "storage",
};

export interface ElectricityMapsOptions {
  token?: string | null;
  /** Explicit zone key; otherwise derived from `ba`. */
  zone?: string | null;
  ba?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export interface ElectricityMapsBreakdown {
  fuelMix: FuelMix;
  carbonFreeShare: number;
  /** As reported by the provider (0-100), for cross-checking our own maths. */
  fossilFreePercentage: number | null;
  renewablePercentage: number | null;
}

export interface ElectricityMapsSnapshot {
  live: LiveReading | null;
  forecast: ProviderForecastPoint[];
  breakdown: ElectricityMapsBreakdown | null;
  attribution: ProviderAttribution;
}

function attribution(used: boolean, role: string, detail?: string): ProviderAttribution {
  return { id: PROVIDER_ID, label: PROVIDER_LABEL, role, used, detail };
}

/** Turn any of the three error envelopes into one sentence. */
function errorDetail(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : null;
    const error = typeof record.error === "string" ? record.error : null;
    if (message && error) return `${error}: ${message}`;
    if (message) return message;
    if (error) return error;
  }
  return `HTTP ${status}`;
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike | null {
  if (fetchImpl) return fetchImpl;
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis) as unknown as FetchLike;
  }
  return null;
}

interface GetResult {
  body: unknown;
  status: number;
  ok: boolean;
}

async function get(
  doFetch: FetchLike,
  url: string,
  token: string,
): Promise<GetResult> {
  let response: FetchLikeResponse;
  try {
    response = await doFetch(url, { method: "GET", headers: { "auth-token": token } });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { error: error instanceof Error ? error.message : "network error" },
    };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function breakdownFromRecord(record: unknown): FuelMix {
  if (!record || typeof record !== "object") return {};
  const totals = new Map<FuelType, number>();
  let total = 0;
  for (const [key, raw] of Object.entries(record as Record<string, unknown>)) {
    const fuel = EM_FUEL_MAP[key];
    // Storage discharge is deliberately excluded; unknown keys are ignored
    // rather than lumped into "other", so a new EM fuel key cannot silently
    // distort the mix.
    if (!fuel || fuel === "storage") continue;
    const value = toFiniteNumber(raw);
    if (value === null || value <= 0) continue;
    totals.set(fuel, (totals.get(fuel) ?? 0) + value);
    total += value;
  }
  if (total <= 0) return {};
  const mix: FuelMix = {};
  for (const [fuel, value] of totals) mix[fuel] = value / total;
  return mix;
}

/**
 * Fetch everything we can from Electricity Maps in one go, and never throw.
 *
 * Missing credentials, an unmapped zone, a network blip and a free-tier
 * forecast refusal all end the same way: `null` data plus an attribution that
 * says, in plain English, why.
 */
export async function fetchElectricityMaps(
  options: ElectricityMapsOptions,
): Promise<ElectricityMapsSnapshot> {
  const empty = (detail: string): ElectricityMapsSnapshot => ({
    live: null,
    forecast: [],
    breakdown: null,
    attribution: attribution(false, "Live intensity and 24h forecast", detail),
  });

  const token = options.token?.trim();
  if (!token) {
    return empty("No ELECTRICITY_MAPS_TOKEN set, so we used our own model instead.");
  }
  const zone =
    options.zone ?? (options.ba ? electricityMapsZoneForBa(options.ba) : null);
  if (!zone) {
    return empty(`No Electricity Maps zone for ${options.ba ?? "this region"}.`);
  }
  const doFetch = resolveFetch(options.fetchImpl);
  if (!doFetch) return empty("No fetch implementation available.");
  const base = options.baseUrl ?? ELECTRICITY_MAPS_BASE_URL;
  const query = `?zone=${encodeURIComponent(zone)}`;

  const [latest, forecast, breakdown] = await Promise.all([
    get(doFetch, `${base}/carbon-intensity/latest${query}`, token),
    get(doFetch, `${base}/carbon-intensity/forecast${query}`, token),
    get(doFetch, `${base}/power-breakdown/latest${query}`, token),
  ]);

  const notes: string[] = [];

  let live: LiveReading | null = null;
  if (latest.ok && latest.body && typeof latest.body === "object") {
    const record = latest.body as Record<string, unknown>;
    const intensity = toFiniteNumber(record.carbonIntensity);
    const datetime = typeof record.datetime === "string" ? record.datetime : null;
    if (intensity !== null && intensity > 0 && datetime) {
      live = {
        ts: datetime,
        gCO2PerKWh: intensity,
        // `isEstimated` means Electricity Maps modelled it too, so we should not
        // present it as gospel.
        confidence: record.isEstimated === true ? "medium" : "high",
      };
    } else {
      notes.push("latest reading had no usable carbonIntensity");
    }
  } else if (!latest.ok) {
    notes.push(`latest: ${errorDetail(latest.body, latest.status)}`);
  }

  const forecastPoints: ProviderForecastPoint[] = [];
  if (forecast.ok && forecast.body && typeof forecast.body === "object") {
    const raw = (forecast.body as Record<string, unknown>).forecast;
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const intensity = toFiniteNumber(record.carbonIntensity);
        const datetime = typeof record.datetime === "string" ? record.datetime : null;
        if (intensity === null || intensity <= 0 || !datetime) continue;
        const parsed = Date.parse(datetime);
        if (Number.isNaN(parsed)) continue;
        forecastPoints.push({ ts: new Date(parsed).toISOString(), gCO2PerKWh: intensity });
      }
    }
  } else if (!forecast.ok) {
    // The free personal tier excludes forecasts, so this is expected, not broken.
    notes.push(`forecast: ${errorDetail(forecast.body, forecast.status)}`);
  }

  let mixResult: ElectricityMapsBreakdown | null = null;
  if (breakdown.ok && breakdown.body && typeof breakdown.body === "object") {
    const record = breakdown.body as Record<string, unknown>;
    // Consumption breakdown includes imports, which is the honest answer to
    // "what is powering my house"; production is the fallback.
    const fuelMix = (() => {
      const consumption = breakdownFromRecord(record.powerConsumptionBreakdown);
      if (Object.keys(consumption).length > 0) return consumption;
      return breakdownFromRecord(record.powerProductionBreakdown);
    })();
    if (Object.keys(fuelMix).length > 0) {
      mixResult = {
        fuelMix,
        carbonFreeShare: carbonFreeShare(fuelMix),
        fossilFreePercentage: toFiniteNumber(record.fossilFreePercentage),
        renewablePercentage: toFiniteNumber(record.renewablePercentage),
      };
      if (live) {
        live.fuelMix = fuelMix;
        live.carbonFreeShare = mixResult.carbonFreeShare;
      }
    }
  } else if (!breakdown.ok) {
    notes.push(`power breakdown: ${errorDetail(breakdown.body, breakdown.status)}`);
  }

  const used = live !== null || forecastPoints.length > 0;
  const parts: string[] = [];
  if (live) parts.push(`live ${Math.round(live.gCO2PerKWh)} gCO2/kWh`);
  if (forecastPoints.length > 0) parts.push(`${forecastPoints.length}h forecast`);
  if (mixResult) parts.push("fuel breakdown");
  if (notes.length > 0) parts.push(notes.join("; "));

  return {
    live,
    forecast: forecastPoints,
    breakdown: mixResult,
    attribution: attribution(
      used,
      "Live intensity and 24h forecast",
      `${zone}: ${parts.join(" · ") || "no data returned"}`,
    ),
  };
}
