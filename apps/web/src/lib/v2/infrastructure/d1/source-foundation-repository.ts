import {
  CaptureSourceValidationError,
  isReservedLegacyDraftId,
  type CaptureCommitReceipt,
  type PreparedCaptureCommit,
  type PreparedLegacyCaptureCommit,
} from "@/lib/v2/domain/capture-source";
import { SourceCommitIdempotencyConflictError, SourceCommitTransactionError } from "@/lib/v2/domain/source-commit";
import { readAnalysisExtractionSource, type AnalysisExtractionSource } from "@/lib/v2/domain/analysis-extraction-source";
import { readManualLinkSource, type ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import { readPublicFetchSource, type PublicFetchSourceV1 } from "@/lib/v2/domain/public-fetch-source";
import { readVideoAnalysisSource, type VideoAnalysisSourceV1 } from "@/lib/v2/domain/video-analysis-source";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { analysisExtractionProofSql } from "@/lib/v2/infrastructure/d1/analysis-extraction-provenance";
import { hasVideoAnalysisProvenanceSchema, videoAnalysisProofSql } from "@/lib/v2/infrastructure/d1/video-analysis-provenance";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type IdempotencyRow = { payload_hash: string; response_json: string };

class ProviderInvocationVisibilityConflictError extends Error {
  readonly code = "provider_invocation_visibility_conflict";

  constructor() {
    super("The record is currently being sent to an AI provider. Retry this visibility change after the invocation finishes.");
    this.name = "ProviderInvocationVisibilityConflictError";
  }
}

export type V2RecordProjection = Readonly<{
  recordId: string;
  lifecycleStatus: string;
  title: string | null;
  bodyMarkdown: string | null;
  privacyLevel: "normal" | "sensitive" | "restricted";
  currentRevisionId: string | null;
  currentVersion: number | null;
  writtenAt: string | null;
  documentStatus: "inbox" | "draft" | "revising" | "finished" | "archived" | null;
  capturedAt: string;
  committedAt: string;
  locked: boolean;
  sources: readonly Readonly<{
    id: string;
    kind: string;
    displayOrder: number;
    rawText: string | null;
    contentHash: string;
    attachmentId: string | null;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    manualLink: ManualLinkSourceV1 | null;
    publicFetch?: PublicFetchSourceV1 | null;
    analysisExtraction?: AnalysisExtractionSource | null;
    videoAnalysis?: VideoAnalysisSourceV1 | null;
  }>[];
}>;

/** Non-content metadata used only to fence owner-scoped local recovery copies.
 * It is available to the authenticated owner even while content is locked.
 */
export type V2RecordRecoveryPolicy = Readonly<{
  recordId: string;
  currentVersion: number;
  privacyLevel: V2RecordProjection["privacyLevel"];
}>;

type SourceProjectionRow = {
  id: string;
  item_kind: string;
  display_order: number;
  raw_text: string | null;
  content_hash: string;
  attachment_id: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  source_metadata: string | null;
  analysis_extraction_verified: number;
  video_analysis_verified: number;
};

function projectManualLink(value: string | null): ManualLinkSourceV1 | null {
  if (!value) return null;
  try {
    return readManualLinkSource(JSON.parse(value));
  } catch {
    // Historical or unsupported source metadata must not break raw-source reads.
    return null;
  }
}

function projectPublicFetch(value: string | null): PublicFetchSourceV1 | null {
  if (!value) return null;
  try { return readPublicFetchSource(JSON.parse(value)); }
  catch { return null; }
}

function projectVideoAnalysis(value: string | null): VideoAnalysisSourceV1 | null {
  if (!value) return null;
  try { return readVideoAnalysisSource(JSON.parse(value)); }
  catch { return null; }
}

function projectAnalysisExtraction(value: string | null): AnalysisExtractionSource | null {
  if (!value) return null;
  try { return readAnalysisExtractionSource(JSON.parse(value)); }
  catch { return null; }
}

function receiptFromJson(value: string) {
  const parsed = JSON.parse(value) as CaptureCommitReceipt;
  if (!parsed.captureId || !parsed.recordId || !parsed.revisionId || !Array.isArray(parsed.sourceItemIds)) {
    throw new SourceCommitTransactionError(new Error("Stored capture receipt has an invalid shape."));
  }
  return parsed;
}

function templateFieldDataType(valueKind: NonNullable<PreparedCaptureCommit["template"]>["inputs"][number]["valueKind"]) {
  if (valueKind === "number") return "decimal";
  if (valueKind === "text") return "short_text";
  if (valueKind === "json") return "structured_json";
  return valueKind;
}

function templateValueColumns(valueKind: NonNullable<PreparedCaptureCommit["template"]>["inputs"][number]["valueKind"], value: unknown) {
  return {
    text: valueKind === "text" && typeof value === "string" ? value : null,
    number: (valueKind === "number" || valueKind === "rating") && typeof value === "number" ? value : null,
    boolean: valueKind === "boolean" && typeof value === "boolean" ? (value ? 1 : 0) : null,
    date: valueKind === "date" && typeof value === "string" ? value : null,
    json: JSON.stringify(value),
  };
}

export class D1SourceFoundationRepository {
  constructor(
    private readonly db: D1DatabaseBinding,
    private readonly userId: string,
  ) {
    if (!userId.trim()) throw new Error("A scoped repository requires a userId.");
  }

  private findIdempotency(input: Pick<PreparedCaptureCommit, "idempotencyKey">) {
    return this.db
      .prepare(
        `select payload_hash, response_json from v2_idempotency_records
         where user_id = ? and operation = 'capture.commit' and idempotency_key = ? limit 1`,
      )
      .bind(this.userId, input.idempotencyKey)
      .first<IdempotencyRow>();
  }

  private async replayStoredCapture(
    input: PreparedCaptureCommit,
    existing: IdempotencyRow,
    allowHiddenLegacyReplay: boolean,
  ) {
    if (existing.payload_hash !== input.payloadHash) throw new SourceCommitIdempotencyConflictError();
    const receipt = receiptFromJson(existing.response_json);
    if (!allowHiddenLegacyReplay) {
      const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
      const storedObject = await this.db
        .prepare(
          `select case when ${legacyVisibility} then 1 else 0 end as visible
           from v2_objects o where o.id=? and o.user_id=? limit 1`,
        )
        .bind(receipt.recordId, this.userId)
        .first<{ visible: number }>();
      // A missing historical object does not establish legacy provenance, but
      // a present object that normal reads hide must never leak its receipt.
      if (storedObject && storedObject.visible !== 1) throw new SourceCommitIdempotencyConflictError();
    }
    return receipt;
  }

  private assertLegacyCapture(input: PreparedLegacyCaptureCommit, allowCompatibilityActive: boolean) {
    if (
      input.internalCaptureScope !== "legacy_migration"
      || !input.draftId.startsWith("legacy:")
      || input.draftId !== input.idempotencyKey
      || input.channel !== "import"
      || input.aiEnabled
      || (!allowCompatibilityActive && input.initialLifecycleStatus !== "archived")
    ) {
      throw new CaptureSourceValidationError("Legacy migration capture capability is invalid.");
    }
  }

  async commitCapture(input: PreparedCaptureCommit): Promise<CaptureCommitReceipt & { disposition: "committed" | "replayed" }> {
    if (isReservedLegacyDraftId(input.draftId) || "internalCaptureScope" in input) {
      throw new CaptureSourceValidationError("Legacy migration captures require the internal commit path.");
    }
    return this.commitCaptureInternal(input, false);
  }

  async commitLegacyCapture(input: PreparedLegacyCaptureCommit): Promise<CaptureCommitReceipt & { disposition: "committed" | "replayed" }> {
    this.assertLegacyCapture(input, false);
    return this.commitCaptureInternal(input, true);
  }

  async replayLegacyCapture(input: PreparedLegacyCaptureCommit): Promise<CaptureCommitReceipt & { disposition: "replayed" }> {
    this.assertLegacyCapture(input, true);
    const existing = await this.findIdempotency(input);
    if (!existing) throw new SourceCommitIdempotencyConflictError();
    return { ...await this.replayStoredCapture(input, existing, true), disposition: "replayed" };
  }

  private async commitCaptureInternal(
    input: PreparedCaptureCommit,
    allowHiddenLegacyReplay: boolean,
  ): Promise<CaptureCommitReceipt & { disposition: "committed" | "replayed" }> {
    const existing = await this.findIdempotency(input);
    if (existing) {
      return { ...await this.replayStoredCapture(input, existing, allowHiddenLegacyReplay), disposition: "replayed" };
    }

    const receipt: CaptureCommitReceipt = {
      captureId: input.captureId,
      recordId: input.objectId,
      revisionId: input.revisionId,
      sourceItemIds: input.sources.map((source) => source.id),
      attachmentCount: input.sources.filter((source) => source.attachmentId).length,
      committedAt: input.committedAt,
      aiProcessing: input.aiEnabled ? "queued" : "disabled",
      processingStatusUrl: `/api/v2/captures/${input.captureId}/receipt`,
    };
    const statements: D1PreparedStatementBinding[] = [
      this.db
        .prepare(
          `insert into v2_capture_bundles
           (id,user_id,draft_id,capture_channel,user_note,ai_enabled,client_timezone,processing_status,processing_priority,content_hash,template_version_id,captured_at,committed_at,created_at)
           values (?,?,?,?,?,?,?,?,'interactive',?,?,?,?,?)`,
        )
        .bind(
          input.captureId,
          this.userId,
          input.draftId,
          input.channel,
          input.bodyMarkdown,
          input.aiEnabled ? 1 : 0,
          input.clientTimezone,
          input.aiEnabled ? "pending" : "completed",
          input.contentHash,
          input.template?.templateVersionId ?? null,
          input.capturedAt,
          input.committedAt,
          input.committedAt,
        ),
      this.db
        .prepare(
          `insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at)
           values (?,?,'document',?,?,?)`,
        )
        .bind(input.objectId, this.userId, input.initialLifecycleStatus, input.committedAt, input.committedAt),
      this.db
        .prepare(
          `insert into v2_documents
           (object_id,capture_id,title,title_source,body_markdown,current_revision_id,current_version,document_status,privacy_level,user_locked_fields)
           values (?,?,?,?,?,?,1,'inbox',?,'[]')`,
        )
        .bind(
          input.objectId,
          input.captureId,
          input.title,
          input.titleSource,
          input.bodyMarkdown,
          input.revisionId,
          input.privacyLevel,
        ),
      this.db
        .prepare(
          `insert into v2_document_revisions
           (id,document_object_id,parent_revision_id,body_markdown,content_hash,author_kind,change_reason,created_at)
           values (?,?,null,?,?,'user','source_commit',?)`,
        )
        .bind(input.revisionId, input.objectId, input.bodyMarkdown, input.contentHash, input.committedAt),
    ];

    for (const source of input.sources) {
      statements.push(
        this.db
          .prepare(
            `insert into v2_source_items
             (id,user_id,capture_id,item_kind,display_order,raw_text,content_hash,source_metadata,immutability_version,created_at)
             values (?,?,?,?,?,?,?,?,1,?)`,
          )
          .bind(
            source.id,
            this.userId,
            input.captureId,
            source.kind,
            source.displayOrder,
            source.rawText,
            source.contentHash,
            source.metadataJson,
            input.committedAt,
          ),
      );
      if (source.attachmentId) {
        statements.push(
          this.db
            .prepare(
              `insert into v2_source_attachment_links (user_id,source_item_id,attachment_id,created_at)
               values (?,?,?,?)`,
            )
            .bind(this.userId, source.id, source.attachmentId, input.committedAt),
          this.db
            .prepare(
              `update v2_attachment_reservations set status='committed', committed_at=?
               where id=? and user_id=? and status='verified'`,
            )
            .bind(input.committedAt, source.attachmentId, this.userId),
        );
      }
      statements.push(
        this.db
          .prepare(
            `insert into v2_document_source_links (document_object_id,source_item_id,role,source_order,created_at)
             values (?,?,?, ?,?)`,
          )
          .bind(
            input.objectId,
            source.id,
            source.kind === "text" ? "primary_text" : "evidence",
            source.displayOrder,
            input.committedAt,
          ),
      );
    }

    if (input.template) {
      const template = input.template;
      statements.push(
        this.db.prepare(
          `insert into v2_capture_template_sessions
           (id,user_id,draft_id,capture_id,template_version_id,state,applied_at,submitted_at,input_snapshot_json)
           values (?,?,?,?,?,'submitted',?,?,?)`,
        ).bind(template.sessionId, this.userId, input.draftId, input.captureId, template.templateVersionId, template.appliedAt, input.committedAt, JSON.stringify(template.inputs.map(({ id: _id, bindingJson: _bindingJson, ...value }) => value))),
      );
      const itemMap = new Map(template.definition.sections.flatMap((section) => section.items).map((item) => [item.key, item]));
      for (const value of template.inputs) {
        statements.push(
          this.db.prepare(
            `insert into v2_capture_input_values
             (id,session_id,user_id,item_key,binding_snapshot_json,value_kind,value_json,input_order,blank_state,client_timestamp,created_at)
             values (?,?,?,?,?,?,?,?,?,?,?)`,
          ).bind(value.id, template.sessionId, this.userId, value.itemKey, value.bindingJson, value.valueKind, value.blankState === "answered" ? JSON.stringify(value.value) : null, value.inputOrder, value.blankState, value.clientTimestamp, input.committedAt),
        );
        const item = itemMap.get(value.itemKey);
        const binding = item?.binding;
        if (value.blankState !== "answered" || !binding) continue;
        if (binding.corePath === "document.written_at" && typeof value.value === "string") {
          statements.push(this.db.prepare(`update v2_documents set written_at=?,user_locked_fields=json_insert(user_locked_fields,'$[#]','written_at') where object_id=?`).bind(value.value, input.objectId));
          continue;
        }
        if (binding.corePath === "document.title" && typeof value.value === "string" && value.value.trim()) {
          statements.push(this.db.prepare(`update v2_documents set title=?,title_source='user',user_locked_fields=json_insert(user_locked_fields,'$[#]','title') where object_id=?`).bind(value.value.trim(), input.objectId));
          continue;
        }
        if (!binding.fieldKey) continue;
        const fieldId = `field:template:${this.userId}:${binding.fieldKey}`;
        const propertyId = `property:template:${input.objectId}:${value.itemKey}:${value.inputOrder}`;
        const columns = templateValueColumns(value.valueKind, value.value);
        const dataType = templateFieldDataType(value.valueKind);
        statements.push(
          this.db.prepare(
            `insert or ignore into v2_field_definitions
             (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
             values (?,?,?,?,?,?,'active','user_created',1,0,?,?)`,
          ).bind(fieldId, this.userId, binding.fieldKey, item.prompt.slice(0, 100), `Structured value explicitly entered through template ${template.templateVersionId}.`, dataType, input.committedAt, input.committedAt),
          this.db.prepare(
            `insert into v2_property_values
             (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_number,value_boolean,value_date,value_json,source_class,claim_risk,review_status,confirmed_by_user_at,locked_by_user,created_at)
             select ?,?,?,id,?,?,?,?,?,?,'user_explicit','low','accepted',?,1,?
             from v2_field_definitions where user_id=? and key=? and data_type=? limit 1`,
          ).bind(propertyId, this.userId, input.objectId, value.valueKind, columns.text, columns.number, columns.boolean, columns.date, columns.json, input.committedAt, input.committedAt, this.userId, binding.fieldKey, dataType),
          this.db.prepare(
            `insert into v2_evidence_refs
             (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
             values (?,?, 'property_value',?,null,'form_field',?,?)`,
          ).bind(`evidence:${propertyId}`, this.userId, propertyId, JSON.stringify({ templateVersionId: template.templateVersionId, sessionId: template.sessionId, itemKey: value.itemKey, inputValueId: value.id }), input.committedAt),
          this.db.prepare(
             `update v2_field_definitions set usage_count=(select count(distinct owner_object_id) from v2_property_values where field_definition_id=v2_field_definitions.id and user_id=v2_field_definitions.user_id and review_status='accepted'),updated_at=? where user_id=? and key=?`,
          ).bind(input.committedAt, this.userId, binding.fieldKey),
        );
      }
      statements.push(this.db.prepare(`update v2_capture_templates set usage_count=usage_count+1,updated_at=? where id=? and user_id=?`).bind(input.committedAt, template.templateId, this.userId));
    }

    if (input.outboxId) {
      statements.push(
        this.db
          .prepare(
            `insert into v2_processing_outbox
             (id,user_id,capture_id,event_type,payload_json,status,created_at)
             values (?,?,?,'analyze',?,'pending',?)`,
          )
          .bind(input.outboxId, this.userId, input.captureId, JSON.stringify({ captureId: input.captureId }), input.committedAt),
      );
    }
    statements.push(
      this.db
        .prepare(
          `insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at)
           values (?,?,'capture.source_committed','document',?,'{}',?)`,
        )
        .bind(input.auditEventId, this.userId, input.objectId, input.committedAt),
      this.db
        .prepare(
          `insert into v2_idempotency_records
           (user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
           values (?,'capture.commit',?,?,?,201,?)`,
        )
        .bind(this.userId, input.idempotencyKey, input.payloadHash, JSON.stringify(receipt), input.committedAt),
    );

    try {
      await this.db.batch(statements);
      return { ...receipt, disposition: "committed" };
    } catch (error) {
      const raced = await this.findIdempotency(input);
      if (raced) {
        return { ...await this.replayStoredCapture(input, raced, allowHiddenLegacyReplay), disposition: "replayed" };
      }
      throw new SourceCommitTransactionError(error);
    }
  }

  async getReceipt(captureId: string) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db
      .prepare(
        `select i.response_json from v2_idempotency_records i
         join v2_objects o on o.id=json_extract(i.response_json,'$.recordId') and o.user_id=i.user_id
         where i.user_id=? and i.operation='capture.commit'
           and json_extract(i.response_json,'$.captureId')=? and ${legacyVisibility} limit 1`,
      )
      .bind(this.userId, captureId)
      .first<{ response_json: string }>();
    return row ? receiptFromJson(row.response_json) : null;
  }

  async getRecoveryPolicy(recordId: string): Promise<V2RecordRecoveryPolicy | null> {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db.prepare(`select o.id as record_id,d.current_version,d.privacy_level
      from v2_objects o join v2_documents d on d.object_id=o.id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
      where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`)
      .bind(recordId, this.userId).first<{ record_id: string; current_version: number; privacy_level: V2RecordProjection["privacyLevel"] }>();
    return row ? { recordId: row.record_id, currentVersion: row.current_version, privacyLevel: row.privacy_level } : null;
  }

  async getRecord(recordId: string, restrictedUnlocked = false): Promise<V2RecordProjection | null> {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db
      .prepare(
        `select o.id as record_id,o.lifecycle_status,d.title,d.body_markdown,d.privacy_level,
                d.current_revision_id,d.current_version,d.written_at,d.document_status,c.captured_at,c.committed_at
         from v2_objects o join v2_documents d on d.object_id=o.id
         join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
         join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
         where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`,
      )
      .bind(recordId, this.userId)
      .first<{
        record_id: string;
        lifecycle_status: string;
        title: string;
        body_markdown: string;
        privacy_level: "normal" | "sensitive" | "restricted";
        current_revision_id: string;
        current_version: number;
        written_at: string | null;
        document_status: "inbox" | "draft" | "revising" | "finished" | "archived";
        captured_at: string;
        committed_at: string;
      }>();
    if (!row) return null;
    const locked = row.privacy_level === "restricted" && !restrictedUnlocked;
    const videoProof = !locked && await hasVideoAnalysisProvenanceSchema(this.db) ? videoAnalysisProofSql() : "0";
    const sourceRows: { results: SourceProjectionRow[] } = locked
      ? { results: [] }
      : await this.db
          .prepare(
            `select s.id,s.item_kind,s.display_order,s.raw_text,s.content_hash,s.source_metadata,a.id as attachment_id,
                    a.filename,a.mime_type,a.size_bytes,
                    case when ${analysisExtractionProofSql()} then 1 else 0 end as analysis_extraction_verified,
                    case when ${videoProof} then 1 else 0 end as video_analysis_verified
             from v2_document_source_links dsl
             join v2_documents d on d.object_id=dsl.document_object_id
             join v2_objects o on o.id=d.object_id
             join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
             join v2_document_revisions current on current.id=d.current_revision_id and current.document_object_id=d.object_id
             join v2_source_items s on s.id=dsl.source_item_id
             left join v2_source_attachment_links l on l.source_item_id=s.id and l.user_id=s.user_id
             left join v2_attachment_reservations a on a.id=l.attachment_id and a.user_id=l.user_id
               and a.status='committed' and a.committed_at is not null
             where dsl.document_object_id=? and o.user_id=? and s.user_id=o.user_id and s.capture_id=d.capture_id
               and d.privacy_level=? and d.current_revision_id=? and d.current_version=? and ${legacyVisibility}
             order by s.display_order`,
          )
          .bind(recordId, this.userId, row.privacy_level, row.current_revision_id, row.current_version)
          .all<SourceProjectionRow>();
    const stillCurrent = await this.db.prepare(`select 1 as current from v2_objects o
      join v2_documents d on d.object_id=o.id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions current on current.id=d.current_revision_id and current.document_object_id=d.object_id
      where o.id=? and o.user_id=? and o.lifecycle_status=? and d.privacy_level=?
        and d.current_revision_id=? and d.current_version=? and ${legacyVisibility} limit 1`)
      .bind(recordId, this.userId, row.lifecycle_status, row.privacy_level, row.current_revision_id, row.current_version)
      .first<{ current: number }>();
    if (!stillCurrent) return null;
    return {
      recordId: row.record_id,
      lifecycleStatus: row.lifecycle_status,
      title: locked ? null : row.title,
      bodyMarkdown: locked ? null : row.body_markdown,
      privacyLevel: row.privacy_level,
      currentRevisionId: locked ? null : row.current_revision_id,
      currentVersion: locked ? null : row.current_version,
      writtenAt: locked ? null : row.written_at,
      documentStatus: locked ? null : row.document_status,
      capturedAt: row.captured_at,
      committedAt: row.committed_at,
      locked,
      sources: sourceRows.results.map((source) => ({
        id: source.id,
        kind: source.item_kind,
        displayOrder: source.display_order,
        rawText: source.raw_text,
        contentHash: source.content_hash,
        attachmentId: source.attachment_id,
        filename: source.filename,
        mimeType: source.mime_type,
        sizeBytes: source.size_bytes,
        manualLink: projectManualLink(source.source_metadata),
        publicFetch: projectPublicFetch(source.source_metadata),
        analysisExtraction: source.analysis_extraction_verified === 1 ? projectAnalysisExtraction(source.source_metadata) : null,
        videoAnalysis: source.video_analysis_verified === 1 ? projectVideoAnalysis(source.source_metadata) : null,
      })),
    };
  }

  async trashRecord(recordId: string, input: { auditEventId: string; deletedAt: string; purgeAfter: string }) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const existing = await this.db
      .prepare(`select o.id,o.lifecycle_status from v2_objects o where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`)
      .bind(recordId, this.userId)
      .first<{ id: string; lifecycle_status: string }>();
    if (!existing) return null;
    if (existing.lifecycle_status === "deleted") return { recordId, lifecycleStatus: "deleted" as const, replayed: true };
    try {
      await this.db.batch([
        this.db
          .prepare(`update v2_objects as o set lifecycle_status='deleted',deleted_at=?,updated_at=?
                    where o.id=? and o.user_id=? and o.lifecycle_status<>'deleted' and ${legacyVisibility}`)
          .bind(input.deletedAt, input.deletedAt, recordId, this.userId),
        this.db
          .prepare(
            `insert into v2_deletion_tombstones (object_id,user_id,deleted_at,purge_after,reason)
             select ?,?,?,?,'user_request' where exists (
               select 1 from v2_objects o where o.id=? and o.user_id=?
                 and o.lifecycle_status='deleted' and o.deleted_at=? and ${legacyVisibility}
             )`,
          )
          .bind(recordId, this.userId, input.deletedAt, input.purgeAfter, recordId, this.userId, input.deletedAt),
        this.db
          .prepare(
            `insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at)
             select ?,?,'record.trashed','document',?,'{}',? where exists (
               select 1 from v2_objects o where o.id=? and o.user_id=?
                 and o.lifecycle_status='deleted' and o.deleted_at=? and ${legacyVisibility}
             )`,
          )
          .bind(input.auditEventId, this.userId, recordId, input.deletedAt, recordId, this.userId, input.deletedAt),
      ]);
    } catch (error) {
      if ((error instanceof Error ? error.message : String(error)).includes("legacy_provider_invocation_active")) {
        throw new ProviderInvocationVisibilityConflictError();
      }
      throw error;
    }
    const committed = await this.db
      .prepare(`select o.lifecycle_status from v2_objects o where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`)
      .bind(recordId, this.userId)
      .first<{ lifecycle_status: string }>();
    if (!committed || committed.lifecycle_status !== "deleted") return null;
    return { recordId, lifecycleStatus: "deleted" as const, replayed: false };
  }

  async restoreRecord(recordId: string, input: { auditEventId: string; restoredAt: string }) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const existing = await this.db
      .prepare(`select o.id,o.lifecycle_status from v2_objects o where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`)
      .bind(recordId, this.userId)
      .first<{ id: string; lifecycle_status: string }>();
    if (!existing) return null;
    if (existing.lifecycle_status !== "deleted") return { recordId, lifecycleStatus: "active" as const, replayed: true };
    await this.db.batch([
      this.db
        .prepare(`update v2_objects as o set lifecycle_status='active',deleted_at=null,updated_at=?
                  where o.id=? and o.user_id=? and o.lifecycle_status='deleted' and ${legacyVisibility}`)
        .bind(input.restoredAt, recordId, this.userId),
      this.db
        .prepare(`update v2_deletion_tombstones set restored_at=? where object_id=? and user_id=? and exists (
                    select 1 from v2_objects o where o.id=? and o.user_id=?
                      and o.lifecycle_status='active' and o.updated_at=? and ${legacyVisibility}
                  )`)
        .bind(input.restoredAt, recordId, this.userId, recordId, this.userId, input.restoredAt),
      this.db
        .prepare(
          `insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at)
           select ?,?,'record.restored','document',?,'{}',? where exists (
             select 1 from v2_objects o where o.id=? and o.user_id=?
               and o.lifecycle_status='active' and o.updated_at=? and ${legacyVisibility}
           )`,
        )
        .bind(input.auditEventId, this.userId, recordId, input.restoredAt, recordId, this.userId, input.restoredAt),
    ]);
    const committed = await this.db
      .prepare(`select o.lifecycle_status from v2_objects o where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`)
      .bind(recordId, this.userId)
      .first<{ lifecycle_status: string }>();
    if (!committed || committed.lifecycle_status !== "active") return null;
    return { recordId, lifecycleStatus: "active" as const, replayed: false };
  }
}
