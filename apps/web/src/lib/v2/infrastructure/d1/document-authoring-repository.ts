import {
  DocumentRevisionIdempotencyConflictError,
  DocumentRevisionLockedError,
  DocumentRevisionNotFoundError,
  DocumentRevisionSchemaRequiredError,
  DocumentRevisionValidationError,
  DocumentRevisionWriteError,
  type DocumentRevisionResult,
  type PreparedDocumentRevision,
} from "@/lib/v2/domain/document-revision";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

const REVISION_OPERATION = "document.revise";

type IdempotencyRow = { payload_hash: string; response_json: string };
type CandidateReceipt = { recordId: string; revisionId: string; savedAt: string };
type RevisionStateRow = { revision_status: "committed" | "fork"; revision_number: number };
type CurrentDocumentRow = {
  object_id: string;
  title: string;
  body_markdown: string;
  current_revision_id: string;
  current_version: number;
  written_at: string | null;
  document_status: string;
  privacy_level: string;
  ai_enabled: number;
};

export type V2LibraryRecord = Readonly<{
  recordId: string;
  title: string | null;
  excerpt: string | null;
  privacyLevel: "normal" | "sensitive" | "restricted";
  documentStatus: string;
  lifecycleStatus: string;
  currentVersion: number | null;
  writtenAt: string | null;
  capturedAt: string;
  updatedAt: string;
  locked: boolean;
}>;

export type V2LibraryPage = Readonly<{
  records: readonly V2LibraryRecord[];
  nextCursor: string | null;
  totalCount: number;
}>;

type LibraryCursor = { version: 1; updatedAt: string; recordId: string; includeDeleted: boolean };

function readLibraryCursor(cursor: string | undefined, includeDeleted: boolean): LibraryCursor | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid cursor encoding.");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as LibraryCursor;
    if (value.version !== 1 || typeof value.updatedAt !== "string" || !value.updatedAt || typeof value.recordId !== "string" || !value.recordId || value.includeDeleted !== includeDeleted) throw new Error("Invalid cursor scope.");
    return value;
  } catch {
    throw new DocumentRevisionValidationError("Library cursor is invalid for this collection.");
  }
}

function parseCandidate(value: string): CandidateReceipt {
  const parsed = JSON.parse(value) as CandidateReceipt;
  if (!parsed.recordId || !parsed.revisionId || !parsed.savedAt) throw new DocumentRevisionWriteError(new Error("Invalid revision receipt."));
  return parsed;
}

