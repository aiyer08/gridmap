import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWattTime,
  hourlyFromMoerPoints,
  LBS_PER_MWH_TO_G_PER_KWH,
  wattTimeLogin,
  wattTimeRegionForBa,
  type WattTimeOptions,
} from "./wattTime";
import type { FetchLike, FetchLikeResponse } from "./types";

/**
 * WattTime is the second optional provider whose fail-soft path stays
 * invisible until someone actually configures credentials. Every test here
 * checks the same thing: nothing throws, and the attribution says why.
 */

function jsonResponse(status: number, body: unknown): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** WattTime's real 401/403 bodies are plain text, not JSON. */
function textOnlyResponse(status: number, text: string): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
    text: async () => text,
  };
}

function throwingFetch(error: unknown): FetchLike {
  return async () => {
    throw error;
  };
}

const CREDENTIALS = { username: "homeowner", password: "hunter2" };

/**
 * Routes /login, /v3/forecast and /v3/signal-index to canned responses. Login
 * defaults to a normal success so tests can focus on one failure at a time.
 */
function routedFetch(routes: {
  login?: FetchLikeResponse;
  forecast?: FetchLikeResponse;
  index?: FetchLikeResponse;
}): FetchLike {
  return async (input: string) => {
    if (input.includes("/login")) {
      return routes.login ?? jsonResponse(200, { token: "test-token" });
    }
    if (input.includes("/v3/forecast")) {
      return routes.forecast ?? jsonResponse(200, { data: [] });
    }
    if (input.includes("/v3/signal-index")) {
      return routes.index ?? jsonResponse(200, { data: [] });
    }
    throw new Error(`unexpected URL in test fetch: ${input}`);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wattTimeRegionForBa", () => {
  it("maps a known BA to WattTime's own region code, not the EIA code", () => {
    // WattTime writes BPA where EIA writes BPAT — this is the whole point of
    // having a separate table rather than reusing the EIA code directly.
    expect(wattTimeRegionForBa("CISO")).toBe("CAISO_NORTH");
    expect(wattTimeRegionForBa("BPAT")).toBe("BPA");
  });

  it("returns null for a BA WattTime does not cover", () => {
    expect(wattTimeRegionForBa("NOT-A-REAL-BA")).toBeNull();
  });
});

