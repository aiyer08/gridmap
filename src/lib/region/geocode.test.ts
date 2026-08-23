import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearGeocodeCache, formatPlace, geocodeZip } from "./geocode";

/** A real zippopotam.us body, trimmed to the fields we read. */
function zippopotamBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    country: "United States",
    "country abbreviation": "US",
    "post code": "94305",
    places: [
      {
        "place name": "Stanford",
        "state abbreviation": "CA",
        state: "California",
        latitude: "37.4236",
        longitude: "-122.1619",
        ...overrides,
      },
    ],
  });
}

function okFetch(body: string) {
  return vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
}

describe("geocodeZip", () => {
  beforeEach(() => {
    clearGeocodeCache();
  });

  it("parses a real response into city, state and coordinates", async () => {
    const result = await geocodeZip("94305", { fetchImpl: okFetch(zippopotamBody()) });
    expect(result).toEqual({
      zip: "94305",
      city: "Stanford",
      state: "CA",
      lat: 37.4236,
      lon: -122.1619,
    });
  });

  it("calls the documented no-key endpoint with an abort signal", async () => {
    const fetchImpl = okFetch(zippopotamBody());
    await geocodeZip("94305", { fetchImpl });
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zippopotam.us/us/94305");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects anything that isn't five digits without a network call", async () => {
    const fetchImpl = okFetch(zippopotamBody());
    for (const bad of ["", "9430", "943055", "abcde", "94305-1234"]) {
      expect(await geocodeZip(bad, { fetchImpl }), bad).toBeNull();
    }
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("returns null for an unknown ZIP (the API answers 404)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    expect(await geocodeZip("99999", { fetchImpl })).toBeNull();
  });

  it("fails soft when the network throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND api.zippopotam.us");
    }) as unknown as typeof fetch;
    expect(await geocodeZip("94305", { fetchImpl })).toBeNull();
  });

  it("fails soft on malformed JSON", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not json at all", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await geocodeZip("94305", { fetchImpl })).toBeNull();
  });

  it("fails soft on a well-formed body with no places", async () => {
    const fetchImpl = okFetch(JSON.stringify({ "post code": "94305", places: [] }));
    expect(await geocodeZip("94305", { fetchImpl })).toBeNull();
  });

  it("tolerates missing or junk fields rather than producing NaN", async () => {
    const fetchImpl = okFetch(
      zippopotamBody({ latitude: "not-a-number", longitude: null, "place name": "" }),
    );
    const result = await geocodeZip("94305", { fetchImpl });
    expect(result).toEqual({ zip: "94305", city: undefined, state: "CA", lat: undefined, lon: undefined });
  });

  it("aborts rather than hanging when the endpoint is slow", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;

    const started = Date.now();
    const result = await geocodeZip("94305", { fetchImpl, timeoutMs: 30 });
    expect(result).toBeNull();
    // The point is that it came back at all, quickly, instead of hanging.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("caches a hit so a repeated lookup costs nothing", async () => {
    const fetchImpl = okFetch(zippopotamBody());
    await geocodeZip("94305", { fetchImpl });
    await geocodeZip("94305", { fetchImpl });
    await geocodeZip("94305", { fetchImpl });
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("caches a miss too, so a bad ZIP isn't retried in a loop", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    await geocodeZip("99999", { fetchImpl });
    await geocodeZip("99999", { fetchImpl });
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when asked", async () => {
    const fetchImpl = okFetch(zippopotamBody());
    await geocodeZip("94305", { fetchImpl, useCache: false });
    await geocodeZip("94305", { fetchImpl, useCache: false });
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
  });

  it("returns null instead of throwing when the runtime has no fetch", async () => {
    const original = globalThis.fetch;
    // @ts-expect-error deliberately simulating a runtime without fetch
    delete globalThis.fetch;
    try {
      expect(await geocodeZip("94305", { useCache: false })).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("formatPlace", () => {
  it("builds the label the UI shows", () => {
    expect(formatPlace({ zip: "94301", city: "Palo Alto", state: "CA" })).toBe("Palo Alto, CA");
  });

  it("drops the comma when there is no state", () => {
    expect(formatPlace({ zip: "94301", city: "Palo Alto" })).toBe("Palo Alto");
  });

  it("returns undefined rather than an empty label", () => {
    expect(formatPlace(null)).toBeUndefined();
    expect(formatPlace(undefined)).toBeUndefined();
    expect(formatPlace({ zip: "94301", state: "CA" })).toBeUndefined();
  });
});
