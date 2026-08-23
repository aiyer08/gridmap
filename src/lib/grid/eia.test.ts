import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EiaError,
  buildEiaDataUrl,
  fetchEiaRows,
  fetchFuelTypeRows,
  formatEiaPeriod,
  parseEiaPeriod,
  respondentChain,
  rowsToSamples,
  type EiaRow,
} from "./eia";
import type { FetchLike, FetchLikeResponse } from "./types";

function jsonResponse(status: number, body: unknown): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Parses `offset`/`length` out of a v2 data URL so fakes can page correctly. */
function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatEiaPeriod / parseEiaPeriod round-tripping", () => {
  it("formats a Date as EIA's hour-truncated YYYY-MM-DDTHH", () => {
    expect(formatEiaPeriod(new Date("2026-08-22T14:37:19.000Z"))).toBe("2026-08-22T14");
  });

  it("passes a pre-formatted string straight through", () => {
    expect(formatEiaPeriod("2026-08-22T14")).toBe("2026-08-22T14");
  });

  it("parses the bare hour-truncated form as UTC", () => {
    expect(parseEiaPeriod("2026-08-22T14")).toBe(Date.UTC(2026, 7, 22, 14, 0));
  });

  it("parses a space-separated variant the same way", () => {
    expect(parseEiaPeriod("2026-08-22 14")).toBe(Date.UTC(2026, 7, 22, 14, 0));
  });

  it("parses an explicit Z suffix and a numeric offset consistently", () => {
    expect(parseEiaPeriod("2026-08-22T14:00Z")).toBe(Date.UTC(2026, 7, 22, 14, 0));
    // 14:00-05:00 is 19:00 UTC.
    expect(parseEiaPeriod("2026-08-22T14:00-05:00")).toBe(Date.UTC(2026, 7, 22, 19, 0));
    expect(parseEiaPeriod("2026-08-22T14:00-0500")).toBe(Date.UTC(2026, 7, 22, 19, 0));
  });

  it("rejects garbage rather than returning a wrong-but-plausible timestamp", () => {
    expect(parseEiaPeriod("not-a-period")).toBeNull();
    expect(parseEiaPeriod("")).toBeNull();
  });

  it("round-trips: formatting a parsed period and re-parsing it is a no-op", () => {
    const original = "2026-01-01T00";
    const epoch = parseEiaPeriod(original);
    expect(epoch).not.toBeNull();
    const reformatted = formatEiaPeriod(new Date(epoch!));
    expect(reformatted).toBe(original);
    expect(parseEiaPeriod(reformatted)).toBe(epoch);
  });
});

describe("respondentChain", () => {
  it("walks BA -> parent region -> national aggregate for a BA with a parent", () => {
    expect(respondentChain("CISO")).toEqual(["CISO", "CAL", "US48"]);
  });

  it("walks BA -> national aggregate for a BA with no known parent", () => {
    // A made-up code, deliberately absent from EIA_PARENT_REGION.
    expect(respondentChain("ZZZZ")).toEqual(["ZZZZ", "US48"]);
  });

  it("stops at the national aggregate for a region aggregate input", () => {
    expect(respondentChain("CAL")).toEqual(["CAL", "US48"]);
  });

  it("is a single-element chain for the national aggregate itself", () => {
    expect(respondentChain("US48")).toEqual(["US48"]);
  });

  it("is case-insensitive", () => {
    expect(respondentChain("ciso")).toEqual(["CISO", "CAL", "US48"]);
  });
});

