/**
 * EIA API v2 client for hourly generation by fuel type (the EIA-930 dataset).
 *
 * The EIA gives us the one thing nobody else gives us for free: a full year of
 * hourly, per-fuel generation for every US balancing authority. It publishes no
 * forecast, so we use it as *history* and build the forecast ourselves in
 * `climatology.ts`.
 *
 * Endpoint and parameter syntax:
 *   GET https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/
 *       ?api_key=...&frequency=hourly&data[0]=value
 *       &facets[respondent][]=CISO
 *       &start=2025-08-01T00&end=2026-08-01T00
 *       &sort[0][column]=period&sort[0][direction]=desc
 *       &offset=0&length=5000
 *
 * Rows come back as:
 *   { period: "2026-08-22T14", respondent: "CISO", fueltype: "SUN",
 *     "type-name": "Solar", value: 12345, "value-units": "megawatthours" }
 *
 * `value` arrives as a JSON number in current responses but has historically
 * been quoted, so we coerce. Periods for `frequency=hourly` are UTC hour starts.
 *
 * No network access happens without an injected `fetch`, so every path below is
 * unit-testable against fixtures.
 */

import {
  carbonFreeShare,
  intensityFromEiaGeneration,
  mixFromGeneration,
  normaliseEiaFuelCode,
} from "../emissions";
import type { FuelType } from "../types";
import type { FetchLike, FetchLikeResponse, HourlySample } from "./types";

export const EIA_FUEL_TYPE_DATA_URL =
  "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/";

/** The API rejects anything larger. A year of hourly data is ~14 pages. */
export const EIA_MAX_PAGE_SIZE = 5000;

/**
 * EIA reports regional aggregates alongside individual balancing authorities,
 * using the same `respondent` facet. That matters a lot for small BAs: Seattle
 * City Light publishes patchy fuel-type data, but the Northwest aggregate
 * (`NW`) it belongs to is complete. Real regional data beats a synthetic
 * archetype every time, so the fallback chain is BA -> region -> US48 ->
 * modelled archetype.
 *
 * Groupings follow EIA's Hourly Electric Grid Monitor regions
 * (https://www.eia.gov/electricity/gridmonitor/about).
 */
export const EIA_REGION_AGGREGATES = [
  "CAL",
  "CAR",
  "CENT",
  "FLA",
  "MIDA",
  "MIDW",
  "NE",
  "NW",
  "NY",
  "SE",
  "SW",
  "TEN",
  "TEX",
] as const;

export type EiaRegionAggregate = (typeof EIA_REGION_AGGREGATES)[number];

/** Nationwide aggregate — the last stop before we fall back to a model. */
export const EIA_NATIONAL_AGGREGATE = "US48";

export const EIA_PARENT_REGION: Record<string, EiaRegionAggregate> = {
  // California
  BANC: "CAL", CISO: "CAL", IID: "CAL", LDWP: "CAL", TIDC: "CAL",
  // Carolinas
  CPLE: "CAR", CPLW: "CAR", DUK: "CAR", SC: "CAR", SCEG: "CAR", YAD: "CAR",
  // Central
  SPA: "CENT", SWPP: "CENT",
  // Florida
  FMPP: "FLA", FPC: "FLA", FPL: "FLA", GVL: "FLA", HST: "FLA", JEA: "FLA",
  NSB: "FLA", SEC: "FLA", TAL: "FLA", TEC: "FLA",
  // Mid-Atlantic
  OVEC: "MIDA", PJM: "MIDA",
  // Midwest
  AECI: "MIDW", EEI: "MIDW", LGEE: "MIDW", MISO: "MIDW",
  // New England / New York
  ISNE: "NE", NYIS: "NY",
  // Northwest
  AVA: "NW", AVRN: "NW", BPAT: "NW", CHPD: "NW", DOPD: "NW", GCPD: "NW",
  GRID: "NW", GWA: "NW", IPCO: "NW", NEVP: "NW", NWMT: "NW", PACE: "NW",
  PACW: "NW", PGE: "NW", PSCO: "NW", PSEI: "NW", SCL: "NW", TPWR: "NW",
  WACM: "NW", WAUW: "NW", WWA: "NW",
  // Southeast
  SEPA: "SE", SOCO: "SE",
  // Southwest
  AZPS: "SW", DEAA: "SW", EPE: "SW", GRIF: "SW", GRMA: "SW", HGMA: "SW",
  PNM: "SW", SRP: "SW", TEPC: "SW", WALC: "SW",
  // Tennessee Valley / Texas
  TVA: "TEN", ERCO: "TEX",
};

