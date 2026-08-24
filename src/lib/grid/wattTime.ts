/**
 * WattTime v3 (optional provider).
 *
 * WattTime reports **marginal** emissions (MOER): the CO2 of the next kWh, set
 * by whichever plant is on the margin. EIA and Electricity Maps report
 * **average** intensity. Those are different quantities and must not be mixed
 * into one series, so we keep average as the headline number everywhere and use
 * WattTime purely as a cross-check: its `signal-index` tells us where this hour
 * ranks, which is a genuinely independent read on "is now a good time".
 *
 * Shapes verified 2026-08-23 against the live OpenAPI 3.1 spec at
 * https://docs.watttime.org/openapi.json (title "WattTime Data API", V3):
 *
 *  - GET https://api.watttime.org/login with HTTP Basic -> { "token": "..." }.
 *    Token lasts 30 minutes; data calls use `Authorization: Bearer <token>`.
 *    Bad credentials return 403 with a *non-JSON* body ("Forbidden"), and data
 *    endpoints without a token return 401 with plain text ("Jwt is missing"),
 *    so every response body is parsed defensively.
 *  - GET /v3/forecast?region=CAISO_NORTH&signal_type=co2_moer[&horizon_hours=72]
 *      { data: [{ point_time, value }],
 *        meta: { data_point_period_seconds, generated_at, model, region,
 *                signal_type, units, warnings } }
 *    `units` is "lbs_co2_per_mwh"; default horizon 24h, max 72h; most regions
 *    are 5-minute granularity (data_point_period_seconds = 300).
 *  - GET /v3/signal-index?region=...&signal_type=co2_moer
 *      { data: [{ point_time, value }], meta: { ..., units: "percentile" } }
 *    Spec wording: "0-100 ... percentile of the current MOER relative to the
 *    upcoming 24 hours of forecast MOER values (100=dirtiest, 0=cleanest)".
 *    NOTE the direction: WattTime's 100 is the *worst* hour, whereas our
 *    `cleanlinessPercentile` is 100 = cleanest. We invert on the way in.
 *  - Error bodies (when JSON) are { error, message | msg, docs } — the spec's
 *    own schema and example disagree on that key, so we read both.
 */

import type { ProviderAttribution } from "../types";
import type { FetchLike, FetchLikeResponse, ProviderForecastPoint } from "./types";

export const WATTTIME_BASE_URL = "https://api.watttime.org";

const PROVIDER_ID = "watttime" as const;
const PROVIDER_LABEL = "WattTime";

/** 1 lb CO2 per MWh = 453.59237 g per 1000 kWh. */
export const LBS_PER_MWH_TO_G_PER_KWH = 0.45359237;

/**
 * EIA balancing authority -> WattTime v3 region.
 *
 * WattTime uses its own codes, not EIA-930 ones. Multi-zone ISOs are split into
 * `ISO_SUBREGION` (we pick the most populous subregion), while single-BA regions
 * mostly reuse the BA acronym — but not always: WattTime writes `BPA` where EIA
 * writes `BPAT`. Anything missing here simply means "no WattTime for you",
 * which is handled as a normal outcome rather than an error.
 *
 * The authoritative per-account list is GET /v3/my-access; this table is the
 * best-effort default so the first call has something to try.
 */
export const WATTTIME_REGIONS: Record<string, string> = {
  CISO: "CAISO_NORTH",
  ERCO: "ERCOT_EASTTX",
  PJM: "PJM_ROANOKE",
  ISNE: "ISONE_WCMA",
  NYIS: "NYISO_NYC",
  MISO: "MISO_DETROIT",
  SWPP: "SPP_KANSAS",
  BPAT: "BPA",
  BANC: "BANC",
  TVA: "TVA",
  SOCO: "SOCO",
  DUK: "DUK",
  CPLE: "CPLE",
  FPL: "FPL",
  AZPS: "AZPS",
  SRP: "SRP",
  TEPC: "TEPC",
  PNM: "PNM",
  PSCO: "PSCO",
  NEVP: "NEVP",
  LDWP: "LDWP",
  PACE: "PACE",
  PACW: "PACW",
  IPCO: "IPCO",
  PSEI: "PSEI",
  AVA: "AVA",
  AECI: "AECI",
};

export function wattTimeRegionForBa(ba: string): string | null {
  return WATTTIME_REGIONS[ba.toUpperCase()] ?? null;
}

/**
 * Either a username/password pair (which we exchange for a token) or an
 * already-issued bearer token.
 *
 * WattTime's own portal hands out a raw bearer token, so accepting one directly
 * is a real convenience — but note it **expires 30 minutes after issue**, so a
 * token-only setup stops working almost immediately and degrades to our own
 * model. Username and password are what make this durable, because we can mint
 * a fresh token on every request.
 */
export interface WattTimeCredentials {
  username?: string;
  password?: string;
  /** A pre-issued bearer token. Short-lived; prefer username/password. */
  token?: string;
}

