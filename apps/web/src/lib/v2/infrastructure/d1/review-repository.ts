import { ulid } from "ulidx";

import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

export type ReviewResolutionAction = "accept" | "reject" | "correct" | "dismiss";

const REVIEW_PRIVACY_PREDICATE = "(?=1 or not exists (select 1 from v2_documents locked_document where locked_document.object_id=o.id and locked_document.privacy_level='restricted'))";

type ReviewRow = {
  id: string; object_id: string; processing_run_id: string | null; kind: "registry_conflict" | "value_conflict" | "high_risk_claim" | "analysis_review" | "analysis_warning";
  payload_json: string; status: "open" | "resolved" | "dismissed";
};

export class ReviewResolutionError extends Error {
  constructor(readonly code: "review_not_found" | "review_already_resolved" | "high_risk_confirmation_required" | "review_target_missing" | "review_action_invalid" | "review_corrected_value_invalid" | "provider_invocation_visibility_conflict" | "restricted_record_locked", message: string) {
    super(message);
    this.name = "ReviewResolutionError";
  }
}

export class D1ReviewRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async assertReviewAccess(reviewId: string, restrictedUnlocked: boolean) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db.prepare(
      `select d.privacy_level from v2_review_items r join v2_objects o on o.id=r.object_id and o.user_id=r.user_id
       left join v2_documents d on d.object_id=o.id
       left join v2_processing_runs pr on pr.id=r.processing_run_id and pr.user_id=r.user_id
       left join v2_processing_jobs pj on pj.id=pr.job_id and pj.user_id=r.user_id and pj.object_id=r.object_id
       where r.id=? and r.user_id=? and (r.processing_run_id is null or pj.id is not null) and ${legacyVisibility} limit 1`,
    ).bind(reviewId, this.userId).first<{ privacy_level: string | null }>();
    if (!row) throw new ReviewResolutionError("review_not_found", "The review item was not found.");
    if (row.privacy_level === "restricted" && !restrictedUnlocked) {
      throw new ReviewResolutionError("restricted_record_locked", "Unlock the restricted record before resolving or replaying its review.");
    }
  }

  private async findVisibleReview(reviewId: string, restrictedUnlocked: boolean) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    return this.db.prepare(
      `select r.id,r.object_id,r.processing_run_id,r.kind,r.payload_json,r.status
       from v2_review_items r join v2_objects o on o.id=r.object_id and o.user_id=r.user_id
       left join v2_processing_runs pr on pr.id=r.processing_run_id and pr.user_id=r.user_id
       left join v2_processing_jobs pj on pj.id=pr.job_id and pj.user_id=r.user_id and pj.object_id=r.object_id
       where r.id=? and r.user_id=? and (r.processing_run_id is null or pj.id is not null) and ${legacyVisibility} and ${REVIEW_PRIVACY_PREDICATE} limit 1`,
    ).bind(reviewId, this.userId, restrictedUnlocked ? 1 : 0).first<ReviewRow>();
  }

  private async findVisibleReceipt(reviewId: string, restrictedUnlocked: boolean) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const targetLegacyVisibility = await legacyProjectionVisibilityPredicate(this.db, "eo");
    return this.db.prepare(
      `select rr.id,rr.action,rr.result_status
       from v2_review_receipts rr join v2_objects o on o.id=rr.object_id and o.user_id=rr.user_id
       join v2_review_items ri on ri.id=rr.review_item_id and ri.user_id=rr.user_id and ri.object_id=rr.object_id
       where rr.review_item_id=? and rr.user_id=? and ${legacyVisibility} and ${REVIEW_PRIVACY_PREDICATE}
         and (rr.target_kind not in ('entity','event') or exists (
           select 1 from v2_objects eo where eo.id=rr.target_id and eo.user_id=rr.user_id and ${targetLegacyVisibility}
         ))
       limit 1`,
    ).bind(reviewId, this.userId, restrictedUnlocked ? 1 : 0).first<{ id: string; action: string; result_status: string }>();
  }

  private async hasUnavailableReceiptTarget(reviewId: string) {
    const targetLegacyVisibility = await legacyProjectionVisibilityPredicate(this.db, "eo");
    return Boolean(await this.db.prepare(
      `select 1 as unavailable from v2_review_receipts rr
       join v2_review_items ri on ri.id=rr.review_item_id and ri.user_id=rr.user_id and ri.object_id=rr.object_id
       where rr.review_item_id=? and rr.user_id=? and rr.target_kind in ('entity','event')
         and not exists (
           select 1 from v2_objects eo where eo.id=rr.target_id and eo.user_id=rr.user_id and ${targetLegacyVisibility}
         )
       limit 1`,
    ).bind(reviewId, this.userId).first<{ unavailable: number }>());
  }

  async listOpenRecords(includeRestricted = false) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const rows = await this.db.prepare(
      `select d.object_id,d.title,d.privacy_level,d.current_revision_id,count(*) as open_count,max(r.created_at) as latest_review_at
       from v2_review_items r
       join v2_documents d on d.object_id=r.object_id
       join v2_objects o on o.id=d.object_id and o.user_id=r.user_id and o.lifecycle_status='active'
       join v2_document_revisions current on current.id=d.current_revision_id and current.document_object_id=d.object_id
       left join v2_processing_runs pr on pr.id=r.processing_run_id and pr.user_id=r.user_id
       left join v2_processing_jobs pj on pj.id=pr.job_id and pj.user_id=r.user_id and pj.object_id=r.object_id
       where r.user_id=? and r.status='open' and (r.processing_run_id is null or pj.id is not null) and ${legacyVisibility} and (?=1 or d.privacy_level<>'restricted')
       group by d.object_id,d.title,d.privacy_level,d.current_revision_id
       order by latest_review_at desc,d.object_id`,
    ).bind(this.userId, includeRestricted ? 1 : 0).all<{ object_id: string; title: string; privacy_level: "normal" | "sensitive" | "restricted"; current_revision_id: string; open_count: number; latest_review_at: string }>();
    return rows.results.map((row) => ({
      recordId: row.object_id,
      title: row.title || "제목 없는 기록",
      privacyLevel: row.privacy_level,
      currentRevisionId: row.current_revision_id,
      openCount: row.open_count,
      latestReviewAt: row.latest_review_at,
    }));
  }

  async resolve(reviewId: string, input: { action: ReviewResolutionAction; confirmHighRisk?: boolean; correctedValue?: unknown; now?: string }, options: { restrictedUnlocked?: boolean } = {}) {
    const now = input.now ?? new Date().toISOString();
    const restrictedUnlocked = options.restrictedUnlocked === true;
    await this.assertReviewAccess(reviewId, restrictedUnlocked);
    const review = await this.findVisibleReview(reviewId, restrictedUnlocked);
    if (!review) {
      await this.assertReviewAccess(reviewId, restrictedUnlocked);
      throw new ReviewResolutionError("review_not_found", "The review item was not found.");
    }
    const existing = await this.findVisibleReceipt(reviewId, restrictedUnlocked);
    // A grant may be absent while privacy changes between the two reads. Never
    // expose an earlier receipt or its disposition after the record locks.
    await this.assertReviewAccess(reviewId, restrictedUnlocked);
    if (existing) return { reviewId, receiptId: existing.id, action: existing.action, resultStatus: existing.result_status, replayed: true };
    if (review.status !== "open") {
      if (await this.hasUnavailableReceiptTarget(reviewId)) throw new ReviewResolutionError("review_target_missing", "The proposed target is no longer available.");
      throw new ReviewResolutionError("review_already_resolved", "The review item is already resolved.");
    }
    if (review.kind === "high_risk_claim" && input.action === "accept" && !input.confirmHighRisk) throw new ReviewResolutionError("high_risk_confirmation_required", "High-risk claims require explicit confirmation.");
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(review.payload_json) as Record<string, unknown>; } catch { payload = {}; }
    const tempId = typeof payload.proposalTempId === "string" ? payload.proposalTempId : null;
    const fieldKey = typeof payload.fieldKey === "string" ? payload.fieldKey : null;
    const typeKey = payload.target === "type" && typeof payload.key === "string" ? payload.key : null;
    const receiptId = ulid();
    const statements: D1PreparedStatementBinding[] = [];
    let targetKind: "property_value" | "type_assignment" | "entity" | "event" | "relation" | "review_item" = "review_item";
    let targetId: string | null = null;
    let priorStatus: string | null = review.status;
    let resultStatus = input.action === "dismiss" ? "dismissed" : "resolved";
    let correctedValueJson: string | null = null;
    const targetLegacyVisibility = await legacyProjectionVisibilityPredicate(this.db, "eo");

    if (tempId && review.processing_run_id) {
      const property = await this.db.prepare(
        `select p.id,p.field_definition_id,p.review_status,p.claim_risk,p.value_kind
         from v2_property_values p join v2_objects o on o.id=p.owner_object_id and o.user_id=p.user_id
         where p.user_id=? and p.owner_object_id=? and p.processing_run_id=? and p.proposal_temp_id=? limit 1`,
      ).bind(this.userId, review.object_id, review.processing_run_id, tempId).first<{ id: string; field_definition_id: string; review_status: string; claim_risk: string; value_kind: "text" | "number" | "boolean" | "date" | "rating" | "json" }>();
      if (!property && input.action !== "dismiss") throw new ReviewResolutionError("review_target_missing", "The proposed property no longer exists.");
      if (property) {
        targetKind = "property_value";
        targetId = property.id;
        priorStatus = property.review_status;
        if (input.action === "accept") {
          if (property.claim_risk === "social_high_risk" && !input.confirmHighRisk) throw new ReviewResolutionError("high_risk_confirmation_required", "High-risk claims require explicit confirmation.");
          statements.push(
            this.db.prepare(
              `update v2_property_values set review_status='superseded',superseded_at=?
               where user_id=? and owner_object_id=? and field_definition_id=? and id<>?
                 and review_status='accepted' and superseded_at is null`,
            ).bind(now, this.userId, review.object_id, property.field_definition_id, property.id),
            this.db.prepare(
              `update v2_property_values set review_status='accepted',confirmed_by_user_at=?,locked_by_user=1
               where id=? and user_id=? and owner_object_id=? and review_status in ('proposed','disputed')`,
            ).bind(now, property.id, this.userId, review.object_id),
          );
          resultStatus = "accepted";
        } else if (input.action === "reject") {
          statements.push(this.db.prepare(`update v2_property_values set review_status='rejected' where id=? and user_id=? and owner_object_id=? and review_status in ('proposed','disputed')`).bind(property.id, this.userId, review.object_id));
          resultStatus = "rejected";
        } else if (input.action === "correct") {
          const corrected = correctedValueColumns(property.value_kind, input.correctedValue);
          correctedValueJson = corrected.json;
          const correctedId = ulid();
          statements.push(
            this.db.prepare(
              `update v2_property_values set review_status='superseded',superseded_at=?
               where user_id=? and owner_object_id=? and field_definition_id=? and review_status='accepted' and superseded_at is null`,
            ).bind(now, this.userId, review.object_id, property.field_definition_id),
            this.db.prepare(
              `update v2_property_values set review_status='superseded',superseded_at=?
               where id=? and user_id=? and owner_object_id=? and review_status in ('proposed','disputed')`,
            ).bind(now, property.id, this.userId, review.object_id),
            this.db.prepare(
              `insert into v2_property_values
               (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_number,value_boolean,value_date,value_json,source_class,claim_risk,review_status,confirmed_by_user_at,locked_by_user,supersedes_value_id,created_at)
               values (?,?,?,?,?,?,?,?,?,?,'user_locked','low','accepted',?,1,?,?)`,
            ).bind(correctedId, this.userId, review.object_id, property.field_definition_id, property.value_kind, corrected.text, corrected.number, corrected.boolean, corrected.date, corrected.json, now, property.id, now),
          );
          targetId = correctedId;
          resultStatus = "corrected";
        }
      }
    } else if (typeof payload.entityTempId === "string" && review.processing_run_id) {
      const entity = await this.db.prepare(
        `select e.object_id,e.resolution_status,r.id as relation_id,r.review_status
         from v2_entity_records e
         join v2_objects eo on eo.id=e.object_id
         left join v2_relation_edges r on r.processing_run_id=e.processing_run_id and r.object_object_id=e.object_id and r.subject_object_id=? and r.user_id=eo.user_id
         where e.processing_run_id=? and e.proposal_temp_id=? and eo.user_id=? and ${targetLegacyVisibility} limit 1`,
      ).bind(review.object_id, review.processing_run_id, payload.entityTempId, this.userId).first<{ object_id: string; resolution_status: string; relation_id: string | null; review_status: string | null }>();
      if (!entity) throw new ReviewResolutionError("review_target_missing", "The proposed entity no longer exists.");
      if (entity) {
        targetKind = "entity"; targetId = entity.object_id; priorStatus = entity.review_status ?? entity.resolution_status;
        if (input.action === "accept") {
          statements.push(
            this.db.prepare(`update v2_entity_records set resolution_status='resolved' where object_id=? and processing_run_id=?`).bind(entity.object_id, review.processing_run_id),
            this.db.prepare(`update v2_relation_edges set review_status='accepted',locked_by_user=1 where id=? and user_id=? and subject_object_id=?`).bind(entity.relation_id, this.userId, review.object_id),
          );
          resultStatus = "accepted";
        } else if (input.action === "reject") {
          statements.push(
            this.db.prepare(`update v2_relation_edges set review_status='rejected' where id=? and user_id=? and subject_object_id=?`).bind(entity.relation_id, this.userId, review.object_id),
            this.db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where id=? and user_id=?`).bind(now, entity.object_id, this.userId),
          );
          resultStatus = "rejected";
        }
      }
    } else if (typeof payload.eventTempId === "string" && review.processing_run_id) {
      const event = await this.db.prepare(
        `select e.object_id,r.id as relation_id,r.review_status
         from v2_event_records e
         join v2_objects eo on eo.id=e.object_id
         left join v2_relation_edges r on r.processing_run_id=e.processing_run_id and r.object_object_id=e.object_id and r.subject_object_id=? and r.user_id=eo.user_id
         where e.processing_run_id=? and e.proposal_temp_id=? and eo.user_id=? and ${targetLegacyVisibility} limit 1`,
      ).bind(review.object_id, review.processing_run_id, payload.eventTempId, this.userId).first<{ object_id: string; relation_id: string | null; review_status: string | null }>();
      if (!event) throw new ReviewResolutionError("review_target_missing", "The proposed event no longer exists.");
      if (event) {
        targetKind = "event"; targetId = event.object_id; priorStatus = event.review_status;
        if (input.action === "accept") {
          statements.push(this.db.prepare(`update v2_relation_edges set review_status='accepted',locked_by_user=1 where id=? and user_id=? and subject_object_id=?`).bind(event.relation_id, this.userId, review.object_id));
          resultStatus = "accepted";
        } else if (input.action === "reject") {
          statements.push(
            this.db.prepare(`update v2_relation_edges set review_status='rejected' where id=? and user_id=? and subject_object_id=?`).bind(event.relation_id, this.userId, review.object_id),
            this.db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where id=? and user_id=?`).bind(now, event.object_id, this.userId),
          );
          resultStatus = "rejected";
        }
      }
    } else if (typeKey && review.processing_run_id) {
      const assignment = await this.db.prepare(
        `select a.id,a.review_status from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id
         where a.user_id=? and a.object_id=? and a.processing_run_id=? and t.key=? limit 1`,
      ).bind(this.userId, review.object_id, review.processing_run_id, typeKey).first<{ id: string; review_status: string }>();
      if (!assignment && input.action !== "dismiss") throw new ReviewResolutionError("review_target_missing", "The proposed type assignment no longer exists.");
      if (assignment) {
        targetKind = "type_assignment";
        targetId = assignment.id;
        priorStatus = assignment.review_status;
        if (input.action === "accept") {
          statements.push(
            this.db.prepare(`update v2_object_type_assignments set review_status='accepted',locked_by_user=1,updated_at=? where id=? and user_id=? and object_id=?`).bind(now, assignment.id, this.userId, review.object_id),
            this.db.prepare(
              `update v2_type_definitions set status='active',user_pinned=1,updated_at=?
               where user_id=? and key=? and status in ('candidate','observed')`,
            ).bind(now, this.userId, typeKey),
          );
          resultStatus = "accepted";
        } else if (input.action === "reject") {
          statements.push(this.db.prepare(`update v2_object_type_assignments set review_status='rejected',updated_at=? where id=? and user_id=? and object_id=?`).bind(now, assignment.id, this.userId, review.object_id));
          resultStatus = "rejected";
        }
      }
    } else if (input.action === "accept" || input.action === "correct") {
      throw new ReviewResolutionError("review_action_invalid", "This review item can only be dismissed.");
    }

    const itemStatus = input.action === "dismiss" ? "dismissed" : "resolved";
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const targetVisibilityClause = (targetKind === "entity" || targetKind === "event") && targetId
      ? `and exists (select 1 from v2_objects eo where eo.id=? and eo.user_id=? and ${targetLegacyVisibility})`
      : "";
    const targetVisibilityBindings = targetVisibilityClause ? [targetId, this.userId] : [];
    statements.push(
      this.db.prepare(`update v2_review_items set status=?,resolved_at=? where id=? and user_id=? and status='open'`).bind(itemStatus, now, review.id, this.userId),
      this.db.prepare(
        `insert into v2_review_receipts
         (id,review_item_id,user_id,object_id,action,target_kind,target_id,prior_status,result_status,high_risk_confirmed,corrected_value_json,created_at)
         values (?,(
           select r.id from v2_review_items r join v2_objects o on o.id=r.object_id and o.user_id=r.user_id
           where r.id=? and r.user_id=? and r.status=? and ${legacyVisibility} and ${REVIEW_PRIVACY_PREDICATE} ${targetVisibilityClause} limit 1
         ),?,?,?,?,?,?,?,?,?,?)`,
      ).bind(receiptId, review.id, this.userId, itemStatus, restrictedUnlocked ? 1 : 0, ...targetVisibilityBindings, this.userId, review.object_id, input.action, targetKind, targetId, priorStatus, resultStatus, input.confirmHighRisk ? 1 : 0, correctedValueJson, now),
      this.db.prepare(
        `insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at)
         values (?,?,'review.resolved','document',?,?,?)`,
      ).bind(ulid(), this.userId, review.object_id, JSON.stringify({ reviewId, action: input.action, targetKind, fieldKey }), now),
    );
    try {
      // The receipt's NOT NULL review_item_id is an assertion inside this
      // transaction: losing the current privacy check rolls back every update.
      await this.db.batch(statements);
    } catch (error) {
      await this.assertReviewAccess(reviewId, restrictedUnlocked);
      const replay = await this.findVisibleReceipt(reviewId, restrictedUnlocked);
      await this.assertReviewAccess(reviewId, restrictedUnlocked);
      if (replay) return { reviewId, receiptId: replay.id, action: replay.action, resultStatus: replay.result_status, replayed: true };
      if ((targetKind === "entity" || targetKind === "event") && targetId) {
        const targetVisible = await this.db.prepare(
          `select 1 as visible from v2_objects eo where eo.id=? and eo.user_id=? and ${targetLegacyVisibility} limit 1`,
        ).bind(targetId, this.userId).first<{ visible: number }>();
        if (!targetVisible) throw new ReviewResolutionError("review_target_missing", "The proposed target is no longer available.");
      }
      const current = await this.findVisibleReview(reviewId, restrictedUnlocked);
      if (!current) {
        await this.assertReviewAccess(reviewId, restrictedUnlocked);
        throw new ReviewResolutionError("review_not_found", "The review item was not found.");
      }
      if (current.status !== "open") throw new ReviewResolutionError("review_already_resolved", "The review item is already resolved.");
      if ((error instanceof Error ? error.message : String(error)).includes("legacy_provider_invocation_active")) {
        throw new ReviewResolutionError("provider_invocation_visibility_conflict", "The record is currently being sent to an AI provider. Retry this visibility change after the invocation finishes.");
      }
      throw error;
    }
    const receipt = await this.findVisibleReceipt(reviewId, restrictedUnlocked);
    await this.assertReviewAccess(reviewId, restrictedUnlocked);
    if (!receipt) throw new ReviewResolutionError("review_not_found", "The review item was not found.");
    return { reviewId, receiptId, action: input.action, resultStatus, replayed: false };
  }
}

function correctedValueColumns(kind: "text" | "number" | "boolean" | "date" | "rating" | "json", value: unknown) {
  const invalid = () => { throw new ReviewResolutionError("review_corrected_value_invalid", "The corrected value does not match this field type."); };
  if (kind === "text") {
    if (typeof value !== "string" || !value.trim()) return invalid();
    return { text: value.trim(), number: null, boolean: null, date: null, json: JSON.stringify(value.trim()) };
  }
  if (kind === "number" || kind === "rating") {
    if (typeof value !== "number" || !Number.isFinite(value) || (kind === "rating" && (value < 0 || value > 5))) return invalid();
    return { text: null, number: value, boolean: null, date: null, json: JSON.stringify(value) };
  }
  if (kind === "boolean") {
    if (typeof value !== "boolean") return invalid();
    return { text: null, number: null, boolean: value ? 1 : 0, date: null, json: JSON.stringify(value) };
  }
  if (kind === "date") {
    if (typeof value !== "string" || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?(?:T.*)?$/.test(value)) return invalid();
    return { text: null, number: null, boolean: null, date: value, json: JSON.stringify(value) };
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return invalid();
    return { text: null, number: null, boolean: null, date: null, json };
  } catch {
    return invalid();
  }
}
