import { describe, expect, it } from "vitest";

import {
  BALANCING_AUTHORITIES,
  BA_METADATA,
  EIA_NATIONAL_AGGREGATE,
  EIA_REGION_AGGREGATES,
  KNOWN_BA_CODES,
  LOAD_SERVING_BAS,
  RETIRED_BA_SUCCESSORS,
  UNSUPPORTED_AREAS,
  getBalancingAuthority,
  isEiaRespondent,
  parentRegionFor,
} from "./balancingAuthorities";

/**
 * The exact respondent codes that returned hourly fuel-type data from the EIA v2
 * API on 2026-08-23 (a 48-hour pull over 2026-08-18 → 2026-08-20), minus the 14
 * regional aggregates. If EIA adds or retires a BA this test will fail, which is
 * the point: a stale code means a silent empty response in production.
 */
const LIVE_EIA_BA_CODES = [
  "AECI", "AVA", "AVRN", "AZPS", "BANC", "BHBA", "BPAT", "CHPD", "CISO",
  "CPLE", "CPLW", "DEAA", "DOPD", "DUK", "EPE", "ERCO", "FMPP", "FPC",
  "FPL", "GCPD", "GRID", "GVL", "GWA", "HST", "IID", "IPCO", "ISNE",
  "JEA", "LDWP", "LGEE", "MISO", "NEVP", "NWMT", "NYIS", "PACE", "PACW",
  "PGE", "PJM", "PNM", "PSCO", "PSEI", "SC", "SCEG", "SCL", "SEC",
  "SEPA", "SIKE", "SOCO", "SPA", "SRP", "SWPP", "SWPW", "TAL", "TEC",
  "TEPC", "TIDC", "TPWR", "TVA", "WALC", "YAD",
].sort();