describe("fetchEiaRows paging", () => {
  const baseRequest = {
    apiKey: "test-key",
    path: "electricity/rto/fuel-type-data",
    facets: { respondent: ["CISO"] },
    start: "2026-08-01T00",
    end: "2026-08-02T00",
  };

  function rowAt(period: string): EiaRow {
    return { period, respondent: "CISO", fueltype: "NG", value: 100 };
  }

  it("pages through multiple full pages via response.total, stopping exactly at the total", async () => {
    const totalRows = 5;
    const pageSize = 2;
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      const params = paramsOf(url);
      const offset = Number(params.get("offset"));
      const length = Number(params.get("length"));
      const remaining = Math.max(0, totalRows - offset);
      const rows = Array.from({ length: Math.min(length, remaining) }, (_, i) =>
        rowAt(`2026-08-01T${String(offset + i).padStart(2, "0")}`),
      );
      return jsonResponse(200, { response: { total: totalRows, data: rows } });
    });
    const result = await fetchEiaRows(baseRequest, { fetchImpl, pageSize });
    expect(result.rows).toHaveLength(totalRows);
    expect(result.total).toBe(totalRows);
    expect(result.pages).toBe(3); // 2 + 2 + 1
    expect(result.truncated).toBe(false);
  });

  it("stops on the first short page even without a reported total", async () => {
    const pageSize = 5;
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      calls += 1;
      // First page comes back short (3 < 5), which alone must end paging.
      const rows = Array.from({ length: 3 }, (_, i) => rowAt(`2026-08-01T0${i}`));
      return jsonResponse(200, { response: { data: rows } });
    });
    const result = await fetchEiaRows(baseRequest, { fetchImpl, pageSize, maxPages: 10 });
    expect(result.rows).toHaveLength(3);
    expect(result.pages).toBe(1);
    expect(calls).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("stops on an empty page without treating it as an error", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, { response: { data: [] } }));
    const result = await fetchEiaRows(baseRequest, { fetchImpl });
    expect(result.rows).toEqual([]);
    expect(result.pages).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("stops at maxPages and reports truncated when full pages never end", async () => {
    const pageSize = 3;
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      calls += 1;
      // Always returns a full page and never reports a total, so without
      // maxPages this would page forever.
      const rows = Array.from({ length: pageSize }, (_, i) => rowAt(`2026-08-01T0${i}`));
      return jsonResponse(200, { response: { data: rows } });
    });
    const result = await fetchEiaRows(baseRequest, { fetchImpl, pageSize, maxPages: 4 });
    expect(calls).toBe(4);
    expect(result.rows).toHaveLength(4 * pageSize);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).not.toMatch(/time budget/); // this is the maxPages guard, not the clock
  });

  it("stops on the time budget and reports truncated, without hanging", async () => {
    // Control the clock explicitly so this is deterministic rather than a
    // real-time race: the deadline is computed once, then Date.now() is
    // checked before every page. We make the second check land past it.
    const nowValues = [1_000, 1_000, 1_000_000];
    let call = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowValues[Math.min(call++, nowValues.length - 1)]);
    const pageSize = 3;
    let fetchCalls = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      fetchCalls += 1;
      const rows = Array.from({ length: pageSize }, (_, i) => rowAt(`2026-08-01T0${i}`));
      return jsonResponse(200, { response: { data: rows } });
    });
    const result = await fetchEiaRows(baseRequest, {
      fetchImpl,
      pageSize,
      maxPages: 40,
      totalTimeoutMs: 50,
    });
    // Only the first page's worth of work happened; the loop bailed before a
    // second network call.
    expect(fetchCalls).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/time budget/);
  });

  it("throws EiaError with the API's message on a non-200 response", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      jsonResponse(403, { error: { code: "INVALID_API_KEY", message: "Invalid API key" } }),
    );
    await expect(fetchEiaRows(baseRequest, { fetchImpl })).rejects.toMatchObject({
      name: "EiaError",
      status: 403,
      message: "Invalid API key",
    });
  });

  it("throws EiaError for a string-shaped error body", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(400, { error: "Bad request" }));
    await expect(fetchEiaRows(baseRequest, { fetchImpl })).rejects.toThrow(EiaError);
    await expect(fetchEiaRows(baseRequest, { fetchImpl })).rejects.toThrow("Bad request");
  });

  it("throws EiaError for a 200 response carrying an error envelope (malformed facet)", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      jsonResponse(200, { data: { error: "invalid facet" } }),
    );
    await expect(fetchEiaRows(baseRequest, { fetchImpl })).rejects.toThrow(EiaError);
  });

  it("falls back to a plain HTTP-status message when the error body is unusable", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(500, null));
    await expect(fetchEiaRows(baseRequest, { fetchImpl })).rejects.toThrow(/HTTP 500/);
  });

  it("collects warnings from both the top-level and response-nested locations", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      jsonResponse(200, {
        warnings: [{ warning: "top-level warning" }],
        response: {
          data: [rowAt("2026-08-01T00")],
          warnings: [{ description: "nested warning" }],
        },
      }),
    );
    const result = await fetchEiaRows(baseRequest, { fetchImpl });
    expect(result.warnings).toEqual(["top-level warning", "nested warning"]);
  });
});

describe("buildEiaDataUrl", () => {
  it("clamps the page length to EIA's 5000-row maximum", () => {
    const url = buildEiaDataUrl({
      apiKey: "k",
      path: "electricity/rto/fuel-type-data",
      facets: { respondent: ["CISO"] },
      start: "2026-08-01T00",
      end: "2026-08-02T00",
      length: 999_999,
    });
    expect(paramsOf(url).get("length")).toBe("5000");
  });

  it("encodes multiple facet values as repeated bracketed params", () => {
    const url = buildEiaDataUrl({
      apiKey: "k",
      path: "electricity/rto/fuel-type-data",
      facets: { respondent: ["CISO", "PJM"] },
      start: "2026-08-01T00",
      end: "2026-08-02T00",
    });
    expect(paramsOf(url).getAll("facets[respondent][]")).toEqual(["CISO", "PJM"]);
  });
});

