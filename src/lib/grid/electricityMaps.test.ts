import { afterEach, describe, expect, it, vi } from "vitest";
import {
  electricityMapsZoneForBa,
  fetchElectricityMaps,
  type ElectricityMapsOptions,
} from "./electricityMaps";
import type { FetchLike, FetchLikeResponse } from "./types";

/**
 * The Electricity Maps token activates the moment someone pastes one into
 * `.env.local`, so every branch here has to fail soft: a homeowner who typos a
 * token must get the modelled fallback, not a crashed page.
 */

const ZONE_QUERY = "zone=US-CAL-CISO";

function jsonResponse(status: number, body: unknown): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function throwingFetch(error: unknown): FetchLike {
  return async () => {
    throw error;
  };
}

/** Routes each of the three parallel GETs to its own canned response. */
function routedFetch(routes: {
  latest?: FetchLikeResponse;
  forecast?: FetchLikeResponse;
  breakdown?: FetchLikeResponse;
}): FetchLike {
  return async (input: string) => {
    if (input.includes("carbon-intensity/latest")) {
      return routes.latest ?? jsonResponse(200, {});
    }
    if (input.includes("carbon-intensity/forecast")) {
      return routes.forecast ?? jsonResponse(200, { forecast: [] });
    }
    if (input.includes("power-breakdown/latest")) {
      return routes.breakdown ?? jsonResponse(200, {});
    }
    throw new Error(`unexpected URL in test fetch: ${input}`);
  };
}

