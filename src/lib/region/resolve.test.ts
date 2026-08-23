import { describe, expect, it } from "vitest";

import {
  BA_METADATA,
  KNOWN_BA_CODES,
  LOAD_SERVING_BAS,
  UNSUPPORTED_AREAS,
} from "./balancingAuthorities";
import {
  DEFAULT_REGION,
  getRegionByBa,
  haversineKm,
  listRegions,
  resolveRegionFromLatLon,
  resolveRegionFromZip,
  resolveRegionFromZipSync,
} from "./resolve";
import {
  STATE_PRIMARY_BA,
  ZIP3_BA_OVERRIDES,
  ZIP3_TO_STATE,
  ZIP5_BA_OVERRIDES,
  matchZipToBa,
  normaliseZip,
  referencedBaCodes,
} from "./zipToBa";

/** All 50 states plus DC. Territories are handled separately, on purpose. */
const STATES_AND_DC = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
];

describe("resolveRegionFromZipSync — well-known ZIPs", () => {
  // [zip, expected BA, expected state, what's there]
  const cases: Array<[string, string, string, string]> = [
    ["94305", "CISO", "CA", "Stanford — PG&E, so CAISO"],
    ["90012", "LDWP", "CA", "Downtown LA — LADWP, not CAISO"],
    ["95814", "BANC", "CA", "Sacramento — SMUD, so BANC"],
    ["10001", "NYIS", "NY", "Manhattan"],
    ["02108", "ISNE", "MA", "Beacon Hill — leading zero"],
    ["77001", "ERCO", "TX", "Houston — ERCOT"],
    ["79901", "EPE", "TX", "El Paso — not ERCOT"],
    ["60601", "PJM", "IL", "Chicago Loop — ComEd is PJM"],
    ["30301", "SOCO", "GA", "Atlanta — Georgia Power"],
    ["33101", "FPL", "FL", "Miami"],
    ["98101", "SCL", "WA", "Downtown Seattle — Seattle City Light"],
    ["97201", "PGE", "OR", "Portland — Portland General Electric"],
    ["85001", "AZPS", "AZ", "Phoenix — APS side of the valley"],
    ["80202", "PSCO", "CO", "Denver — Xcel"],
    ["89101", "NEVP", "NV", "Las Vegas — NV Energy"],
    ["84101", "PACE", "UT", "Salt Lake City — Rocky Mountain Power"],
    ["37201", "TVA", "TN", "Nashville"],
    ["63101", "MISO", "MO", "St. Louis — Ameren"],
    ["55401", "MISO", "MN", "Minneapolis — Xcel"],
    ["73101", "SWPP", "OK", "Oklahoma City — SPP"],
    ["87101", "PNM", "NM", "Albuquerque"],
    ["19103", "PJM", "PA", "Center City Philadelphia"],
    ["20001", "PJM", "DC", "Washington DC"],
    ["28202", "DUK", "NC", "Uptown Charlotte — Duke Carolinas"],
    // Beyond the brief: the multi-BA states where a wrong answer is expensive.
    ["85281", "SRP", "AZ", "Tempe — SRP, not APS"],
    ["85701", "TEPC", "AZ", "Tucson — TEP"],
    ["92243", "IID", "CA", "El Centro — Imperial Irrigation District"],
    ["92262", "CISO", "CA", "Palm Springs — SCE island inside prefix 922"],
    ["95380", "TIDC", "CA", "Turlock Irrigation District"],
    ["95350", "BANC", "CA", "Modesto Irrigation District — a BANC member"],
    ["98402", "TPWR", "WA", "Tacoma Power"],
    ["98004", "PSEI", "WA", "Bellevue — Puget Sound Energy"],
    ["99201", "AVA", "WA", "Spokane — Avista"],
    ["98901", "PACW", "WA", "Yakima — Pacific Power"],
    ["97401", "BPAT", "OR", "Eugene — EWEB, a BPA customer"],
    ["83702", "IPCO", "ID", "Boise — Idaho Power"],
    ["83814", "AVA", "ID", "Coeur d'Alene — Avista"],
    ["80521", "SWPW", "CO", "Fort Collins — Platte River, now SPP West"],
    ["81001", "BHBA", "CO", "Pueblo — Black Hills Energy"],
    ["82001", "BHBA", "WY", "Cheyenne — Black Hills Energy"],
    ["57701", "BHBA", "SD", "Rapid City — Black Hills Power"],
    ["58102", "MISO", "ND", "Fargo — Xcel"],
    ["58501", "SWPW", "ND", "Bismarck — Montana-Dakota Utilities"],
    ["59101", "NWMT", "MT", "Billings — NorthWestern Energy"],
    ["35801", "TVA", "AL", "Huntsville — TVA, not Alabama Power"],
    ["39530", "SOCO", "MS", "Biloxi — Mississippi Power"],
    ["39201", "MISO", "MS", "Jackson — Entergy"],
    ["71101", "SWPP", "LA", "Shreveport — SWEPCO"],
    ["70112", "MISO", "LA", "New Orleans — Entergy"],
    ["72701", "SWPP", "AR", "Fayetteville AR — SWEPCO"],
    ["72201", "MISO", "AR", "Little Rock — Entergy"],
    ["40202", "LGEE", "KY", "Louisville — LG&E"],
    ["41011", "PJM", "KY", "Covington — Duke Energy Kentucky"],
    ["42301", "MISO", "KY", "Owensboro — Big Rivers"],
    ["42001", "TVA", "KY", "Paducah — TVA distributor"],
    ["62701", "MISO", "IL", "Springfield IL — Ameren"],
    ["46802", "PJM", "IN", "Fort Wayne — AEP I&M"],
    ["46204", "MISO", "IN", "Indianapolis — AES Indiana"],
    ["48226", "MISO", "MI", "Detroit — DTE"],
    ["32202", "JEA", "FL", "Jacksonville — JEA"],
    ["32301", "TAL", "FL", "Tallahassee"],
    ["32601", "GVL", "FL", "Gainesville"],
    ["32801", "FMPP", "FL", "Orlando — OUC"],
    ["33602", "TEC", "FL", "Tampa — TECO"],
    ["33701", "FPC", "FL", "St. Petersburg — Duke Energy Florida"],
    ["27601", "CPLE", "NC", "Raleigh — Duke Progress East"],
    ["28801", "CPLW", "NC", "Asheville — Duke Progress West"],
    ["29601", "DUK", "SC", "Greenville SC — Duke Carolinas"],
    ["29201", "SCEG", "SC", "Columbia — Dominion SC"],
    ["29577", "SC", "SC", "Myrtle Beach — Santee Cooper"],
    ["79101", "SWPP", "TX", "Amarillo — Xcel/SPS, not ERCOT"],
    ["77701", "MISO", "TX", "Beaumont — Entergy Texas, not ERCOT"],
    ["88001", "EPE", "NM", "Las Cruces — El Paso Electric"],
    ["88201", "SWPP", "NM", "Roswell — Xcel/SPS"],
    ["68102", "SWPP", "NE", "Omaha — OPPD"],
    ["66502", "SWPP", "KS", "Manhattan KS"],
    ["50309", "MISO", "IA", "Des Moines — MidAmerican"],
    ["53202", "MISO", "WI", "Milwaukee — We Energies"],
    ["43215", "PJM", "OH", "Columbus — AEP Ohio"],
    ["25301", "PJM", "WV", "Charleston WV — Appalachian Power"],
    ["23219", "PJM", "VA", "Richmond — Dominion"],
    ["21201", "PJM", "MD", "Baltimore — BGE"],
    ["19801", "PJM", "DE", "Wilmington — Delmarva"],
    ["07102", "PJM", "NJ", "Newark — PSE&G"],
    ["04101", "ISNE", "ME", "Portland ME"],
    ["05401", "ISNE", "VT", "Burlington VT"],
    ["03101", "ISNE", "NH", "Manchester NH"],
    ["02903", "ISNE", "RI", "Providence"],
    ["06103", "ISNE", "CT", "Hartford"],
  ];

  it.each(cases)("%s -> %s (%s)", (zip, expectedBa, expectedState) => {
    const result = resolveRegionFromZipSync(zip);
    expect(result.ok).toBe(true);
    expect(result.region.ba).toBe(expectedBa);
    expect(result.region.state).toBe(expectedState);
    expect(KNOWN_BA_CODES.has(result.region.ba)).toBe(true);
  });

  it("covers at least 25 distinct ZIPs, as the brief asked", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(new Set(cases.map(([zip]) => zip)).size).toBe(cases.length);
  });
});

