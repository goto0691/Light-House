import { desc, sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./auth";

const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

const updatedAt = () =>
  text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

export const v2CaptureBundles = sqliteTable(
  "v2_capture_bundles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    draftId: text("draft_id").notNull(),
    captureChannel: text("capture_channel").notNull(),
    userNote: text("user_note"),
    aiEnabled: integer("ai_enabled", { mode: "boolean" }).notNull(),
    clientTimezone: text("client_timezone").notNull(),
    processingStatus: text("processing_status").notNull().default("pending"),
    processingPriority: text("processing_priority").notNull().default("interactive"),
    contentHash: text("content_hash").notNull(),
    templateVersionId: text("template_version_id"),
    capturedAt: text("captured_at").notNull(),
    committedAt: text("committed_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_v2_capture_user_draft").on(table.userId, table.draftId),
    index("idx_v2_capture_user_time").on(table.userId, table.capturedAt),
    check("ck_v2_capture_channel", sql`${table.captureChannel} in ('web','mobile_share','clipboard','import','api')`),
    check(
      "ck_v2_capture_processing_status",
      sql`${table.processingStatus} in ('pending','analyzing','enriching','completed','needs_review','failed_retryable','unclassified')`,
    ),
    check("ck_v2_capture_priority", sql`${table.processingPriority} in ('interactive','background','migration')`),
  ],
);