const baseOptions: Omit<ElectricityMapsOptions, "fetchImpl"> = {
  token: "fake-token",
  ba: "CISO",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("electricityMapsZoneForBa", () => {
  it("maps a known EIA balancing authority to its zone key", () => {
    expect(electricityMapsZoneForBa("CISO")).toBe("US-CAL-CISO");
    expect(electricityMapsZoneForBa("ciso")).toBe("US-CAL-CISO");
  });

  it("returns null for a BA with no known Electricity Maps zone", () => {
    expect(electricityMapsZoneForBa("NOT-A-REAL-BA")).toBeNull();
  });
});

describe("fetchElectricityMaps fail-soft paths", () => {
  it("returns null-ish data and an honest attribution when no token is configured", async () => {
    const result = await fetchElectricityMaps({
      ba: "CISO",
      fetchImpl: routedFetch({}),
    });
    expect(result.live).toBeNull();
    expect(result.forecast).toEqual([]);
    expect(result.breakdown).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/ELECTRICITY_MAPS_TOKEN/);
  });

  it("treats a blank token the same as a missing one", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      token: "   ",
      fetchImpl: routedFetch({}),
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/ELECTRICITY_MAPS_TOKEN/);
  });

  it("fails soft when the BA has no mapped zone, without ever calling fetch", async () => {
    const fetchImpl = vi.fn(routedFetch({}));
    const result = await fetchElectricityMaps({
      token: "fake-token",
      ba: "NOT-A-REAL-BA",
      fetchImpl,
    });
    expect(result.live).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/NOT-A-REAL-BA/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails soft when no fetch implementation is available at all", async () => {
    vi.stubGlobal("fetch", undefined);
    const result = await fetchElectricityMaps({ ...baseOptions });
    expect(result.live).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/No fetch implementation/);
  });

  it("fails soft on HTTP 401 with the {error,message} envelope", async () => {
    const body = { error: "unauthorized", message: "The provided token is invalid" };
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(401, body),
        forecast: jsonResponse(401, body),
        breakdown: jsonResponse(401, body),
      }),
    });
    expect(result.live).toBeNull();
    expect(result.forecast).toEqual([]);
    expect(result.breakdown).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/unauthorized: The provided token is invalid/);
  });

  it("fails soft on HTTP 403 for the forecast route (expected on the free tier)", async () => {
    // Per the module's own docs comment: the free personal tier excludes the
    // forecast endpoint, so a 403 here is a normal, non-fatal outcome, not a
    // sign anything is broken.
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(200, {
          zone: "US-CAL-CISO",
          carbonIntensity: 210,
          datetime: "2026-08-23T18:00:00.000Z",
          isEstimated: false,
        }),
        forecast: jsonResponse(403, { error: "Forbidden" }),
      }),
    });
    expect(result.live?.gCO2PerKWh).toBe(210);
    expect(result.forecast).toEqual([]);
    // live succeeded, so the provider is still "used" overall.
    expect(result.attribution.used).toBe(true);
    expect(result.attribution.detail).toMatch(/forecast: Forbidden/);
  });

  it("fails soft on HTTP 429 with the {status,message} envelope", async () => {
    const body = { status: "error", message: "Too many requests" };
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(429, body),
        forecast: jsonResponse(429, body),
        breakdown: jsonResponse(429, body),
      }),
    });
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/Too many requests/);
  });

  it("fails soft on HTTP 500 with an unparseable body", async () => {
    const serverError: FetchLikeResponse = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    };
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: serverError,
        forecast: serverError,
        breakdown: serverError,
      }),
    });
    expect(result.live).toBeNull();
    expect(result.attribution.used).toBe(false);
    // No usable body, so we fall back to a plain HTTP-status sentence.
    expect(result.attribution.detail).toMatch(/HTTP 500/);
  });

  it("fails soft when fetch itself throws (DNS failure, offline, etc.)", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: throwingFetch(new TypeError("fetch failed")),
    });
    expect(result.live).toBeNull();
    expect(result.forecast).toEqual([]);
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/fetch failed/);
  });

  it("fails soft when the request is aborted (timeout)", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: throwingFetch(abortError),
    });
    expect(result.live).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/aborted/i);
  });

  it("fails soft when a 200 body is not valid JSON", async () => {
    const unparseable: FetchLikeResponse = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    };
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({ latest: unparseable, forecast: unparseable, breakdown: unparseable }),
    });
    expect(result.live).toBeNull();
    expect(result.forecast).toEqual([]);
    expect(result.breakdown).toBeNull();
    expect(result.attribution.used).toBe(false);
    // Still a readable sentence, even with nothing to report.
    expect(typeof result.attribution.detail).toBe("string");
    expect(result.attribution.detail!.length).toBeGreaterThan(0);
  });

  it("fails soft when JSON is well-formed but the fields have been renamed", async () => {
    // Same shape of envelope, but the two fields we actually read are missing.
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(200, {
          zone: "US-CAL-CISO",
          intensity: 210, // renamed from carbonIntensity
          updatedAt: "2026-08-23T18:00:00.000Z", // renamed from datetime
        }),
      }),
    });
    expect(result.live).toBeNull();
    expect(result.attribution.used).toBe(false);
    expect(result.attribution.detail).toMatch(/no usable carbonIntensity/);
  });

  it("fails soft on a null carbonIntensity, which the API documents as a possible value", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(200, {
          zone: "US-CAL-CISO",
          carbonIntensity: null,
          datetime: "2026-08-23T18:00:00.000Z",
        }),
      }),
    });
    expect(result.live).toBeNull();
  });

  it("treats an empty forecast array as a normal, non-fatal outcome", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        forecast: jsonResponse(200, { zone: "US-CAL-CISO", forecast: [] }),
      }),
    });
    expect(result.forecast).toEqual([]);
    expect(result.attribution.used).toBe(false);
  });

  it("drops individual forecast entries with unusable fields rather than failing the whole array", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        forecast: jsonResponse(200, {
          zone: "US-CAL-CISO",
          forecast: [
            { carbonIntensity: 200, datetime: "2026-08-23T18:00:00.000Z" },
            { carbonIntensity: null, datetime: "2026-08-23T19:00:00.000Z" }, // null intensity
            { carbonIntensity: 190, datetime: "not-a-date" }, // bad timestamp
            { carbonIntensity: -5, datetime: "2026-08-23T21:00:00.000Z" }, // negative
            "not even an object",
            { carbonIntensity: 205, datetime: "2026-08-23T22:00:00.000Z" },
          ],
        }),
      }),
    });
    expect(result.forecast).toHaveLength(2);
    expect(result.forecast.map((p) => p.gCO2PerKWh)).toEqual([200, 205]);
  });
});