describe("resolveRegionFromZipSync — honesty about confidence", () => {
  it("labels a hand-checked ZIP5 as an exact match", () => {
    const result = resolveRegionFromZipSync("92262");
    expect(result.region.matchedBy).toBe("zip");
    expect(result.region.approximate).toBe(false);
  });

  it("labels a prefix override as zip3 and approximate", () => {
    const result = resolveRegionFromZipSync("90012");
    expect(result.region.matchedBy).toBe("zip3");
    expect(result.region.approximate).toBe(true);
  });

  it("labels a state fallback as state and approximate", () => {
    const result = resolveRegionFromZipSync("94305");
    expect(result.region.matchedBy).toBe("state");
    expect(result.region.approximate).toBe(true);
  });

  it("never reports an unapproximated region from a prefix or state match", () => {
    for (const prefix of Object.keys(ZIP3_TO_STATE)) {
      const result = resolveRegionFromZipSync(`${prefix}01`);
      if (!result.ok) continue;
      if (result.region.matchedBy === "zip") continue;
      expect(result.region.approximate, prefix).toBe(true);
    }
  });
});

describe("resolveRegionFromZipSync — timezones", () => {
  const cases: Array<[string, string]> = [
    ["94305", "America/Los_Angeles"],
    ["10001", "America/New_York"],
    ["77001", "America/Chicago"],
    ["79901", "America/Denver"], //  El Paso is Mountain, unlike the rest of Texas
    ["37201", "America/Chicago"], // Nashville is Central
    ["37901", "America/New_York"], // Knoxville is Eastern
    ["85001", "America/Phoenix"], //  Arizona does not observe DST
    ["32501", "America/Chicago"], // Pensacola is Central, unlike most of Florida
    ["32801", "America/New_York"], // Orlando is Eastern
    ["46802", "America/Indiana/Indianapolis"],
    ["46402", "America/Chicago"], // Gary is Central, unlike most of Indiana
    ["42001", "America/Chicago"], // Paducah is Central, unlike most of Kentucky
    ["40202", "America/New_York"],
    ["83702", "America/Boise"], //   Southern Idaho is Mountain
    ["83814", "America/Los_Angeles"], // The panhandle is Pacific
    ["97914", "America/Boise"], //   Malheur County runs on Boise time
    ["57701", "America/Denver"], //  The Black Hills are Mountain
    ["49938", "America/Menominee"], // The western UP is Central
  ];

  it.each(cases)("%s clock is %s", (zip, timezone) => {
    expect(resolveRegionFromZipSync(zip).region.timezone).toBe(timezone);
  });
});

