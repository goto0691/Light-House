import { ulid } from "ulidx";

import { normalizeSha256 } from "@/lib/v2/domain/attachment-reservation";
import { hasManualLinkSource, MANUAL_LINK_LIMITS, normalizeManualLinkSource, ManualLinkValidationError } from "@/lib/v2/domain/manual-link-source";
import type { TemplateDefinitionV1, TemplateSubmission } from "@/lib/v2/templates/template-definition-v1";

export type CaptureChannel = "web" | "mobile_share" | "clipboard" | "import" | "api";
export type CapturePrivacyLevel = "normal" | "sensitive" | "restricted";
export type CaptureSourceKind = "text" | "image" | "audio" | "video" | "document" | "transcript" | "url";

export type CaptureCommitRequest = Readonly<{
  draftId: string;
  channel: CaptureChannel;
  title?: string | null;
  bodyMarkdown: string;
  aiEnabled: boolean;
  clientTimezone: string;
  privacyLevel: CapturePrivacyLevel;
  capturedAt: string;
  template?: unknown;
  sources?: readonly Readonly<{
    kind: CaptureSourceKind;
    rawText?: string | null;
    contentHash: string;
    attachmentId?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
  }>[];
}>;

export type PreparedCaptureCommit = Readonly<{
  captureId: string;
  objectId: string;
  revisionId: string;
  outboxId: string | null;
  auditEventId: string;
  capturedAt: string;
  committedAt: string;
  draftId: string;
  channel: CaptureChannel;
  title: string;
  titleSource: "user" | "fallback";
  bodyMarkdown: string;
  aiEnabled: boolean;
  clientTimezone: string;
  privacyLevel: CapturePrivacyLevel;
  initialLifecycleStatus: "active" | "archived";
  contentHash: string;
  sources: readonly Readonly<{
    id: string;
    kind: CaptureSourceKind;
    displayOrder: number;
    rawText: string | null;
    contentHash: string;
    attachmentId: string | null;
    metadataJson: string | null;
  }>[];
  idempotencyKey: string;
  payloadHash: string;
  template: null | Readonly<{
    sessionId: string;
    templateId: string;
    templateVersionId: string;
    appliedAt: string;
    definition: TemplateDefinitionV1;
    inputs: readonly Readonly<{
      id: string;
      itemKey: string;
      valueKind: "text" | "number" | "boolean" | "date" | "rating" | "json";
      value: unknown;
      blankState: "answered" | "unanswered" | "unknown" | "not_applicable" | "withheld";
      inputOrder: number;
      clientTimestamp: string;
      bindingJson: string;
    }>[];
  }>;
}>;

export type PreparedLegacyCaptureCommit = PreparedCaptureCommit & Readonly<{
  internalCaptureScope: "legacy_migration";
}>;

export type CaptureCommitReceipt = Readonly<{
  captureId: string;
  recordId: string;
  revisionId: string;
  sourceItemIds: readonly string[];
  attachmentCount: number;
  committedAt: string;
  aiProcessing: "queued" | "disabled";
  processingStatusUrl: string;
}>;

export class CaptureSourceValidationError extends Error {
  readonly code = "capture_source_invalid";

  constructor(message: string) {
    super(message);
    this.name = "CaptureSourceValidationError";
  }
}

function requireText(value: string, label: string) {
  if (!value.trim()) throw new CaptureSourceValidationError(`${label} is required.`);
}

