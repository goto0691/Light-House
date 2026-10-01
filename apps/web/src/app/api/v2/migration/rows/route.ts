import { V2HttpError, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";

export async function POST() {
  try {
    requireV2Route({ write: true });
    throw new V2HttpError(410, "legacy_row_projection_retired", "Direct legacy row projection is retired. Use the approved migration run endpoint.");
  } catch (error) { return v2ErrorResponse(error); }
}
