/**
 * Optional ZIP → city / lat-lon enrichment.
 *
 * Purely cosmetic-plus: the region resolver never needs this to work, but
 * "Palo Alto, CA" reads a lot warmer than "94305", and a lat/lon lets us sanity
 * check the BA we picked. So every failure path here is a silent skip — a flaky
 * network must never stop a homeowner from seeing their grid.
 *
 * We use api.zippopotam.us because it is free, needs no key, needs no attribution
 * banner, and answers in one round trip:
 *
 *   GET https://api.zippopotam.us/us/94305
 *   { "post code": "94305", "places": [ { "place name": "Stanford",
 *     "state abbreviation": "CA", "latitude": "37.4236", "longitude": "-122.1619" } ] }
 *
 * An unknown ZIP returns 404, which we treat as "no extra detail", not an error.
 */

/** What the caller actually gets. Every field is optional on purpose. */
export interface GeocodeResult {
  zip: string;
  city?: string;
  /** Two-letter state code as reported by the geocoder, for cross-checking. */
  state?: string;
  lat?: number;
  lon?: number;
}

export interface GeocodeOptions {
  /** Injected in tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
  /** Milliseconds before we give up. Kept short: this is a nice-to-have. */
  timeoutMs?: number;
  /** Set false to bypass the cache (tests, or a forced refresh). */
  useCache?: boolean;
}

const DEFAULT_TIMEOUT_MS = 2500;

/**
 * Process-lifetime cache. ZIP centroids do not move, so there is no TTL, and a
 * few hundred entries of three small fields is not worth an eviction policy.
 * `null` is cached too, so a bad ZIP is only ever looked up once.
 */
const cache = new Map<string, GeocodeResult | null>();

/** Exposed for tests; also handy if a long-running server wants to reclaim it. */
export function clearGeocodeCache(): void {
  cache.clear();
}

interface ZippopotamPlace {
  "place name"?: unknown;
  "state abbreviation"?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

interface ZippopotamResponse {
  places?: unknown;
}

function parseCoordinate(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Look up a ZIP's city and centroid. Resolves to `null` on any problem at all —
 * bad input, 404, timeout, offline, malformed JSON. Never throws, never rejects.
 */
export async function geocodeZip(
  zip: string,
  options: GeocodeOptions = {},
): Promise<GeocodeResult | null> {
  if (!/^\d{5}$/.test(zip)) return null;

  const useCache = options.useCache !== false;
  if (useCache && cache.has(zip)) return cache.get(zip) ?? null;

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let result: GeocodeResult | null = null;
  try {
    const response = await fetchImpl(`https://api.zippopotam.us/us/${zip}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      const body = (await response.json()) as ZippopotamResponse;
      const places = Array.isArray(body.places) ? body.places : [];
      const place = places[0] as ZippopotamPlace | undefined;
      if (place) {
        result = {
          zip,
          city: parseString(place["place name"]),
          state: parseString(place["state abbreviation"]),
          lat: parseCoordinate(place.latitude),
          lon: parseCoordinate(place.longitude),
        };
      }
    }
  } catch {
    // Abort, DNS failure, offline, bad JSON — all mean the same thing to us.
    result = null;
  } finally {
    clearTimeout(timer);
  }

  if (useCache) cache.set(zip, result);
  return result;
}

/** "Palo Alto, CA", or undefined when we have nothing worth showing. */
export function formatPlace(result: GeocodeResult | null | undefined): string | undefined {
  if (!result?.city) return undefined;
  return result.state ? `${result.city}, ${result.state}` : result.city;
}
