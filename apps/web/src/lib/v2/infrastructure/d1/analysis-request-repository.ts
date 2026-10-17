import { ulid } from "ulidx";

import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

export class AnalysisRequestError extends Error {
  constructor(readonly code: "record_not_found" | "analysis_request_not_allowed", message: string) {
    super(message);
    this.name = "AnalysisRequestError";
  }
}

/**
 * The owner asks for AI organization of a record that was saved with AI off (for example a
 * record kept in another tool and brought in). The request is the consent: it turns AI on for
 * that record's capture and queues one analysis of its current revision through the same
 * outbox the editor uses, so the usual lease, revision and privacy rules apply. Only a normal
 * record qualifies; a sensitive or locked one is never sent this way. Values the owner already
 * has stay as they are: a differing AI value is kept apart for review, never written over them.
 * Asking again for the same revision changes nothing.
 */
export class D1AnalysisRequestRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {
    if (!userId.trim()) throw new Error("A scoped repository requires a userId.");
  }

  async request(recordId: string, now: string): Promise<{ recordId: string; revisionId: string; outcome: "queued" | "already_requested" }> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const record = await this.db.prepare(
      `select d.object_id,d.capture_id,d.current_revision_id,d.privacy_level,c.ai_enabled from v2_objects o
       join v2_documents d on d.object_id=o.id join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
       where o.id=? and o.user_id=? and o.object_kind='document' and o.lifecycle_status='active' and ${visibility} limit 1`,
    ).bind(recordId, this.userId).first<{ object_id: string; capture_id: string; current_revision_id: string; privacy_level: string; ai_enabled: number }>();
    if (!record) throw new AnalysisRequestError("record_not_found", "The record is not an active record of this owner.");
    if (record.privacy_level !== "normal") throw new AnalysisRequestError("analysis_request_not_allowed", "Only a normal record can be sent for AI organization.");
    const outboxId = `analysis_request:${record.current_revision_id}`;
    const already = await this.db.prepare(`select 1 as present from v2_processing_outbox where id=? and user_id=? limit 1`).bind(outboxId, this.userId).first();
    if (already && record.ai_enabled === 1) return { recordId, revisionId: record.current_revision_id, outcome: "already_requested" };
    // Every write re-checks, in the same batch, that the record is still this normal current revision.
    const current = `exists (select 1 from v2_documents d join v2_objects o on o.id=d.object_id and o.user_id=?
      where d.object_id=? and d.capture_id=? and d.current_revision_id=? and d.privacy_level='normal' and o.lifecycle_status='active' and ${visibility})`;
    const guard = [this.userId, recordId, record.capture_id, record.current_revision_id];
    await this.db.batch([
      this.db.prepare(`update v2_capture_bundles set ai_enabled=1,processing_status='pending' where id=? and user_id=? and ${current}`)
        .bind(record.capture_id, this.userId, ...guard),
      this.db.prepare(`insert or ignore into v2_processing_outbox (id,user_id,capture_id,event_type,payload_json,status,created_at)
        select ?,?,?,'analyze',json_object('captureId',?),'pending',? where ${current}`)
        .bind(outboxId, this.userId, record.capture_id, record.capture_id, now, ...guard),
      this.db.prepare(`insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at)
        select ?,?,'record.analysis_requested','document',?,?,? where ${current}`)
        .bind(ulid(), this.userId, recordId, JSON.stringify({ revisionId: record.current_revision_id }), now, ...guard),
    ]);
    const queued = await this.db.prepare(`select 1 as present from v2_processing_outbox where id=? and user_id=? limit 1`).bind(outboxId, this.userId).first();
    if (!queued) throw new AnalysisRequestError("record_not_found", "The record changed while the request was being saved.");
    return { recordId, revisionId: record.current_revision_id, outcome: "queued" };
  }
}