describe("fetchFuelTypeRows", () => {
  it("scopes the request to a single respondent facet", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      expect(paramsOf(url).getAll("facets[respondent][]")).toEqual(["CISO"]);
      return jsonResponse(200, { response: { data: [] } });
    });
    await fetchFuelTypeRows(
      { apiKey: "k", ba: "ciso", start: "2026-08-01T00", end: "2026-08-02T00" },
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe("rowsToSamples", () => {
  const t0 = "2026-08-22T14";
  const t1 = "2026-08-22T15";

  it("clamps negative generation to zero rather than subtracting it", () => {
    // Real case: CISO reports SUN below zero overnight (inverter parasitic
    // draw counted as negative net generation).
    const rows: EiaRow[] = [
      { period: t0, fueltype: "SUN", value: -37 },
      { period: t0, fueltype: "NG", value: 500 },
      { period: t0, fueltype: "NUC", value: 200 },
    ];
    const samples = rowsToSamples(rows);
    expect(samples).toHaveLength(1);
    // Solar contributes 0 MWh, not -37, so it must not appear as a negative
    // share and must not reduce the total below what gas+nuclear provide.
    expect(samples[0].fuelMix.solar).toBeUndefined();
    expect(samples[0].totalMwh).toBe(700);
  });

  it("drops storage (battery, pumped storage) from the mix entirely", () => {
    const rows: EiaRow[] = [
      { period: t0, fueltype: "NG", value: 500 },
      { period: t0, fueltype: "NUC", value: 200 },
      { period: t0, fueltype: "BAT", value: 300 },
      { period: t0, fueltype: "PS", value: 150 },
    ];
    const samples = rowsToSamples(rows);
    expect(samples).toHaveLength(1);
    expect(samples[0].fuelMix.storage).toBeUndefined();
    // Total must reflect only NG+NUC, not the storage rows.
    expect(samples[0].totalMwh).toBe(700);
    const mixSum = Object.values(samples[0].fuelMix).reduce((a, b) => a + (b ?? 0), 0);
    expect(mixSum).toBeCloseTo(1, 5);
  });

  it("drops an hour whose total generation is far below the median hour (partial report)", () => {
    // Two normal hours (~1000 MWh, several fuels) and one thin, partially
    // reported hour that should be filtered by the default 25%-of-median floor.
    const rows: EiaRow[] = [
      { period: t0, fueltype: "NG", value: 600 },
      { period: t0, fueltype: "NUC", value: 400 },
      { period: t1, fueltype: "NG", value: 600 },
      { period: t1, fueltype: "NUC", value: 400 },
      { period: "2026-08-22T16", fueltype: "NUC", value: 50 },
      { period: "2026-08-22T16", fueltype: "NG", value: 30 },
    ];
    const samples = rowsToSamples(rows);
    expect(samples).toHaveLength(2);
    expect(samples.some((s) => s.epochMs === parseEiaPeriodForTest("2026-08-22T16"))).toBe(false);
  });

  it("drops an hour with fewer than the minimum number of distinct fuels", () => {
    const rows: EiaRow[] = [
      { period: t0, fueltype: "NG", value: 1000 }, // only one fuel this hour
      { period: t1, fueltype: "NG", value: 600 },
      { period: t1, fueltype: "NUC", value: 400 },
    ];
    const samples = rowsToSamples(rows, { minFuels: 2 });
    expect(samples).toHaveLength(1);
    expect(samples[0].ts).toBe(new Date(Date.UTC(2026, 7, 22, 15)).toISOString());
  });

  it("coerces a quoted numeric value the way the API has historically emitted it", () => {
    const rows: EiaRow[] = [
      { period: t0, fueltype: "NG", value: "600" as unknown as number },
      { period: t0, fueltype: "NUC", value: "400" as unknown as number },
    ];
    const samples = rowsToSamples(rows);
    expect(samples[0].totalMwh).toBe(1000);
  });

  it("skips rows with an unparseable period or missing fuel type, without throwing", () => {
    const rows: EiaRow[] = [
      { period: "garbage", fueltype: "NG", value: 600 },
      { period: t0, fueltype: "NG", value: 600 },
      { period: t0, fueltype: "NUC", value: 400 },
    ];
    expect(() => rowsToSamples(rows)).not.toThrow();
  });

  it("returns an empty array for no rows, not an error", () => {
    expect(rowsToSamples([])).toEqual([]);
  });

  it("uses the code-level lifecycle factor for geothermal rather than the mixed 'other' bucket", () => {
    // GEO is bucketed into "other" for display, but priced at 38 gCO2/kWh
    // (near-clean) rather than the 300 g "other" blended factor.
    const rows: EiaRow[] = [
      { period: t0, fueltype: "GEO", value: 500 },
      { period: t0, fueltype: "NG", value: 500 },
    ];
    const samples = rowsToSamples(rows);
    // (500*38 + 500*490) / 1000 = 264, not (500*300 + 500*490)/1000 = 395.
    expect(samples[0].gCO2PerKWh).toBeCloseTo(264, 0);
  });
});

/** Small local helper so the "partial hour dropped" test can locate it precisely. */
function parseEiaPeriodForTest(period: string): number {
  return parseEiaPeriod(period)!;
}