export class D1DocumentAuthoringRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {
    if (!userId.trim()) throw new Error("A scoped repository requires a userId.");
  }

  private findIdempotency(idempotencyKey: string) {
    return this.db
      .prepare(`select payload_hash,response_json from v2_idempotency_records where user_id=? and operation=? and idempotency_key=? limit 1`)
      .bind(this.userId, REVISION_OPERATION, idempotencyKey)
      .first<IdempotencyRow>();
  }

  private async assertWritable(recordId: string, restrictedUnlocked: boolean) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const visible = await this.db
      .prepare(`select d.privacy_level from v2_objects o join v2_documents d on d.object_id=o.id where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`)
      .bind(recordId, this.userId)
      .first<{ privacy_level: string }>();
    if (!visible) throw new DocumentRevisionNotFoundError();
    if (visible.privacy_level === "restricted" && !restrictedUnlocked) throw new DocumentRevisionLockedError();
  }

  private async resolveCandidate(candidate: CandidateReceipt, replayed: boolean, restrictedUnlocked: boolean): Promise<DocumentRevisionResult> {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const revision = await this.db
      .prepare(
        `select r.revision_status,r.revision_number
         from v2_document_revisions r join v2_objects o on o.id=r.document_object_id
         where r.id=? and r.document_object_id=? and o.user_id=? and ${legacyVisibility} limit 1`,
      )
      .bind(candidate.revisionId, candidate.recordId, this.userId)
      .first<RevisionStateRow>();
    if (!revision) throw new DocumentRevisionNotFoundError();
    if (revision.revision_status === "committed") {
      return { outcome: "saved", recordId: candidate.recordId, revisionId: candidate.revisionId, version: revision.revision_number, savedAt: candidate.savedAt, replayed };
    }
    await this.assertWritable(candidate.recordId, restrictedUnlocked);
    const current = await this.db
      .prepare(
        `select d.current_revision_id,d.current_version
         from v2_documents d join v2_objects o on o.id=d.object_id
         where d.object_id=? and o.user_id=? and ${legacyVisibility}
           and ${restrictedUnlocked ? "1=1" : "d.privacy_level <> 'restricted'"} limit 1`,
      )
      .bind(candidate.recordId, this.userId)
      .first<{ current_revision_id: string; current_version: number }>();
    if (!current) {
      await this.assertWritable(candidate.recordId, restrictedUnlocked);
      throw new DocumentRevisionNotFoundError();
    }
    return {
      outcome: "conflict",
      recordId: candidate.recordId,
      forkRevisionId: candidate.revisionId,
      currentRevisionId: current.current_revision_id,
      currentVersion: current.current_version,
      savedAt: candidate.savedAt,
      replayed,
    };
  }

  private async replay(recordId: string, row: IdempotencyRow, input: PreparedDocumentRevision, restrictedUnlocked: boolean) {
    const candidate = parseCandidate(row.response_json);
    await this.assertWritable(candidate.recordId, restrictedUnlocked);
    if (candidate.recordId !== recordId) throw new DocumentRevisionIdempotencyConflictError();
    if (row.payload_hash !== input.payloadHash) throw new DocumentRevisionIdempotencyConflictError();
    return this.resolveCandidate(candidate, true, restrictedUnlocked);
  }

  async saveRevision(recordId: string, input: PreparedDocumentRevision, options: { restrictedUnlocked?: boolean } = {}): Promise<DocumentRevisionResult> {
    const restrictedUnlocked = options.restrictedUnlocked === true;
    await this.assertWritable(recordId, restrictedUnlocked);
    const existingIdempotency = await this.findIdempotency(input.idempotencyKey);
    if (existingIdempotency) return this.replay(recordId, existingIdempotency, input, restrictedUnlocked);

    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const privacyGuard = restrictedUnlocked ? "1=1" : "d.privacy_level <> 'restricted'";

    const current = await this.db
      .prepare(
        `select d.object_id,d.title,d.body_markdown,d.current_revision_id,d.current_version,d.written_at,d.document_status,d.privacy_level,c.ai_enabled
         from v2_documents d join v2_objects o on o.id=d.object_id
         join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
         where d.object_id=? and o.user_id=? and ${legacyVisibility} limit 1`,
      )
      .bind(recordId, this.userId)
      .first<CurrentDocumentRow>();
    if (!current) throw new DocumentRevisionNotFoundError();
    if (current.privacy_level === "restricted" && !restrictedUnlocked) throw new DocumentRevisionLockedError();

    const parent = await this.db
      .prepare(
        `select r.id from v2_document_revisions r join v2_objects o on o.id=r.document_object_id
         where r.id=? and r.document_object_id=? and o.user_id=? and ${legacyVisibility} limit 1`,
      )
      .bind(input.expectedRevisionId, recordId, this.userId)
      .first<{ id: string }>();
    if (!parent) throw new DocumentRevisionValidationError("expectedRevisionId does not belong to this document.");

    const unchanged = current.current_version === input.expectedVersion
      && current.current_revision_id === input.expectedRevisionId
      && current.title === input.title
      && current.body_markdown === input.bodyMarkdown
      && current.written_at === input.writtenAt
      && current.document_status === input.documentStatus
      && current.privacy_level === input.privacyLevel;
    if (!unchanged && current.ai_enabled === 1) {
      const legacyOutboxIndex = await this.db.prepare("select 1 as present from sqlite_master where type='index' and name='uq_v2_outbox_capture_event' limit 1").first<{ present: number }>();
      if (legacyOutboxIndex) throw new DocumentRevisionSchemaRequiredError();
    }
    const candidate: CandidateReceipt = {
      recordId,
      revisionId: unchanged ? current.current_revision_id : input.revisionId,
      savedAt: input.savedAt,
    };

    const statements = unchanged
      ? [
          this.db
            .prepare(
              `insert into v2_idempotency_records (user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
               select ?,?,?,?,?,200,?
               where exists (
                 select 1 from v2_documents d join v2_objects o on o.id=d.object_id
                 where d.object_id=? and o.user_id=? and ${legacyVisibility} and ${privacyGuard}
               )`,
            )
            .bind(this.userId, REVISION_OPERATION, input.idempotencyKey, input.payloadHash, JSON.stringify(candidate), input.savedAt, recordId, this.userId),
        ]
      : [
          this.db
            .prepare(
              `insert into v2_document_revisions
               (id,document_object_id,parent_revision_id,body_markdown,content_hash,author_kind,change_reason,revision_status,revision_number,forked_from_version,created_at)
               select ?,?,?,?,?,'user','autosave','fork',?,?,?
               where exists (
                 select 1 from v2_documents d join v2_objects o on o.id=d.object_id
                 where d.object_id=? and o.user_id=? and ${legacyVisibility} and ${privacyGuard}
               )`,
            )
            .bind(input.revisionId, recordId, input.expectedRevisionId, input.bodyMarkdown, input.contentHash, input.expectedVersion + 1, input.expectedVersion, input.savedAt, recordId, this.userId),
          this.db
            .prepare(
              `update v2_documents set title=?,title_source='user',body_markdown=?,current_revision_id=?,current_version=current_version+1,
                 written_at=?,document_status=?,privacy_level=?
               where object_id=? and current_version=? and current_revision_id=?
                 and ${restrictedUnlocked ? "1=1" : "privacy_level <> 'restricted'"}
                 and exists (
                   select 1 from v2_objects o
                   where o.id=v2_documents.object_id and o.user_id=? and ${legacyVisibility}
                 )`,
            )
            .bind(input.title, input.bodyMarkdown, input.revisionId, input.writtenAt, input.documentStatus, input.privacyLevel, recordId, input.expectedVersion, input.expectedRevisionId, this.userId),
          this.db
            .prepare(
              `update v2_document_revisions set revision_status='committed'
               where id=? and exists (
                 select 1 from v2_documents d join v2_objects o on o.id=d.object_id
                 where d.object_id=? and d.current_revision_id=? and o.user_id=? and ${legacyVisibility}
               )`,
            )
            .bind(input.revisionId, recordId, input.revisionId, this.userId),
          this.db
            .prepare(
              `update v2_objects as o set updated_at=? where o.id=? and o.user_id=?
               and ${legacyVisibility}
               and exists (select 1 from v2_documents d where d.object_id=o.id and d.current_revision_id=?)`,
            )
            .bind(input.savedAt, recordId, this.userId, input.revisionId),
          this.db
            .prepare(
              `insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at)
               select ?,?,'document.revision_saved','document',?,'{}',?
               where exists (
                 select 1 from v2_documents d join v2_objects o on o.id=d.object_id
                 where d.object_id=? and d.current_revision_id=? and o.user_id=? and ${legacyVisibility}
               )`,
            )
            .bind(input.auditEventId, this.userId, recordId, input.savedAt, recordId, input.revisionId, this.userId),
          this.db
            .prepare(
              `insert into v2_idempotency_records (user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
               select ?,?,?,?,?,200,?
               where exists (
                 select 1 from v2_documents d join v2_objects o on o.id=d.object_id
                 where d.object_id=? and o.user_id=? and ${legacyVisibility}
                   and exists (select 1 from v2_document_revisions written where written.id=? and written.document_object_id=d.object_id)
               )`,
            )
            .bind(this.userId, REVISION_OPERATION, input.idempotencyKey, input.payloadHash, JSON.stringify(candidate), input.savedAt, recordId, this.userId, input.revisionId),
        ];

    if (!unchanged) {
      const sourceId = `revision_source:${input.revisionId}`;
      // Only the revision that won the CAS owns a new analysis source/outbox.
      // Original capture text remains immutable and separately addressable.
      statements.push(
        this.db.prepare(`insert into v2_source_items
          (id,user_id,capture_id,item_kind,display_order,raw_text,content_hash,source_metadata,immutability_version,created_at)
          select ?,?,d.capture_id,'text',coalesce((select max(s.display_order)+1 from v2_source_items s where s.capture_id=d.capture_id),0),?,?,?,1,?
          from v2_documents d join v2_objects o on o.id=d.object_id
          where d.object_id=? and d.current_revision_id=? and o.user_id=? and ${legacyVisibility}`)
          .bind(sourceId, this.userId, input.bodyMarkdown, input.contentHash, JSON.stringify({ document_revision_id: input.revisionId, purpose: "document_revision" }), input.savedAt, recordId, input.revisionId, this.userId),
        this.db.prepare(`insert into v2_document_source_links (document_object_id,source_item_id,role,source_order,created_at)
          select ?,s.id,'primary_text',s.display_order,? from v2_source_items s where s.id=? and s.user_id=?`)
          .bind(recordId, input.savedAt, sourceId, this.userId),
        this.db.prepare(`insert into v2_processing_outbox (id,user_id,capture_id,event_type,payload_json,status,created_at)
          select ?,?,c.id,'analyze',json_object('captureId',c.id),'pending',?
          from v2_capture_bundles c join v2_documents d on d.capture_id=c.id join v2_objects o on o.id=d.object_id and o.user_id=c.user_id
          where d.object_id=? and d.current_revision_id=? and c.user_id=? and c.ai_enabled=1 and ${legacyVisibility}`)
          .bind(`revision_analysis:${input.revisionId}`, this.userId, input.savedAt, recordId, input.revisionId, this.userId),
        this.db.prepare(`update v2_capture_bundles set processing_status='pending'
          where user_id=? and ai_enabled=1 and id in (select d.capture_id from v2_documents d join v2_objects o on o.id=d.object_id where d.object_id=? and d.current_revision_id=? and o.user_id=? and ${legacyVisibility})`)
          .bind(this.userId, recordId, input.revisionId, this.userId),
      );
      // A successful edit invalidates unlocked analysis of an earlier revision,
      // while retaining all raw evidence and every user-confirmed/locked value.
      // Foundation-only installations do not have the knowledge tables yet.
      const knowledgeTables = await this.db.prepare("select name from sqlite_master where type='table' and name in ('v2_property_values','v2_object_type_assignments','v2_relation_edges','v2_review_items')").all<{ name: string }>();
      const available = new Set(knowledgeTables.results.map((row) => row.name));
      const staleRun = `exists (select 1 from v2_processing_runs r join v2_processing_jobs j on j.id=r.job_id and j.user_id=r.user_id
        where r.id=stale.processing_run_id and r.user_id=? and j.object_id=? and j.input_revision_id<>?)
        and exists (select 1 from v2_source_items saved where saved.id=? and saved.user_id=?)`;
      const staleTables = [
        { table: "v2_property_values", owner: "owner_object_id", update: "review_status='superseded',superseded_at=?", eligible: "locked_by_user=0 and review_status in ('accepted','proposed','disputed')" },
        { table: "v2_object_type_assignments", owner: "object_id", update: "review_status='superseded',updated_at=?", eligible: "locked_by_user=0 and review_status in ('accepted','proposed')" },
        { table: "v2_relation_edges", owner: "subject_object_id", update: "review_status='superseded',superseded_at=?", eligible: "locked_by_user=0 and review_status in ('accepted','proposed','disputed')" },
        { table: "v2_review_items", owner: "object_id", update: "status='dismissed',resolved_at=?", eligible: "status='open'" },
      ];
      for (const { table, owner, update, eligible } of staleTables) {
        if (available.has(table)) statements.push(this.db.prepare(`update ${table} as stale set ${update}
          where user_id=? and ${owner}=? and ${eligible} and ${staleRun}`)
          .bind(input.savedAt, this.userId, recordId, this.userId, recordId, input.revisionId, sourceId, this.userId));
      }
    }

    try {
      await this.db.batch(statements);
      if (!await this.findIdempotency(input.idempotencyKey)) {
        await this.assertWritable(recordId, restrictedUnlocked);
        throw new DocumentRevisionNotFoundError();
      }
      return this.resolveCandidate(candidate, false, restrictedUnlocked);
    } catch (error) {
      const raced = await this.findIdempotency(input.idempotencyKey);
      if (raced) return this.replay(recordId, raced, input, restrictedUnlocked);
      if (error instanceof DocumentRevisionLockedError) throw error;
      await this.assertWritable(recordId, restrictedUnlocked);
      const stillVisible = await this.db
        .prepare(`select 1 as visible from v2_objects o where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`)
        .bind(recordId, this.userId)
        .first<{ visible: number }>();
      if (!stillVisible) throw new DocumentRevisionNotFoundError();
      throw new DocumentRevisionWriteError(error);
    }
  }

  async listRecords(options: { includeDeleted?: boolean; limit?: number } = {}): Promise<readonly V2LibraryRecord[]> {
    return (await this.listRecordsPage(options)).records;
  }

  async listRecordsPage(options: { includeDeleted?: boolean; limit?: number; cursor?: string } = {}): Promise<V2LibraryPage> {
    const limit = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.trunc(options.limit!))) : 50;
    const includeDeleted = options.includeDeleted === true;
    const cursor = readLibraryCursor(options.cursor, includeDeleted);
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const lifecycle = includeDeleted ? "" : "and o.lifecycle_status <> 'deleted'";
    const count = await this.db.prepare(`select count(*) as value from v2_objects o join v2_documents d on d.object_id=o.id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      where o.user_id=? and ${legacyVisibility} ${lifecycle}`).bind(this.userId).first<{ value: number }>();
    const rows = await this.db
      .prepare(
        `select o.id as record_id,o.lifecycle_status,o.updated_at,d.title,d.body_markdown,d.privacy_level,d.document_status,
                d.current_version,d.written_at,c.captured_at
         from v2_objects o join v2_documents d on d.object_id=o.id join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
         where o.user_id=? and ${legacyVisibility} ${lifecycle}
           ${cursor ? "and (o.updated_at < ? or (o.updated_at = ? and o.id < ?))" : ""}
         order by o.updated_at desc,o.id desc limit ?`,
      )
      .bind(this.userId, ...(cursor ? [cursor.updatedAt, cursor.updatedAt, cursor.recordId] : []), limit + 1)
      .all<{
        record_id: string; lifecycle_status: string; updated_at: string; title: string; body_markdown: string;
        privacy_level: "normal" | "sensitive" | "restricted"; document_status: string; current_version: number;
        written_at: string | null; captured_at: string;
      }>();
    const pageRows = rows.results.slice(0, limit);
    const last = pageRows.at(-1);
    const nextCursor = rows.results.length > limit && last ? Buffer.from(JSON.stringify({ version: 1, updatedAt: last.updated_at, recordId: last.record_id, includeDeleted } satisfies LibraryCursor)).toString("base64url") : null;
    const records = pageRows.map((row) => {
      const locked = row.privacy_level === "restricted";
      const excerpt = row.privacy_level === "normal" ? row.body_markdown.replace(/[#*_>`\[\]]/g, "").trim().slice(0, 160) : null;
      return {
        recordId: row.record_id,
        title: locked ? null : row.title,
        excerpt,
        privacyLevel: row.privacy_level,
        documentStatus: row.document_status,
        lifecycleStatus: row.lifecycle_status,
        currentVersion: locked ? null : row.current_version,
        writtenAt: locked ? null : row.written_at,
        capturedAt: row.captured_at,
        updatedAt: row.updated_at,
        locked,
      };
    });
    return { records, nextCursor, totalCount: Number(count?.value ?? 0) };
  }
}
