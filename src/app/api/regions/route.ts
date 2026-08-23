import { listRegions } from "@/lib/region";

/**
 * GET /api/regions → every grid region a user can pick manually.
 *
 * Served from an endpoint rather than imported into the client so the ZIP
 * lookup tables stay out of the browser bundle.
 */
export const dynamic = "force-static";

export async function GET() {
  const regions = listRegions().map((r) => ({
    ba: r.ba,
    shortName: r.shortName,
    name: r.name,
    state: r.state,
  }));
  return Response.json({ regions });
}
