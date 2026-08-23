/**
 * The US balancing authorities (BAs) GridMap knows about.
 *
 * Carbon intensity is a property of the *grid*, not the house, so everything
 * downstream keys off an EIA-930 respondent code. Getting a code wrong is worse
 * than admitting we don't know: the EIA call silently returns zero rows and the
 * user sees a modelled number dressed up as a measurement.
 *
 * SOURCES (verified 2026-08-23)
 * - EIA-930 balancing-authority list, incl. official names, EIA region grouping,
 *   activation/retirement dates:
 *   https://www.eia.gov/electricity/930-content/EIA930_Reference_Tables.xlsx  ("BAs" sheet)
 * - Live respondent codes actually queryable today, cross-checked against
 *   https://api.eia.gov/v2/electricity/rto/fuel-type-data/facet/respondent/ and
 *   a 48-hour data pull (2026-08-18 → 2026-08-20). Exactly the 60 BAs below
 *   returned rows; WACM and WAUW returned none.
 * - Electricity Maps zone keys from the public zone list:
 *   https://api.electricitymap.org/v3/zones  (58 US BA-level zones)
 *
 * THINGS THAT BIT US, WRITTEN DOWN SO THEY DON'T AGAIN
 * - EIA retired WACM (WAPA Rocky Mountain) and WAUW (WAPA Upper Great Plains
 *   West) on 2026-04-01 when SPP's RTO West went live. Their load now reports
 *   under SWPW. Both old codes still accept historical queries, which makes them
 *   look alive; they have no recent data. We never resolve a household to them.
 * - BHBA (Black Hills Energy) and SWPW both activated 2026-04-01, so they have
 *   months rather than years of history. Neither has an Electricity Maps zone
 *   yet. `parentRegion` exists so the grid engine can fall back to the regional
 *   aggregate instead of inventing numbers.
 * - Dominion Energy South Carolina still reports as SCEG (not DESC).
 * - Duke Energy Florida is FPC, Duke Energy Progress East/West are CPLE/CPLW,
 *   Duke Energy Carolinas is DUK. Three different Dukes, three different grids.
 * - PowerSouth (AEC) folded into SOCO in 2021; Gulf Power folded into FPL in
 *   2021. Neither has its own code any more.
 * - `timezone` here is the timezone of the BA's main service territory, i.e. the
 *   clock a customer reads — *not* EIA's reporting timezone, which differs for
 *   PNM, EPE and IPCO. The resolver overrides this with the ZIP's own timezone
 *   whenever it knows the state, because a BA can straddle two zones.
 */

/** The 13 EIA-930 regional aggregates plus the national roll-up. */
export type EiaRegionCode =
  | "CAL"
  | "CAR"
  | "CENT"
  | "FLA"
  | "MIDA"
  | "MIDW"
  | "NE"
  | "NW"
  | "NY"
  | "SE"
  | "SW"
  | "TEN"
  | "TEX";

/**
 * EIA-930 aggregates. These are valid `respondent` values but they are *not*
 * balancing authorities, so they are never offered as a user's region. They are
 * useful as a fallback for small BAs whose fuel-type reporting is sparse.
 */
export const EIA_REGION_AGGREGATES: Record<EiaRegionCode, string> = {
  CAL: "California",
  CAR: "Carolinas",
  CENT: "Central",
  FLA: "Florida",
  MIDA: "Mid-Atlantic",
  MIDW: "Midwest",
  NE: "New England",
  NW: "Northwest",
  NY: "New York",
  SE: "Southeast",
  SW: "Southwest",
  TEN: "Tennessee",
  TEX: "Texas",
};

/** The national roll-up. Separate from the 13 regions because it is not one. */
export const EIA_NATIONAL_AGGREGATE = "US48";

