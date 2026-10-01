import { timingSafeEqual } from "node:crypto";

import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { V2HttpError, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { advanceBackupMaintenance } from "@/lib/v2/portability/backup-retention-v1";
import { cleanupNextRestoreGeneration } from "@/lib/v2/portability/resumable-restore-v2";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !provided) return false;
  const left = Buffer.from(expected); const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    if (!authorized(request)) throw new V2HttpError(401, "backup_maintenance_unauthorized", "A valid maintenance secret is required.");
    const bindings = getV2CloudflareBindings();
    const bucket = getV2PortabilityBucket();
    const restoreGenerationCleanup = await cleanupNextRestoreGeneration({ db: bindings.db, bucket });
    const result = await advanceBackupMaintenance({ db: bindings.db, bucket });
    return Response.json({ ...result, restoreGenerationCleanup }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
