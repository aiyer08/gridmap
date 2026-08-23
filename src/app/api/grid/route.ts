import type { NextRequest } from "next/server";
import { buildSnapshot } from "@/lib/grid/snapshot";
import {
  DEFAULT_REGION,
  getRegionByBa,
  resolveRegionFromZip,
} from "@/lib/region";
import type { GridSnapshot, RegionInfo } from "@/lib/types";

/**
 * GET /api/grid?zip=94305   → the grid forecast for that ZIP's region
 * GET /api/grid?ba=CISO     → the same, for an explicitly chosen region
 *
 * Returns the whole 7-day hourly series in one go. The client then re-plans
 * windows for any appliance locally (`lib/grid/windows` is pure), so switching
 * from "dishwasher" to "EV" costs no network round-trip.
 */
export const dynamic = "force-dynamic";

export interface GridResponse {
  ok: boolean;
  /** Friendly explanation when we couldn't place the ZIP exactly. */
  reason?: string;
  /** "Palo Alto, CA", when we could resolve it. */
  city?: string;
  snapshot: GridSnapshot;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const zip = params.get("zip")?.trim();
  const ba = params.get("ba")?.trim();

  let region: RegionInfo = DEFAULT_REGION;
  let city: string | undefined;
  let ok = true;
  let reason: string | undefined;

  if (ba) {
    const found = getRegionByBa(ba);
    if (found) {
      // An explicit pick is exact by definition — it's what the user told us.
      region = { ...found, matchedBy: "manual", approximate: false };
    } else {
      ok = false;
      reason = `We don't have grid data for "${ba}".`;
    }
  } else if (zip) {
    const resolved = await resolveRegionFromZip(zip);
    region = resolved.region;
    city = resolved.city;
    ok = resolved.ok;
    reason = resolved.reason;
  }

  try {
    const snapshot = await buildSnapshot(region);
    return Response.json(
      { ok, reason, city, snapshot } satisfies GridResponse,
      {
        headers: {
          // Fifteen minutes is well inside the freshest signal we have (live
          // demand lags about an hour), and it keeps the EIA calls modest.
          "cache-control":
            "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        reason:
          "We couldn't reach the grid data just now. Try again in a moment.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