export interface BalancingAuthority {
  /** EIA-930 respondent code, e.g. "CISO". The join key for everything. */
  ba: string;
  /** Official EIA-930 name. */
  name: string;
  /** What we actually show a homeowner. Recognisable beats correct here. */
  shortName: string;
  /** IANA timezone of the BA's main service territory. */
  timezone: string;
  /** Electricity Maps zone key, when one exists. */
  electricityMapsZone?: string;
  /** EIA-930 regional aggregate, for fallback when a BA reports thin data. */
  parentRegion: EiaRegionCode;
  /** States with meaningful load on this BA, most significant first. */
  states: string[];
  /** Rough centroid of the service territory, for nearest-region lookups. */
  lat: number;
  lon: number;
  /**
   * True for BAs that report generation but serve no retail customers (federal
   * hydro marketing agencies, merchant plants, wind aggregators). No household
   * lives on one, so they never appear in ZIP results or the manual picker.
   */
  generationOnly?: boolean;
  /** Why this entry is awkward, surfaced in the "where does this come from" panel. */
  note?: string;
}

/**
 * The 60 EIA-930 respondents that returned hourly fuel-type data in the
 * 2026-08-18 → 2026-08-20 verification pull, sorted by code.
 */
export const BALANCING_AUTHORITIES: BalancingAuthority[] = [
  {
    ba: "AECI",
    name: "Associated Electric Cooperative, Inc.",
    shortName: "Missouri co-op grid (AECI)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-MIDW-AECI",
    parentRegion: "MIDW",
    states: ["MO", "IA", "OK"],
    lat: 37.2,
    lon: -93.3,
  },
  {
    ba: "AVA",
    name: "Avista Corporation",
    shortName: "Spokane / Inland Northwest grid (Avista)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-AVA",
    parentRegion: "NW",
    states: ["WA", "ID", "MT"],
    lat: 47.66,
    lon: -117.43,
  },
  {
    ba: "AVRN",
    name: "Avangrid Renewables, LLC",
    shortName: "Avangrid Renewables (wind only)",
    timezone: "America/Los_Angeles",
    parentRegion: "NW",
    states: ["OR", "WA"],
    lat: 45.7,
    lon: -120.0,
    generationOnly: true,
  },
  {
    ba: "AZPS",
    name: "Arizona Public Service Company",
    shortName: "Arizona grid (APS)",
    timezone: "America/Phoenix",
    electricityMapsZone: "US-SW-AZPS",
    parentRegion: "SW",
    states: ["AZ"],
    lat: 33.45,
    lon: -112.07,
  },
  {
    ba: "BANC",
    name: "Balancing Authority of Northern California",
    shortName: "Sacramento area grid (SMUD / BANC)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-CAL-BANC",
    parentRegion: "CAL",
    states: ["CA"],
    lat: 38.58,
    lon: -121.49,
    note: "SMUD plus Modesto, Roseville, Redding and Shasta Lake municipal utilities.",
  },
  {
    ba: "BHBA",
    name: "Black Hills Energy",
    shortName: "Black Hills grid (Rapid City / Cheyenne / Pueblo)",
    timezone: "America/Denver",
    parentRegion: "NW",
    states: ["SD", "WY", "CO"],
    lat: 44.08,
    lon: -103.23,
    note: "Became its own EIA-930 respondent on 2026-04-01, so history is short.",
  },
  {
    ba: "BPAT",
    name: "Bonneville Power Administration",
    shortName: "Pacific Northwest grid (BPA)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-BPAT",
    parentRegion: "NW",
    states: ["WA", "OR", "ID", "MT", "WY"],
    lat: 45.9,
    lon: -120.5,
    note: "Federal hydro plus the public utility districts and co-ops it serves.",
  },
  {
    ba: "CHPD",
    name: "Public Utility District No. 1 of Chelan County",
    shortName: "Wenatchee area grid (Chelan PUD)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-CHPD",
    parentRegion: "NW",
    states: ["WA"],
    lat: 47.42,
    lon: -120.31,
  },
  {
    ba: "CISO",
    name: "California Independent System Operator",
    shortName: "California grid (CAISO)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-CAL-CISO",
    parentRegion: "CAL",
    states: ["CA"],
    lat: 36.7,
    lon: -119.8,
    note: "PG&E, SCE and SDG&E, i.e. most of California but not LA or Sacramento.",
  },
  {
    ba: "CPLE",
    name: "Duke Energy Progress East",
    shortName: "Eastern Carolinas grid (Duke Progress East)",
    timezone: "America/New_York",
    electricityMapsZone: "US-CAR-CPLE",
    parentRegion: "CAR",
    states: ["NC", "SC"],
    lat: 35.6,
    lon: -78.4,
  },
  {
    ba: "CPLW",
    name: "Duke Energy Progress West",
    shortName: "Western NC mountains grid (Duke Progress West)",
    timezone: "America/New_York",
    electricityMapsZone: "US-CAR-CPLW",
    parentRegion: "CAR",
    states: ["NC"],
    lat: 35.6,
    lon: -82.6,
  },
  {
    ba: "DEAA",
    name: "Arlington Valley, LLC",
    shortName: "Arlington Valley plant (generation only)",
    timezone: "America/Phoenix",
    parentRegion: "SW",
    states: ["AZ"],
    lat: 33.35,
    lon: -112.86,
    generationOnly: true,
  },
  {
    ba: "DOPD",
    name: "PUD No. 1 of Douglas County",
    shortName: "Douglas County grid (Douglas PUD)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-DOPD",
    parentRegion: "NW",
    states: ["WA"],
    lat: 47.99,
    lon: -119.65,
  },
  {
    ba: "DUK",
    name: "Duke Energy Carolinas",
    shortName: "Charlotte / Piedmont grid (Duke Carolinas)",
    timezone: "America/New_York",
    electricityMapsZone: "US-CAR-DUK",
    parentRegion: "CAR",
    states: ["NC", "SC"],
    lat: 35.4,
    lon: -80.9,
  },
  {
    ba: "EPE",
    name: "El Paso Electric Company",
    shortName: "El Paso / Las Cruces grid (EPE)",
    timezone: "America/Denver",
    electricityMapsZone: "US-SW-EPE",
    parentRegion: "SW",
    states: ["TX", "NM"],
    lat: 31.76,
    lon: -106.49,
    note: "West Texas and southern New Mexico. Not part of ERCOT.",
  },
  {
    ba: "ERCO",
    name: "Electric Reliability Council of Texas, Inc.",
    shortName: "Texas grid (ERCOT)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-TEX-ERCO",
    parentRegion: "TEX",
    states: ["TX"],
    lat: 31.0,
    lon: -97.5,
    note: "About 90% of Texas load, but not El Paso, the Panhandle or Beaumont.",
  },
  {
    ba: "FMPP",
    name: "Florida Municipal Power Pool",
    shortName: "Orlando area municipal grid (FMPP)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-FMPP",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 28.5,
    lon: -81.4,
    note: "Orlando Utilities Commission, Kissimmee and Lakeland municipal utilities.",
  },
  {
    ba: "FPC",
    name: "Duke Energy Florida, Inc.",
    shortName: "Central Florida grid (Duke Energy Florida)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-FPC",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 28.4,
    lon: -82.3,
  },
  {
    ba: "FPL",
    name: "Florida Power & Light Co.",
    shortName: "Florida grid (FPL)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-FPL",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 27.3,
    lon: -80.6,
    note: "Absorbed Gulf Power in 2021, so it now covers the Panhandle too.",
  },
  {
    ba: "GCPD",
    name: "Public Utility District No. 2 of Grant County, Washington",
    shortName: "Grant County grid (Grant PUD)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-GCPD",
    parentRegion: "NW",
    states: ["WA"],
    lat: 47.13,
    lon: -119.28,
  },
  {
    ba: "GRID",
    name: "Gridforce Energy Management, LLC",
    shortName: "Gridforce Energy Management (generation only)",
    timezone: "America/Los_Angeles",
    parentRegion: "NW",
    states: ["OR", "NV"],
    lat: 44.5,
    lon: -119.0,
    generationOnly: true,
  },
  {
    ba: "GVL",
    name: "Gainesville Regional Utilities",
    shortName: "Gainesville grid (GRU)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-GVL",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 29.65,
    lon: -82.32,
  },
  {
    ba: "GWA",
    name: "NaturEner Power Watch, LLC",
    shortName: "NaturEner Power Watch (wind only)",
    timezone: "America/Denver",
    parentRegion: "NW",
    states: ["MT"],
    lat: 48.5,
    lon: -111.5,
    generationOnly: true,
  },
  {
    ba: "HST",
    name: "City of Homestead",
    shortName: "Homestead grid (City of Homestead)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-HST",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 25.47,
    lon: -80.48,
  },
  {
    ba: "IID",
    name: "Imperial Irrigation District",
    shortName: "Imperial Valley / Coachella grid (IID)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-CAL-IID",
    parentRegion: "CAL",
    states: ["CA"],
    lat: 32.79,
    lon: -115.56,
    note: "A gas-heavy island inside otherwise-renewable southern California.",
  },
  {
    ba: "IPCO",
    name: "Idaho Power Company",
    shortName: "Southern Idaho grid (Idaho Power)",
    timezone: "America/Boise",
    electricityMapsZone: "US-NW-IPCO",
    parentRegion: "NW",
    states: ["ID", "OR"],
    lat: 43.6,
    lon: -116.2,
  },
  {
    ba: "ISNE",
    name: "ISO New England",
    shortName: "New England grid (ISO-NE)",
    timezone: "America/New_York",
    electricityMapsZone: "US-NE-ISNE",
    parentRegion: "NE",
    states: ["MA", "CT", "NH", "ME", "RI", "VT"],
    lat: 42.4,
    lon: -71.6,
  },
  {
    ba: "JEA",
    name: "JEA",
    shortName: "Jacksonville grid (JEA)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-JEA",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 30.33,
    lon: -81.66,
  },
  {
    ba: "LDWP",
    name: "Los Angeles Department of Water and Power",
    shortName: "Los Angeles city grid (LADWP)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-CAL-LDWP",
    parentRegion: "CAL",
    states: ["CA"],
    lat: 34.05,
    lon: -118.25,
    note: "City of LA plus Burbank and Glendale. Separate from CAISO and dirtier.",
  },
  {
    ba: "LGEE",
    name: "Louisville Gas and Electric Company and Kentucky Utilities Company",
    shortName: "Central Kentucky grid (LG&E / KU)",
    timezone: "America/New_York",
    electricityMapsZone: "US-MIDW-LGEE",
    parentRegion: "MIDW",
    states: ["KY", "VA"],
    lat: 38.25,
    lon: -85.76,
  },
  {
    ba: "MISO",
    name: "Midcontinent Independent System Operator, Inc.",
    shortName: "Midwest grid (MISO)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-MIDW-MISO",
    parentRegion: "MIDW",
    states: [
      "MI",
      "MN",
      "WI",
      "IA",
      "IL",
      "IN",
      "MO",
      "LA",
      "AR",
      "MS",
      "ND",
      "SD",
      "TX",
      "KY",
      "MT",
    ],
    lat: 41.5,
    lon: -91.5,
    note: "Minnesota to Louisiana. A single average hides a lot of local variation.",
  },
  {
    ba: "NEVP",
    name: "Nevada Power Company",
    shortName: "Nevada grid (NV Energy)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-NEVP",
    parentRegion: "NW",
    states: ["NV"],
    lat: 36.17,
    lon: -115.14,
    note: "NV Energy merged its northern and southern balancing areas; NEVP is both.",
  },
  {
    ba: "NWMT",
    name: "NorthWestern Corporation",
    shortName: "Montana grid (NorthWestern Energy)",
    timezone: "America/Denver",
    electricityMapsZone: "US-NW-NWMT",
    parentRegion: "NW",
    states: ["MT", "SD", "NE"],
    lat: 46.6,
    lon: -111.5,
  },
  {
    ba: "NYIS",
    name: "New York Independent System Operator",
    shortName: "New York grid (NYISO)",
    timezone: "America/New_York",
    electricityMapsZone: "US-NY-NYIS",
    parentRegion: "NY",
    states: ["NY"],
    lat: 42.9,
    lon: -75.5,
  },
  {
    ba: "PACE",
    name: "PacifiCorp East",
    shortName: "Utah / Wyoming grid (Rocky Mountain Power)",
    timezone: "America/Denver",
    electricityMapsZone: "US-NW-PACE",
    parentRegion: "NW",
    states: ["UT", "WY", "ID"],
    lat: 40.76,
    lon: -111.89,
  },
  {
    ba: "PACW",
    name: "PacifiCorp West",
    shortName: "Southern Oregon grid (Pacific Power)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-PACW",
    parentRegion: "NW",
    states: ["OR", "WA", "CA"],
    lat: 44.0,
    lon: -122.5,
  },
  {
    ba: "PGE",
    name: "Portland General Electric Company",
    shortName: "Portland grid (PGE)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-PGE",
    parentRegion: "NW",
    states: ["OR"],
    lat: 45.52,
    lon: -122.68,
    note: "Portland General Electric, not Pacific Gas & Electric.",
  },
  {
    ba: "PJM",
    name: "PJM Interconnection, LLC",
    shortName: "Mid-Atlantic grid (PJM)",
    timezone: "America/New_York",
    electricityMapsZone: "US-MIDA-PJM",
    parentRegion: "MIDA",
    states: [
      "PA",
      "NJ",
      "OH",
      "VA",
      "MD",
      "IL",
      "WV",
      "NC",
      "DE",
      "DC",
      "IN",
      "MI",
      "KY",
      "TN",
    ],
    lat: 39.9,
    lon: -78.5,
    note: "Chicago to Virginia. Biggest market in the country by load.",
  },
  {
    ba: "PNM",
    name: "Public Service Company of New Mexico",
    shortName: "New Mexico grid (PNM)",
    timezone: "America/Denver",
    electricityMapsZone: "US-SW-PNM",
    parentRegion: "SW",
    states: ["NM"],
    lat: 35.08,
    lon: -106.65,
  },
  {
    ba: "PSCO",
    name: "Public Service Company of Colorado",
    shortName: "Colorado Front Range grid (Xcel)",
    timezone: "America/Denver",
    electricityMapsZone: "US-NW-PSCO",
    parentRegion: "NW",
    states: ["CO"],
    lat: 39.74,
    lon: -104.99,
  },
  {
    ba: "PSEI",
    name: "Puget Sound Energy, Inc.",
    shortName: "Puget Sound grid (PSE)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-PSEI",
    parentRegion: "NW",
    states: ["WA"],
    lat: 47.6,
    lon: -122.2,
  },
  {
    ba: "SC",
    name: "South Carolina Public Service Authority",
    shortName: "Santee Cooper grid (South Carolina)",
    timezone: "America/New_York",
    electricityMapsZone: "US-CAR-SC",
    parentRegion: "CAR",
    states: ["SC"],
    lat: 33.4,
    lon: -79.9,
  },
  {
    ba: "SCEG",
    name: "Dominion Energy South Carolina, Inc.",
    shortName: "Columbia / Charleston grid (Dominion SC)",
    timezone: "America/New_York",
    electricityMapsZone: "US-CAR-SCEG",
    parentRegion: "CAR",
    states: ["SC"],
    lat: 33.99,
    lon: -81.03,
    note: "Renamed from SCE&G, but EIA still reports it as SCEG.",
  },
  {
    ba: "SCL",
    name: "Seattle City Light",
    shortName: "Seattle city grid (Seattle City Light)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-SCL",
    parentRegion: "NW",
    states: ["WA"],
    lat: 47.61,
    lon: -122.33,
    note: "Almost entirely hydro, so one of the cleanest grids in the country.",
  },
  {
    ba: "SEC",
    name: "Seminole Electric Cooperative",
    shortName: "Florida co-op grid (Seminole Electric)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-SEC",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 28.8,
    lon: -81.6,
  },
  {
    ba: "SEPA",
    name: "Southeastern Power Administration",
    shortName: "Southeastern Power Administration (federal hydro only)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-SE-SEPA",
    parentRegion: "SE",
    states: ["GA", "AL", "SC", "NC", "TN", "VA", "WV", "KY", "MS", "FL"],
    lat: 34.0,
    lon: -84.0,
    generationOnly: true,
    note: "Markets federal dam output to other utilities. Nobody's meter is on it.",
  },
  {
    ba: "SIKE",
    name: "Sikeston Board Of Municipal Utilities",
    shortName: "Sikeston plant (generation only)",
    timezone: "America/Chicago",
    parentRegion: "MIDW",
    states: ["MO"],
    lat: 36.88,
    lon: -89.59,
    generationOnly: true,
  },
  {
    ba: "SOCO",
    name: "Southern Company Services, Inc. - Trans",
    shortName: "Georgia / Alabama grid (Southern Company)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-SE-SOCO",
    parentRegion: "SE",
    states: ["GA", "AL", "MS", "FL"],
    lat: 32.8,
    lon: -85.5,
    note: "Georgia Power, Alabama Power and Mississippi Power. Absorbed PowerSouth in 2021.",
  },
  {
    ba: "SPA",
    name: "Southwestern Power Administration",
    shortName: "Southwestern Power Administration (federal hydro)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-CENT-SPA",
    parentRegion: "CENT",
    states: ["AR", "OK", "MO", "TX", "LA", "KS"],
    lat: 36.15,
    lon: -95.99,
    generationOnly: true,
    note: "Markets Army Corps dam output. Retail load sits on SWPP or MISO instead.",
  },
  {
    ba: "SRP",
    name: "Salt River Project Agricultural Improvement and Power District",
    shortName: "Phoenix east valley grid (SRP)",
    timezone: "America/Phoenix",
    electricityMapsZone: "US-SW-SRP",
    parentRegion: "SW",
    states: ["AZ"],
    lat: 33.42,
    lon: -111.83,
    note: "Mesa, Tempe, Scottsdale and Chandler. Interleaved block-by-block with APS.",
  },
  {
    ba: "SWPP",
    name: "Southwest Power Pool",
    shortName: "Great Plains grid (SPP)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-CENT-SWPP",
    parentRegion: "CENT",
    states: [
      "KS",
      "OK",
      "NE",
      "SD",
      "ND",
      "MO",
      "AR",
      "TX",
      "LA",
      "NM",
      "MN",
      "IA",
    ],
    lat: 37.7,
    lon: -97.3,
    note: "Very wind-heavy, so its cleanest hours are windy nights, not sunny days.",
  },
  {
    ba: "SWPW",
    name: "Southwest Power Pool West Balancing Authority Area",
    shortName: "Rocky Mountain grid (SPP West)",
    timezone: "America/Denver",
    parentRegion: "NW",
    states: ["CO", "WY", "MT", "ND", "SD", "NE"],
    lat: 43.0,
    lon: -105.0,
    note: "Took over WACM and WAUW on 2026-04-01, so history starts there. No Electricity Maps zone yet.",
  },
  {
    ba: "TAL",
    name: "City of Tallahassee",
    shortName: "Tallahassee grid (City of Tallahassee)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-TAL",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 30.44,
    lon: -84.28,
  },
  {
    ba: "TEC",
    name: "Tampa Electric Company",
    shortName: "Tampa grid (TECO)",
    timezone: "America/New_York",
    electricityMapsZone: "US-FLA-TEC",
    parentRegion: "FLA",
    states: ["FL"],
    lat: 27.95,
    lon: -82.46,
  },
  {
    ba: "TEPC",
    name: "Tucson Electric Power",
    shortName: "Tucson grid (TEP)",
    timezone: "America/Phoenix",
    electricityMapsZone: "US-SW-TEPC",
    parentRegion: "SW",
    states: ["AZ"],
    lat: 32.22,
    lon: -110.97,
  },
  {
    ba: "TIDC",
    name: "Turlock Irrigation District",
    shortName: "Turlock area grid (TID)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-CAL-TIDC",
    parentRegion: "CAL",
    states: ["CA"],
    lat: 37.49,
    lon: -120.85,
  },
  {
    ba: "TPWR",
    name: "City of Tacoma, Department of Public Utilities, Light Division",
    shortName: "Tacoma grid (Tacoma Power)",
    timezone: "America/Los_Angeles",
    electricityMapsZone: "US-NW-TPWR",
    parentRegion: "NW",
    states: ["WA"],
    lat: 47.25,
    lon: -122.44,
  },
  {
    ba: "TVA",
    name: "Tennessee Valley Authority",
    shortName: "Tennessee Valley grid (TVA)",
    timezone: "America/Chicago",
    electricityMapsZone: "US-TEN-TVA",
    parentRegion: "TEN",
    states: ["TN", "AL", "MS", "KY", "GA", "NC", "VA"],
    lat: 35.5,
    lon: -86.5,
    note: "All of Tennessee plus northern Alabama and Mississippi and western Kentucky.",
  },
  {
    ba: "WALC",
    name: "Western Area Power Administration - Desert Southwest Region",
    shortName: "Lower Colorado River grid (WAPA Desert Southwest)",
    timezone: "America/Phoenix",
    electricityMapsZone: "US-SW-WALC",
    parentRegion: "SW",
    states: ["AZ", "NM", "CA", "NV"],
    lat: 33.5,
    lon: -113.5,
    note: "Hoover and Parker-Davis hydro plus the Navajo Nation and Mohave County.",
  },
  {
    ba: "YAD",
    name: "Alcoa Power Generating, Inc. - Yadkin Division",
    shortName: "Yadkin hydro (generation only)",
    timezone: "America/New_York",
    electricityMapsZone: "US-CAR-YAD",
    parentRegion: "CAR",
    states: ["NC"],
    lat: 35.5,
    lon: -80.4,
    generationOnly: true,
  },
];

