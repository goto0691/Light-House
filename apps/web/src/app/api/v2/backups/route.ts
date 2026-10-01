import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString } from "@/lib/v2/http/route-helpers";
import { stageBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";

export async function GET(request: Request) {
  try {
    const context = await requireV2RequestContext(request);
    const rows = await getV2CloudflareBindings().db.prepare(`select id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,manifest_root_hash,referenced_blob_count,referenced_blob_bytes,retention_class,pinned,validator_json,created_at,verified_at,expires_at,pruned_at,workflow_version,build_phase,state_revision,failure_code from v2_backup_snapshots where user_id=? order by created_at desc limit 50`).bind(context.userId).all<Record<string, unknown>>();
    return Response.json({ snapshots: rows.results.map((row) => ({ ...row, validator_json: row.validator_json ? JSON.parse(String(row.validator_json)) : null })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "A verified backup requires recent reauthentication.");
    const kind = (await readJsonObject(request)).kind;
    if (kind !== "full" && kind !== "incremental") throw new V2HttpError(400, "backup_kind_invalid", "Backup kind must be full or incremental.");
    const snapshot = await stageBackupWorkflow({
      db: getV2CloudflareBindings().db,
      userId: context.userId,
      kind,
      retentionClass: "manual",
      idempotencyKey: requireString(request.headers.get("Idempotency-Key"), "Idempotency-Key"),
    });
    return Response.json({ snapshot }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
