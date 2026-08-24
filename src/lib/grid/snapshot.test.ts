import { describe, expect, it, vi } from "vitest";
import type { ProviderAttribution, RegionInfo } from "../types";
import { HOURS_PER_WEEK } from "./time";
import { buildSnapshot } from "./snapshot";
import type { FetchLike, FetchLikeResponse, RegionProfile } from "./types";

/**
 * Integration tests for the blender. Every network-shaped dependency is
 * faked, so these run offline and are timezone-independent (the fixed
 * `now` below is a Sunday afternoon in Los Angeles, matching the other grid
 * test fixtures in this directory).
 */

const REGION: RegionInfo = {
  ba: "CISO",
  name: "California Independent System Operator",
  shortName: "California grid (CAISO)",
  timezone: "America/Los_Angeles",
  state: "CA",
  approximate: false,
  matchedBy: "zip",
};

const NOW = new Date("2026-08-23T21:00:00.000Z"); // 2 PM Sunday in Los Angeles

function flatProfile(overrides: Partial<RegionProfile> = {}): RegionProfile {
  const slots = Array.from({ length: HOURS_PER_WEEK }, (_, hourOfWeek) => ({
    hourOfWeek,
    gCO2PerKWh: 200,
    fuelMix: { gas: 0.6, solar: 0.4 },
    carbonFreeShare: 0.4,
    sampleCount: 40,
    weight: 10,
  }));
  return {
    ba: "CISO",
    timezone: "America/Los_Angeles",
    source: "eia",
    generatedAt: "2026-08-23T00:00:00.000Z",
    targetDate: "2026-08-23",
    hoursOfHistory: 8760,
    slots,
    stats: { min: 200, max: 200, mean: 200, p10: 200, p90: 200 },
    notes: ["fixture profile"],
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): FetchLikeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fetchImpl that must never be called; fails the test loudly if it is. */
const explodingFetch: FetchLike = async (input) => {
  throw new Error(`network call made while offline: ${input}`);
};

describe("offline mode", () => {
  it("makes no network calls at all", async () => {
    const fetchImpl = vi.fn(explodingFetch);
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      offline: true,
      profile: flatProfile(),
      eiaApiKey: "unused-key",
      electricityMapsToken: "unused-token",
      wattTimeCredentials: { username: "u", password: "p" },
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(snapshot.series).toHaveLength(HOURS_PER_WEEK);
  });

  it("still reports every provider, all marked as skipped rather than omitted", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      offline: true,
      profile: flatProfile(),
      fetchImpl: explodingFetch,
    });
    const ids = snapshot.providers.map((p) => p.id).sort();
    expect(ids).toEqual(["eia", "eia-demand", "electricity-maps", "fallback", "watttime"].sort());
    const em = snapshot.providers.find((p) => p.id === "electricity-maps")!;
    const wt = snapshot.providers.find((p) => p.id === "watttime")!;
    expect(em.used).toBe(false);
    expect(em.detail).toMatch(/offline/i);
    expect(wt.used).toBe(false);
    expect(wt.detail).toMatch(/offline/i);
  });
});

describe("series shape", () => {
  it("produces one point per requested hour, with stats and a cleanliness percentile on every point", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      offline: true,
      profile: flatProfile(),
      fetchImpl: explodingFetch,
    });
    expect(snapshot.series).toHaveLength(HOURS_PER_WEEK);
    expect(snapshot.stats.min).toBeLessThanOrEqual(snapshot.stats.mean);
    expect(snapshot.stats.max).toBeGreaterThanOrEqual(snapshot.stats.mean);
    for (const point of snapshot.series) {
      expect(point.cleanlinessPercentile).toBeGreaterThanOrEqual(0);
      expect(point.cleanlinessPercentile).toBeLessThanOrEqual(100);
      expect(Number.isFinite(point.gCO2PerKWh)).toBe(true);
    }
    // On a perfectly flat week, "now" is the first series point.
    expect(snapshot.now).toBe(snapshot.series[0]);
  });

  it("respects a shorter explicit horizon", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      offline: true,
      hours: 24,
      profile: flatProfile(),
      fetchImpl: explodingFetch,
    });
    expect(snapshot.series).toHaveLength(24);
  });
});