export function parentRegionForBa(ba: string): EiaRegionAggregate | null {
  return EIA_PARENT_REGION[ba.toUpperCase()] ?? null;
}

export function isRegionAggregate(code: string): boolean {
  const upper = code.toUpperCase();
  return (
    upper === EIA_NATIONAL_AGGREGATE ||
    (EIA_REGION_AGGREGATES as readonly string[]).includes(upper)
  );
}

/**
 * Respondent codes to try, in order, for a BA. Callers walk this list until one
 * returns enough hours to model, and record which tier they landed on.
 */
export function respondentChain(ba: string): string[] {
  const upper = ba.toUpperCase();
  if (isRegionAggregate(upper)) {
    return upper === EIA_NATIONAL_AGGREGATE
      ? [upper]
      : [upper, EIA_NATIONAL_AGGREGATE];
  }
  const parent = parentRegionForBa(upper);
  return parent ? [upper, parent, EIA_NATIONAL_AGGREGATE] : [upper, EIA_NATIONAL_AGGREGATE];
}

/** One row of the `response.data` array. */
export interface EiaRow {
  period: string;
  respondent?: string;
  "respondent-name"?: string;
  fueltype: string;
  "type-name"?: string;
  value: number | string | null;
  "value-units"?: string;
}

export interface EiaEnvelope {
  response?: {
    total?: number | string;
    dateFormat?: string;
    frequency?: string;
    data?: EiaRow[];
    warnings?: { warning?: string; description?: string }[];
  };
  /** Error bodies use one of these; the API is not entirely consistent. */
  error?: string | { code?: string; message?: string };
  data?: { error?: string; message?: string };
  request?: unknown;
}

export class EiaError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "EiaError";
    this.status = status;
  }
}

/** `YYYY-MM-DDTHH` in UTC, which is what the `start`/`end` params expect. */
export function formatEiaPeriod(value: Date | string): string {
  if (typeof value === "string") return value;
  return value.toISOString().slice(0, 13);
}

/**
 * Parse an EIA hourly period into epoch millis.
 * Accepts "2026-08-22T14", "2026-08-22T14:00", and explicit-offset variants,
 * treating a bare period as UTC (which is what `frequency=hourly` returns).
 */
export function parseEiaPeriod(period: string): number | null {
  if (typeof period !== "string") return null;
  const trimmed = period.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    trimmed,
  );
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", offset] = match;
  const base = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (!Number.isFinite(base)) return null;
  if (!offset || offset === "Z") return base;
  const sign = offset.startsWith("-") ? -1 : 1;
  const digits = offset.slice(1).replace(":", "");
  const offsetMinutes =
    Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || "0");
  return base - sign * offsetMinutes * 60_000;
}

export interface EiaRequestParams {
  apiKey: string;
  ba: string;
  start: Date | string;
  end: Date | string;
  offset?: number;
  length?: number;
  baseUrl?: string;
}