/** Lookup by respondent code. */
export const BA_METADATA: Record<string, BalancingAuthority> = Object.fromEntries(
  BALANCING_AUTHORITIES.map((ba) => [ba.ba, ba]),
);

/** Every code we will ever put in `RegionInfo.ba`, for cheap validation. */
export const KNOWN_BA_CODES: ReadonlySet<string> = new Set(
  BALANCING_AUTHORITIES.map((ba) => ba.ba),
);

/** BAs a household can actually be resolved to (i.e. they serve retail load). */
export const LOAD_SERVING_BAS: BalancingAuthority[] = BALANCING_AUTHORITIES.filter(
  (ba) => !ba.generationOnly,
);

export function getBalancingAuthority(ba: string): BalancingAuthority | undefined {
  return BA_METADATA[ba.toUpperCase()];
}

/**
 * The EIA-930 regional aggregate a BA rolls up into, so a caller can retry a
 * thin BA (GVL, HST, SIKE, BHBA, SWPW…) against real regional data instead of
 * falling all the way back to a synthetic model.
 */
export function parentRegionFor(ba: string): EiaRegionCode | undefined {
  return BA_METADATA[ba.toUpperCase()]?.parentRegion;
}

/**
 * True when `code` is something the EIA v2 `respondent` facet will accept.
 * Aggregates count: they are queryable, just not balancing authorities.
 */