export const v2AttachmentReservations = sqliteTable(
  "v2_attachment_reservations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("reserved"),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
    expiresAt: text("expires_at").notNull(),
    verifiedAt: text("verified_at"),
    committedAt: text("committed_at"),
  },
  (table) => [
    uniqueIndex("uq_v2_attachment_object_key").on(table.objectKey),
    index("idx_v2_attachment_user_status").on(table.userId, table.status, table.createdAt),
    check(
      "ck_v2_attachment_status",
      sql`${table.status} in ('reserved','uploaded_unverified','verified','committed','expired')`,
    ),
    check("ck_v2_attachment_size", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 104857600`),
  ],
);

export const v2SourceItems = sqliteTable(
  "v2_source_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    captureId: text("capture_id").notNull().references(() => v2CaptureBundles.id, { onDelete: "cascade" }),
    itemKind: text("item_kind").notNull(),
    displayOrder: integer("display_order").notNull(),
    rawText: text("raw_text"),
    contentHash: text("content_hash").notNull(),
    sourceMetadata: text("source_metadata"),
    immutabilityVersion: integer("immutability_version").notNull().default(1),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_v2_source_capture_order").on(table.captureId, table.displayOrder),
    index("idx_v2_source_user_capture").on(table.userId, table.captureId),
    check("ck_v2_source_kind", sql`${table.itemKind} in ('text','image','audio','video','document','transcript','url')`),
    check("ck_v2_source_order", sql`${table.displayOrder} >= 0`),
    check("ck_v2_source_immutability", sql`${table.immutabilityVersion} = 1`),
  ],
);

export const v2SourceAttachmentLinks = sqliteTable(
  "v2_source_attachment_links",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id").notNull().references(() => v2SourceItems.id, { onDelete: "cascade" }),
    attachmentId: text("attachment_id").notNull().references(() => v2AttachmentReservations.id),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceItemId, table.attachmentId] }),
    uniqueIndex("uq_v2_source_attachment_once").on(table.attachmentId),
    index("idx_v2_source_attachment_user").on(table.userId, table.sourceItemId),
  ],
);

export const v2IdempotencyRecords = sqliteTable(
  "v2_idempotency_records",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    responseJson: text("response_json").notNull(),
    statusCode: integer("status_code").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.operation, table.idempotencyKey] })],
);

export const v2ProcessingOutbox = sqliteTable(
  "v2_processing_outbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    captureId: text("capture_id").notNull().references(() => v2CaptureBundles.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    dispatchedAt: text("dispatched_at"),
  },
  (table) => [
    index("idx_v2_outbox_capture_event").on(table.captureId, table.eventType),
    index("idx_v2_outbox_status_time").on(table.status, table.createdAt),
    check("ck_v2_outbox_event", sql`${table.eventType} in ('analyze')`),
    check("ck_v2_outbox_status", sql`${table.status} in ('pending','dispatched','failed')`),
  ],
);

export const v2ProcessingJobs = sqliteTable(
  "v2_processing_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    captureId: text("capture_id").notNull().references(() => v2CaptureBundles.id, { onDelete: "cascade" }),
    objectId: text("object_id"),
    stage: text("stage").notNull(),
    status: text("status").notNull().default("queued"),
    priority: text("priority").notNull().default("interactive"),
    idempotencyKey: text("idempotency_key").notNull(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    nextAttemptAt: text("next_attempt_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    dependencyJobId: text("dependency_job_id"),
    inputRevisionId: text("input_revision_id"),
    inputHash: text("input_hash").notNull(),
    inputLinkSnapshotId: text("input_link_snapshot_id").references(() => v2LinkSnapshots.id),
    inputSourceManifestHash: text("input_source_manifest_hash"),
    inputSourceManifestVersion: text("input_source_manifest_version"),
    createdAt: createdAt(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    lastErrorClass: text("last_error_class"),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    uniqueIndex("uq_v2_job_idempotency").on(table.userId, table.idempotencyKey),
    index("idx_v2_job_claim").on(table.status, table.priority, table.nextAttemptAt),
    index("idx_v2_job_link_snapshot").on(table.userId, table.inputLinkSnapshotId, table.status),
    check(
      "ck_v2_job_status",
      sql`${table.status} in ('queued','leased','running','succeeded','retry_wait','needs_review','dead_letter','superseded')`,
    ),
  ],
);

export const v2ProcessingRuns = sqliteTable(
  "v2_processing_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => v2ProcessingJobs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    modelRole: text("model_role").notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    registryVersion: text("registry_version").notNull(),
    modelConfigVersion: text("model_config_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    providerRequestIdHash: text("provider_request_id_hash"),
    status: text("status").notNull(),
    validationErrorCode: text("validation_error_code"),
    groundingQueryCount: integer("grounding_query_count").notNull().default(0),
    citedSourceCount: integer("cited_source_count").notNull().default(0),
    createdAt: createdAt(),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("idx_v2_run_job_time").on(table.jobId, table.createdAt),
    check("ck_v2_run_status", sql`${table.status} in ('running','succeeded','partial','failed','stale','superseded')`),
  ],
);

export const v2Objects = sqliteTable(
  "v2_objects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    objectKind: text("object_kind").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("active"),
    canonicalObjectId: text("canonical_object_id"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_v2_object_user_lifecycle").on(table.userId, table.lifecycleStatus, table.updatedAt),
    index("idx_v2_objects_user_updated_id").on(table.userId, desc(table.updatedAt), desc(table.id)),
    check("ck_v2_object_kind", sql`${table.objectKind} in ('document','entity','event')`),
    check("ck_v2_object_lifecycle", sql`${table.lifecycleStatus} in ('active','archived','merged','deleted')`),
  ],
);

export const v2ProviderInvocationLeases = sqliteTable(
  "v2_provider_invocation_leases",
  {
    jobId: text("job_id").primaryKey().references(() => v2ProcessingJobs.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().references(() => v2ProcessingRuns.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    objectId: text("object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    leaseOwner: text("lease_owner").notNull(),
    stage: text("stage").notNull(),
    expiresAt: text("expires_at").notNull(),
    acquiredAt: text("acquired_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_v2_provider_invocation_run").on(table.runId),
    index("idx_v2_provider_invocation_object_expiry").on(table.userId, table.objectId, table.expiresAt),
    check("ck_v2_provider_invocation_stage", sql`${table.stage} in ('analyze','grounded_enrich','link_analyze')`),
  ],
);

export const v2Documents = sqliteTable(
  "v2_documents",
  {
    objectId: text("object_id").primaryKey().references(() => v2Objects.id, { onDelete: "cascade" }),
    captureId: text("capture_id").notNull().references(() => v2CaptureBundles.id),
    title: text("title").notNull(),
    titleSource: text("title_source").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    currentRevisionId: text("current_revision_id").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    analyzedRevisionId: text("analyzed_revision_id"),
    currentLinkSnapshotId: text("current_link_snapshot_id"),
    linkSnapshotVersion: integer("link_snapshot_version").notNull().default(0),
    publishedLinkRunId: text("published_link_run_id"),
    writtenAt: text("written_at"),
    documentStatus: text("document_status").notNull().default("inbox"),
    summary: text("summary"),
    privacyLevel: text("privacy_level").notNull().default("normal"),
    userLockedFields: text("user_locked_fields").notNull().default("[]"),
  },
  (table) => [
    uniqueIndex("uq_v2_document_capture").on(table.captureId),
    check("ck_v2_document_title_source", sql`${table.titleSource} in ('user','ai_generated','imported','fallback')`),
    check("ck_v2_document_status", sql`${table.documentStatus} in ('inbox','draft','revising','finished','archived')`),
    check("ck_v2_document_privacy", sql`${table.privacyLevel} in ('normal','sensitive','restricted')`),
    check("ck_v2_document_version", sql`${table.currentVersion} >= 1`),
    check("ck_v2_document_link_snapshot_version", sql`${table.linkSnapshotVersion} >= 0`),
  ],
);

export const v2DocumentRevisions = sqliteTable(
  "v2_document_revisions",
  {
    id: text("id").primaryKey(),
    documentObjectId: text("document_object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    parentRevisionId: text("parent_revision_id"),
    bodyMarkdown: text("body_markdown").notNull(),
    contentHash: text("content_hash").notNull(),
    authorKind: text("author_kind").notNull(),
    changeReason: text("change_reason").notNull(),
    revisionStatus: text("revision_status").notNull().default("committed"),
    revisionNumber: integer("revision_number").notNull().default(1),
    forkedFromVersion: integer("forked_from_version"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_v2_revision_document_hash").on(table.documentObjectId, table.contentHash),
    index("idx_v2_revision_document_time").on(table.documentObjectId, table.createdAt),
    check("ck_v2_revision_author", sql`${table.authorKind} in ('user','ai_accepted','import')`),
    check("ck_v2_revision_status", sql`${table.revisionStatus} in ('committed','fork')`),
    check("ck_v2_revision_number", sql`${table.revisionNumber} >= 1`),
  ],
);

export const v2DocumentSourceLinks = sqliteTable(
  "v2_document_source_links",
  {
    documentObjectId: text("document_object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id").notNull().references(() => v2SourceItems.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    sourceOrder: integer("source_order").notNull(),
    extractionRunId: text("extraction_run_id"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.documentObjectId, table.sourceItemId] }),
    check("ck_v2_document_source_role", sql`${table.role} in ('primary_text','evidence','quotation','illustration','identifier')`),
  ],
);

export const v2DeletionTombstones = sqliteTable(
  "v2_deletion_tombstones",
  {
    objectId: text("object_id").primaryKey().references(() => v2Objects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deletedAt: text("deleted_at").notNull(),
    purgeAfter: text("purge_after").notNull(),
    restoredAt: text("restored_at"),
    reason: text("reason").notNull().default("user_request"),
  },
  (table) => [index("idx_v2_tombstone_user_purge").on(table.userId, table.purgeAfter)],
);

export const v2AuditEvents = sqliteTable(
  "v2_audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    objectKind: text("object_kind").notNull(),
    objectId: text("object_id").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: createdAt(),
  },
  (table) => [index("idx_v2_audit_user_time").on(table.userId, table.createdAt)],
);

export const v2RestrictedGrants = sqliteTable(
  "v2_restricted_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("uq_v2_restricted_grant_token").on(table.tokenHash),
    index("idx_v2_restricted_grant_session_expiry").on(table.userId, table.sessionId, table.expiresAt),
  ],
);

export const v2AnalysisProposals = sqliteTable(
  "v2_analysis_proposals",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => v2ProcessingJobs.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().references(() => v2ProcessingRuns.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    captureId: text("capture_id").notNull().references(() => v2CaptureBundles.id, { onDelete: "cascade" }),
    objectId: text("object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    inputRevisionId: text("input_revision_id").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    schemaVersion: text("schema_version").notNull(),
    validatorVersion: text("validator_version").notNull(),
    proposalJson: text("proposal_json").notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_v2_analysis_proposal_job").on(table.jobId),
    index("idx_v2_analysis_proposal_object").on(table.userId, table.objectId, table.createdAt),
    check("ck_v2_analysis_proposal_status", sql`${table.status} in ('validated','stale','needs_review','superseded')`),
  ],
);

export const v2GroundingRequests = sqliteTable(
  "v2_grounding_requests",
  {
    id: text("id").primaryKey(),
    analysisJobId: text("analysis_job_id").notNull().references(() => v2ProcessingJobs.id, { onDelete: "cascade" }),
    processingJobId: text("processing_job_id").notNull().references(() => v2ProcessingJobs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    captureId: text("capture_id").notNull().references(() => v2CaptureBundles.id, { onDelete: "cascade" }),
    objectId: text("object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    inputRevisionId: text("input_revision_id").notNull(),
    requestKey: text("request_key").notNull(),
    entityKind: text("entity_kind").notNull(),
    queryText: text("query_text").notNull(),
    queryHash: text("query_hash").notNull(),
    requestedFieldsJson: text("requested_fields_json").notNull(),
    status: text("status").notNull().default("queued"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_v2_grounding_analysis_request").on(table.analysisJobId, table.requestKey),
    uniqueIndex("uq_v2_grounding_processing_job").on(table.processingJobId),
    index("idx_v2_grounding_request_object").on(table.userId, table.objectId, table.createdAt),
    check("ck_v2_grounding_entity_kind", sql`${table.entityKind} in ('place','work','book','game')`),
    check("ck_v2_grounding_request_status", sql`${table.status} in ('queued','running','succeeded','stale','needs_review')`),
  ],
);

export const v2GroundingResults = sqliteTable(
  "v2_grounding_results",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull().references(() => v2GroundingRequests.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().references(() => v2ProcessingRuns.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    answerText: text("answer_text").notNull(),
    citationsJson: text("citations_json").notNull(),
    queriesJson: text("queries_json").notNull(),
    outputHash: text("output_hash").notNull(),
    status: text("status").notNull(),
    verifiedAt: text("verified_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_v2_grounding_result_request").on(table.requestId),
    index("idx_v2_grounding_result_user_time").on(table.userId, table.verifiedAt),
    check("ck_v2_grounding_result_status", sql`${table.status} in ('cited','stale','needs_review')`),
  ],
);

export const v2AiRuntimeState = sqliteTable(
  "v2_ai_runtime_state",
  {
    modelRole: text("model_role").primaryKey(),
    state: text("state").notNull().default("healthy"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    retryAfter: text("retry_after"),
    probeOwner: text("probe_owner"),
    probeExpiresAt: text("probe_expires_at"),
    lastErrorCode: text("last_error_code"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_v2_ai_runtime_retry").on(table.state, table.retryAfter),
    check("ck_v2_ai_runtime_role", sql`${table.modelRole} in ('main_analyzer','grounded_enricher')`),
    check("ck_v2_ai_runtime_state", sql`${table.state} in ('healthy','throttled','quota_exhausted','circuit_open')`),
    check("ck_v2_ai_runtime_failure_count", sql`${table.consecutiveFailures} >= 0`),
  ],
);

export const v2TypeDefinitions = sqliteTable(
  "v2_type_definitions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    appliesToKind: text("applies_to_kind").notNull(),
    status: text("status").notNull().default("candidate"),
    origin: text("origin").notNull(),
    definition: text("definition").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    usageCount: integer("usage_count").notNull().default(0),
    userPinned: integer("user_pinned", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_v2_type_definition_user_key").on(table.userId, table.key),
    index("idx_v2_type_definition_user_status").on(table.userId, table.status, table.usageCount),
    check("ck_v2_type_definition_kind", sql`${table.appliesToKind} in ('document','entity','event')`),
    check("ck_v2_type_definition_status", sql`${table.status} in ('candidate','observed','active','archived','merged')`),
    check("ck_v2_type_definition_origin", sql`${table.origin} in ('system_seed','ai_proposed','user_created','imported')`),
  ],
);

export const v2FieldDefinitions = sqliteTable(
  "v2_field_definitions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    definition: text("definition").notNull(),
    dataType: text("data_type").notNull(),
    canonicalUnit: text("canonical_unit"),
    status: text("status").notNull().default("candidate"),
    origin: text("origin").notNull(),
    semanticFingerprint: text("semantic_fingerprint"),
    filterable: integer("filterable", { mode: "boolean" }).notNull().default(false),
    sortable: integer("sortable", { mode: "boolean" }).notNull().default(false),
    facetable: integer("facetable", { mode: "boolean" }).notNull().default(false),
    schemaVersion: integer("schema_version").notNull().default(1),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_v2_field_definition_user_key").on(table.userId, table.key),
    index("idx_v2_field_definition_user_status").on(table.userId, table.status, table.usageCount),
    check("ck_v2_field_definition_status", sql`${table.status} in ('candidate','observed','active','archived','merged')`),
    check("ck_v2_field_definition_origin", sql`${table.origin} in ('system_seed','ai_proposed','user_created','imported')`),
  ],
);

export const v2ObjectTypeAssignments = sqliteTable(
  "v2_object_type_assignments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    objectId: text("object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    typeDefinitionId: text("type_definition_id").notNull().references(() => v2TypeDefinitions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    sourceClass: text("source_class").notNull(),
    reviewStatus: text("review_status").notNull(),
    processingRunId: text("processing_run_id").references(() => v2ProcessingRuns.id, { onDelete: "set null" }),
    lockedByUser: integer("locked_by_user", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_v2_object_type_assignment").on(table.userId, table.objectId, table.typeDefinitionId),
    index("idx_v2_object_type_user_status").on(table.userId, table.reviewStatus, table.objectId),
  ],
);

export const v2PropertyValues = sqliteTable(
  "v2_property_values",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ownerObjectId: text("owner_object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    fieldDefinitionId: text("field_definition_id").notNull().references(() => v2FieldDefinitions.id, { onDelete: "cascade" }),
    proposalTempId: text("proposal_temp_id"),
    valueKind: text("value_kind").notNull(),
    valueText: text("value_text"),
    valueNumber: real("value_number"),
    valueBoolean: integer("value_boolean", { mode: "boolean" }),
    valueDate: text("value_date"),
    valueJson: text("value_json").notNull(),
    unitKey: text("unit_key"),
    sourceClass: text("source_class").notNull(),
    claimRisk: text("claim_risk").notNull(),
    confidence: real("confidence"),
    reviewStatus: text("review_status").notNull(),
    confirmedByUserAt: text("confirmed_by_user_at"),
    lockedByUser: integer("locked_by_user", { mode: "boolean" }).notNull().default(false),
    supersedesValueId: text("supersedes_value_id"),
    processingRunId: text("processing_run_id").references(() => v2ProcessingRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    supersededAt: text("superseded_at"),
  },
  (table) => [
    uniqueIndex("uq_v2_property_run_temp").on(table.processingRunId, table.proposalTempId).where(sql`${table.processingRunId} is not null and ${table.proposalTempId} is not null`),
    uniqueIndex("uq_v2_property_current_accepted").on(table.userId, table.ownerObjectId, table.fieldDefinitionId).where(sql`${table.reviewStatus}='accepted' and ${table.supersededAt} is null`),
    index("idx_v2_property_user_field_status").on(table.userId, table.fieldDefinitionId, table.reviewStatus),
  ],
);

export const v2EvidenceRefs = sqliteTable(
  "v2_evidence_refs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    sourceItemId: text("source_item_id").references(() => v2SourceItems.id, { onDelete: "cascade" }),
    locatorKind: text("locator_kind").notNull(),
    locatorJson: text("locator_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_v2_evidence_target").on(table.targetKind, table.targetId),
    index("idx_v2_evidence_source").on(table.userId, table.sourceItemId),
    uniqueIndex("uq_v2_evidence_locator").on(table.targetKind, table.targetId, table.sourceItemId, table.locatorKind, table.locatorJson),
  ],
);

export const v2ReviewItems = sqliteTable(
  "v2_review_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    objectId: text("object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    processingRunId: text("processing_run_id").references(() => v2ProcessingRuns.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("open"),
    payloadJson: text("payload_json").notNull(),
    createdAt: createdAt(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [index("idx_v2_review_user_status_time").on(table.userId, table.status, table.createdAt)],
);

export const v2ReviewReceipts = sqliteTable(
  "v2_review_receipts",
  {
    id: text("id").primaryKey(),
    reviewItemId: text("review_item_id").notNull().references(() => v2ReviewItems.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    objectId: text("object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id"),
    priorStatus: text("prior_status"),
    resultStatus: text("result_status").notNull(),
    highRiskConfirmed: integer("high_risk_confirmed", { mode: "boolean" }).notNull().default(false),
    correctedValueJson: text("corrected_value_json"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_v2_review_receipt_item").on(table.reviewItemId),
    index("idx_v2_review_receipt_user_time").on(table.userId, table.createdAt),
  ],
);

export const v2SavedViews = sqliteTable("v2_saved_views", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewKey: text("view_key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  iconKey: text("icon_key").notNull(),
  queryPlanJson: text("query_plan_json").notNull(),
  displayJson: text("display_json").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("active"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  pinOrder: integer("pin_order"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("uq_v2_saved_view_user_key").on(table.userId, table.viewKey),
  index("idx_v2_saved_view_user_status_pin").on(table.userId, table.status, table.pinned, table.pinOrder),
]);

export const v2CaptureTemplates = sqliteTable("v2_capture_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  iconKey: text("icon_key").notNull(),
  origin: text("origin").notNull(),
  status: text("status").notNull(),
  currentVersionId: text("current_version_id"),
  patternSignature: text("pattern_signature"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("idx_v2_capture_template_user_name").on(table.userId, table.name),
  uniqueIndex("uq_v2_capture_template_pattern").on(table.userId, table.patternSignature).where(sql`${table.patternSignature} is not null`),
  index("idx_v2_capture_template_user_status").on(table.userId, table.status, table.pinned, table.usageCount),
]);

export const v2CaptureTemplateVersions = sqliteTable("v2_capture_template_versions", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull().references(() => v2CaptureTemplates.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  definitionJson: text("definition_json").notNull(),
  registrySnapshotVersion: text("registry_snapshot_version").notNull(),
  sourceModel: text("source_model"),
  promptVersion: text("prompt_version"),
  approvedAt: text("approved_at"),
  previousVersionId: text("previous_version_id"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("uq_v2_capture_template_version").on(table.templateId, table.versionNumber)]);

export const v2TemplateSourceLinks = sqliteTable("v2_template_source_links", {
  templateVersionId: text("template_version_id").notNull().references(() => v2CaptureTemplateVersions.id, { onDelete: "cascade" }),
  sourceDocumentId: text("source_document_id").notNull().references(() => v2Documents.objectId, { onDelete: "cascade" }),
  sourceRevisionId: text("source_revision_id").notNull().references(() => v2DocumentRevisions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.templateVersionId, table.sourceDocumentId, table.sourceRevisionId, table.role] })]);

export const v2CaptureTemplateSessions = sqliteTable("v2_capture_template_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  draftId: text("draft_id").notNull(),
  captureId: text("capture_id").references(() => v2CaptureBundles.id, { onDelete: "cascade" }),
  templateVersionId: text("template_version_id").notNull().references(() => v2CaptureTemplateVersions.id, { onDelete: "restrict" }),
  state: text("state").notNull(),
  appliedAt: text("applied_at").notNull(),
  detachedAt: text("detached_at"),
  submittedAt: text("submitted_at"),
  inputSnapshotJson: text("input_snapshot_json").notNull().default("[]"),
}, (table) => [
  uniqueIndex("uq_v2_capture_template_session_capture").on(table.captureId).where(sql`${table.captureId} is not null`),
  index("idx_v2_capture_template_session_draft").on(table.userId, table.draftId, table.appliedAt),
]);

export const v2CaptureInputValues = sqliteTable("v2_capture_input_values", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => v2CaptureTemplateSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),
  bindingSnapshotJson: text("binding_snapshot_json").notNull(),
  valueKind: text("value_kind").notNull(),
  valueJson: text("value_json"),
  inputOrder: integer("input_order").notNull().default(0),
  blankState: text("blank_state").notNull(),
  clientTimestamp: text("client_timestamp").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("uq_v2_capture_input_item_order").on(table.sessionId, table.itemKey, table.inputOrder),
  index("idx_v2_capture_input_user_item").on(table.userId, table.itemKey, table.createdAt),
]);

export const v2TemplatePatternObservations = sqliteTable("v2_template_pattern_observations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  patternSignature: text("pattern_signature").notNull(),
  signatureVersion: integer("signature_version").notNull().default(1),
  sourceDocumentId: text("source_document_id").notNull().references(() => v2Documents.objectId, { onDelete: "cascade" }),
  sourceRevisionId: text("source_revision_id").notNull().references(() => v2DocumentRevisions.id, { onDelete: "cascade" }),
  observedDate: text("observed_date").notNull(),
  typeKey: text("type_key"),
  featuresJson: text("features_json").notNull(),
  candidateDefinitionJson: text("candidate_definition_json"),
  similarity: real("similarity"),
  clusterId: text("cluster_id").notNull(),
  outcome: text("outcome").notNull().default("observed"),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("uq_v2_template_pattern_source").on(table.userId, table.patternSignature, table.sourceDocumentId),
  index("idx_v2_template_pattern_threshold").on(table.userId, table.patternSignature, table.observedDate, table.outcome),
]);

export const v2RediscoveryPreferences = sqliteTable("v2_rediscovery_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  includeSensitive: integer("include_sensitive", { mode: "boolean" }).notNull().default(false),
  enabledAt: text("enabled_at"),
  updatedAt: text("updated_at").notNull(),
});

export const v2RediscoveryEvents = sqliteTable("v2_rediscovery_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recordId: text("record_id").notNull().references(() => v2Documents.objectId, { onDelete: "cascade" }),
  eventKind: text("event_kind").notNull(),
  createdAt: createdAt(),
}, (table) => [index("idx_v2_rediscovery_event_user_record_time").on(table.userId, table.recordId, table.createdAt)]);

export const v2EntityRecords = sqliteTable("v2_entity_records", {
  objectId: text("object_id").primaryKey().references(() => v2Objects.id, { onDelete: "cascade" }),
  proposalTempId: text("proposal_temp_id"),
  processingRunId: text("processing_run_id").references(() => v2ProcessingRuns.id, { onDelete: "set null" }),
  entityKind: text("entity_kind").notNull(),
  canonicalName: text("canonical_name").notNull(),
  resolutionStatus: text("resolution_status").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("uq_v2_entity_run_temp").on(table.processingRunId, table.proposalTempId).where(sql`${table.processingRunId} is not null and ${table.proposalTempId} is not null`),
  index("idx_v2_entity_kind_name").on(table.entityKind, table.canonicalName),
]);

export const v2EventRecords = sqliteTable("v2_event_records", {
  objectId: text("object_id").primaryKey().references(() => v2Objects.id, { onDelete: "cascade" }),
  proposalTempId: text("proposal_temp_id"),
  processingRunId: text("processing_run_id").references(() => v2ProcessingRuns.id, { onDelete: "set null" }),
  eventTypeKey: text("event_type_key").notNull(),
  occurredAtStart: text("occurred_at_start"),
  occurredAtEnd: text("occurred_at_end"),
  timePrecision: text("time_precision").notNull().default("unknown"),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("uq_v2_event_run_temp").on(table.processingRunId, table.proposalTempId).where(sql`${table.processingRunId} is not null and ${table.proposalTempId} is not null`),
  index("idx_v2_event_type_time").on(table.eventTypeKey, table.occurredAtStart),
]);

export const v2PredicateDefinitions = sqliteTable("v2_predicate_definitions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(), label: text("label").notNull(), definition: text("definition").notNull(), inverseKey: text("inverse_key"),
  status: text("status").notNull().default("candidate"), origin: text("origin").notNull(), schemaVersion: integer("schema_version").notNull().default(1),
  createdAt: createdAt(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("uq_v2_predicate_user_key").on(table.userId, table.key)]);

export const v2RelationEdges = sqliteTable("v2_relation_edges", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subjectObjectId: text("subject_object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
  predicateDefinitionId: text("predicate_definition_id").notNull().references(() => v2PredicateDefinitions.id, { onDelete: "cascade" }),
  objectObjectId: text("object_object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
  sourceClass: text("source_class").notNull(), claimRisk: text("claim_risk").notNull(), reviewStatus: text("review_status").notNull(),
  processingRunId: text("processing_run_id").references(() => v2ProcessingRuns.id, { onDelete: "set null" }),
  lockedByUser: integer("locked_by_user", { mode: "boolean" }).notNull().default(false), createdAt: createdAt(), supersededAt: text("superseded_at"),
}, (table) => [
  uniqueIndex("uq_v2_relation_run_triple").on(table.processingRunId, table.subjectObjectId, table.predicateDefinitionId, table.objectObjectId).where(sql`${table.processingRunId} is not null`),
  index("idx_v2_relation_subject_status").on(table.userId, table.subjectObjectId, table.reviewStatus),
  index("idx_v2_relation_object_status").on(table.userId, table.objectObjectId, table.reviewStatus),
]);

export const v2UnitDefinitions = sqliteTable("v2_unit_definitions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(), label: text("label").notNull(), dimension: text("dimension").notNull(), canonicalUnitKey: text("canonical_unit_key").notNull(),
  conversionFactor: real("conversion_factor").notNull().default(1), status: text("status").notNull().default("active"), origin: text("origin").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1), createdAt: createdAt(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("uq_v2_unit_user_key").on(table.userId, table.key)]);

export const v2TypePresentationProfiles = sqliteTable("v2_type_presentation_profiles", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  typeDefinitionId: text("type_definition_id").notNull().references(() => v2TypeDefinitions.id, { onDelete: "cascade" }), iconKey: text("icon_key"),
  accentRole: text("accent_role").notNull().default("neutral"), defaultCollectionPresetKey: text("default_collection_preset_key"), defaultRecordPresetKey: text("default_record_preset_key"),
  source: text("source").notNull(), version: integer("version").notNull().default(1), status: text("status").notNull().default("candidate"), createdAt: createdAt(), updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("uq_v2_type_profile_version").on(table.typeDefinitionId, table.version),
  index("idx_v2_type_profile_active").on(table.userId, table.status, table.typeDefinitionId),
]);

export const v2ChangeEvents = sqliteTable("v2_change_events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  aggregateKind: text("aggregate_kind").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  revisionOrVersion: text("revision_or_version"),
  operation: text("operation").notNull(),
  contentHash: text("content_hash"),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("idx_v2_change_user_sequence").on(table.userId, table.sequence),
  index("idx_v2_change_user_aggregate").on(table.userId, table.aggregateKind, table.aggregateId, table.sequence),
]);

export const v2ExportJobs = sqliteTable("v2_export_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  profile: text("profile").notNull(),
  scopeJson: text("scope_json").notNull(),
  scopeHash: text("scope_hash").notNull(),
  status: text("status").notNull().default("queued"),
  baseSequence: integer("base_sequence").notNull().default(0),
  endSequence: integer("end_sequence").notNull().default(0),
  bundleObjectKey: text("bundle_object_key"),
  bundleSha256: text("bundle_sha256"),
  bundleSizeBytes: integer("bundle_size_bytes"),
  manifestJson: text("manifest_json"),
  failureCode: text("failure_code"),
  createdAt: createdAt(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  expiresAt: text("expires_at"),
  workflowVersion: integer("workflow_version").notNull().default(1),
  buildPhase: text("build_phase").notNull().default("legacy"),
  cursorJson: text("cursor_json").notNull().default("{}"),
  stateRevision: integer("state_revision").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  lastProgressAt: text("last_progress_at"),
  uploadId: text("upload_id"),
  nextPartNumber: integer("next_part_number").notNull().default(1),
  pendingObjectKey: text("pending_object_key"),
  pendingSizeBytes: integer("pending_size_bytes").notNull().default(0),
  pendingSha256: text("pending_sha256"),
  zipSizeBytes: integer("zip_size_bytes").notNull().default(0),
  zipSha256StateJson: text("zip_sha256_state_json"),
  entryCount: integer("entry_count").notNull().default(0),
}, (table) => [
  uniqueIndex("uq_v2_export_user_idempotency").on(table.userId, table.idempotencyKey),
  index("idx_v2_export_user_status_time").on(table.userId, table.status, table.createdAt),
  index("idx_v2_export_resume").on(table.userId, table.status, table.buildPhase, table.leaseExpiresAt, table.lastProgressAt),
]);

export const v2ExportFiles = sqliteTable("v2_export_files", {
  exportId: text("export_id").notNull().references(() => v2ExportJobs.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  entryKind: text("entry_kind").notNull(),
  tableName: text("table_name"),
  sourceRef: text("source_ref"),
  path: text("path").notNull(),
  mediaType: text("media_type").notNull(),
  includeInManifest: integer("include_in_manifest", { mode: "boolean" }).notNull().default(true),
  localOffset: integer("local_offset").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  crc32: integer("crc32").notNull(),
  sha256: text("sha256").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  createdAt: createdAt(),
  completedAt: text("completed_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.exportId, table.path] }),
  uniqueIndex("uq_v2_export_file_ordinal").on(table.exportId, table.ordinal),
  index("idx_v2_export_file_manifest").on(table.exportId, table.includeInManifest, table.ordinal),
]);

export const v2ExportMultipartParts = sqliteTable("v2_export_multipart_parts", {
  exportId: text("export_id").notNull().references(() => v2ExportJobs.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  partNumber: integer("part_number").notNull(),
  etag: text("etag").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.exportId, table.partNumber] }),
  index("idx_v2_export_part_resume").on(table.exportId, table.partNumber),
]);

export const v2ExportPendingSegments = sqliteTable("v2_export_pending_segments", {
  exportId: text("export_id").notNull().references(() => v2ExportJobs.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  leaseToken: text("lease_token").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.exportId, table.objectKey] }),
  index("idx_v2_export_pending_segment_cleanup").on(table.exportId, table.createdAt, table.objectKey),
]);

export const v2BackupSnapshots = sqliteTable("v2_backup_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  snapshotKind: text("snapshot_kind").notNull(),
  status: text("status").notNull().default("building"),
  baseSnapshotId: text("base_snapshot_id"),
  baseSequence: integer("base_sequence").notNull().default(0),
  endSequence: integer("end_sequence").notNull(),
  manifestObjectKey: text("manifest_object_key"),
  manifestRootHash: text("manifest_root_hash"),
  referencedBlobCount: integer("referenced_blob_count").notNull().default(0),
  referencedBlobBytes: integer("referenced_blob_bytes").notNull().default(0),
  retentionClass: text("retention_class").notNull().default("manual"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  validatorJson: text("validator_json"),
  createdAt: createdAt(),
  verifiedAt: text("verified_at"),
  expiresAt: text("expires_at"),
  prunedAt: text("pruned_at"),
  pruneRunId: text("prune_run_id"),
  workflowVersion: integer("workflow_version").notNull().default(1),
  idempotencyKey: text("idempotency_key"),
  buildPhase: text("build_phase").notNull().default("legacy"),
  cursorJson: text("cursor_json").notNull().default("{}"),
  stateRevision: integer("state_revision").notNull().default(0),
  failureCode: text("failure_code"),
  lastProgressAt: text("last_progress_at"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
}, (table) => [
  index("idx_v2_backup_user_kind_time").on(table.userId, table.snapshotKind, table.createdAt),
  uniqueIndex("uq_v2_backup_user_idempotency").on(table.userId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null`),
  index("idx_v2_backup_resume").on(table.userId, table.status, table.buildPhase, table.lastProgressAt),
  index("idx_v2_backup_prune_owner").on(table.userId, table.status, table.pruneRunId),
  uniqueIndex("uq_v2_backup_prune_run_active").on(table.pruneRunId).where(sql`${table.pruneRunId} is not null`),
]);