export function isReservedLegacyDraftId(value: string) {
  return /^legacy:/i.test(value);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackTitle(bodyMarkdown: string) {
  const firstContentLine = bodyMarkdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .find(Boolean);
  return firstContentLine?.slice(0, 80) || "제목 없는 기록";
}

async function prepareCaptureCommitCore(
  request: CaptureCommitRequest,
  idempotencyKey: string,
  now = new Date().toISOString(),
  resolvedTemplate: null | Readonly<{ templateId: string; definition: TemplateDefinitionV1; submission: TemplateSubmission }> = null,
  options: Readonly<{ initialLifecycleStatus?: "active" | "archived" }> = {},
): Promise<PreparedCaptureCommit> {
  requireText(request.draftId, "draftId");
  requireText(request.clientTimezone, "clientTimezone");
  requireText(idempotencyKey, "Idempotency-Key");
  if (Number.isNaN(Date.parse(request.capturedAt))) throw new CaptureSourceValidationError("capturedAt must be an ISO timestamp.");
  if (!request.bodyMarkdown.trim() && !(request.sources?.length) && !resolvedTemplate?.submission.inputs.some((input) => input.blankState === "answered")) {
    throw new CaptureSourceValidationError("A capture requires text or at least one source item.");
  }

  const suppliedSources = request.sources ?? [];
  const manualSources = suppliedSources.filter((source) => hasManualLinkSource(source.metadata));
  if (manualSources.length > MANUAL_LINK_LIMITS.sources) throw new CaptureSourceValidationError("링크 자료는 기록당 최대 20개까지 보관할 수 있습니다.");
  if (manualSources.length && request.aiEnabled) throw new CaptureSourceValidationError("수동 링크 자료의 AI 분석은 아직 지원하지 않습니다. AI 정리를 꺼주세요.");
  const manualTextBytes = manualSources.reduce((size, source) => size + new TextEncoder().encode(source.rawText ?? "").byteLength, 0);
  if (manualTextBytes > MANUAL_LINK_LIMITS.textBytes) throw new CaptureSourceValidationError("붙여넣은 링크 원문은 기록당 합계 100KB 이내로 입력해 주세요.");
  const sources: Array<PreparedCaptureCommit["sources"][number]> = [];
  if (request.bodyMarkdown.length > 0) {
    sources.push({
      id: ulid(),
      kind: "text",
      displayOrder: 0,
      rawText: request.bodyMarkdown,
      contentHash: await sha256(request.bodyMarkdown),
      attachmentId: null,
      metadataJson: null,
    });
  }
  for (const [index, source] of suppliedSources.entries()) {
    requireText(source.contentHash, `sources[${index}].contentHash`);
    if (source.attachmentId) requireText(source.attachmentId, `sources[${index}].attachmentId`);
    const metadata = source.metadata;
    if (metadata && (
      metadata.purpose === "analysis_extraction"
      || metadata.purpose === "document_revision"
      || ["derived_from_source_item_id", "processing_run_id", "document_revision_id", "extraction_kind", "publicFetchV1", "videoAnalysisV1"].some((key) => Object.hasOwn(metadata, key))
    )) throw new CaptureSourceValidationError(`sources[${index}].metadata contains server-managed provenance.`);
    const contentHash = source.contentHash.startsWith("sha256:")
      ? `sha256:${normalizeSha256(source.contentHash.slice(7))}`
      : `sha256:${normalizeSha256(source.contentHash)}`;
    let normalizedMetadata = metadata;
    if (hasManualLinkSource(metadata)) {
      if (source.kind !== "url" || source.attachmentId) throw new CaptureSourceValidationError("수동 링크 자료는 첨부파일과 별도의 URL 원문이어야 합니다.");
      try {
        const manualLinkV1 = normalizeManualLinkSource(metadata?.manualLinkV1);
        if (manualLinkV1.completeness === "complete" && !source.rawText?.trim()) throw new CaptureSourceValidationError("원문이 없는 링크는 확보 완료로 표시할 수 없습니다.");
        normalizedMetadata = { manualLinkV1 };
      } catch (error) {
        if (error instanceof ManualLinkValidationError) throw new CaptureSourceValidationError(error.message);
        throw error;
      }
      if (contentHash !== `sha256:${await sha256(source.rawText ?? "")}`) throw new CaptureSourceValidationError("링크 원문과 해시가 일치하지 않습니다. 다시 저장해 주세요.");
    }
    sources.push({
      id: ulid(),
      kind: source.kind,
      displayOrder: sources.length,
      rawText: source.rawText ?? null,
      contentHash,
      attachmentId: source.attachmentId ?? null,
      metadataJson: normalizedMetadata ? JSON.stringify(normalizedMetadata) : null,
    });
  }

  const templateItems = new Map(resolvedTemplate?.definition.sections.flatMap((section) => section.items).map((item) => [item.key, item]) ?? []);
  const preparedTemplate = resolvedTemplate ? {
    sessionId: ulid(),
    templateId: resolvedTemplate.templateId,
    templateVersionId: resolvedTemplate.submission.templateVersionId,
    appliedAt: resolvedTemplate.submission.appliedAt,
    definition: resolvedTemplate.definition,
    inputs: resolvedTemplate.submission.inputs.map((input) => ({
      id: ulid(),
      ...input,
      bindingJson: JSON.stringify(templateItems.get(input.itemKey)?.binding ?? null),
    })),
  } : null;

  const initialLifecycleStatus = options.initialLifecycleStatus ?? "active";
  const canonicalPayload = JSON.stringify({
    draftId: request.draftId,
    channel: request.channel,
    title: request.title?.trim() || null,
    bodyMarkdown: request.bodyMarkdown,
    aiEnabled: request.aiEnabled,
    clientTimezone: request.clientTimezone,
    privacyLevel: request.privacyLevel,
    ...(initialLifecycleStatus === "archived" ? { initialLifecycleStatus } : {}),
    capturedAt: request.capturedAt,
    sources: sources.map(({ id: _id, ...source }) => source),
    template: preparedTemplate ? {
      templateVersionId: preparedTemplate.templateVersionId,
      appliedAt: preparedTemplate.appliedAt,
      inputs: preparedTemplate.inputs.map(({ id: _id, bindingJson: _bindingJson, ...input }) => input),
    } : null,
  });
  const title = request.title?.trim() || fallbackTitle(request.bodyMarkdown);
  return {
    captureId: ulid(),
    objectId: ulid(),
    revisionId: ulid(),
    outboxId: request.aiEnabled ? ulid() : null,
    auditEventId: ulid(),
    capturedAt: request.capturedAt,
    committedAt: now,
    draftId: request.draftId,
    channel: request.channel,
    title,
    titleSource: request.title?.trim() ? "user" : "fallback",
    bodyMarkdown: request.bodyMarkdown,
    aiEnabled: request.aiEnabled,
    clientTimezone: request.clientTimezone,
    privacyLevel: request.privacyLevel,
    initialLifecycleStatus,
    contentHash: `sha256:${await sha256(canonicalPayload)}`,
    sources,
    idempotencyKey,
    payloadHash: `sha256:${await sha256(canonicalPayload)}`,
    template: preparedTemplate,
  };
}

export async function prepareCaptureCommit(
  request: CaptureCommitRequest,
  idempotencyKey: string,
  now = new Date().toISOString(),
  resolvedTemplate: null | Readonly<{ templateId: string; definition: TemplateDefinitionV1; submission: TemplateSubmission }> = null,
  options: Readonly<{ initialLifecycleStatus?: "active" | "archived" }> = {},
) {
  if (isReservedLegacyDraftId(request.draftId)) {
    throw new CaptureSourceValidationError("draftId uses a reserved internal namespace.");
  }
  return prepareCaptureCommitCore(request, idempotencyKey, now, resolvedTemplate, options);
}

/**
 * The legacy importer is the sole producer of capture rows in the reserved
 * `legacy:` namespace. Keeping this preparation path separate prevents public
 * capture requests from manufacturing provenance that visibility guards trust.
 */
export async function prepareLegacyCaptureCommit(
  request: CaptureCommitRequest,
  idempotencyKey: string,
  now = new Date().toISOString(),
  options: Readonly<{ compatibilityLifecycleStatus?: "active" | "archived" }> = {},
): Promise<PreparedLegacyCaptureCommit> {
  if (!request.draftId.startsWith("legacy:") || request.draftId !== idempotencyKey) {
    throw new CaptureSourceValidationError("Legacy migration capture identity is invalid.");
  }
  if (request.channel !== "import" || request.aiEnabled) {
    throw new CaptureSourceValidationError("Legacy migration captures must be non-AI imports.");
  }
  const prepared = await prepareCaptureCommitCore(request, idempotencyKey, now, null, {
    initialLifecycleStatus: options.compatibilityLifecycleStatus ?? "archived",
  });
  return { ...prepared, internalCaptureScope: "legacy_migration" };
}