describe("fetchWattTime fail-soft paths", () => {
  it("fails soft with no network calls when credentials are missing", async () => {
    const fetchImpl = vi.fn(routedFetch({}));
    const result = await fetchWattTime({ ba: "CISO", fetchImpl });
    expect(result.marginalForecast).toEqual([]);
    expect(result.cleanlinessPercentile).toBeNull();
    expect(result.rawIndex).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/WATTTIME_USERNAME/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails soft when only one half of the credential pair is set", async () => {
    const fetchImpl = vi.fn(routedFetch({}));
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: { username: "homeowner", password: "" },
      fetchImpl,
    });
    expect(result.attribution.used).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails soft when the BA has no mapped WattTime region", async () => {
    const fetchImpl = vi.fn(routedFetch({}));
    const result = await fetchWattTime({
      ba: "NOT-A-REAL-BA",
      credentials: CREDENTIALS,
      fetchImpl,
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/NOT-A-REAL-BA/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails soft when no fetch implementation is available at all", async () => {
    vi.stubGlobal("fetch", undefined);
    const result = await fetchWattTime({ ba: "CISO", credentials: CREDENTIALS });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/No fetch implementation/);
  });

  it("fails soft on a 403 login rejection with a plain-text body", async () => {
    // WattTime's real bad-credentials response is HTTP 403 with the literal
    // text "Forbidden" — not JSON — so this exercises the text() fallback.
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({ login: textOnlyResponse(403, "Forbidden") }),
    });
    expect(result.marginalForecast).toEqual([]);
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/Sign-in failed/);
    expect(result.attribution.detail).toMatch(/Forbidden/);
  });

  it("fails soft when login succeeds but the body has no token field", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({ login: jsonResponse(200, { ok: true }) }),
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/no token/);
  });

  it("fails soft when login itself throws (network down)", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: throwingFetch(new TypeError("fetch failed")),
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/fetch failed/);
  });

  it("fails soft when login is aborted (timeout)", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: throwingFetch(abortError),
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/aborted/i);
  });

  it("fails soft on a 401 from a data endpoint with a plain-text body", async () => {
    // "Jwt is missing" is WattTime's real 401 text for data calls without a
    // valid bearer token.
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({
        forecast: textOnlyResponse(401, "Jwt is missing"),
        index: textOnlyResponse(401, "Jwt is missing"),
      }),
    });
    expect(result.marginalForecast).toEqual([]);
    expect(result.rawIndex).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/Jwt is missing/);
  });

  it("fails soft on a 429 rate limit with the {error,message} envelope", async () => {
    const body = { error: "rate_limit", message: "Too many requests" };
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({
        forecast: jsonResponse(429, body),
        index: jsonResponse(429, body),
      }),
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/rate_limit: Too many requests/);
  });

  it("fails soft on a 429 rate limit using the {msg} spelling from the spec's own example", async () => {
    // The OpenAPI schema says `message`; the spec's own example uses `msg`.
    // Both must be read.
    const body = { error: "rate_limit", msg: "slow down" };
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({ forecast: jsonResponse(429, body) }),
    });
    expect(result.attribution.detail).toMatch(/rate_limit: slow down/);
  });

  it("fails soft on a 500 with an unparseable, non-text body", async () => {
    const serverError: FetchLikeResponse = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
      // No `text` method at all — some responses genuinely lack one.
    };
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({ forecast: serverError, index: serverError }),
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/HTTP 500/);
  });

  it("fails soft when a data call throws after a successful login", async () => {
    const fetchImpl: FetchLike = async (input) => {
      if (input.includes("/login")) return jsonResponse(200, { token: "test-token" });
      throw new TypeError("fetch failed");
    };
    const result = await fetchWattTime({ ba: "CISO", credentials: CREDENTIALS, fetchImpl });
    expect(result.marginalForecast).toEqual([]);
    expect(result.rawIndex).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/fetch failed/);
  });

  it("treats a well-formed body with renamed fields as no usable data", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({
        forecast: jsonResponse(200, {
          // "readings" instead of "data", "time"/"moer" instead of
          // "point_time"/"value".
          readings: [{ time: "2026-08-23T18:00:00Z", moer: 900 }],
        }),
        index: jsonResponse(200, {
          readings: [{ time: "2026-08-23T18:00:00Z", moer: 40 }],
        }),
      }),
    });
    expect(result.marginalForecast).toEqual([]);
    expect(result.rawIndex).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/forecast returned no points/);
    expect(result.attribution.detail).toMatch(/signal index returned no usable value/);
  });

  it("treats an empty forecast data array as a normal, non-fatal outcome", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({ forecast: jsonResponse(200, { data: [] }) }),
    });
    expect(result.marginalForecast).toEqual([]);
    expect(result.attribution.used).toBe(false);
  });

  it("rejects a signal-index value outside the documented 0-100 range", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({
        index: jsonResponse(200, {
          data: [{ point_time: "2026-08-23T18:00:00Z", value: 137 }],
        }),
      }),
    });
    expect(result.rawIndex).toBeNull();
    expect(result.attribution.detail).toMatch(/no usable value/);
  });

  it("drops individual forecast points with unusable fields, keeping the rest", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({
        forecast: jsonResponse(200, {
          data: [
            { point_time: "2026-08-23T18:00:00Z", value: 900 },
            { point_time: "not-a-date", value: 800 },
            { point_time: "2026-08-23T18:05:00Z", value: "NaN" },
            null,
            { point_time: "2026-08-23T18:10:00Z", value: 950 },
          ],
        }),
      }),
    });
    expect(result.marginalForecast).toHaveLength(1); // both survivors share an hour bucket
    expect(result.attribution.used).toBe(true);
  });
});

describe("wattTimeLogin", () => {
  it("sends HTTP Basic auth, not a bearer token, to /login", async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      seenHeaders = init?.headers;
      return jsonResponse(200, { token: "abc" });
    };
    await wattTimeLogin({ credentials: CREDENTIALS, fetchImpl });
    expect(seenHeaders?.Authorization).toMatch(/^Basic /);
    const decoded = Buffer.from(seenHeaders!.Authorization.slice(6), "base64").toString("utf8");
    expect(decoded).toBe("homeowner:hunter2");
  });
});

