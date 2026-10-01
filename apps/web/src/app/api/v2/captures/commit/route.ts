import { isReservedLegacyDraftId, prepareCaptureCommit, type CaptureCommitRequest } from "@/lib/v2/domain/capture-source";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { validateTemplateSubmission } from "@/lib/v2/templates/template-definition-v1";

const CHANNELS = new Set(["web", "mobile_share", "clipboard", "import", "api"]);
const PRIVACY = new Set(["normal", "sensitive", "restricted"]);
const SOURCE_KINDS = new Set(["text", "image", "audio", "video", "document", "transcript", "url"]);

function parseCommitRequest(body: Record<string, unknown>): CaptureCommitRequest {
  const channel = requireString(body.channel, "channel");
  const privacyLevel = requireString(body.privacyLevel, "privacyLevel");
  const draftId = requireString(body.draftId, "draftId");
  if (isReservedLegacyDraftId(draftId)) throw new V2HttpError(400, "invalid_field", "draftId uses a reserved internal namespace.");
  if (!CHANNELS.has(channel) || !PRIVACY.has(privacyLevel)) throw new V2HttpError(400, "invalid_field", "Invalid channel or privacyLevel.");
  if (typeof body.bodyMarkdown !== "string" || typeof body.aiEnabled !== "boolean") {
    throw new V2HttpError(400, "invalid_field", "bodyMarkdown and aiEnabled are required.");
  }
  if (body.sources !== undefined && !Array.isArray(body.sources)) throw new V2HttpError(400, "invalid_field", "sources must be an array.");
  const sources = (body.sources as Array<Record<string, unknown>> | undefined)?.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new V2HttpError(400, "invalid_field", `sources[${index}] must be an object.`);
    if (source.rawText !== undefined && source.rawText !== null && typeof source.rawText !== "string") throw new V2HttpError(400, "invalid_field", `sources[${index}].rawText must be text.`);
    if (source.metadata !== undefined && source.metadata !== null && (typeof source.metadata !== "object" || Array.isArray(source.metadata))) throw new V2HttpError(400, "invalid_field", `sources[${index}].metadata must be an object.`);
    const kind = requireString(source.kind, `sources[${index}].kind`);
    if (!SOURCE_KINDS.has(kind)) throw new V2HttpError(400, "invalid_field", `sources[${index}].kind is invalid.`);
    return {
      kind: kind as CaptureCommitRequest["sources"] extends readonly (infer T)[] | undefined
        ? T extends { kind: infer K }
          ? K
          : never
        : never,
      rawText: typeof source.rawText === "string" ? source.rawText : null,
      contentHash: requireString(source.contentHash, `sources[${index}].contentHash`),
      attachmentId: typeof source.attachmentId === "string" ? source.attachmentId : null,
      metadata: source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
        ? (source.metadata as Record<string, unknown>)
        : undefined,
    };
  });
  return {
    draftId,
    channel: channel as CaptureCommitRequest["channel"],
    title: typeof body.title === "string" ? body.title : null,
    bodyMarkdown: body.bodyMarkdown,
    aiEnabled: body.aiEnabled,
    clientTimezone: requireString(body.clientTimezone, "clientTimezone"),
    privacyLevel: privacyLevel as CaptureCommitRequest["privacyLevel"],
    capturedAt: requireString(body.capturedAt, "capturedAt"),
    sources,
    template: body.template,
  };
}

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey?.trim()) throw new V2HttpError(400, "idempotency_key_required", "Idempotency-Key is required.");
    const parsed = parseCommitRequest(await readJsonObject(request, { maxBytes: 1_048_576 }));
    const db = getV2CloudflareBindings().db;
    let resolvedTemplate = null;
    if (parsed.template !== undefined && parsed.template !== null) {
      if (!parsed.template || typeof parsed.template !== "object" || Array.isArray(parsed.template)) throw new V2HttpError(400, "template_contract_invalid", "template must be an object.");
      const versionId = requireString((parsed.template as Record<string, unknown>).templateVersionId, "template.templateVersionId");
      const template = await new D1TemplateRepository(db, context.userId).getByVersion(versionId);
      if (!template || !["active", "trial", "suggested"].includes(template.status)) throw new V2HttpError(400, "template_contract_invalid", "The selected template version is not available for capture.");
      resolvedTemplate = { templateId: template.id, definition: template.definition, submission: validateTemplateSubmission(parsed.template, template.definition) };
    }
    const prepared = await prepareCaptureCommit(parsed, idempotencyKey, new Date().toISOString(), resolvedTemplate);
    const repository = new D1SourceFoundationRepository(db, context.userId);
    const receipt = await repository.commitCapture(prepared);
    return Response.json(receipt, {
      status: receipt.disposition === "committed" ? 201 : 200,
      headers: { Location: receipt.processingStatusUrl },
    });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