export const v2BackupBlobRefs = sqliteTable("v2_backup_blob_refs", {
  snapshotId: text("snapshot_id").notNull().references(() => v2BackupSnapshots.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sha256: text("sha256").notNull(),
  objectKey: text("object_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mediaType: text("media_type").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.sha256] }),
  index("idx_v2_backup_blob_ref_user_hash").on(table.userId, table.sha256, table.snapshotId),
]);

export const v2BackupMetadataFiles = sqliteTable("v2_backup_metadata_files", {
  snapshotId: text("snapshot_id").notNull().references(() => v2BackupSnapshots.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tableName: text("table_name").notNull(),
  basePath: text("base_path").notNull(),
  partNumber: integer("part_number").notNull(),
  path: text("path").notNull(),
  objectKey: text("object_key").notNull(),
  metadataMode: text("metadata_mode").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  recordCount: integer("record_count").notNull(),
  status: text("status").notNull().default("uploaded"),
  createdAt: createdAt(),
  verifiedAt: text("verified_at"),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.path] }),
  index("idx_v2_backup_metadata_resume").on(table.snapshotId, table.status, table.basePath, table.partNumber),
]);

export const v2BackupBlobWorkItems = sqliteTable("v2_backup_blob_work_items", {
  snapshotId: text("snapshot_id").notNull().references(() => v2BackupSnapshots.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sha256: text("sha256").notNull(),
  sourceObjectKey: text("source_object_key").notNull(),
  objectKey: text("object_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mediaType: text("media_type").notNull(),
  status: text("status").notNull().default("pending"),
  uploadId: text("upload_id"),
  nextOffset: integer("next_offset").notNull().default(0),
  nextPartNumber: integer("next_part_number").notNull().default(1),
  partsJson: text("parts_json").notNull().default("[]"),
  createdAt: createdAt(),
  verifiedAt: text("verified_at"),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.sha256] }),
  index("idx_v2_backup_blob_work_resume").on(table.snapshotId, table.status, table.sha256),
]);