describe("fetchElectricityMaps happy path", () => {
  const latestBody = {
    zone: "US-CAL-CISO",
    carbonIntensity: 212.4,
    datetime: "2026-08-23T18:00:00.000Z",
    updatedAt: "2026-08-23T18:05:00.000Z",
    emissionFactorType: "lifecycle",
    isEstimated: false,
  };
  const forecastBody = {
    zone: "US-CAL-CISO",
    forecast: [
      { carbonIntensity: 220, datetime: "2026-08-23T19:00:00.000Z" },
      { carbonIntensity: 205, datetime: "2026-08-23T20:00:00.000Z" },
    ],
    updatedAt: "2026-08-23T18:00:00.000Z",
    temporalGranularity: "hourly",
  };
  const breakdownBody = {
    zone: "US-CAL-CISO",
    powerConsumptionBreakdown: {
      nuclear: 500,
      geothermal: 50,
      biomass: 20,
      coal: 5,
      wind: 300,
      solar: 800,
      hydro: 100,
      gas: 900,
      oil: 0,
      unknown: 10,
      "hydro discharge": 40,
      "battery discharge": 60,
    },
    powerProductionBreakdown: {},
    fossilFreePercentage: 71,
    renewablePercentage: 62,
    powerConsumptionTotal: 2785,
  };

  it("parses the live reading straight through with no unit conversion needed", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({ latest: jsonResponse(200, latestBody) }),
    });
    expect(result.live).toEqual({
      ts: "2026-08-23T18:00:00.000Z",
      gCO2PerKWh: 212.4,
      confidence: "high",
    });
    expect(result.attribution.used).toBe(true);
  });

  it("marks an estimated reading as medium confidence rather than high", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(200, { ...latestBody, isEstimated: true }),
      }),
    });
    expect(result.live?.confidence).toBe("medium");
  });

  it("parses every forecast point in order", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({ forecast: jsonResponse(200, forecastBody) }),
    });
    expect(result.forecast).toEqual([
      { ts: "2026-08-23T19:00:00.000Z", gCO2PerKWh: 220 },
      { ts: "2026-08-23T20:00:00.000Z", gCO2PerKWh: 205 },
    ]);
  });

  it("builds a fuel mix that sums to 1 and drops storage discharge entirely", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({ breakdown: jsonResponse(200, breakdownBody) }),
    });
    expect(result.breakdown).not.toBeNull();
    const mix = result.breakdown!.fuelMix;
    // "hydro discharge" and "battery discharge" must not appear anywhere.
    expect(mix.storage).toBeUndefined();
    const total = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBeCloseTo(1, 5);
    // geothermal/biomass/unknown all fold into "other".
    const expectedOtherMwh = 50 + 20 + 10; // geothermal + biomass + unknown
    const consumptionTotal = 500 + 50 + 20 + 5 + 300 + 800 + 100 + 900 + 10; // excludes discharge
    expect(mix.other).toBeCloseTo(expectedOtherMwh / consumptionTotal, 5);
  });

  it("reports the provider's own fossil-free and renewable percentages unchanged", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({ breakdown: jsonResponse(200, breakdownBody) }),
    });
    expect(result.breakdown?.fossilFreePercentage).toBe(71);
    expect(result.breakdown?.renewablePercentage).toBe(62);
  });

  it("ignores an unrecognised fuel key rather than lumping it into 'other'", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        breakdown: jsonResponse(200, {
          powerConsumptionBreakdown: { solar: 100, gas: 100, tidal: 500 },
        }),
      }),
    });
    const mix = result.breakdown!.fuelMix;
    // If "tidal" leaked into "other" the mix would be dominated by it (500 of 700).
    expect(mix.solar).toBeCloseTo(0.5, 5);
    expect(mix.gas).toBeCloseTo(0.5, 5);
    expect(mix.other).toBeUndefined();
  });

  it("falls back to the production breakdown when consumption is empty", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        breakdown: jsonResponse(200, {
          powerConsumptionBreakdown: {},
          powerProductionBreakdown: { solar: 300, gas: 700 },
        }),
      }),
    });
    expect(result.breakdown?.fuelMix.solar).toBeCloseTo(0.3, 5);
    expect(result.breakdown?.fuelMix.gas).toBeCloseTo(0.7, 5);
  });

  it("attaches the breakdown's fuel mix onto the live reading when both are present", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(200, latestBody),
        breakdown: jsonResponse(200, breakdownBody),
      }),
    });
    expect(result.live?.fuelMix).toBeDefined();
    expect(result.live?.carbonFreeShare).toBe(result.breakdown?.carbonFreeShare);
  });

  it("produces a readable, non-empty attribution summarising everything it found", async () => {
    const result = await fetchElectricityMaps({
      ...baseOptions,
      fetchImpl: routedFetch({
        latest: jsonResponse(200, latestBody),
        forecast: jsonResponse(200, forecastBody),
        breakdown: jsonResponse(200, breakdownBody),
      }),
    });
    expect(result.attribution.used).toBe(true);
    expect(result.attribution.detail).toMatch(/US-CAL-CISO/);
    expect(result.attribution.detail).toMatch(/live 212/);
    expect(result.attribution.detail).toMatch(/2h forecast/);
    expect(result.attribution.detail).toMatch(/fuel breakdown/);
  });

  it("accepts an explicit zone, bypassing BA-to-zone lookup entirely", async () => {
    const fetchImpl = vi.fn(routedFetch({ latest: jsonResponse(200, latestBody) }));
    const result = await fetchElectricityMaps({
      token: "fake-token",
      zone: "US-CAL-CISO",
      fetchImpl,
    });
    expect(result.live).not.toBeNull();
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toContain(ZONE_QUERY);
  });

  it("sends the token in the auth-token header, not a bearer header", async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      seenHeaders = init?.headers;
      return jsonResponse(200, latestBody);
    };
    await fetchElectricityMaps({ ...baseOptions, fetchImpl });
    expect(seenHeaders?.["auth-token"]).toBe("fake-token");
  });
});