describe("resolveRegionFromZipSync — bad and unusual input", () => {
  it.each([
    [""],
    ["   "],
    ["abcde"],
    ["9430a"],
    ["943055"],
    ["!!!!!"],
    ["-1234"],
  ])("rejects %j with a friendly reason", (input) => {
    const result = resolveRegionFromZipSync(input);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toContain("ZIP");
    // Still hands back something renderable rather than throwing.
    expect(result.region.ba).toBe(DEFAULT_REGION.ba);
    expect(result.region.matchedBy).toBe("default");
  });

  it("recovers ZIPs that lost their leading zero to a number type", () => {
    expect(normaliseZip("2108")).toBe("02108");
    expect(resolveRegionFromZipSync("2108").region.ba).toBe("ISNE");
    expect(resolveRegionFromZipSync(String(2108)).region.ba).toBe("ISNE");
    expect(resolveRegionFromZipSync("7102").region.ba).toBe("PJM"); // Newark NJ
  });

  it("accepts ZIP+4 and surrounding whitespace", () => {
    for (const input of ["94305-1234", "94305 1234", "  94305  ", "94305"]) {
      expect(resolveRegionFromZipSync(input).region.ba, input).toBe("CISO");
    }
  });

  it("says so plainly for unassigned prefixes", () => {
    for (const zip of ["00000", "00123", "00299", "00412"]) {
      const result = resolveRegionFromZipSync(zip);
      expect(result.ok, zip).toBe(false);
      expect(result.reason, zip).toContain("recognise");
    }
  });
});