export function isEiaRespondent(code: string): boolean {
  const upper = code.toUpperCase();
  return (
    KNOWN_BA_CODES.has(upper) ||
    upper === EIA_NATIONAL_AGGREGATE ||
    upper in EIA_REGION_AGGREGATES ||
    upper in RETIRED_BA_SUCCESSORS
  );
}

/**
 * Codes EIA has retired, mapped to whoever picked up the load. Old bookmarks and
 * saved preferences shouldn't break, and these codes still answer historical
 * queries, so they look alive until you ask for recent data.
 */
export const RETIRED_BA_SUCCESSORS: Record<string, string> = {
  // SPP RTO West went live 2026-04-01 and swallowed both WAPA balancing areas.
  WACM: "SWPW",
  WAUW: "SWPW",
  WAUE: "SWPW",
  // PowerSouth folded into Southern Company in 2021.
  AEC: "SOCO",
  // New Smyrna Beach stopped balancing separately in 2020.
  NSB: "FPL",
  // Ohio Valley Electric moved into PJM in 2018.
  OVEC: "PJM",
  EEI: "MISO",
  GLHB: "MISO",
  // Merchant plants in Arizona that stopped reporting separately.
  GRIF: "WALC",
  GRMA: "SRP",
  HGMA: "SRP",
  WWA: "NWMT",
};

