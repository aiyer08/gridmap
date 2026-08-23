import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GridSnapshot, RegionInfo } from "@/lib/types";

/**
 * The route is the seam between the browser and the grid engine, so its job is
 * narrow: resolve a location, hand back a snapshot, and never turn a provider
 * problem into a broken page. These tests fake the engine entirely and check the
 * branching and the failure behaviour.
 */

const CISO: RegionInfo = {
  ba: "CISO",
  name: "California Independent System Operator",
  shortName: "California grid (CAISO)",
  timezone: "America/Los_Angeles",
  state: "CA",
  approximate: true,
  matchedBy: "state",
};

const NYIS: RegionInfo = {
  ba: "NYIS",
  name: "New York Independent System Operator",
  shortName: "New York grid (NYISO)",
  timezone: "America/New_York",
  state: "NY",
  approximate: false,
  matchedBy: "zip3",
};

function fakeSnapshot(region: RegionInfo): GridSnapshot {
  return {
    region,
    now: {
      ts: "2026-08-23T21:00:00.000Z",
      gCO2PerKWh: 174,
      source: "blend",
      confidence: "high",
    },
    series: [],
    stats: { min: 120, max: 362, mean: 222, p10: 153, p90: 277 },
    providers: [],
    generatedAt: "2026-08-23T21:00:00.000Z",
    ttlSeconds: 900,
    notes: [],
  };
}

const buildSnapshot = vi.fn(async (region: RegionInfo) => fakeSnapshot(region));
const resolveRegionFromZip = vi.fn(async (zip: string) => {
  if (zip === "94305") {
    return { region: CISO, city: "Stanford", ok: true };
  }
  if (zip === "96813") {
    return {
      region: { ...CISO, ba: "HI", state: "HI", shortName: "Hawaii (HI)" },
      city: "Honolulu",
      ok: false,
      reason: "Hawaii's island grids aren't in the EIA-930 data we use.",
    };
  }
  return {
    region: CISO,
    ok: false,
    reason: "That doesn't look like a US ZIP code. Try five digits, like 94305.",
  };
});
const getRegionByBa = vi.fn((ba: string) =>
  ba.toUpperCase() === "NYIS" ? NYIS : undefined,
);

vi.mock("@/lib/grid/snapshot", () => ({
  buildSnapshot: (region: RegionInfo) => buildSnapshot(region),
}));

vi.mock("@/lib/region", () => ({
  DEFAULT_REGION: CISO,
  resolveRegionFromZip: (zip: string) => resolveRegionFromZip(zip),
  getRegionByBa: (ba: string) => getRegionByBa(ba),
}));

const { GET } = await import("./route");

/** The route only reads `nextUrl.searchParams`, so a plain URL stand-in is enough. */
function request(query: string) {
  const url = new URL(`http://localhost:3200/api/grid${query}`);
  return { nextUrl: url } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  buildSnapshot.mockClear();
  resolveRegionFromZip.mockClear();
  getRegionByBa.mockClear();
});

describe("GET /api/grid", () => {
  it("falls back to a default region when given nothing", async () => {
    const response = await GET(request(""));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.snapshot.region.ba).toBe("CISO");
    expect(resolveRegionFromZip).not.toHaveBeenCalled();
  });

  it("resolves a ZIP and passes the city through", async () => {
    const body = await (await GET(request("?zip=94305"))).json();
    expect(resolveRegionFromZip).toHaveBeenCalledWith("94305");
    expect(body.city).toBe("Stanford");
    expect(body.snapshot.region.ba).toBe("CISO");
  });

  it("honours an explicit region pick and marks it exact", async () => {
    const body = await (await GET(request("?ba=NYIS"))).json();
    expect(body.snapshot.region.ba).toBe("NYIS");
    // The user told us, so we stop calling it approximate.
    expect(body.snapshot.region.matchedBy).toBe("manual");
    expect(body.snapshot.region.approximate).toBe(false);
    expect(resolveRegionFromZip).not.toHaveBeenCalled();
  });

  it("prefers an explicit region over a ZIP when both are given", async () => {
    const body = await (await GET(request("?ba=NYIS&zip=94305"))).json();
    expect(body.snapshot.region.ba).toBe("NYIS");
    expect(resolveRegionFromZip).not.toHaveBeenCalled();
  });

  it("still returns a usable snapshot when the ZIP can't be placed", async () => {
    // An unusable answer is worse than an approximate one, so we serve a
    // default region alongside an honest explanation.
    const response = await GET(request("?zip=00000"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/ZIP/);
    expect(body.snapshot).toBeTruthy();
  });

  it("carries the unsupported-area explanation through verbatim", async () => {
    const body = await (await GET(request("?zip=96813"))).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/Hawaii/);
    expect(body.city).toBe("Honolulu");
  });

  it("rejects an unknown region code by name", async () => {
    const body = await (await GET(request("?ba=NOPE"))).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("NOPE");
  });

  it("trims whitespace around parameters", async () => {
    await GET(request("?zip=%2094305%20"));
    expect(resolveRegionFromZip).toHaveBeenCalledWith("94305");
  });

  it("sets a cache header that matches the freshest signal we have", async () => {
    const response = await GET(request(""));
    const cacheControl = response.headers.get("cache-control") ?? "";
    // Live demand lags about an hour, so 15 minutes is comfortably inside it.
    expect(cacheControl).toContain("s-maxage=900");
    expect(cacheControl).toContain("stale-while-revalidate");
  });

  it("returns 502 with a friendly message when the engine throws", async () => {
    buildSnapshot.mockRejectedValueOnce(new Error("EIA unreachable"));
    const response = await GET(request("?zip=94305"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    // Something a person can act on, with the cause kept for debugging.
    expect(body.reason).toMatch(/try again/i);
    expect(body.detail).toContain("EIA unreachable");
  });

  it("does not leak a non-Error throw as undefined", async () => {
    buildSnapshot.mockRejectedValueOnce("just a string");
    const body = await (await GET(request(""))).json();
    expect(body.detail).toBe("just a string");
  });
});
