/**
 * The public region resolver. Everything else in `src/lib/region` is plumbing.
 *
 * Design rules, in priority order:
 *   1. Never throw at a homeowner. A typo returns `ok: false` and a sentence
 *      they can act on, not a stack trace.
 *   2. Never claim more precision than we have. `matchedBy` and `approximate`
 *      are load-bearing: the UI shows them in the "where does this come from"
 *      panel, and the whole app's credibility rests on them being honest.
 *   3. Stay synchronous. Only the optional city-name lookup touches the network,
 *      so `resolveRegionFromZipSync` exists for server components and tests.
 */

import type { RegionInfo } from "@/lib/types";
import {
  BALANCING_AUTHORITIES,
  BA_METADATA,
  LOAD_SERVING_BAS,
  RETIRED_BA_SUCCESSORS,
  UNSUPPORTED_AREAS,
  type BalancingAuthority,
} from "./balancingAuthorities";
import { formatPlace, geocodeZip, type GeocodeOptions } from "./geocode";
import { matchZipToBa, normaliseZip, stateForZip, timezoneForZip } from "./zipToBa";

export interface RegionResolution {
  region: RegionInfo;
  /** "Palo Alto", when the optional geocode succeeded. */
  city?: string;
  /** Two-letter state code we resolved, whether or not geocoding ran. */
  state?: string;
  /** The household's own coordinates, when geocoding succeeded. Not the BA's. */
  lat?: number;
  lon?: number;
  /** False when we could not give a real answer for this input. */
  ok: boolean;
  /** A sentence for the user. Present whenever `ok` is false. */
  reason?: string;
}

export interface ResolveOptions extends GeocodeOptions {
  /**
   * Set false to skip the city-name lookup entirely. Defaults to true, but the
   * result is identical either way apart from `city`, `lat` and `lon`.
   */
  geocode?: boolean;
}

/**
 * Where we land when we have nothing to go on. CAISO because it is the largest
 * single-state grid in the country, its data is complete, and its intraday
 * swing between solar noon and the evening gas ramp is the clearest possible
 * illustration of what this app is for.
 */
export const DEFAULT_REGION: RegionInfo = Object.freeze(
  toRegionInfo(BA_METADATA.CISO, {
    state: "CA",
    matchedBy: "default",
    approximate: true,
  }),
);

interface RegionInfoOverrides {
  state: string;
  matchedBy: RegionInfo["matchedBy"];
  approximate: boolean;
  timezone?: string;
}

/** Project a BA table row into the shared `RegionInfo` contract. */
function toRegionInfo(
  ba: BalancingAuthority,
  overrides: RegionInfoOverrides,
): RegionInfo {
  return {
    ba: ba.ba,
    name: ba.name,
    shortName: ba.shortName,
    // Prefer the ZIP's own timezone: several BAs span two of them.
    timezone: overrides.timezone ?? ba.timezone,
    state: overrides.state,
    electricityMapsZone: ba.electricityMapsZone,
    lat: ba.lat,
    lon: ba.lon,
    approximate: overrides.approximate,
    matchedBy: overrides.matchedBy,
  };
}

/**
 * A region for somewhere with no EIA-930 balancing authority at all (Hawaii,
 * Alaska, the territories, military mail).
 *
 * `ba` here is a state/territory code, *not* an EIA respondent — deliberately,
 * because it is far safer for a careless caller to query EIA for "HI" and get
 * zero rows than to query for "CISO" and render California's grid as Honolulu's.
 * Guard with `isEiaRespondent()` if you need to be sure.
 */
function unsupportedRegion(code: string): RegionInfo {
  const area = UNSUPPORTED_AREAS[code];
  return {
    ba: area.code,
    name: `${area.label} (no EIA-930 balancing authority)`,
    shortName: area.label,
    timezone: area.timezone,
    state: area.code,
    electricityMapsZone: area.electricityMapsZone,
    approximate: true,
    matchedBy: "state",
  };
}

/**
 * Resolve a ZIP to a grid region without touching the network.
 *
 * Returns `ok: false` for anything we cannot answer honestly: a malformed ZIP,
 * an unassigned prefix, or an area outside EIA-930's coverage. In all those
 * cases `region` is still populated so the UI has something to render, but the
 * caller must respect `ok` before fetching grid data.
 */
