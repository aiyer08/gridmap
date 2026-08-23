/**
 * The balancing authorities we pre-build profiles for.
 *
 * Region *resolution* (ZIP -> BA) lives elsewhere; this list exists so the
 * `build:profiles` script and the fallback generator can work standalone. It is
 * ordered by rough population served, so "top 25" is just the first 25 entries.
 *
 * Timezones are the one the majority of each BA's customers live in. Several
 * BAs straddle a boundary (MISO, TVA, SOCO); we pick the side with the most
 * people, because the point of the local clock here is "what time is it for the
 * person reading the screen".
 */

export interface BalancingAuthorityMeta {
  ba: string;
  name: string;
  shortName: string;
  timezone: string;
  /** Rough population served, in millions. Used only for ordering. */
  populationMillions: number;
}

export const BALANCING_AUTHORITIES: BalancingAuthorityMeta[] = [
  { ba: "PJM", name: "PJM Interconnection", shortName: "Mid-Atlantic grid (PJM)", timezone: "America/New_York", populationMillions: 65 },
  { ba: "MISO", name: "Midcontinent Independent System Operator", shortName: "Midwest grid (MISO)", timezone: "America/Chicago", populationMillions: 45 },
  { ba: "CISO", name: "California Independent System Operator", shortName: "California grid (CAISO)", timezone: "America/Los_Angeles", populationMillions: 32 },
  { ba: "ERCO", name: "Electric Reliability Council of Texas", shortName: "Texas grid (ERCOT)", timezone: "America/Chicago", populationMillions: 27 },
  { ba: "NYIS", name: "New York Independent System Operator", shortName: "New York grid (NYISO)", timezone: "America/New_York", populationMillions: 20 },
  { ba: "SWPP", name: "Southwest Power Pool", shortName: "Great Plains grid (SPP)", timezone: "America/Chicago", populationMillions: 18 },
  { ba: "ISNE", name: "ISO New England", shortName: "New England grid (ISO-NE)", timezone: "America/New_York", populationMillions: 14 },
  { ba: "FPL", name: "Florida Power & Light Company", shortName: "South Florida grid (FPL)", timezone: "America/New_York", populationMillions: 12 },
  { ba: "TVA", name: "Tennessee Valley Authority", shortName: "Tennessee Valley grid (TVA)", timezone: "America/Chicago", populationMillions: 10 },
  { ba: "SOCO", name: "Southern Company Services", shortName: "Deep South grid (Southern)", timezone: "America/New_York", populationMillions: 9 },
  { ba: "BPAT", name: "Bonneville Power Administration", shortName: "Pacific Northwest grid (BPA)", timezone: "America/Los_Angeles", populationMillions: 6 },
  { ba: "DUK", name: "Duke Energy Carolinas", shortName: "Carolinas grid (Duke)", timezone: "America/New_York", populationMillions: 4.6 },
  { ba: "LDWP", name: "Los Angeles Department of Water and Power", shortName: "Los Angeles grid (LADWP)", timezone: "America/Los_Angeles", populationMillions: 4 },
  { ba: "AZPS", name: "Arizona Public Service Company", shortName: "Arizona grid (APS)", timezone: "America/Phoenix", populationMillions: 3.1 },
  { ba: "CPLE", name: "Duke Energy Progress East", shortName: "Eastern Carolinas grid (Duke Progress)", timezone: "America/New_York", populationMillions: 3 },
  { ba: "PSCO", name: "Public Service Company of Colorado", shortName: "Colorado grid (Xcel)", timezone: "America/Denver", populationMillions: 3 },
  { ba: "NEVP", name: "Nevada Power Company", shortName: "Nevada grid (NV Energy)", timezone: "America/Los_Angeles", populationMillions: 2.6 },
  { ba: "SRP", name: "Salt River Project", shortName: "Phoenix grid (SRP)", timezone: "America/Phoenix", populationMillions: 2.2 },
  { ba: "PACE", name: "PacifiCorp East", shortName: "Utah and Wyoming grid (PacifiCorp East)", timezone: "America/Denver", populationMillions: 2.1 },
  { ba: "TEC", name: "Tampa Electric Company", shortName: "Tampa grid (TECO)", timezone: "America/New_York", populationMillions: 1.6 },
  { ba: "LGEE", name: "Louisville Gas & Electric / Kentucky Utilities", shortName: "Kentucky grid (LG&E)", timezone: "America/New_York", populationMillions: 1.4 },
  { ba: "PSEI", name: "Puget Sound Energy", shortName: "Puget Sound grid (PSE)", timezone: "America/Los_Angeles", populationMillions: 1.3 },
  { ba: "SCEG", name: "Dominion Energy South Carolina", shortName: "South Carolina grid (Dominion)", timezone: "America/New_York", populationMillions: 1.1 },
  { ba: "SC", name: "South Carolina Public Service Authority", shortName: "Santee Cooper grid", timezone: "America/New_York", populationMillions: 1 },
  { ba: "PACW", name: "PacifiCorp West", shortName: "Oregon grid (PacifiCorp West)", timezone: "America/Los_Angeles", populationMillions: 1 },
  { ba: "PGE", name: "Portland General Electric", shortName: "Portland grid (PGE)", timezone: "America/Los_Angeles", populationMillions: 0.95 },
  { ba: "PNM", name: "Public Service Company of New Mexico", shortName: "New Mexico grid (PNM)", timezone: "America/Denver", populationMillions: 0.8 },
  { ba: "TEPC", name: "Tucson Electric Power", shortName: "Tucson grid (TEP)", timezone: "America/Phoenix", populationMillions: 0.7 },
  { ba: "IPCO", name: "Idaho Power Company", shortName: "Idaho grid (Idaho Power)", timezone: "America/Boise", populationMillions: 0.65 },
  { ba: "AECI", name: "Associated Electric Cooperative", shortName: "Missouri co-op grid (AECI)", timezone: "America/Chicago", populationMillions: 0.6 },
  { ba: "SCL", name: "Seattle City Light", shortName: "Seattle grid (Seattle City Light)", timezone: "America/Los_Angeles", populationMillions: 0.5 },
  { ba: "EPE", name: "El Paso Electric", shortName: "El Paso grid (EPE)", timezone: "America/Denver", populationMillions: 0.45 },
  { ba: "IID", name: "Imperial Irrigation District", shortName: "Imperial Valley grid (IID)", timezone: "America/Los_Angeles", populationMillions: 0.18 },
];

/** The set `npm run build:profiles` fetches by default. */
export const TOP_BALANCING_AUTHORITIES = BALANCING_AUTHORITIES.slice(0, 25);

const BY_CODE = new Map(BALANCING_AUTHORITIES.map((meta) => [meta.ba, meta]));

export function balancingAuthorityMeta(
  ba: string,
): BalancingAuthorityMeta | undefined {
  return BY_CODE.get(ba.toUpperCase());
}

/** Best-effort timezone for a BA; UTC when we have never heard of it. */
export function timezoneForBa(ba: string): string {
  return balancingAuthorityMeta(ba)?.timezone ?? "UTC";
}