export interface WattTimeOptions {
  credentials?: WattTimeCredentials | null;
  /** Explicit WattTime region; otherwise derived from `ba`. */
  region?: string | null;
  ba?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  /** Forecast horizon in hours; WattTime caps this at 72. */
  horizonHours?: number;
}

export interface WattTimeSnapshot {
  /**
   * Marginal-emissions forecast, converted to gCO2/kWh and averaged to whole
   * hours. Marginal, not average — do not merge into the main series.
   */
  marginalForecast: ProviderForecastPoint[];
  /**
   * WattTime's own ranking of right now, re-expressed as 100 = cleanest so it
   * matches `IntensityPoint.cleanlinessPercentile`.
   */
  cleanlinessPercentile: number | null;
  /** The raw WattTime index (100 = dirtiest), kept for the attribution copy. */
  rawIndex: number | null;
  region: string | null;
  attribution: ProviderAttribution;
}

function attribution(
  used: boolean,
  detail?: string,
): ProviderAttribution {
  return {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    role: "Independent cleanliness ranking (marginal emissions)",
    used,
    detail,
  };
}

function basicAuthHeader(credentials: WattTimeCredentials): string {
  const raw = `${credentials.username ?? ""}:${credentials.password ?? ""}`;
  // Buffer in Node, btoa on the edge. Both exist somewhere; neither everywhere.
  if (typeof globalThis.btoa === "function") return `Basic ${globalThis.btoa(raw)}`;
  const maybeBuffer = (globalThis as { Buffer?: { from(input: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (maybeBuffer) return `Basic ${maybeBuffer.from(raw, "utf8").toString("base64")}`;
  throw new Error("No base64 encoder available");
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike | null {
  if (fetchImpl) return fetchImpl;
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis) as unknown as FetchLike;
  }
  return null;
}

/** Read a body without ever throwing — WattTime returns plain text on 401/403. */
async function readBody(response: FetchLikeResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    if (typeof response.text === "function") {
      try {
        return await response.text();
      } catch {
        return null;
      }
    }
    return null;
  }
}

function errorDetail(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim() !== "") return `HTTP ${status}: ${body.trim()}`;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    // The spec's schema says `message`; its own example says `msg`.
    const message =
      (typeof record.message === "string" && record.message) ||
      (typeof record.msg === "string" && record.msg) ||
      null;
    const error = typeof record.error === "string" ? record.error : null;
    if (error && message) return `${error}: ${message}`;
    if (message) return message;
    if (error) return error;
  }
  return `HTTP ${status}`;
}

export interface WattTimeLoginResult {
  token: string | null;
  detail: string;
}

/**
 * Is this JWT already past its expiry? Purely a courtesy check so we can give a
 * useful message; the API is still the authority.
 */
export function isExpiredJwt(token: string, now = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decode =
      typeof globalThis.atob === "function"
        ? globalThis.atob(json)
        : String(
            (
              globalThis as {
                Buffer?: { from(i: string, e: string): { toString(e: string): string } };
              }
            ).Buffer?.from(json, "base64").toString("utf8") ?? "",
          );
    const payload = JSON.parse(decode) as { exp?: number };
    if (typeof payload.exp !== "number") return false;
    return now >= payload.exp * 1000;
  } catch {
    // Not a JWT we can read — let the API decide.
    return false;
  }
}

/** Exchange basic-auth credentials for a 30-minute bearer token. */
export async function wattTimeLogin(options: {
  credentials: WattTimeCredentials;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): Promise<WattTimeLoginResult> {
  const doFetch = resolveFetch(options.fetchImpl);
  if (!doFetch) return { token: null, detail: "No fetch implementation available." };
  const url = `${options.baseUrl ?? WATTTIME_BASE_URL}/login`;
  let response: FetchLikeResponse;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(options.credentials) },
    });
  } catch (error) {
    return {
      token: null,
      detail: error instanceof Error ? error.message : "network error",
    };
  }
  const body = await readBody(response);
  if (!response.ok) {
    return { token: null, detail: errorDetail(body, response.status) };
  }
  const token =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).token === "string"
      ? ((body as Record<string, unknown>).token as string)
      : null;
  return token
    ? { token, detail: "Signed in." }
    : { token: null, detail: "Login succeeded but returned no token." };
}

interface V3Point {
  point_time?: unknown;
  value?: unknown;
}

function parsePoints(body: unknown): { ts: number; value: number }[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  const points: { ts: number; value: number }[] = [];
  for (const entry of data as V3Point[]) {
    if (!entry || typeof entry !== "object") continue;
    const time = typeof entry.point_time === "string" ? Date.parse(entry.point_time) : NaN;
    const value = typeof entry.value === "number" ? entry.value : Number(entry.value);
    if (Number.isNaN(time) || !Number.isFinite(value)) continue;
    points.push({ ts: time, value });
  }
  return points.sort((a, b) => a.ts - b.ts);
}

