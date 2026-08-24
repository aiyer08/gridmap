/**
 * Server-only access to the credentials GridMap can optionally use.
 *
 * Two rules here, both deliberate:
 *
 * 1. Nothing throws. Every provider in `src/lib/grid` is optional — the app is
 *    designed to give a good answer with zero keys configured — so a missing
 *    variable is a normal state, not an error.
 * 2. Values are read lazily on every call rather than captured at module load.
 *    Next.js evaluates modules once per server process, but tests (and the
 *    `build:profiles` script) mutate `process.env` after import, and reading
 *    late keeps those cases honest.
 *
 * None of these are `NEXT_PUBLIC_*`: they must never reach the browser.
 */

function read(name: string): string | null {
  // `process` is undefined in edge/browser bundles; guard rather than crash.
  if (typeof process === "undefined" || !process.env) return null;
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // `.env.example` ships these keys with empty values, so blank means absent.
  return trimmed.length > 0 ? trimmed : null;
}

/** EIA API v2 key — powers the hourly fuel-mix history behind our climatology. */
export function eiaApiKey(): string | null {
  return read("EIA_API_KEY");
}

export function hasEiaKey(): boolean {
  return eiaApiKey() !== null;
}

/** Electricity Maps token — live intensity plus a short forecast. */
export function electricityMapsToken(): string | null {
  return read("ELECTRICITY_MAPS_TOKEN");
}

export function hasElectricityMapsToken(): boolean {
  return electricityMapsToken() !== null;
}

export interface WattTimeCredentials {
  username?: string;
  password?: string;
  token?: string;
}

/**
 * WattTime accepts either a basic-auth pair or a pre-issued bearer token.
 *
 * Username/password is preferred: their tokens expire 30 minutes after issue,
 * so a token-only configuration works once and then quietly stops. We take the
 * pair when both halves are present and fall back to the token otherwise.
 */
export function wattTimeCredentials(): WattTimeCredentials | null {
  const username = read("WATTTIME_USERNAME");
  const password = read("WATTTIME_PASSWORD");
  if (username && password) return { username, password };
  const token = read("WATTTIME_API_TOKEN");
  if (token) return { token };
  return null;
}

export function hasWattTimeCredentials(): boolean {
  return wattTimeCredentials() !== null;
}

/** Snapshot of what is configured, for the "where does this come from" panel. */
export interface CredentialStatus {
  eia: boolean;
  electricityMaps: boolean;
  wattTime: boolean;
  /** True when we have nothing and will be serving modelled archetypes. */
  noneConfigured: boolean;
}

export function credentialStatus(): CredentialStatus {
  const eia = hasEiaKey();
  const electricityMaps = hasElectricityMapsToken();
  const wattTime = hasWattTimeCredentials();
  return {
    eia,
    electricityMaps,
    wattTime,
    noneConfigured: !eia && !electricityMaps && !wattTime,
  };
}