describe("resolveRegionFromZipSync — areas EIA-930 does not cover", () => {
  it.each([
    ["96813", "HI", "Honolulu"],
    ["96720", "HI", "Hilo"],
    ["99501", "AK", "Anchorage"],
    ["00601", "PR", "Adjuntas PR"],
    ["00802", "VI", "St. Thomas"],
    ["96910", "GU", "Guam"],
    ["09001", "AE", "Armed Forces Europe"],
    ["34001", "AA", "Armed Forces Americas"],
    ["96201", "AP", "Armed Forces Pacific"],
  ])("%s (%s) is refused politely, not snapped to the mainland", (zip, code) => {
    const result = resolveRegionFromZipSync(zip);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(UNSUPPORTED_AREAS[code].reason);
    // A region is still returned so the UI has a label and a clock…
    expect(result.region.state).toBe(code);
    expect(result.region.timezone).toBe(UNSUPPORTED_AREAS[code].timezone);
    // …but it must never carry a mainland BA code that would look like real data.
    expect(KNOWN_BA_CODES.has(result.region.ba)).toBe(false);
    expect(result.region.ba).not.toBe("CISO");
  });

  it("still offers the Electricity Maps zone for Hawaii and Alaska", () => {
    expect(resolveRegionFromZipSync("96813").region.electricityMapsZone).toBe("US-HI");
    expect(resolveRegionFromZipSync("99501").region.electricityMapsZone).toBe("US-AK");
  });
});

describe("coverage guarantees", () => {
  it("resolves every state and DC to a region, with no undefined anywhere", () => {
    const seen = new Map<string, string>();
    for (const [prefix, state] of Object.entries(ZIP3_TO_STATE)) {
      if (seen.has(state)) continue;
      seen.set(state, prefix);
    }

    for (const state of STATES_AND_DC) {
      const prefix = seen.get(state);
      expect(prefix, `no ZIP3 prefix for ${state}`).toBeDefined();
      const result = resolveRegionFromZipSync(`${prefix}01`);
      expect(result.region, state).toBeDefined();
      expect(result.region.ba, state).toBeTruthy();
      expect(result.region.shortName, state).toBeTruthy();
      expect(result.region.timezone, state).toBeTruthy();
      // Hawaii and Alaska are the only two we cannot actually serve.
      if (state === "HI" || state === "AK") {
        expect(result.ok, state).toBe(false);
      } else {
        expect(result.ok, state).toBe(true);
        expect(KNOWN_BA_CODES.has(result.region.ba), state).toBe(true);
      }
    }
  });

  it("gives every one of the 995 assigned prefixes a defined region", () => {
    expect(Object.keys(ZIP3_TO_STATE).length).toBe(995);
    for (const prefix of Object.keys(ZIP3_TO_STATE)) {
      const result = resolveRegionFromZipSync(`${prefix}01`);
      expect(result.region, prefix).toBeDefined();
      expect(result.region.ba.length, prefix).toBeGreaterThan(0);
      expect(result.region.timezone, prefix).toContain("/");
    }
  });

  it("maps every state in the ZIP3 table to a BA or an explicit non-coverage note", () => {
    const states = new Set(Object.values(ZIP3_TO_STATE));
    for (const state of states) {
      const covered = state in STATE_PRIMARY_BA || state in UNSUPPORTED_AREAS;
      expect(covered, `${state} has neither a primary BA nor an unsupported note`).toBe(true);
    }
  });

  it("never points at a BA code the EIA has not heard of", () => {
    for (const code of referencedBaCodes()) {
      expect(KNOWN_BA_CODES.has(code), code).toBe(true);
      expect(BA_METADATA[code].generationOnly, code).toBeUndefined();
    }
  });

  it("keeps every override prefix and ZIP inside the assigned ranges", () => {
    for (const prefix of Object.keys(ZIP3_BA_OVERRIDES)) {
      expect(ZIP3_TO_STATE[prefix], prefix).toBeDefined();
    }
    for (const zip of Object.keys(ZIP5_BA_OVERRIDES)) {
      expect(zip, zip).toMatch(/^\d{5}$/);
      expect(ZIP3_TO_STATE[zip.slice(0, 3)], zip).toBeDefined();
    }
  });

  it("only overrides a prefix when it actually changes the answer", () => {
    for (const [prefix, ba] of Object.entries(ZIP3_BA_OVERRIDES)) {
      const state = ZIP3_TO_STATE[prefix];
      // 982/986/993 keep the state default on purpose — the comment explains
      // which utility they are, which is worth more than the saved line.
      if (STATE_PRIMARY_BA[state] === ba) {
        expect(["982", "986", "993"], prefix).toContain(prefix);
      }
    }
  });

  it("returns undefined from matchZipToBa only for uncovered areas", () => {
    expect(matchZipToBa("94305")?.ba).toBe("CISO");
    expect(matchZipToBa("96813")).toBeUndefined();
    expect(matchZipToBa("99501")).toBeUndefined();
    expect(matchZipToBa("00000")).toBeUndefined();
  });
});