describe("every provider present in providers[] whether used or not", () => {
  it("lists all five providers even when every optional one fails", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      eiaApiKey: "test-key",
      electricityMapsToken: "test-token",
      wattTimeCredentials: { username: "u", password: "p" },
      fetchImpl: explodingFetch, // everything network-shaped fails
    });
    const byId = new Map(snapshot.providers.map((p) => [p.id, p]));
    expect(byId.size).toBe(5);
    const expectedIds: ProviderAttribution["id"][] = [
      "eia",
      "eia-demand",
      "electricity-maps",
      "watttime",
      "fallback",
    ];
    for (const id of expectedIds) {
      expect(byId.has(id)).toBe(true);
      expect(typeof byId.get(id)!.detail).toBe("string");
    }
    // "eia" reflects whether the *profile* is EIA-sourced (it is, per the
    // fixture) regardless of whether a network call happened this run; the
    // two live optional providers correctly show as unused since every
    // fetch attempt failed.
    expect(byId.get("eia")!.used).toBe(true);
    expect(byId.get("electricity-maps")!.used).toBe(false);
    expect(byId.get("watttime")!.used).toBe(false);
    expect(byId.get("fallback")!.used).toBe(false); // profile is "eia", not modelled
  });
});

describe("a throwing provider still yields a usable snapshot", () => {
  it("does not reject, even when every injected fetch call throws", async () => {
    const profile = flatProfile({
      demandSlots: Array.from({ length: HOURS_PER_WEEK }, () => 30_000),
      demandSensitivity: {
        slope: 4.6,
        intercept: -18.9,
        r: 0.79,
        n: 2145,
        baselineRmse: 86,
        correctedRmse: 45,
        applied: true,
      },
    });
    await expect(
      buildSnapshot(REGION, {
        now: NOW,
        profile,
        eiaApiKey: "test-key",
        electricityMapsToken: "test-token",
        wattTimeCredentials: { username: "u", password: "p" },
        fetchImpl: explodingFetch,
      }),
    ).resolves.toMatchObject({});
  });

  it("still uses plain climatology values when everything network-shaped failed", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      eiaApiKey: "test-key",
      electricityMapsToken: "test-token",
      fetchImpl: explodingFetch,
    });
    expect(snapshot.series.every((p) => p.gCO2PerKWh === 200)).toBe(true);
    expect(snapshot.series.every((p) => p.source === "climatology")).toBe(true);
  });
});