export const v2BackupBlobMembers = sqliteTable("v2_backup_blob_members", {
  snapshotId: text("snapshot_id").notNull().references(() => v2BackupSnapshots.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sha256: text("sha256").notNull(),
  attachmentId: text("attachment_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.sha256, table.attachmentId] }),
  index("idx_v2_backup_blob_members_hash").on(table.snapshotId, table.sha256, table.attachmentId),
]);

export const v2BackupBlobGcMarks = sqliteTable("v2_backup_blob_gc_marks", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sha256: text("sha256").notNull(),
  objectKey: text("object_key").notNull(),
  unreferencedSince: text("unreferenced_since").notNull(),
  lastCheckedAt: text("last_checked_at").notNull(),
  deletedAt: text("deleted_at"),
  deleteToken: text("delete_token"),
  deleteClaimedAt: text("delete_claimed_at"),
}, (table) => [
  primaryKey({ columns: [table.userId, table.sha256] }),
  index("idx_v2_backup_blob_gc_due").on(table.userId, table.deletedAt, table.unreferencedSince),
  index("idx_v2_backup_blob_gc_claim").on(table.deleteToken, table.deletedAt, table.unreferencedSince),
]);

export const v2BackupRetentionRuns = sqliteTable("v2_backup_retention_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("running"),
  phase: text("phase").notNull().default("inventory"),
  cursorJson: text("cursor_json").notNull().default("{}"),
  stateRevision: integer("state_revision").notNull().default(0),
  failureCode: text("failure_code"),
  startedAt: text("started_at").notNull(),
  lastProgressAt: text("last_progress_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [
  uniqueIndex("uq_v2_backup_retention_user_idempotency").on(table.userId, table.idempotencyKey),
  index("idx_v2_backup_retention_resume").on(table.status, table.lastProgressAt, table.userId),
  check("ck_v2_backup_retention_run_status", sql`${table.status} in ('running','succeeded','failed')`),
  check("ck_v2_backup_retention_run_phase", sql`${table.phase} in ('inventory','ancestor_closure','pruning','gc_references','gc_deleting','complete')`),
]);

export const v2BackupRetentionKeep = sqliteTable("v2_backup_retention_keep", {
  runId: text("run_id").notNull().references(() => v2BackupRetentionRuns.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => v2BackupSnapshots.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  chainChecked: integer("chain_checked", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.snapshotId] }),
  index("idx_v2_backup_retention_keep_chain").on(table.runId, table.chainChecked, table.snapshotId),
  check("ck_v2_backup_retention_keep_chain_checked", sql`${table.chainChecked} in (0,1)`),
]);

