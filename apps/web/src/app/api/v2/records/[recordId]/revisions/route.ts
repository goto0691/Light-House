import {
  prepareDocumentRevision,
  type DocumentPrivacy,
  type DocumentRevisionRequest,
  type DocumentStatus,
} from "@/lib/v2/domain/document-revision";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";

const STATUSES = new Set<DocumentStatus>(["inbox", "draft", "revising", "finished", "archived"]);
const PRIVACY = new Set<DocumentPrivacy>(["normal", "sensitive", "restricted"]);

function parseRevisionRequest(body: Record<string, unknown>): DocumentRevisionRequest {
  const documentStatus = requireString(body.documentStatus, "documentStatus") as DocumentStatus;
  const privacyLevel = requireString(body.privacyLevel, "privacyLevel") as DocumentPrivacy;
  if (!STATUSES.has(documentStatus) || !PRIVACY.has(privacyLevel)) {
    throw new V2HttpError(400, "invalid_field", "documentStatus or privacyLevel is invalid.");
  }
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || typeof body.bodyMarkdown !== "string") {
    throw new V2HttpError(400, "invalid_field", "expectedVersion and bodyMarkdown are required.");
  }
  if (!(body.writtenAt === null || typeof body.writtenAt === "string")) {
    throw new V2HttpError(400, "invalid_field", "writtenAt must be null or an ISO timestamp.");
  }
  return {
    expectedVersion: Number(body.expectedVersion),
    expectedRevisionId: requireString(body.expectedRevisionId, "expectedRevisionId"),
    title: requireString(body.title, "title"),
    bodyMarkdown: body.bodyMarkdown,
    writtenAt: body.writtenAt,
    documentStatus,
    privacyLevel,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey?.trim()) throw new V2HttpError(400, "idempotency_key_required", "Idempotency-Key is required.");
    const { recordId } = await params;
    const prepared = await prepareDocumentRevision(parseRevisionRequest(await readJsonObject(request)), idempotencyKey);
    const result = await new D1DocumentAuthoringRepository(getV2CloudflareBindings().db, context.userId).saveRevision(recordId, prepared, {
      restrictedUnlocked: Boolean(context.restrictedGrant),
    });
    return Response.json(result, {
      status: result.outcome === "conflict" ? 409 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