describe("source labelling and confidence over the horizon", () => {
  const LIVE_TS = NOW.toISOString(); // top of the current hour
  const forecastHour = (offset: number) => new Date(NOW.getTime() + offset * 3_600_000).toISOString();

  function fetchWithLiveAndForecast(): FetchLike {
    return async (url: string) => {
      if (url.includes("carbon-intensity/latest")) {
        return jsonResponse(200, {
          zone: "US-CAL-CISO",
          carbonIntensity: 100, // half the 200 climatology baseline
          datetime: LIVE_TS,
        });
      }
      if (url.includes("carbon-intensity/forecast")) {
        return jsonResponse(200, {
          zone: "US-CAL-CISO",
          forecast: [1, 2, 3, 4, 5].map((h) => ({
            carbonIntensity: 150,
            datetime: forecastHour(h),
          })),
        });
      }
      if (url.includes("power-breakdown")) return jsonResponse(200, {});
      // WattTime and EIA demand: no credentials/apiKey supplied for this
      // scenario, so those should never be called at all.
      throw new Error(`unexpected call: ${url}`);
    };
  }

  it("marks the current hour as 'live' with high confidence", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      electricityMapsToken: "test-token",
      fetchImpl: fetchWithLiveAndForecast(),
    });
    expect(snapshot.series[0].source).toBe("live");
    expect(snapshot.series[0].confidence).toBe("high");
    expect(snapshot.series[0].gCO2PerKWh).toBe(100);
  });

  it("marks provider-forecast-covered hours as 'forecast' with high confidence inside 24h", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      electricityMapsToken: "test-token",
      fetchImpl: fetchWithLiveAndForecast(),
    });
    for (const h of [1, 2, 3, 4, 5]) {
      expect(snapshot.series[h].source).toBe("forecast");
      expect(snapshot.series[h].gCO2PerKWh).toBe(150);
      expect(snapshot.series[h].confidence).toBe("high");
    }
  });

  it("still marks unforecast near-term hours as high confidence because of the live anchor", async () => {
    // Hour 10 has no EM forecast point, but a fresh live anchor at hour 0
    // means "near term" (<=24h) is still treated as high confidence.
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      electricityMapsToken: "test-token",
      fetchImpl: fetchWithLiveAndForecast(),
    });
    expect(snapshot.series[10].source).toBe("blend"); // decayed live anchor, not raw climatology
    expect(snapshot.series[10].confidence).toBe("high");
  });

  it("degrades to medium confidence between 24h and 72h out", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      electricityMapsToken: "test-token",
      fetchImpl: fetchWithLiveAndForecast(),
    });
    // Comfortably past both the live-anchor decay window (30h default) and
    // the <=24h "near term" boost, but still inside <=72h.
    expect(snapshot.series[50].confidence).toBe("medium");
  });

  it("degrades to low confidence beyond 72h", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      electricityMapsToken: "test-token",
      fetchImpl: fetchWithLiveAndForecast(),
    });
    expect(snapshot.series[100].confidence).toBe("low");
    expect(snapshot.series[100].source).toBe("climatology");
  });

  it("caps confidence at 'low' everywhere once the underlying profile is only modelled", async () => {
    const modelled = flatProfile({ source: "modelled" });
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: modelled,
      fetchImpl: explodingFetch,
    });
    expect(snapshot.series.every((p) => p.confidence === "low")).toBe(true);
  });

  it("decays a live anchor's multiplicative correction back to pure climatology by the decay horizon", async () => {
    const decayHours = 10;
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("carbon-intensity/latest")) {
        return jsonResponse(200, {
          zone: "US-CAL-CISO",
          carbonIntensity: 400, // 2x the 200 baseline
          datetime: LIVE_TS,
        });
      }
      return jsonResponse(200, { forecast: [] });
    };
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      electricityMapsToken: "test-token",
      correctionDecayHours: decayHours,
      fetchImpl,
    });
    expect(snapshot.series[0].gCO2PerKWh).toBe(400);
    // Half-decayed at the midpoint.
    expect(snapshot.series[5].gCO2PerKWh).toBeCloseTo(300, 0);
    // Fully decayed back to the climatology baseline at/after the horizon.
    expect(snapshot.series[decayHours].gCO2PerKWh).toBe(200);
    expect(snapshot.series[decayHours].source).toBe("climatology");
  });
});

describe("eia-demand attribution honesty", () => {
  const sensitiveProfile = flatProfile({
    demandSlots: Array.from({ length: HOURS_PER_WEEK }, () => 30_000),
    demandSensitivity: {
      slope: 4.6,
      intercept: -18.9,
      r: 0.79, // CAISO-like: demand genuinely does predict intensity here
      n: 2145,
      baselineRmse: 86,
      correctedRmse: 45,
      applied: true,
    },
  });

  it("does not blame 'wind and solar' when the fit says demand IS predictive here but we simply went offline", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      offline: true,
      profile: sensitiveProfile,
      fetchImpl: explodingFetch,
    });
    const demandProvider = snapshot.providers.find((p) => p.id === "eia-demand")!;
    expect(demandProvider.used).toBe(false);
    // `demandSensitivity.applied` is literally true above, so a message
    // claiming "intensity is driven by wind and solar, not demand" would
    // directly contradict the fit it is summarising.
    expect(demandProvider.detail).not.toMatch(/wind and solar/);
    expect(demandProvider.detail).toMatch(/offline/i);
  });

  it("still gives the 'not predictive here' message when the fit genuinely says so", async () => {
    const insensitiveProfile = flatProfile({
      demandSlots: Array.from({ length: HOURS_PER_WEEK }, () => 30_000),
      demandSensitivity: {
        slope: 0.1,
        intercept: 0,
        r: 0.01, // SPP/ERCOT-like: no relationship
        n: 2000,
        baselineRmse: 50,
        correctedRmse: 50,
        applied: false,
      },
    });
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: insensitiveProfile,
      eiaApiKey: "test-key",
      fetchImpl: explodingFetch,
    });
    const demandProvider = snapshot.providers.find((p) => p.id === "eia-demand")!;
    expect(demandProvider.used).toBe(false);
    expect(demandProvider.detail).toMatch(/wind and solar/);
  });

  it("asks for an API key when there is no key and the profile has no fitted sensitivity at all", async () => {
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(), // no demandSensitivity
      eiaApiKey: null,
      fetchImpl: explodingFetch,
    });
    const demandProvider = snapshot.providers.find((p) => p.id === "eia-demand")!;
    expect(demandProvider.used).toBe(false);
    expect(demandProvider.detail).toMatch(/EIA API key/);
  });
});

