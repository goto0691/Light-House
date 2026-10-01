import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject } from "@/lib/v2/http/route-helpers";
import { getBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";

export async function GET(request: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  try {
    const context = await requireV2RequestContext(request);
    const snapshot = await getBackupWorkflow(getV2CloudflareBindings().db, context.userId, (await params).snapshotId);
    return Response.json({ snapshot }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Changing backup retention requires recent reauthentication.");
    const body = await readJsonObject(request);
    if (typeof body.pinned !== "boolean") throw new V2HttpError(400, "backup_pin_invalid", "pinned must be a boolean.");
    const snapshotId = (await params).snapshotId;
    const db = getV2CloudflareBindings().db;
    await db.prepare(`update v2_backup_snapshots set pinned=? where id=? and user_id=? and status='succeeded'`).bind(body.pinned ? 1 : 0, snapshotId, context.userId).run();
    const snapshot = await db.prepare(`select id,pinned,status from v2_backup_snapshots where id=? and user_id=? limit 1`).bind(snapshotId, context.userId).first<{ id: string; pinned: number; status: string }>();
    if (snapshot?.status === "pruning") throw new V2HttpError(409, "backup_retention_busy", "This backup is currently being pruned and cannot be pinned.");
    if (!snapshot || snapshot.status !== "succeeded") throw new V2HttpError(404, "backup_snapshot_not_found", "Backup snapshot was not found.");
    return Response.json({ snapshot: { id: snapshot.id, pinned: Boolean(snapshot.pinned) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