export function buildEiaUrl(params: EiaRequestParams): string {
  const search = new URLSearchParams();
  search.set("api_key", params.apiKey);
  search.set("frequency", "hourly");
  search.set("data[0]", "value");
  search.set("facets[respondent][]", params.ba.toUpperCase());
  search.set("start", formatEiaPeriod(params.start));
  search.set("end", formatEiaPeriod(params.end));
  // Descending so that, if we ever truncate, we keep the most recent hours —
  // the ones the recency weighting cares most about.
  search.set("sort[0][column]", "period");
  search.set("sort[0][direction]", "desc");
  search.set("offset", String(Math.max(0, Math.floor(params.offset ?? 0))));
  search.set(
    "length",
    String(Math.min(EIA_MAX_PAGE_SIZE, Math.max(1, Math.floor(params.length ?? EIA_MAX_PAGE_SIZE)))),
  );
  return `${params.baseUrl ?? EIA_FUEL_TYPE_DATA_URL}?${search.toString()}`;
}

function describeError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const envelope = body as EiaEnvelope;
    if (typeof envelope.error === "string") return envelope.error;
    if (envelope.error && typeof envelope.error === "object") {
      return envelope.error.message ?? envelope.error.code ?? "EIA returned an error";
    }
    if (envelope.data?.error) return String(envelope.data.error);
    if (envelope.data?.message) return String(envelope.data.message);
  }
  return `EIA request failed with HTTP ${status}`;
}

async function readJson(response: FetchLikeResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export interface EiaFetchOptions {
  fetchImpl?: FetchLike;
  /** Rows per request. Clamped to EIA's 5000 maximum. */
  pageSize?: number;
  /** Safety valve so a bad `total` can never spin forever. */
  maxPages?: number;
  baseUrl?: string;
}

export interface EiaFetchResult {
  rows: EiaRow[];
  /** `response.total` as reported by the API, when present. */
  total: number | null;
  pages: number;
  warnings: string[];
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis) as unknown as FetchLike;
  }
  throw new EiaError("No fetch implementation available");
}

/**
 * Fetch every row in a window, paging until the API runs out.
 *
 * Stops on the first short page (fewer rows than requested), on an empty page,
 * once `offset` passes `response.total`, or at `maxPages` — whichever comes
 * first. An empty `response.data` is a normal answer for a BA with no reported
 * data, not an error.
 */
export async function fetchFuelTypeRows(
  params: EiaRequestParams,
  options: EiaFetchOptions = {},
): Promise<EiaFetchResult> {
  const doFetch = resolveFetch(options.fetchImpl);
  const pageSize = Math.min(
    EIA_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize ?? EIA_MAX_PAGE_SIZE)),
  );
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? 40));
  const rows: EiaRow[] = [];
  const warnings: string[] = [];
  let total: number | null = null;
  let pages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const url = buildEiaUrl({
      ...params,
      baseUrl: options.baseUrl ?? params.baseUrl,
      offset: page * pageSize,
      length: pageSize,
    });
    const response = await doFetch(url, { method: "GET" });
    pages += 1;
    const body = await readJson(response);
    if (!response.ok) {
      throw new EiaError(describeError(body, response.status), response.status);
    }
    const envelope = (body ?? {}) as EiaEnvelope;
    if (envelope.error || envelope.data?.error) {
      // A 200 with an error body happens for malformed facets.
      throw new EiaError(describeError(envelope, response.status), response.status);
    }
    for (const warning of envelope.response?.warnings ?? []) {
      const text = warning.description ?? warning.warning;
      if (text) warnings.push(text);
    }
    const reportedTotal = Number(envelope.response?.total);
    if (Number.isFinite(reportedTotal)) total = reportedTotal;
    const data = envelope.response?.data;
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    if (total !== null && rows.length >= total) break;
  }

  return { rows, total, pages, warnings };
}

export interface RowsToSamplesOptions {
  /**
   * Drop hours whose total generation is below this fraction of the median
   * hour. Late-reporting or partially-revised hours arrive with only one or two
   * fuels populated, and they would otherwise poison the climatology.
   */
  minShareOfMedian?: number;
  /** Require at least this many distinct fuels before trusting an hour. */
  minFuels?: number;
}