/**
 * Areas with no EIA-930 balancing authority at all. We say so out loud rather
 * than snapping a Honolulu household onto a mainland grid: Hawaii and Alaska are
 * islanded systems, and the territories aren't in the survey.
 *
 * `electricityMapsZone` is set where Electricity Maps does cover the area, so a
 * future provider can light these up without another mapping table.
 */
export interface UnsupportedArea {
  /** State or territory postal code, as produced by the ZIP3 table. */
  code: string;
  label: string;
  timezone: string;
  electricityMapsZone?: string;
  /** Shown to the user verbatim. */
  reason: string;
}

export const UNSUPPORTED_AREAS: Record<string, UnsupportedArea> = {
  HI: {
    code: "HI",
    label: "Hawaii",
    timezone: "Pacific/Honolulu",
    electricityMapsZone: "US-HI",
    reason:
      "Hawaii's island grids aren't part of the federal EIA-930 survey we build forecasts from, so we can't tell you the cleanest hour there yet.",
  },
  AK: {
    code: "AK",
    label: "Alaska",
    timezone: "America/Anchorage",
    electricityMapsZone: "US-AK",
    reason:
      "Alaska's grids report separately from the lower 48 and aren't in the EIA-930 data we use, so we can't forecast there yet.",
  },
  PR: {
    code: "PR",
    label: "Puerto Rico",
    timezone: "America/Puerto_Rico",
    reason:
      "Puerto Rico's grid isn't covered by the federal hourly data we use, so we can't forecast there yet.",
  },
  VI: {
    code: "VI",
    label: "U.S. Virgin Islands",
    timezone: "America/St_Thomas",
    reason:
      "The U.S. Virgin Islands aren't covered by the federal hourly data we use, so we can't forecast there yet.",
  },
  GU: {
    code: "GU",
    label: "Guam and the Pacific territories",
    timezone: "Pacific/Guam",
    reason:
      "Guam and the Pacific territories aren't covered by the federal hourly data we use, so we can't forecast there yet.",
  },
  AA: {
    code: "AA",
    label: "Armed Forces Americas",
    timezone: "America/New_York",
    reason:
      "That looks like a military mailing address, which doesn't tell us where the power is actually coming from. Try the ZIP code where you live.",
  },
  AE: {
    code: "AE",
    label: "Armed Forces Europe",
    timezone: "Europe/London",
    reason:
      "That looks like a military mailing address, which doesn't tell us where the power is actually coming from. Try the ZIP code where you live.",
  },
  AP: {
    code: "AP",
    label: "Armed Forces Pacific",
    timezone: "Pacific/Honolulu",
    reason:
      "That looks like a military mailing address, which doesn't tell us where the power is actually coming from. Try the ZIP code where you live.",
  },
};