describe("resolveRegionFromLatLon", () => {
  it("measures great-circle distance sensibly", () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0);
    // Los Angeles to New York is about 3,940 km.
    expect(haversineKm(34.05, -118.25, 40.71, -74.01)).toBeGreaterThan(3800);
    expect(haversineKm(34.05, -118.25, 40.71, -74.01)).toBeLessThan(4100);
  });

  it("snaps well-known coordinates to a plausible region", () => {
    expect(resolveRegionFromLatLon(34.05, -118.25).ba).toBe("LDWP");
    expect(resolveRegionFromLatLon(47.61, -122.33).ba).toBe("SCL");
    expect(resolveRegionFromLatLon(30.27, -97.74).ba).toBe("ERCO");
    expect(resolveRegionFromLatLon(42.36, -71.06).ba).toBe("ISNE");
    expect(resolveRegionFromLatLon(33.45, -112.07).ba).toBe("AZPS");
  });

  it("is always flagged approximate, because a centroid is not a territory", () => {
    const region = resolveRegionFromLatLon(39.74, -104.99);
    expect(region.approximate).toBe(true);
    expect(region.matchedBy).toBe("state");
    // "manual" is reserved for a region the user picked themselves.
    expect(region.matchedBy).not.toBe("manual");
  });

  it("never lands on a generation-only BA", () => {
    for (let lat = 26; lat <= 48; lat += 2) {
      for (let lon = -124; lon <= -68; lon += 4) {
        const region = resolveRegionFromLatLon(lat, lon);
        expect(BA_METADATA[region.ba].generationOnly, `${lat},${lon}`).toBeUndefined();
      }
    }
  });

  it("falls back to the default region for nonsense coordinates", () => {
    expect(resolveRegionFromLatLon(Number.NaN, 0)).toEqual(DEFAULT_REGION);
    expect(resolveRegionFromLatLon(0, Number.POSITIVE_INFINITY)).toEqual(DEFAULT_REGION);
  });
});