describe("precedence: provider forecast overrides a demand-corrected value", () => {
  it("uses the Electricity Maps forecast value even where demand would otherwise correct the hour", async () => {
    const profile = flatProfile({
      demandSlots: Array.from({ length: HOURS_PER_WEEK }, () => 30_000),
      demandSensitivity: {
        slope: 4.6,
        intercept: -18.9,
        r: 0.79,
        n: 2145,
        baselineRmse: 86,
        correctedRmse: 45,
        applied: true,
      },
    });
    const forecastTs = new Date(NOW.getTime() + 2 * 3_600_000).toISOString();
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("carbon-intensity/forecast")) {
        return jsonResponse(200, { forecast: [{ carbonIntensity: 321, datetime: forecastTs }] });
      }
      if (url.includes("region-data")) {
        // Actual demand well above normal, which alone would push this hour
        // up via the demand nowcast if the EM forecast were not present.
        const period = new URL(url).searchParams.get("start") ?? "2026-08-23T00";
        return jsonResponse(200, {
          response: {
            data: [{ period, type: "D", value: 40_000 }],
            total: 1,
          },
        });
      }
      return jsonResponse(200, {});
    };
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile,
      electricityMapsToken: "test-token",
      eiaApiKey: "test-key",
      fetchImpl,
    });
    expect(snapshot.series[2].gCO2PerKWh).toBe(321);
    expect(snapshot.series[2].source).toBe("forecast");
  });
});

describe("WattTime cross-check surfaces in notes without being blended into the series", () => {
  it("reports WattTime's dirtiness index when there is no marginal figure to compare, and never uses marginal MOER as the series value", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("/login")) return jsonResponse(200, { token: "tok" });
      if (url.includes("/v3/signal-index")) {
        return jsonResponse(200, {
          data: [{ point_time: NOW.toISOString(), value: 20 }],
        });
      }
      if (url.includes("/v3/forecast")) return jsonResponse(200, { data: [] });
      throw new Error(`unexpected call: ${url}`);
    };
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      wattTimeCredentials: { username: "u", password: "p" },
      fetchImpl,
    });
    // The forecast is empty here, so we fall back to quoting their index. It
    // must be described as a ranking against recent conditions on the grid —
    // not, as an earlier version claimed, a ranking across our next 24 hours.
    const note = snapshot.notes.find((n) => n.includes("out of 100"));
    expect(note).toBeDefined();
    expect(note).toContain("20 out of 100");
    expect(note).toContain("recent conditions");
    expect(note).not.toContain("next 24 hours");
    // The series stays at the flat 200 climatology value — MOER never leaks in.
    expect(snapshot.series[0].gCO2PerKWh).toBe(200);
  });

  it("explains the average-versus-marginal gap rather than printing two contradictory numbers", async () => {
    // 934 lbs/MWh is the real CAISO_NORTH marginal rate measured at
    // 2026-08-23T23:25Z, when the average intensity was 158 gCO2/kWh. Roughly
    // 424 g/kWh marginal against a 200 g/kWh flat average here.
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("/login")) return jsonResponse(200, { token: "tok" });
      if (url.includes("/v3/signal-index")) {
        return jsonResponse(200, {
          data: [{ point_time: NOW.toISOString(), value: 85 }],
        });
      }
      if (url.includes("/v3/forecast")) {
        return jsonResponse(200, {
          data: Array.from({ length: 12 }, (_, i) => ({
            point_time: new Date(NOW.getTime() + i * 300_000).toISOString(),
            value: 934.1,
          })),
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };
    const snapshot = await buildSnapshot(REGION, {
      now: NOW,
      profile: flatProfile(),
      wattTimeCredentials: { username: "u", password: "p" },
      fetchImpl,
    });
    const note = snapshot.notes.find((n) => n.includes("marginal"));
    expect(note).toBeDefined();
    // Both numbers, and the reason they differ.
    expect(note).toMatch(/42[0-9] g\/kWh/);
    expect(note).toContain("200 g/kWh");
    expect(note).toMatch(/gas/i);
    // And the series is still the average, untouched by MOER.
    expect(snapshot.series[0].gCO2PerKWh).toBe(200);
  });
});
