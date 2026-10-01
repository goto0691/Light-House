import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { requireV2RequestContext, V2HttpError, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString } from "@/lib/v2/http/route-helpers";
import { exportJobForSession } from "@/lib/v2/portability/export-access-v1";
import { normalizeExportScopeForProfile, parseExportProfile } from "@/lib/v2/portability/portability-contract-v1";
import { stageResumableExportWorkflow } from "@/lib/v2/portability/resumable-export-v2";

export async function GET(request: Request) {
  try {
    const context = await requireV2RequestContext(request);
    const jobs = await new D1PortabilityRepository(getV2CloudflareBindings().db, context.userId).listExports();
    return Response.json({ jobs: jobs.map((job) => exportJobForSession(job, Boolean(context.restrictedGrant))) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    const body = await readJsonObject(request);
    const profile = parseExportProfile(body.profile);
    if (profile === "migration" && !context.restrictedGrant) {
      throw new V2HttpError(403, "recent_reauthentication_required", "A lossless migration export requires recent reauthentication.");
    }
    const scope = normalizeExportScopeForProfile(
      profile,
      body.scope ?? { privacyLevels: ["normal"] },
      { restrictedUnlocked: Boolean(context.restrictedGrant) },
    );
    const idempotencyKey = requireString(request.headers.get("Idempotency-Key"), "Idempotency-Key");
    const db = getV2CloudflareBindings().db;
    const created = await new D1PortabilityRepository(db, context.userId).createExport({ profile, scope, idempotencyKey });
    const job = await stageResumableExportWorkflow({ db, userId: context.userId, exportId: created.id });
    return Response.json({ job: exportJobForSession(job, Boolean(context.restrictedGrant)) }, { status: job.status === "queued" ? 202 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