describe("listRegions", () => {
  it("offers every load-serving BA, sorted by the label we show", () => {
    const regions = listRegions();
    expect(regions.length).toBe(LOAD_SERVING_BAS.length);
    const labels = regions.map((r) => r.shortName);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("marks a hand-picked region as exact and manual", () => {
    for (const region of listRegions()) {
      expect(region.matchedBy, region.ba).toBe("manual");
      expect(region.approximate, region.ba).toBe(false);
      expect(region.state, region.ba).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("leaves out federal hydro and merchant plants nobody is metered on", () => {
    const codes = new Set(listRegions().map((r) => r.ba));
    for (const excluded of ["SEPA", "SPA", "YAD", "AVRN", "DEAA", "GRID", "GWA", "SIKE"]) {
      expect(codes.has(excluded), excluded).toBe(false);
    }
    expect(codes.has("CISO")).toBe(true);
    expect(codes.has("ERCO")).toBe(true);
  });
});

describe("getRegionByBa", () => {
  it("finds a region by code, case-insensitively", () => {
    expect(getRegionByBa("CISO")?.shortName).toBe("California grid (CAISO)");
    expect(getRegionByBa(" erco ")?.ba).toBe("ERCO");
    expect(getRegionByBa("CISO")?.matchedBy).toBe("manual");
    expect(getRegionByBa("CISO")?.approximate).toBe(false);
  });

  it("redirects a retired code to whoever took over the load", () => {
    // WACM and WAUW stopped reporting on 2026-04-01.
    expect(getRegionByBa("WACM")?.ba).toBe("SWPW");
    expect(getRegionByBa("WAUW")?.ba).toBe("SWPW");
    expect(getRegionByBa("AEC")?.ba).toBe("SOCO");
    expect(getRegionByBa("NSB")?.ba).toBe("FPL");
    expect(getRegionByBa("OVEC")?.ba).toBe("PJM");
    // A redirect is a guess about the user's intent, so flag it.
    expect(getRegionByBa("WACM")?.approximate).toBe(true);
  });

  it("returns undefined rather than guessing for an unknown code", () => {
    expect(getRegionByBa("NOPE")).toBeUndefined();
    expect(getRegionByBa("")).toBeUndefined();
    expect(getRegionByBa("DESC")).toBeUndefined();
    // Our own uncovered-area placeholders are not BAs.
    expect(getRegionByBa("HI")).toBeUndefined();
  });
});

describe("DEFAULT_REGION", () => {
  it("is CAISO, and says it is a default", () => {
    expect(DEFAULT_REGION.ba).toBe("CISO");
    expect(DEFAULT_REGION.state).toBe("CA");
    expect(DEFAULT_REGION.matchedBy).toBe("default");
    expect(DEFAULT_REGION.approximate).toBe(true);
    expect(DEFAULT_REGION.electricityMapsZone).toBe("US-CAL-CISO");
  });
});

describe("resolveRegionFromZip (async)", () => {
  it("adds a city and coordinates when the geocoder answers", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          "post code": "94305",
          places: [
            {
              "place name": "Stanford",
              "state abbreviation": "CA",
              latitude: "37.4236",
              longitude: "-122.1619",
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await resolveRegionFromZip("94305", { fetchImpl, useCache: false });
    expect(result.ok).toBe(true);
    expect(result.region.ba).toBe("CISO");
    expect(result.city).toBe("Stanford");
    expect(result.state).toBe("CA");
    expect(result.lat).toBeCloseTo(37.4236, 3);
    expect(result.lon).toBeCloseTo(-122.1619, 3);
  });

  it("still returns the right region when the geocoder is down", async () => {
    const fetchImpl = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    const result = await resolveRegionFromZip("77001", { fetchImpl, useCache: false });
    expect(result.ok).toBe(true);
    expect(result.region.ba).toBe("ERCO");
    expect(result.city).toBeUndefined();
  });

  it("does not call the network at all when geocoding is off", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await resolveRegionFromZip("10001", { fetchImpl, geocode: false });
    expect(calls).toBe(0);
    expect(result.region.ba).toBe("NYIS");
  });

  it("keeps the refusal for an uncovered area even if geocoding succeeds", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          places: [
            {
              "place name": "Honolulu",
              "state abbreviation": "HI",
              latitude: "21.3069",
              longitude: "-157.8583",
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await resolveRegionFromZip("96813", { fetchImpl, useCache: false });
    expect(result.ok).toBe(false);
    expect(result.city).toBe("Honolulu");
    expect(result.reason).toBe(UNSUPPORTED_AREAS.HI.reason);
  });
});