/**
 * Group raw rows into one `HourlySample` per hour.
 *
 * Three cleanups happen here:
 *  - Negative values (batteries and pumped storage charging) clamp to 0. They
 *    represent consumption, not generation, and `mixFromGeneration` would
 *    otherwise see a negative share.
 *  - Storage is dropped from the mix entirely. A battery is a transfer, not a
 *    source, so counting discharge at 0 gCO2/kWh would understate the evening
 *    peak in exactly the regions that matter most. Excluding it attributes
 *    discharge to the average of everything else, which is the conventional
 *    treatment and matches the note in `emissions.ts`.
 *  - Partial hours are filtered out (see options above).
 */
export function rowsToSamples(
  rows: EiaRow[],
  options: RowsToSamplesOptions = {},
): HourlySample[] {
  const minShareOfMedian = options.minShareOfMedian ?? 0.25;
  const minFuels = options.minFuels ?? 2;
  // Two parallel views of the same hour: raw EIA codes (for intensity, so that
  // geothermal is not charged at the "other" bucket rate) and our display
  // buckets (for the "what's powering the grid" breakdown).
  const byHour = new Map<
    number,
    { codes: Record<string, number>; buckets: Partial<Record<FuelType, number>> }
  >();

  for (const row of rows) {
    if (!row || typeof row.fueltype !== "string") continue;
    const epochMs = parseEiaPeriod(row.period);
    if (epochMs === null) continue;
    const code = row.fueltype.toUpperCase();
    const fuel = normaliseEiaFuelCode(code);
    if (fuel === "storage") continue;
    const raw = typeof row.value === "string" ? Number(row.value) : row.value;
    if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
    // Negative net generation is real and common — CISO reports SUN < 0
    // overnight (inverter draw) and BAT < 0 while charging. It is consumption,
    // not generation, so it clamps to zero rather than subtracting.
    const mwh = Math.max(0, raw);
    const bucket = byHour.get(epochMs) ?? { codes: {}, buckets: {} };
    bucket.codes[code] = (bucket.codes[code] ?? 0) + mwh;
    bucket.buckets[fuel] = (bucket.buckets[fuel] ?? 0) + mwh;
    byHour.set(epochMs, bucket);
  }

  const candidates: {
    epochMs: number;
    codes: Record<string, number>;
    buckets: Partial<Record<FuelType, number>>;
    total: number;
  }[] = [];
  for (const [epochMs, entry] of byHour) {
    let total = 0;
    let fuels = 0;
    for (const mwh of Object.values(entry.buckets)) {
      if (Number.isFinite(mwh) && (mwh as number) > 0) {
        total += mwh as number;
        fuels += 1;
      }
    }
    if (total <= 0 || fuels < minFuels) continue;
    candidates.push({ epochMs, codes: entry.codes, buckets: entry.buckets, total });
  }
  if (candidates.length === 0) return [];

  const totals = candidates.map((c) => c.total).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  const floor = median * minShareOfMedian;

  return candidates
    .filter((candidate) => candidate.total >= floor)
    .sort((a, b) => a.epochMs - b.epochMs)
    .map((candidate) => {
      const fuelMix = mixFromGeneration(candidate.buckets);
      return {
        ts: new Date(candidate.epochMs).toISOString(),
        epochMs: candidate.epochMs,
        fuelMix,
        gCO2PerKWh: intensityFromEiaGeneration(candidate.codes),
        carbonFreeShare: carbonFreeShare(fuelMix),
        totalMwh: candidate.total,
      } satisfies HourlySample;
    });
}

export interface EiaHistoryOptions extends EiaFetchOptions, RowsToSamplesOptions {
  apiKey: string;
  ba: string;
  /** How far back to look. EIA keeps far more, but a year is the useful window. */
  days?: number;
  /** Reference "now", for tests. */
  now?: Date;
}

export interface EiaHistoryResult {
  samples: HourlySample[];
  rowCount: number;
  pages: number;
  warnings: string[];
  /** Distinct hours that survived cleanup. */
  hours: number;
}