describe("hourlyFromMoerPoints", () => {
  it("averages 5-minute points within an hour and converts units", () => {
    const points = [
      { ts: Date.parse("2026-08-23T18:00:00Z"), value: 1000 },
      { ts: Date.parse("2026-08-23T18:05:00Z"), value: 1200 },
      { ts: Date.parse("2026-08-23T18:55:00Z"), value: 1400 },
    ];
    const hourly = hourlyFromMoerPoints(points);
    expect(hourly).toHaveLength(1);
    expect(hourly[0].ts).toBe("2026-08-23T18:00:00.000Z");
    // Mean of 1000/1200/1400 lbs/MWh = 1200, converted to g/kWh.
    expect(hourly[0].gCO2PerKWh).toBeCloseTo(1200 * LBS_PER_MWH_TO_G_PER_KWH, 6);
  });

  it("buckets points spanning an hour boundary into two separate hours", () => {
    const points = [
      { ts: Date.parse("2026-08-23T18:59:00Z"), value: 1000 },
      { ts: Date.parse("2026-08-23T19:01:00Z"), value: 2000 },
    ];
    const hourly = hourlyFromMoerPoints(points);
    expect(hourly.map((p) => p.ts)).toEqual([
      "2026-08-23T18:00:00.000Z",
      "2026-08-23T19:00:00.000Z",
    ]);
  });

  it("returns an empty array for no points, rather than throwing", () => {
    expect(hourlyFromMoerPoints([])).toEqual([]);
  });
});

describe("fetchWattTime happy path", () => {
  const forecastBody = {
    data: [
      { point_time: "2026-08-23T18:00:00Z", value: 1000 },
      { point_time: "2026-08-23T18:30:00Z", value: 1200 },
      { point_time: "2026-08-23T19:00:00Z", value: 800 },
    ],
    meta: {
      data_point_period_seconds: 1800,
      region: "CAISO_NORTH",
      signal_type: "co2_moer",
      units: "lbs_co2_per_mwh",
    },
  };
  const indexBody = {
    data: [{ point_time: "2026-08-23T18:00:00Z", value: 30 }],
    meta: { region: "CAISO_NORTH", signal_type: "co2_moer", units: "percentile" },
  };

  it("parses the marginal forecast and converts lbs/MWh to gCO2/kWh", async () => {
    const options: WattTimeOptions = {
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({ forecast: jsonResponse(200, forecastBody) }),
    };
    const result = await fetchWattTime(options);
    expect(result.marginalForecast).toHaveLength(2);
    expect(result.marginalForecast[0].ts).toBe("2026-08-23T18:00:00.000Z");
    // (1000 + 1200) / 2 = 1100 lbs/MWh.
    expect(result.marginalForecast[0].gCO2PerKWh).toBeCloseTo(1100 * LBS_PER_MWH_TO_G_PER_KWH, 6);
    expect(result.marginalForecast[1].gCO2PerKWh).toBeCloseTo(800 * LBS_PER_MWH_TO_G_PER_KWH, 6);
  });

  it("inverts WattTime's dirtiness index into our cleanliness percentile", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({ index: jsonResponse(200, indexBody) }),
    });
    // WattTime says 30/100 dirty; we should say 70/100 clean.
    expect(result.rawIndex).toBe(30);
    expect(result.cleanlinessPercentile).toBe(70);
  });

  it("reports the resolved region even when nothing else succeeds", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({}),
    });
    expect(result.region).toBe("CAISO_NORTH");
  });

  it("clamps the requested horizon into WattTime's documented 1-72h range", async () => {
    const fetchImpl = vi.fn(routedFetch({ forecast: jsonResponse(200, forecastBody) }));
    await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl,
      horizonHours: 200,
    });
    const forecastCall = fetchImpl.mock.calls.find(([url]) =>
      (url as string).includes("/v3/forecast"),
    );
    expect(forecastCall?.[0]).toContain("horizon_hours=72");
  });

  it("uses Bearer <token> for the data calls, distinct from the Basic login header", async () => {
    let dataHeaders: Record<string, string> | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      if (input.includes("/login")) return jsonResponse(200, { token: "session-token" });
      dataHeaders = init?.headers;
      return jsonResponse(200, { data: [] });
    };
    await fetchWattTime({ ba: "CISO", credentials: CREDENTIALS, fetchImpl });
    expect(dataHeaders?.Authorization).toBe("Bearer session-token");
  });

  it("produces a readable attribution summarising both signals", async () => {
    const result = await fetchWattTime({
      ba: "CISO",
      credentials: CREDENTIALS,
      fetchImpl: routedFetch({
        forecast: jsonResponse(200, forecastBody),
        index: jsonResponse(200, indexBody),
      }),
    });
    expect(result.attribution.used).toBe(true);
    expect(result.attribution.detail).toMatch(/CAISO_NORTH/);
    expect(result.attribution.detail).toMatch(/30\/100 dirtiness/);
    expect(result.attribution.detail).toMatch(/2h marginal forecast/);
  });
});
