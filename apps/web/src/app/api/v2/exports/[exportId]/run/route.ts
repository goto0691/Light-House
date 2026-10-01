import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { requireV2RequestContext, V2HttpError, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { exportJobForSession, exportRequiresRecentReauthentication } from "@/lib/v2/portability/export-access-v1";
import { advanceResumableExportWorkflow, ResumableExportError } from "@/lib/v2/portability/resumable-export-v2";

export async function POST(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    const db = getV2CloudflareBindings().db;
    const exportId = (await params).exportId;
    const existing = await new D1PortabilityRepository(db, context.userId).getExport(exportId);
    if (existing && exportRequiresRecentReauthentication(existing) && !context.restrictedGrant) {
      throw new V2HttpError(403, "recent_reauthentication_required", "Continuing this export requires recent reauthentication.");
    }
    const job = await advanceResumableExportWorkflow({ db, bucket: getV2PortabilityBucket(), userId: context.userId, exportId });
    return Response.json({ job: exportJobForSession(job, Boolean(context.restrictedGrant)) }, { status: job.status === "succeeded" ? 200 : 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ResumableExportError && error.code === "export_retryable_storage_error") {
      return Response.json({ error: { code: error.code, message: "내보내기 저장소가 일시적으로 응답하지 않았습니다. 같은 작업을 다시 진행해주세요." } }, { status: 503, headers: { "Retry-After": "2" } });
    }
    return v2ErrorResponse(error);
  }
}
