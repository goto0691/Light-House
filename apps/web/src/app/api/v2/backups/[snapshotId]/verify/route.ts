import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Backup verification requires recent reauthentication.");
    await params;
    throw new V2HttpError(409, "backup_verification_resumable_required", "Use the backup restore dry-run workflow for bounded, resumable verification.");
  } catch (error) { return v2ErrorResponse(error); }
}
