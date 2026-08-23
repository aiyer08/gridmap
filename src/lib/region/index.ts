/**
 * Location → grid region.
 *
 * Import from here. The submodules are free to move around underneath.
 *
 *   const { region, city, ok, reason } = await resolveRegionFromZip("94305");
 *   //  region.ba              -> "CISO"        (EIA-930 respondent code)
 *   //  region.shortName       -> "California grid (CAISO)"
 *   //  region.matchedBy       -> "state"       (how sure we are)
 *   //  parentRegionFor("CISO")-> "CAL"         (aggregate to fall back to)
 */

export {
  resolveRegionFromZip,
  resolveRegionFromZipSync,
  resolveRegionFromLatLon,
  listRegions,
  getRegionByBa,
  allBalancingAuthorities,
  haversineKm,
  DEFAULT_REGION,
  type RegionResolution,
  type ResolveOptions,
} from "./resolve";

export {
  BALANCING_AUTHORITIES,
  BA_METADATA,
  EIA_NATIONAL_AGGREGATE,
  EIA_REGION_AGGREGATES,
  KNOWN_BA_CODES,
  LOAD_SERVING_BAS,
  RETIRED_BA_SUCCESSORS,
  UNSUPPORTED_AREAS,
  getBalancingAuthority,
  isEiaRespondent,
  parentRegionFor,
  type BalancingAuthority,
  type EiaRegionCode,
  type UnsupportedArea,
} from "./balancingAuthorities";

export {
  STATE_PRIMARY_BA,
  STATE_TIMEZONES,
  ZIP3_BA_OVERRIDES,
  ZIP3_TIMEZONE_OVERRIDES,
  ZIP3_TO_STATE,
  ZIP5_BA_OVERRIDES,
  matchZipToBa,
  normaliseZip,
  stateForZip,
  timezoneForZip,
  type ZipBaMatch,
  type ZipMatchTier,
} from "./zipToBa";

export {
  clearGeocodeCache,
  formatPlace,
  geocodeZip,
  type GeocodeOptions,
  type GeocodeResult,
} from "./geocode";