/** Up to a year of hourly fuel mix for one balancing authority. */
export async function fetchHourlyHistory(
  options: EiaHistoryOptions,
): Promise<EiaHistoryResult> {
  const now = options.now ?? new Date();
  const days = Math.max(1, Math.floor(options.days ?? 365));
  const start = new Date(now.getTime() - days * 86_400_000);
  // EIA's `end` is inclusive of the hour, and the latest hours are often not
  // published yet; asking slightly into the future costs nothing.
  const end = new Date(now.getTime() + 3_600_000);
  const { rows, pages, warnings } = await fetchFuelTypeRows(
    { apiKey: options.apiKey, ba: options.ba, start, end },
    options,
  );
  const samples = rowsToSamples(rows, options);
  return {
    samples,
    rowCount: rows.length,
    pages,
    warnings,
    hours: samples.length,
  };
}

export interface EiaRecentOptions extends EiaFetchOptions, RowsToSamplesOptions {
  apiKey: string;
  ba: string;
  /** Defaults to 72h, enough to survive EIA's usual 1-2 day publication lag. */
  hours?: number;
  now?: Date;
}

/**
 * The last few days of hourly data, used to anchor the forecast to reality.
 * One small request, so it is cheap enough to run on every snapshot build.
 */
export async function fetchRecentHours(
  options: EiaRecentOptions,
): Promise<EiaHistoryResult> {
  const now = options.now ?? new Date();
  const hours = Math.max(1, Math.floor(options.hours ?? 72));
  const start = new Date(now.getTime() - hours * 3_600_000);
  const end = new Date(now.getTime() + 3_600_000);
  const { rows, pages, warnings } = await fetchFuelTypeRows(
    { apiKey: options.apiKey, ba: options.ba, start, end },
    // ~10 fuels x 72 hours = 720 rows; one page is plenty.
    { ...options, pageSize: options.pageSize ?? 2000, maxPages: options.maxPages ?? 3 },
  );
  const samples = rowsToSamples(rows, options);
  return { samples, rowCount: rows.length, pages, warnings, hours: samples.length };
}

/** The most recent hour we have data for, i.e. "the grid right now". */
export function latestSample(samples: HourlySample[]): HourlySample | null {
  let latest: HourlySample | null = null;
  for (const sample of samples) {
    if (!latest || sample.epochMs > latest.epochMs) latest = sample;
  }
  return latest;
}

export interface VerifyEiaKeyResult {
  ok: boolean;
  detail: string;
  status?: number;
  /** Rows the probe returned, so a zero tells us the key works but the BA is odd. */
  rows?: number;
}

/**
 * One cheap request (a single row) to check a key works.
 *
 * Kept separate from the data path so we can smoke-test credentials without
 * pulling a year of history — useful the moment a real key shows up.
 */
export async function verifyEiaKey(options: {
  apiKey: string;
  ba?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  now?: Date;
}): Promise<VerifyEiaKeyResult> {
  if (!options.apiKey) {
    return { ok: false, detail: "No EIA_API_KEY configured." };
  }
  const now = options.now ?? new Date();
  try {
    const result = await fetchFuelTypeRows(
      {
        apiKey: options.apiKey,
        ba: options.ba ?? "CISO",
        start: new Date(now.getTime() - 48 * 3_600_000),
        end: now,
      },
      {
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl,
        pageSize: 1,
        maxPages: 1,
      },
    );
    if (result.rows.length === 0) {
      return {
        ok: true,
        rows: 0,
        detail: "Key accepted, but the probe window returned no rows.",
      };
    }
    return {
      ok: true,
      rows: result.rows.length,
      detail: `Key works — latest row is ${result.rows[0].period} for ${result.rows[0].respondent ?? "?"}.`,
    };
  } catch (error) {
    const status = error instanceof EiaError ? error.status : 0;
    return {
      ok: false,
      status,
      detail: error instanceof Error ? error.message : "Unknown EIA error",
    };
  }
}