/**
 * Average 5-minute MOER points up to whole hours and convert to gCO2/kWh.
 * Our whole model is hourly, and a 5-minute resolution the user cannot act on
 * is just noise.
 */
export function hourlyFromMoerPoints(
  points: { ts: number; value: number }[],
): ProviderForecastPoint[] {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const point of points) {
    const hour = Math.floor(point.ts / 3_600_000) * 3_600_000;
    const bucket = buckets.get(hour) ?? { sum: 0, count: 0 };
    bucket.sum += point.value;
    bucket.count += 1;
    buckets.set(hour, bucket);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, bucket]) => ({
      ts: new Date(hour).toISOString(),
      gCO2PerKWh: (bucket.sum / bucket.count) * LBS_PER_MWH_TO_G_PER_KWH,
    }));
}

/**
 * Log in, then pull the MOER forecast and the current index. Never throws:
 * missing credentials, an unmapped region, an expired token and a 403 on an
 * unsubscribed region all return `null` data plus an honest attribution.
 */
export async function fetchWattTime(
  options: WattTimeOptions,
): Promise<WattTimeSnapshot> {
  const region =
    options.region ?? (options.ba ? wattTimeRegionForBa(options.ba) : null);
  const empty = (detail: string): WattTimeSnapshot => ({
    marginalForecast: [],
    cleanlinessPercentile: null,
    rawIndex: null,
    region,
    attribution: attribution(false, detail),
  });

  const credentials = options.credentials;
  const hasLogin = Boolean(credentials?.username && credentials?.password);
  const hasToken = Boolean(credentials?.token);
  if (!hasLogin && !hasToken) {
    return empty("No WATTTIME_USERNAME / WATTTIME_PASSWORD set.");
  }
  if (!region) {
    return empty(`No WattTime region mapped for ${options.ba ?? "this region"}.`);
  }
  const doFetch = resolveFetch(options.fetchImpl);
  if (!doFetch) return empty("No fetch implementation available.");
  const base = options.baseUrl ?? WATTTIME_BASE_URL;

  // A supplied token is used as-is; otherwise trade credentials for a fresh one.
  let token = credentials!.token ?? null;
  if (!token) {
    const login = await wattTimeLogin({
      credentials: credentials!,
      fetchImpl: doFetch,
      baseUrl: base,
    });
    if (!login.token) return empty(`Sign-in failed — ${login.detail}`);
    token = login.token;
  } else if (isExpiredJwt(token)) {
    // Fail with a message that names the actual problem rather than surfacing
    // an opaque 401 from the API.
    return empty(
      "The WattTime token has expired — they last 30 minutes. Set WATTTIME_USERNAME and WATTTIME_PASSWORD so a fresh one can be fetched automatically.",
    );
  }

  const headers = { Authorization: `Bearer ${token}` };
  const horizon = Math.min(72, Math.max(1, Math.floor(options.horizonHours ?? 72)));
  const query = `region=${encodeURIComponent(region)}&signal_type=co2_moer`;

  const request = async (path: string) => {
    try {
      const response = await doFetch(`${base}${path}`, { method: "GET", headers });
      const body = await readBody(response);
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: error instanceof Error ? error.message : "network error",
      };
    }
  };

  const [forecast, index] = await Promise.all([
    request(`/v3/forecast?${query}&horizon_hours=${horizon}`),
    request(`/v3/signal-index?${query}`),
  ]);

  const notes: string[] = [];
  let marginalForecast: ProviderForecastPoint[] = [];
  if (forecast.ok) {
    marginalForecast = hourlyFromMoerPoints(parsePoints(forecast.body));
    if (marginalForecast.length === 0) notes.push("forecast returned no points");
  } else {
    notes.push(`forecast: ${errorDetail(forecast.body, forecast.status)}`);
  }

  let rawIndex: number | null = null;
  if (index.ok) {
    const points = parsePoints(index.body);
    const latest = points[points.length - 1];
    if (latest && latest.value >= 0 && latest.value <= 100) rawIndex = latest.value;
    else notes.push("signal index returned no usable value");
  } else {
    notes.push(`signal index: ${errorDetail(index.body, index.status)}`);
  }

  const used = marginalForecast.length > 0 || rawIndex !== null;
  const parts: string[] = [];
  if (rawIndex !== null) {
    parts.push(`index ${Math.round(rawIndex)}/100 dirtiness`);
  }
  if (marginalForecast.length > 0) {
    parts.push(`${marginalForecast.length}h marginal forecast`);
  }
  if (notes.length > 0) parts.push(notes.join("; "));

  return {
    marginalForecast,
    // Invert: WattTime 100 = dirtiest, our percentile 100 = cleanest.
    cleanlinessPercentile: rawIndex === null ? null : Math.round(100 - rawIndex),
    rawIndex,
    region,
    attribution: attribution(used, `${region}: ${parts.join(" · ") || "no data returned"}`),
  };
}
