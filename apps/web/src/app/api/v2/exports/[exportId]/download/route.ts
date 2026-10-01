import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { requireV2RequestContext, V2HttpError, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { exportRequiresRecentReauthentication } from "@/lib/v2/portability/export-access-v1";

export async function GET(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  try {
    const context = await requireV2RequestContext(request);
    const job = await new D1PortabilityRepository(getV2CloudflareBindings().db, context.userId).getExport((await params).exportId);
    if (job && exportRequiresRecentReauthentication(job) && !context.restrictedGrant) {
      throw new V2HttpError(403, "recent_reauthentication_required", "Downloading this export requires recent reauthentication.");
    }
    if (!job || job.status !== "succeeded" || !job.bundleObjectKey || !job.expiresAt || Date.parse(job.expiresAt) <= Date.now()) {
      return Response.json({ error: { code: "export_not_found", message: "Export is unavailable or expired." } }, { status: 404 });
    }
    const object = await getV2PortabilityBucket().get(job.bundleObjectKey);
    if (!object) return Response.json({ error: { code: "export_not_found", message: "Export object is missing." } }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="lighthouse-${job.profile}-${job.id}.zip"`,
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return v2ErrorResponse(error); }
}
