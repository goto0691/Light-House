import { timingSafeEqual } from "node:crypto";

import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { V2HttpError, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { advanceExpiredRestoreUpload } from "@/lib/v2/portability/resumable-restore-upload-v1";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    if (!authorized(request)) throw new V2HttpError(401, "restore_upload_maintenance_unauthorized", "A valid maintenance secret is required.");
    const result = await advanceExpiredRestoreUpload({ db: getV2CloudflareBindings().db, bucket: getV2PortabilityBucket() });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