describe("balancing authority table", () => {
  it("matches the live EIA-930 respondent list exactly", () => {
    expect([...KNOWN_BA_CODES].sort()).toEqual(LIVE_EIA_BA_CODES);
  });

  it("has no duplicate codes", () => {
    expect(KNOWN_BA_CODES.size).toBe(BALANCING_AUTHORITIES.length);
  });

  it("does not resolve to WACM or WAUW, which EIA retired on 2026-04-01", () => {
    expect(KNOWN_BA_CODES.has("WACM")).toBe(false);
    expect(KNOWN_BA_CODES.has("WAUW")).toBe(false);
    expect(RETIRED_BA_SUCCESSORS.WACM).toBe("SWPW");
    expect(RETIRED_BA_SUCCESSORS.WAUW).toBe("SWPW");
  });

  it("gives every BA a name, a friendly label, a timezone and a centroid", () => {
    for (const ba of BALANCING_AUTHORITIES) {
      // JEA's official name really is just "JEA", hence >= rather than >.
      expect(ba.name.length, ba.ba).toBeGreaterThanOrEqual(3);
      expect(ba.shortName.length, ba.ba).toBeGreaterThan(3);
      // A homeowner should recognise the label, so it must not be bare jargon.
      expect(ba.shortName, ba.ba).not.toBe(ba.ba);
      expect(ba.timezone, ba.ba).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
      expect(ba.states.length, ba.ba).toBeGreaterThan(0);
      expect(ba.lat, ba.ba).toBeGreaterThan(24);
      expect(ba.lat, ba.ba).toBeLessThan(50);
      expect(ba.lon, ba.ba).toBeGreaterThan(-125);
      expect(ba.lon, ba.ba).toBeLessThan(-66);
    }
  });

  it("uses only real two-letter state codes", () => {
    const valid = /^[A-Z]{2}$/;
    for (const ba of BALANCING_AUTHORITIES) {
      for (const state of ba.states) expect(state, ba.ba).toMatch(valid);
    }
  });

  it("builds Electricity Maps zone keys that agree with the BA code", () => {
    for (const ba of BALANCING_AUTHORITIES) {
      if (!ba.electricityMapsZone) continue;
      // Every US BA-level zone is US-<REGION>-<BA CODE>.
      expect(ba.electricityMapsZone, ba.ba).toMatch(/^US-[A-Z]+-[A-Z]+$/);
      expect(ba.electricityMapsZone.split("-").at(-1), ba.ba).toBe(ba.ba);
    }
  });

  it("leaves the Electricity Maps zone off the BAs that genuinely lack one", () => {
    // Verified against https://api.electricitymap.org/v3/zones on 2026-08-23.
    const withoutZone = BALANCING_AUTHORITIES.filter((ba) => !ba.electricityMapsZone)
      .map((ba) => ba.ba)
      .sort();
    expect(withoutZone).toEqual(["AVRN", "BHBA", "DEAA", "GRID", "GWA", "SIKE", "SWPW"]);
  });

  it("points every BA at a real EIA regional aggregate", () => {
    for (const ba of BALANCING_AUTHORITIES) {
      expect(parentRegionFor(ba.ba), ba.ba).toBe(ba.parentRegion);
      expect(EIA_REGION_AGGREGATES[ba.parentRegion], ba.ba).toBeTruthy();
    }
  });

  it("groups the obvious BAs under the aggregate you would expect", () => {
    expect(parentRegionFor("CISO")).toBe("CAL");
    expect(parentRegionFor("LDWP")).toBe("CAL");
    expect(parentRegionFor("ERCO")).toBe("TEX");
    expect(parentRegionFor("PJM")).toBe("MIDA");
    expect(parentRegionFor("ISNE")).toBe("NE");
    expect(parentRegionFor("NYIS")).toBe("NY");
    expect(parentRegionFor("TVA")).toBe("TEN");
    expect(parentRegionFor("SOCO")).toBe("SE");
    expect(parentRegionFor("DUK")).toBe("CAR");
    expect(parentRegionFor("FPL")).toBe("FLA");
    expect(parentRegionFor("MISO")).toBe("MIDW");
    expect(parentRegionFor("SWPP")).toBe("CENT");
    expect(parentRegionFor("BPAT")).toBe("NW");
    expect(parentRegionFor("AZPS")).toBe("SW");
    // The thin ones, which is the whole reason this lookup exists.
    expect(parentRegionFor("SWPW")).toBe("NW");
    expect(parentRegionFor("BHBA")).toBe("NW");
    expect(parentRegionFor("GVL")).toBe("FLA");
    expect(parentRegionFor("HST")).toBe("FLA");
    expect(parentRegionFor("SIKE")).toBe("MIDW");
  });

  it("returns undefined for an unknown parent region", () => {
    expect(parentRegionFor("NOPE")).toBeUndefined();
    expect(parentRegionFor("HI")).toBeUndefined();
  });

  it("excludes generation-only BAs from the load-serving list", () => {
    const generationOnly = BALANCING_AUTHORITIES.filter((ba) => ba.generationOnly)
      .map((ba) => ba.ba)
      .sort();
    expect(generationOnly).toEqual([
      "AVRN", "DEAA", "GRID", "GWA", "SEPA", "SIKE", "SPA", "YAD",
    ]);
    for (const ba of LOAD_SERVING_BAS) expect(ba.generationOnly).toBeUndefined();
    expect(LOAD_SERVING_BAS.length).toBe(BALANCING_AUTHORITIES.length - 8);
  });

  it("accepts aggregates and retired codes as EIA respondents", () => {
    expect(isEiaRespondent("CISO")).toBe(true);
    expect(isEiaRespondent("ciso")).toBe(true);
    expect(isEiaRespondent("CAL")).toBe(true);
    expect(isEiaRespondent(EIA_NATIONAL_AGGREGATE)).toBe(true);
    expect(isEiaRespondent("WACM")).toBe(true);
    // Not respondents: our own placeholders for uncovered areas.
    expect(isEiaRespondent("HI")).toBe(false);
    expect(isEiaRespondent("AK")).toBe(false);
    expect(isEiaRespondent("DESC")).toBe(false);
  });

  it("points every retirement at a BA that still reports", () => {
    for (const [retired, successor] of Object.entries(RETIRED_BA_SUCCESSORS)) {
      expect(KNOWN_BA_CODES.has(retired), retired).toBe(false);
      expect(KNOWN_BA_CODES.has(successor), `${retired} -> ${successor}`).toBe(true);
    }
  });

  it("looks BAs up case-insensitively", () => {
    expect(getBalancingAuthority("erco")?.shortName).toBe("Texas grid (ERCOT)");
    expect(getBalancingAuthority("ERCO")).toBe(BA_METADATA.ERCO);
    expect(getBalancingAuthority("NOPE")).toBeUndefined();
  });

  it("keeps friendly labels people would actually recognise", () => {
    expect(BA_METADATA.CISO.shortName).toContain("CAISO");
    expect(BA_METADATA.ERCO.shortName).toContain("ERCOT");
    expect(BA_METADATA.PJM.shortName).toContain("PJM");
    expect(BA_METADATA.BPAT.shortName).toContain("BPA");
    expect(BA_METADATA.CISO.shortName).toContain("California");
    expect(BA_METADATA.ERCO.shortName).toContain("Texas");
    expect(BA_METADATA.PJM.shortName).toContain("Mid-Atlantic");
    expect(BA_METADATA.BPAT.shortName).toContain("Pacific Northwest");
  });

  it("uses the exact Electricity Maps keys for the marquee zones", () => {
    expect(BA_METADATA.CISO.electricityMapsZone).toBe("US-CAL-CISO");
    expect(BA_METADATA.ERCO.electricityMapsZone).toBe("US-TEX-ERCO");
    expect(BA_METADATA.PJM.electricityMapsZone).toBe("US-MIDA-PJM");
    expect(BA_METADATA.BPAT.electricityMapsZone).toBe("US-NW-BPAT");
    expect(BA_METADATA.ISNE.electricityMapsZone).toBe("US-NE-ISNE");
    expect(BA_METADATA.NYIS.electricityMapsZone).toBe("US-NY-NYIS");
    // Renamed utility, unchanged EIA code.
    expect(BA_METADATA.SCEG.electricityMapsZone).toBe("US-CAR-SCEG");
  });

  it("describes the areas EIA-930 does not cover", () => {
    expect(Object.keys(UNSUPPORTED_AREAS).sort()).toEqual([
      "AA", "AE", "AK", "AP", "GU", "HI", "PR", "VI",
    ]);
    for (const area of Object.values(UNSUPPORTED_AREAS)) {
      // The reason string goes straight to the user, so it has to read as English.
      expect(area.reason.length, area.code).toBeGreaterThan(40);
      expect(area.reason, area.code).toMatch(/\.$/);
      expect(area.timezone, area.code).toContain("/");
    }
    expect(UNSUPPORTED_AREAS.HI.electricityMapsZone).toBe("US-HI");
    expect(UNSUPPORTED_AREAS.AK.electricityMapsZone).toBe("US-AK");
  });
});