export function resolveRegionFromZipSync(zip: string): RegionResolution {
  const normalised = normaliseZip(zip);
  if (!normalised) {
    return {
      region: DEFAULT_REGION,
      ok: false,
      reason:
        "That doesn't look like a US ZIP code. Try five digits, like 94305.",
    };
  }

  const state = stateForZip(normalised);
  if (!state) {
    return {
      region: DEFAULT_REGION,
      ok: false,
      reason: `We don't recognise ZIP ${normalised}. Double-check the digits, or pick your grid from the list.`,
    };
  }

  if (state in UNSUPPORTED_AREAS) {
    return {
      region: unsupportedRegion(state),
      state,
      ok: false,
      reason: UNSUPPORTED_AREAS[state].reason,
    };
  }

  const match = matchZipToBa(normalised);
  if (!match) {
    // Belt and braces: a state in the ZIP3 table with no BA mapping is a bug,
    // and a test asserts it can't happen. Fall back rather than crash.
    return {
      region: { ...DEFAULT_REGION, state, timezone: timezoneForZip(normalised, state) },
      state,
      ok: false,
      reason: `We couldn't work out which grid serves ZIP ${normalised}. Pick your grid from the list and we'll remember it.`,
    };
  }

  const ba = BA_METADATA[match.ba];
  return {
    region: toRegionInfo(ba, {
      state: match.state,
      timezone: match.timezone,
      matchedBy: match.matchedBy,
      // A hand-checked ZIP5 entry is the only tier we call exact.
      approximate: match.matchedBy !== "zip",
    }),
    state: match.state,
    ok: true,
  };
}

/**
 * Resolve a ZIP, and enrich it with a city name and coordinates when the free
 * geocoder cooperates. The region itself is identical to the sync version — the
 * network call can only add the friendly label, never change the grid.
 */
export async function resolveRegionFromZip(
  zip: string,
  options: ResolveOptions = {},
): Promise<RegionResolution> {
  const base = resolveRegionFromZipSync(zip);
  if (options.geocode === false) return base;

  const normalised = normaliseZip(zip);
  if (!normalised) return base;

  const place = await geocodeZip(normalised, options);
  if (!place) return base;

  return {
    ...base,
    city: place.city,
    // Trust the geocoder's state over our prefix table when they disagree: it
    // knows about individual ZIPs, we only know about prefixes.
    state: place.state ?? base.state,
    lat: place.lat,
    lon: place.lon,
  };
}

/** Great-circle distance in kilometres. Exported because the tests check it. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Nearest load-serving BA by centroid distance.
 *
 * This is genuinely coarse — a BA centroid is a single point standing in for a
 * territory that can be the size of Texas — so the result is always
 * `approximate: true` and `matchedBy: "state"`. It is not `"manual"`, which we
 * reserve for a region the user picked themselves, and not `"zip"`, which would
 * imply a precision we don't have.
 */
export function resolveRegionFromLatLon(lat: number, lon: number): RegionInfo {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return DEFAULT_REGION;

  let best = BA_METADATA.CISO;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of LOAD_SERVING_BAS) {
    const distance = haversineKm(lat, lon, candidate.lat, candidate.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return toRegionInfo(best, {
    state: best.states[0],
    matchedBy: "state",
    approximate: true,
  });
}

/**
 * Every region a user can pick by hand, for the "not your grid? choose it"
 * dropdown. Sorted by the label we show, so the list reads alphabetically.
 * Generation-only BAs are excluded: nobody's meter is on a federal hydro
 * marketing agency.
 */
export function listRegions(): RegionInfo[] {
  return LOAD_SERVING_BAS.map((ba) =>
    toRegionInfo(ba, {
      state: ba.states[0],
      matchedBy: "manual",
      // The user told us. That's as exact as this gets.
      approximate: false,
    }),
  ).sort((a, b) => a.shortName.localeCompare(b.shortName));
}

/**
 * Look up a region by BA code, for restoring a saved preference or a URL param.
 * Retired codes redirect to whoever took over the load, so an old bookmark
 * keeps working instead of silently returning nothing.
 */
export function getRegionByBa(ba: string): RegionInfo | undefined {
  const code = ba.trim().toUpperCase();
  const resolved = BA_METADATA[code] ?? BA_METADATA[RETIRED_BA_SUCCESSORS[code]];
  if (!resolved) return undefined;
  return toRegionInfo(resolved, {
    state: resolved.states[0],
    matchedBy: "manual",
    // True when we silently swapped a retired code for its successor.
    approximate: resolved.ba !== code,
  });
}

/** Every BA in the table, including generation-only ones. Mostly for tests. */
export function allBalancingAuthorities(): BalancingAuthority[] {
  return BALANCING_AUTHORITIES;
}