export const v2BackupRetentionSnapshotWork = sqliteTable("v2_backup_retention_snapshot_work", {
  runId: text("run_id").notNull().references(() => v2BackupRetentionRuns.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => v2BackupSnapshots.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("receipting"),
  cursorJson: text("cursor_json").notNull().default("{}"),
  createdAt: createdAt(),
  completedAt: text("completed_at"),
}, (table) => [
  primaryKey({ columns: [table.runId, table.snapshotId] }),
  index("idx_v2_backup_retention_snapshot_work_resume").on(table.runId, table.status, table.snapshotId),
  uniqueIndex("uq_v2_backup_retention_active_snapshot_work").on(table.snapshotId).where(sql`${table.status} not in ('complete','cancelled')`),
  check("ck_v2_backup_retention_work_status", sql`${table.status} in ('receipting','deleting_objects','marking_blobs','finalizing','complete','cancelled')`),
]);

export const v2BackupRetentionObjectReceipts = sqliteTable("v2_backup_retention_object_receipts", {
  runId: text("run_id").notNull().references(() => v2BackupRetentionRuns.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => v2BackupSnapshots.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  objectKind: text("object_kind").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: createdAt(),
  deletedAt: text("deleted_at"),
}, (table) => [
  primaryKey({ columns: [table.runId, table.objectKey] }),
  index("idx_v2_backup_retention_object_resume").on(table.runId, table.snapshotId, table.status, table.objectKey),
  check("ck_v2_backup_retention_object_kind", sql`${table.objectKind} in ('metadata','manifest')`),
  check("ck_v2_backup_retention_object_status", sql`${table.status} in ('pending','deleted')`),
]);

export const v2BackupRetentionKnownMetadataPaths = sqliteTable("v2_backup_retention_known_metadata_paths", {
  path: text("path").primaryKey(),
});

export const v2BackupMaintenanceState = sqliteTable("v2_backup_maintenance_state", {
  id: integer("id").primaryKey(),
  lastUserId: text("last_user_id"),
  stateRevision: integer("state_revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [check("ck_v2_backup_maintenance_singleton", sql`${table.id}=1`)]);

export const v2RestoreBatches = sqliteTable("v2_restore_batches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  archiveSha256: text("archive_sha256").notNull(),
  manifestRootHash: text("manifest_root_hash").notNull(),
  dryRunHash: text("dry_run_hash").notNull(),
  status: text("status").notNull().default("verified"),
  summaryJson: text("summary_json").notNull(),
  collisionMapJson: text("collision_map_json").notNull().default("{}"),
  createdAt: createdAt(),
  approvedAt: text("approved_at"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  rolledBackAt: text("rolled_back_at"),
  failureCode: text("failure_code"),
  workflowVersion: integer("workflow_version").notNull().default(1),
  sourceKind: text("source_kind").notNull().default("legacy_inline"),
  sourceRef: text("source_ref"),
  sourceObjectKey: text("source_object_key"),
  sourceSizeBytes: integer("source_size_bytes"),
  cursorJson: text("cursor_json").notNull().default("{}"),
  planChainHash: text("plan_chain_hash"),
  plannedRowCount: integer("planned_row_count").notNull().default(0),
  appliedRowCount: integer("applied_row_count").notNull().default(0),
  rollbackConflictCount: integer("rollback_conflict_count").notNull().default(0),
  stateRevision: integer("state_revision").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  lastProgressAt: text("last_progress_at"),
}, (table) => [
  uniqueIndex("uq_v2_restore_user_idempotency").on(table.userId, table.idempotencyKey),
  index("idx_v2_restore_user_status_time").on(table.userId, table.status, table.createdAt),
  index("idx_v2_restore_resume").on(table.userId, table.status, table.leaseExpiresAt, table.lastProgressAt),
  index("idx_v2_restore_source").on(table.userId, table.sourceKind, table.sourceRef),
]);

export const v2WorkflowLeaseAssertions = sqliteTable("v2_workflow_lease_assertions", {
  assertionId: text("assertion_id").primaryKey(),
  workflowKind: text("workflow_kind").notNull(),
  workflowId: text("workflow_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leaseToken: text("lease_token").notNull(),
  stateRevision: integer("state_revision").notNull(),
  expectedStatus: text("expected_status").notNull(),
  nextStatus: text("next_status").notNull(),
  createdAt: createdAt(),
}, (table) => [
  check("ck_v2_workflow_lease_assertion_kind", sql`${table.workflowKind} in ('backup','restore')`),
  check("ck_v2_workflow_lease_assertion_revision", sql`${table.stateRevision}>=0`),
]);

export const v2RestoreTransitionAssertions = sqliteTable("v2_restore_transition_assertions", {
  assertionId: text("assertion_id").primaryKey(),
  restoreId: text("restore_id").notNull().references(() => v2RestoreBatches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expectedRevision: integer("expected_revision").notNull(),
  expectedStatus: text("expected_status").notNull(),
  nextStatus: text("next_status").notNull(),
  requireUnleased: integer("require_unleased", { mode: "boolean" }).notNull(),
  createdAt: createdAt(),
}, (table) => [check("ck_v2_restore_transition_revision", sql`${table.expectedRevision}>=0`)]);

export const v2RestoreGenerationCleanupReceipts = sqliteTable("v2_restore_generation_cleanup_receipts", {
  restoreId: text("restore_id").notNull().references(() => v2RestoreBatches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  armedAt: text("armed_at"),
  notBefore: text("not_before"),
  firstDeletedAt: text("first_deleted_at"),
  deleteAttemptCount: integer("delete_attempt_count").notNull().default(0),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.restoreId, table.objectKey] }),
  index("idx_v2_restore_generation_cleanup_due").on(table.notBefore, table.restoreId),
]);

export const v2RestoreRows = sqliteTable("v2_restore_rows", {
  restoreBatchId: text("restore_batch_id").notNull().references(() => v2RestoreBatches.id, { onDelete: "cascade" }),
  tableName: text("table_name").notNull(),
  rowKey: text("row_key").notNull(),
  sourceRowHash: text("source_row_hash").notNull(),
  disposition: text("disposition").notNull(),
  restoredRowKey: text("restored_row_key").notNull(),
  createdAt: createdAt(),
  sourceRowJson: text("source_row_json"),
  candidateRowJson: text("candidate_row_json"),
  restoredRowHash: text("restored_row_hash"),
  targetRowHash: text("target_row_hash"),
  planPosition: integer("plan_position"),
  applySequence: integer("apply_sequence"),
  applyStatus: text("apply_status").notNull().default("legacy"),
  rollbackStatus: text("rollback_status").notNull().default("not_applicable"),
  observedRowHash: text("observed_row_hash"),
  r2ObjectKey: text("r2_object_key"),
  r2Sha256: text("r2_sha256"),
  r2SizeBytes: integer("r2_size_bytes"),
  r2Status: text("r2_status").notNull().default("not_applicable"),
  updatedAt: text("updated_at"),
}, (table) => [
  primaryKey({ columns: [table.restoreBatchId, table.tableName, table.rowKey] }),
  index("idx_v2_restore_rows_disposition").on(table.restoreBatchId, table.disposition, table.tableName),
  index("idx_v2_restore_rows_apply").on(table.restoreBatchId, table.applyStatus, table.planPosition),
  index("idx_v2_restore_rows_rollback").on(table.restoreBatchId, table.rollbackStatus, table.applySequence),
  index("idx_v2_restore_rows_r2").on(table.restoreBatchId, table.r2Status, table.planPosition),
]);

export const v2RestoreFiles = sqliteTable("v2_restore_files", {
  restoreBatchId: text("restore_batch_id").notNull().references(() => v2RestoreBatches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileId: text("file_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  tableName: text("table_name"),
  path: text("path").notNull(),
  sourceObjectKey: text("source_object_key").notNull(),
  dataOffset: integer("data_offset").notNull().default(0),
  byteLength: integer("byte_length").notNull(),
  expectedSha256: text("expected_sha256"),
  expectedCrc32: integer("expected_crc32"),
  expectedRecords: integer("expected_records").notNull().default(0),
  schemaVersion: text("schema_version"),
  sourceScopeId: text("source_scope_id"),
  layerOrdinal: integer("layer_ordinal"),
  metadataMode: text("metadata_mode"),
  status: text("status").notNull().default("indexed"),
  nextByteOffset: integer("next_byte_offset").notNull().default(0),
  nextRecord: integer("next_record").notNull().default(0),
  verifiedAt: text("verified_at"),
  consumedAt: text("consumed_at"),
  failureCode: text("failure_code"),
}, (table) => [
  primaryKey({ columns: [table.restoreBatchId, table.fileId] }),
  index("idx_v2_restore_files_status").on(table.restoreBatchId, table.status, table.ordinal),
]);

export const v2RestoreIdMappings = sqliteTable("v2_restore_id_mappings", {
  restoreBatchId: text("restore_batch_id").notNull().references(() => v2RestoreBatches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tableName: text("table_name").notNull(),
  sourceId: text("source_id").notNull(),
  targetId: text("target_id").notNull(),
  disposition: text("disposition").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.restoreBatchId, table.tableName, table.sourceId] }),
  index("idx_v2_restore_id_mapping_target").on(table.restoreBatchId, table.tableName, table.targetId),
]);

export const v2RestoreUploads = sqliteTable("v2_restore_uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  fileName: text("file_name").notNull(),
  expectedSizeBytes: integer("expected_size_bytes").notNull(),
  expectedArchiveSha256: text("expected_archive_sha256").notNull(),
  partSizeBytes: integer("part_size_bytes").notNull().default(8 * 1024 * 1024),
  expectedPartCount: integer("expected_part_count").notNull(),
  status: text("status").notNull().default("uploading"),
  phase: text("phase").notNull().default("receiving"),
  cursorJson: text("cursor_json").notNull().default("{}"),
  uploadedBytes: integer("uploaded_bytes").notNull().default(0),
  hashVerifiedBytes: integer("hash_verified_bytes").notNull().default(0),
  finalObjectKey: text("final_object_key").notNull(),
  multipartUploadId: text("multipart_upload_id"),
  restoreBatchId: text("restore_batch_id").references(() => v2RestoreBatches.id, { onDelete: "set null" }),
  stateRevision: integer("state_revision").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  failureCode: text("failure_code"),
  createdAt: createdAt(),
  lastProgressAt: text("last_progress_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [
  uniqueIndex("uq_v2_restore_upload_user_idempotency").on(table.userId, table.idempotencyKey),
  index("idx_v2_restore_upload_resume").on(table.userId, table.status, table.leaseExpiresAt, table.lastProgressAt),
  index("idx_v2_restore_upload_expiry").on(table.status, table.expiresAt, table.leaseExpiresAt),
]);

export const v2RestoreUploadParts = sqliteTable("v2_restore_upload_parts", {
  uploadId: text("upload_id").notNull().references(() => v2RestoreUploads.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  partNumber: integer("part_number").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  tempObjectKey: text("temp_object_key").notNull(),
  multipartEtag: text("multipart_etag"),
  createdAt: createdAt(),
  tempDeletedAt: text("temp_deleted_at"),
}, (table) => [
  primaryKey({ columns: [table.uploadId, table.partNumber] }),
  index("idx_v2_restore_upload_part_resume").on(table.uploadId, table.multipartEtag, table.partNumber),
  index("idx_v2_restore_upload_part_cleanup").on(table.uploadId, table.tempDeletedAt, table.partNumber),
]);

export const v2LegacySourceEnvelopes = sqliteTable("v2_legacy_source_envelopes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  legacyTable: text("legacy_table").notNull(),
  legacyId: text("legacy_id").notNull(),
  rowJson: text("row_json").notNull(),
  rowHash: text("row_hash").notNull(),
  capturedAt: text("captured_at").notNull(),
  schemaSnapshot: text("schema_snapshot").notNull(),
  damageCodesJson: text("damage_codes_json").notNull().default("[]"),
  importBatchId: text("import_batch_id").notNull(),
}, (table) => [
  uniqueIndex("uq_v2_legacy_envelope_source").on(table.userId, table.legacyTable, table.legacyId, table.rowHash, table.schemaSnapshot),
  index("idx_v2_legacy_envelope_batch").on(table.userId, table.importBatchId),
]);

export const v2LegacySourceMappings = sqliteTable("v2_legacy_source_mappings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  legacyEnvelopeId: text("legacy_envelope_id").notNull().references(() => v2LegacySourceEnvelopes.id, { onDelete: "cascade" }),
  legacyTable: text("legacy_table").notNull(),
  legacyId: text("legacy_id").notNull(),
  adapterVersion: text("adapter_version").notNull(),
  sourceItemId: text("source_item_id").references(() => v2SourceItems.id, { onDelete: "set null" }),
  projectedObjectId: text("projected_object_id").references(() => v2Objects.id, { onDelete: "set null" }),
  projectionKind: text("projection_kind").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
  supersededAt: text("superseded_at"),
  supersededByMappingId: text("superseded_by_mapping_id"),
  supersededFromStatus: text("superseded_from_status"),
  targetLifecycleStatus: text("target_lifecycle_status"),
  activationBatchId: text("activation_batch_id"),
}, (table) => [
  uniqueIndex("uq_v2_legacy_mapping_projection").on(table.userId, table.legacyEnvelopeId, table.adapterVersion, table.projectionKind),
  index("idx_v2_legacy_mapping_batch_source").on(table.legacyEnvelopeId, table.status),
  index("idx_v2_legacy_mapping_current_projection").on(table.userId, table.legacyTable, table.legacyId, table.adapterVersion, table.projectionKind, table.status),
  index("idx_v2_legacy_mapping_object_visibility")
    .on(table.userId, table.projectedObjectId, table.status)
    .where(sql`${table.projectedObjectId} is not null`),
]);

export const v2LegacyMigrationBatches = sqliteTable("v2_legacy_migration_batches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  legacyTable: text("legacy_table").notNull(),
  adapterVersion: text("adapter_version").notNull(),
  mode: text("mode").notNull(),
  dryRunHash: text("dry_run_hash").notNull(),
  schemaSnapshot: text("schema_snapshot").notNull(),
  manifestJson: text("manifest_json").notNull(),
  inputRows: integer("input_rows").notNull(),
  expectedMappingCount: integer("expected_mapping_count").notNull(),
  nextOffset: integer("next_offset").notNull().default(0),
  status: text("status").notNull().default("approved"),
  reconciliationStatus: text("reconciliation_status").notNull().default("pending"),
  reconciliationJson: text("reconciliation_json"),
  summaryJson: text("summary_json").notNull(),
  failureCode: text("failure_code"),
  createdAt: createdAt(),
  approvedAt: text("approved_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  reconciledAt: text("reconciled_at"),
  stateRevision: integer("state_revision").notNull().default(0),
  controlStatus: text("control_status").notNull().default("paused"),
  quarantineIdempotencyKey: text("quarantine_idempotency_key"),
  quarantineReason: text("quarantine_reason"),
  quarantinePreStatus: text("quarantine_pre_status"),
  quarantinePreControlStatus: text("quarantine_pre_control_status"),
  quarantineReceiptJson: text("quarantine_receipt_json"),
  quarantinedAt: text("quarantined_at"),
}, (table) => [
  index("idx_v2_legacy_batch_user_status").on(table.userId, table.status, table.createdAt),
]);

export const v2LegacyQuarantineAssertions = sqliteTable("v2_legacy_quarantine_assertions", {
  assertionId: text("assertion_id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => v2LegacyMigrationBatches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expectedRevision: integer("expected_revision").notNull(),
  expectedControlStatus: text("expected_control_status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  expectedItemCount: integer("expected_item_count").notNull(),
  expectedEnvelopeCount: integer("expected_envelope_count").notNull(),
  expectedMappingCount: integer("expected_mapping_count").notNull(),
  expectedSourceCount: integer("expected_source_count").notNull(),
  expectedPriorMappingCount: integer("expected_prior_mapping_count").notNull(),
  createdAt: text("created_at").notNull(),
});

export const v2LegacyMigrationBatchItems = sqliteTable("v2_legacy_migration_batch_items", {
  batchId: text("batch_id").notNull().references(() => v2LegacyMigrationBatches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  legacyEnvelopeId: text("legacy_envelope_id").notNull().references(() => v2LegacySourceEnvelopes.id, { onDelete: "cascade" }),
  legacyId: text("legacy_id").notNull(),
  rowHash: text("row_hash").notNull(),
  projectionHash: text("projection_hash"),
  projectionsJson: text("projections_json"),
  expectedMappingCount: integer("expected_mapping_count").notNull(),
  status: text("status").notNull().default("pending"),
  processedAt: text("processed_at"),
}, (table) => [
  primaryKey({ columns: [table.batchId, table.position] }),
  uniqueIndex("uq_v2_legacy_batch_item_envelope").on(table.batchId, table.legacyEnvelopeId),
  index("idx_v2_legacy_batch_item_status").on(table.userId, table.batchId, table.status, table.position),
]);

export const v2LegacyPreservationGates = sqliteTable("v2_legacy_preservation_gates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetBatchId: text("target_batch_id").notNull(),
  targetTable: text("target_table").notNull(),
  targetAdapterVersion: text("target_adapter_version").notNull(),
  targetDryRunHash: text("target_dry_run_hash").notNull(),
  basisHash: text("basis_hash").notNull(),
  requiredTablesJson: text("required_tables_json").notNull(),
  nextTablePosition: integer("next_table_position").notNull().default(0),
  nextRowOffset: integer("next_row_offset").notNull().default(0),
  checkedRows: integer("checked_rows").notNull().default(0),
  status: text("status").notNull().default("checking"),
  stateRevision: integer("state_revision").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  failureCode: text("failure_code"),
  failureDetail: text("failure_detail"),
  createdAt: createdAt(),
  lastProgressAt: text("last_progress_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [
  uniqueIndex("uq_v2_legacy_gate_target_batch").on(table.userId, table.targetBatchId),
  index("idx_v2_legacy_gate_resume").on(table.userId, table.status, table.leaseExpiresAt, table.lastProgressAt),
]);

export const v2LinkSnapshots = sqliteTable("v2_link_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentObjectId: text("document_object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
  captureId: text("capture_id").notNull().references(() => v2CaptureBundles.id, { onDelete: "cascade" }),
  parentSnapshotId: text("parent_snapshot_id"),
  snapshotVersion: integer("snapshot_version").notNull(),
  manifestVersion: text("manifest_version").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  acquisitionMethod: text("acquisition_method").notNull(),
  adapterVersion: text("adapter_version").notNull(),
  captureState: text("capture_state").notNull(),
  coverageJson: text("coverage_json").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("uq_v2_link_snapshot_version").on(table.documentObjectId, table.snapshotVersion),
  foreignKey({ columns: [table.parentSnapshotId], foreignColumns: [table.id] }),
  index("idx_v2_link_snapshot_owner_document").on(table.userId, table.documentObjectId, table.createdAt),
  check("ck_v2_link_snapshot_version", sql`${table.snapshotVersion} >= 1`),
  check("ck_v2_link_snapshot_manifest", sql`${table.manifestVersion} = 'link-source-manifest.v1'`),
  check("ck_v2_link_snapshot_hash", sql`length(${table.manifestHash}) = 64`),
  check("ck_v2_link_snapshot_coverage", sql`json_valid(${table.coverageJson})`),
  check("ck_v2_link_snapshot_method", sql`${table.acquisitionMethod} in ('user_paste','user_upload','api','public_fetch')`),
  check("ck_v2_link_snapshot_state", sql`${table.captureState} in ('link_only','partial','captured','needs_input','unavailable')`),
]);

export const v2LinkSnapshotSources = sqliteTable("v2_link_snapshot_sources", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => v2LinkSnapshots.id, { onDelete: "cascade" }),
  sourceItemId: text("source_item_id").notNull().references(() => v2SourceItems.id),
  memberKey: text("member_key").notNull(),
  sourceOrder: integer("source_order").notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
}, (table) => [
  uniqueIndex("uq_v2_link_snapshot_member_key").on(table.snapshotId, table.memberKey),
  uniqueIndex("uq_v2_link_snapshot_member_order").on(table.snapshotId, table.sourceOrder),
  uniqueIndex("uq_v2_link_snapshot_member_source").on(table.snapshotId, table.sourceItemId),
  index("idx_v2_link_snapshot_member_owner").on(table.userId, table.snapshotId),
  check("ck_v2_link_snapshot_member_order", sql`${table.sourceOrder} >= 0`),
  check("ck_v2_link_snapshot_member_fingerprint", sql`length(${table.sourceFingerprint}) = 64`),
]);

export const v2LinkFragments = sqliteTable("v2_link_fragments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentObjectId: text("document_object_id").notNull().references(() => v2Objects.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => v2LinkSnapshots.id, { onDelete: "cascade" }),
  primaryMemberId: text("primary_member_id").notNull().references(() => v2LinkSnapshotSources.id),
  processingRunId: text("processing_run_id").references(() => v2ProcessingRuns.id),
  fragmentKey: text("fragment_key").notNull(),
  role: text("role").notNull(),
  sourceClass: text("source_class").notNull(),
  textStart: integer("text_start"), textEnd: integer("text_end"),
  rawText: text("raw_text"), rawTextHash: text("raw_text_hash"), derivedText: text("derived_text"),
  detailsJson: text("details_json").notNull().default("{}"),
  completeness: text("completeness").notNull(),
  displayOrder: integer("display_order").notNull(),
  reviewStatus: text("review_status").notNull(),
  lockedByUser: integer("locked_by_user", { mode: "boolean" }).notNull().default(false),
  stateVersion: integer("state_version").notNull().default(1),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("uq_v2_link_fragment_run_key").on(table.processingRunId, table.fragmentKey),
  index("idx_v2_link_fragment_document").on(table.userId, table.documentObjectId, table.processingRunId, table.displayOrder),
  check("ck_v2_link_fragment_role", sql`${table.role} in ('prompt','negative_prompt','parameters','quote','insight','visual_tip','transcript','caption')`),
  check("ck_v2_link_fragment_source", sql`${table.sourceClass} in ('source_extract','ai_interpretation','user_assertion')`),
  check("ck_v2_link_fragment_completeness", sql`${table.completeness} in ('complete','partial','truncated','ocr_unverified','selection_unverified','unknown')`),
  check("ck_v2_link_fragment_review", sql`${table.reviewStatus} in ('proposed','confirmed','rejected','superseded')`),
  check("ck_v2_link_fragment_order", sql`${table.displayOrder} >= 0`),
  check("ck_v2_link_fragment_version", sql`${table.stateVersion} >= 1`),
  check("ck_v2_link_fragment_lock", sql`${table.lockedByUser} in (0,1)`),
  check("ck_v2_link_fragment_details", sql`json_valid(${table.detailsJson})`),
  check("ck_v2_link_fragment_offsets", sql`(${table.textStart} is null and ${table.textEnd} is null) or (${table.textStart} is not null and ${table.textEnd} is not null and ${table.textStart} >= 0 and ${table.textEnd} > ${table.textStart})`),
  check("ck_v2_link_fragment_raw_hash", sql`(${table.rawText} is null and ${table.rawTextHash} is null) or (${table.rawText} is not null and ${table.rawTextHash} is not null and length(${table.rawTextHash})=64)`),
  check("ck_v2_link_fragment_extract", sql`${table.sourceClass}<>'source_extract' or (${table.rawText} is not null and ${table.rawTextHash} is not null and ${table.textStart} is not null and ${table.textEnd} is not null and ${table.derivedText} is null)`),
  check("ck_v2_link_fragment_interpretation", sql`${table.sourceClass}<>'ai_interpretation' or (${table.rawText} is null and ${table.rawTextHash} is null and ${table.textStart} is null and ${table.textEnd} is null and ${table.derivedText} is not null)`),
]);

export const v2LinkFragmentEvidence = sqliteTable("v2_link_fragment_evidence", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fragmentId: text("fragment_id").notNull().references(() => v2LinkFragments.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => v2LinkSnapshotSources.id),
  relationKind: text("relation_kind").notNull(), evidenceMethod: text("evidence_method").notNull(),
  textStart: integer("text_start"), textEnd: integer("text_end"), imageRegionJson: text("image_region_json"),
  startSeconds: real("start_seconds"), endSeconds: real("end_seconds"),
  displayOrder: integer("display_order").notNull(),
  lockedByUser: integer("locked_by_user", { mode: "boolean" }).notNull().default(false),
  stateVersion: integer("state_version").notNull().default(1),
  createdAt: createdAt(),
}, (table) => [
  index("idx_v2_link_fragment_evidence_order").on(table.fragmentId, table.displayOrder),
  check("ck_v2_link_fragment_evidence_relation", sql`${table.relationKind} in ('example','supports','continuation','variant')`),
  check("ck_v2_link_fragment_evidence_method", sql`${table.evidenceMethod} in ('explicit','author_continuation','user_confirmed','ai_proposed','unresolved')`),
  check("ck_v2_link_fragment_evidence_order", sql`${table.displayOrder} >= 0`),
  check("ck_v2_link_fragment_evidence_version", sql`${table.stateVersion} >= 1`),
  check("ck_v2_link_fragment_evidence_lock", sql`${table.lockedByUser} in (0,1)`),
  check("ck_v2_link_fragment_evidence_region", sql`${table.imageRegionJson} is null or json_valid(${table.imageRegionJson})`),
  check("ck_v2_link_fragment_evidence_offsets", sql`(${table.textStart} is null and ${table.textEnd} is null) or (${table.textStart} is not null and ${table.textEnd} is not null and ${table.textStart} >= 0 and ${table.textEnd} > ${table.textStart})`),
  check("ck_v2_link_fragment_evidence_seconds", sql`(${table.startSeconds} is null and ${table.endSeconds} is null) or (${table.startSeconds} is not null and ${table.endSeconds} is not null and ${table.startSeconds} >= 0 and ${table.endSeconds} > ${table.startSeconds})`),
]);
