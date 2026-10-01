import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { PresentedConnection, PresentedEvidence, PresentedField, PresentedReviewItem, PresentedValueRenderer, RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";
import { isAllowedSemanticIcon, suggestSemanticIconForType } from "@/lib/v2/presentation/semantic-icons";
import { isAllowedRecordPreset, projectFirstContextModule, resolveRecordPreset } from "@/lib/v2/presentation/extension-registry";

type PropertyRow = {
  id: string; proposal_temp_id: string | null; processing_run_id: string | null; field_key: string; label: string; data_type: string; value_kind: PresentedValueRenderer;
  value_text: string | null; value_number: number | null; value_boolean: number | null; value_date: string | null; value_json: string;
  source_class: string; claim_risk: "low" | "autobiographical" | "social_high_risk";
  review_status: "accepted" | "proposed" | "disputed"; locked_by_user: number;
};

type ConnectionRow = { id: string; predicate_key: string; predicate_label: string; target_id: string; object_kind: "entity" | "event" | "document"; target_label: string; source_class: string };
type EvidenceIdentity = { id: string; target_kind: string; target_id: string; source_item_id: string | null; locator_kind: string; locator_json: string };
type PresentationPolicy = { current_version: number; current_revision_id: string; capture_id: string; privacy_level: "normal" | "sensitive" | "restricted"; allowed_relations_json: string; allowed_evidence_json: string };
function closedPresentation(): RecordKnowledgePresentation {
  return { contractVersion: "record-presentation-v1", displayType: { typeKey: null, label: "잠긴 기록", iconKey: "type.document", status: "fallback", tentative: false, recordPresetKey: "record.document.v1" }, highlights: [], sections: [], connections: [], modules: [], reviewItems: [] };
}

function sourceLabel(sourceClass: string) {
  if (sourceClass === "user_locked") return "사용자가 고정함";
  if (sourceClass === "user_explicit") return "원문에서 명시함";
  if (sourceClass === "external_grounded") return "외부 출처";
  if (sourceClass === "image_ocr") return "이미지에서 읽음";
  if (sourceClass === "transcript_extract") return "녹취에서 추출";
  if (sourceClass === "calculated") return "계산됨";
  if (sourceClass === "imported") return "가져온 값";
  return "AI 해석";
}

function value(row: PropertyRow) {
  if (row.value_kind === "text") return row.value_text;
  if (row.value_kind === "number" || row.value_kind === "rating") return row.value_number;
  if (row.value_kind === "boolean") return row.value_boolean === null ? null : Boolean(row.value_boolean);
  if (row.value_kind === "date") return row.value_date;
  try { return JSON.parse(row.value_json) as unknown; } catch { return null; }
}

export class D1PresentationRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async policy(recordId: string, relations: readonly ConnectionRow[] = [], evidence: readonly EvidenceIdentity[] = [], restrictedUnlocked = false): Promise<PresentationPolicy | null> {
    const subjectVisibility = await legacyProjectionVisibilityPredicate(this.db, "subject");
    const targetVisibility = await legacyProjectionVisibilityPredicate(this.db, "target");
    const evidenceVisibility = await legacyProjectionVisibilityPredicate(this.db, "evidence_owner");
    // The final fence reads both subject authority and surviving relation targets
    // in one SQL snapshot, after all asynchronous evidence gathering.
    return this.db.prepare(`select doc.current_version,doc.current_revision_id,doc.capture_id,doc.privacy_level,
      (select coalesce(json_group_array(edge.id),'[]') from v2_relation_edges edge
       join v2_predicate_definitions predicate on predicate.id=edge.predicate_definition_id and predicate.user_id=edge.user_id
       join v2_objects target on target.id=edge.object_object_id and target.user_id=edge.user_id and target.lifecycle_status='active'
       left join v2_documents target_doc on target_doc.object_id=target.id
       left join v2_entity_records target_entity on target_entity.object_id=target.id
       left join v2_event_records target_event on target_event.object_id=target.id
       where edge.user_id=?2 and edge.subject_object_id=?1 and edge.review_status='accepted' and edge.superseded_at is null
         and exists (select 1 from json_each(?3) expected where json_extract(expected.value,'$.id')=edge.id
           and json_extract(expected.value,'$.target_id')=target.id and json_extract(expected.value,'$.object_kind')=target.object_kind
           and json_extract(expected.value,'$.predicate_key')=predicate.key and json_extract(expected.value,'$.predicate_label')=predicate.label
           and json_extract(expected.value,'$.source_class')=edge.source_class
           and json_extract(expected.value,'$.target_label')=coalesce(target_entity.canonical_name,target_event.event_type_key,target_doc.title,'연결된 기록'))
         and ${targetVisibility}
         and (target.object_kind<>'document' or (target_doc.privacy_level in ('normal','sensitive')
           and exists (select 1 from v2_capture_bundles capture join v2_document_revisions revision
             on revision.id=target_doc.current_revision_id and revision.document_object_id=target.id
             where capture.id=target_doc.capture_id and capture.user_id=target.user_id)))) as allowed_relations_json,
      (select coalesce(json_group_array(ref.id),'[]') from v2_evidence_refs ref
       where ref.user_id=?2 and exists (select 1 from json_each(?4) expected where json_extract(expected.value,'$.id')=ref.id
         and json_extract(expected.value,'$.target_kind')=ref.target_kind and json_extract(expected.value,'$.target_id')=ref.target_id
         and json_extract(expected.value,'$.source_item_id') is ref.source_item_id
         and json_extract(expected.value,'$.locator_kind')=ref.locator_kind and json_extract(expected.value,'$.locator_json')=ref.locator_json)
       and (ref.source_item_id is null or exists (
         select 1 from v2_source_items source join v2_capture_bundles source_capture on source_capture.id=source.capture_id and source_capture.user_id=source.user_id
         where source.id=ref.source_item_id and source.user_id=?2
           and exists (select 1 from v2_documents source_doc where source_doc.capture_id=source.capture_id)
           and not exists (select 1 from v2_documents source_doc left join v2_objects evidence_owner on evidence_owner.id=source_doc.object_id
             where source_doc.capture_id=source.capture_id and (evidence_owner.user_id is not ?2
               or (evidence_owner.id<>?1 and evidence_owner.lifecycle_status<>'active')
               or not (${evidenceVisibility})
               or not (source_doc.privacy_level in ('normal','sensitive') or (source_doc.object_id=?1 and source_doc.privacy_level='restricted' and ?5=1))
               or not exists (select 1 from v2_document_revisions source_revision where source_revision.id=source_doc.current_revision_id and source_revision.document_object_id=source_doc.object_id)))))) as allowed_evidence_json
      from v2_objects subject join v2_documents doc on doc.object_id=subject.id
      join v2_capture_bundles capture on capture.id=doc.capture_id and capture.user_id=subject.user_id
      join v2_document_revisions revision on revision.id=doc.current_revision_id and revision.document_object_id=doc.object_id
      where subject.id=?1 and subject.user_id=?2 and ${subjectVisibility} limit 1`)
      .bind(recordId, this.userId, JSON.stringify(relations), JSON.stringify(evidence), restrictedUnlocked ? 1 : 0).first<PresentationPolicy>();
  }

  private async targetEvidence(targetKind: "property_value" | "relation", targetId: string, identities: EvidenceIdentity[]): Promise<PresentedEvidence[]> {
    const rows = await this.db.prepare(
      `select e.id,e.target_kind,e.target_id,e.source_item_id,e.locator_kind,e.locator_json,s.raw_text
       from v2_evidence_refs e
       left join v2_source_items s on s.id=e.source_item_id and s.user_id=e.user_id
       where e.user_id=? and e.target_kind=? and e.target_id=? order by e.created_at`,
    ).bind(this.userId, targetKind, targetId).all<EvidenceIdentity & { raw_text: string | null }>();
    return rows.results.map((row) => {
      identities.push({ id: row.id, target_kind: row.target_kind, target_id: row.target_id, source_item_id: row.source_item_id, locator_kind: row.locator_kind, locator_json: row.locator_json });
      let locator: Record<string, unknown> = {};
      try { const parsed: unknown = JSON.parse(row.locator_json); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) locator = parsed as Record<string, unknown>; } catch { locator = {}; }
      const start = typeof locator.start === "number" ? locator.start : null;
      const end = typeof locator.end === "number" ? locator.end : null;
      const quote = row.raw_text && start !== null && end !== null ? row.raw_text.slice(start, Math.min(end, start + 500)) : null;
      return { evidenceId: row.id, sourceItemId: row.source_item_id, locatorKind: row.locator_kind, locator, quote };
    });
  }

  async project(recordId: string, locked = false, options: { restrictedUnlocked?: boolean } = {}): Promise<RecordKnowledgePresentation> {
    const restrictedUnlocked = options.restrictedUnlocked === true;
    if (locked) return closedPresentation();
    const initialPolicy = await this.policy(recordId);
    if (!initialPolicy || !["normal", "sensitive", "restricted"].includes(initialPolicy.privacy_level)
      || (initialPolicy.privacy_level === "restricted" && !restrictedUnlocked)) return closedPresentation();
    const evidenceIdentities: EvidenceIdentity[] = [];
    const type = await this.db.prepare(
      `select t.key,t.label,t.status,a.review_status,p.icon_key,p.default_record_preset_key
       from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id
       left join v2_type_presentation_profiles p on p.type_definition_id=t.id and p.user_id=t.user_id and p.status='active'
       where a.user_id=? and a.object_id=? and a.review_status not in ('rejected','superseded')
       order by case a.review_status when 'accepted' then 0 else 1 end,
                case t.status when 'active' then 0 when 'observed' then 1 else 2 end,
                t.usage_count desc,t.key limit 1`,
    ).bind(this.userId, recordId).first<{ key: string; label: string; status: "candidate" | "observed" | "active"; review_status: "accepted" | "proposed"; icon_key: string | null; default_record_preset_key: string | null }>();
    const propertyRows = await this.db.prepare(
      `select p.id,p.proposal_temp_id,p.processing_run_id,f.key as field_key,f.label,f.data_type,p.value_kind,p.value_text,p.value_number,p.value_boolean,p.value_date,p.value_json,
              p.source_class,p.claim_risk,p.review_status,p.locked_by_user
       from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id and f.user_id=p.user_id
       where p.user_id=? and p.owner_object_id=? and p.review_status in ('accepted','proposed','disputed') and p.superseded_at is null
       order by case p.review_status when 'accepted' then 0 when 'disputed' then 1 else 2 end,
                case p.source_class when 'user_locked' then 0 when 'user_explicit' then 1 when 'external_grounded' then 2 else 3 end,
                f.key,p.id`,
    ).bind(this.userId, recordId).all<PropertyRow>();
    const fields: PresentedField[] = await Promise.all(propertyRows.results.map(async (row) => ({
      propertyId: row.id, fieldKey: row.field_key, label: row.label, dataType: row.data_type, value: value(row),
      renderer: ["text", "number", "boolean", "date", "rating", "json"].includes(row.value_kind) ? row.value_kind : "json",
      sourceClass: row.source_class, sourceLabel: sourceLabel(row.source_class), claimRisk: row.claim_risk,
      reviewStatus: row.review_status, lockedByUser: Boolean(row.locked_by_user), evidence: await this.targetEvidence("property_value", row.id, evidenceIdentities),
    })));
    const reviewRows = await this.db.prepare(
      `select id,processing_run_id,kind,payload_json from v2_review_items
       where user_id=? and object_id=? and status='open' order by created_at`,
    ).bind(this.userId, recordId).all<{ id: string; processing_run_id: string | null; kind: PresentedReviewItem["kind"]; payload_json: string }>();
    const reviewItems = reviewRows.results.map((row): PresentedReviewItem => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(row.payload_json) as Record<string, unknown>; } catch { payload = {}; }
      const tempId = typeof payload.proposalTempId === "string" ? payload.proposalTempId : null;
      const property = tempId && row.processing_run_id ? propertyRows.results.find((item) => item.processing_run_id === row.processing_run_id && item.proposal_temp_id === tempId) : null;
      const field = property ? fields.find((item) => item.propertyId === property.id) ?? null : null;
      return { reviewId: row.id, kind: row.kind, payload, field, requiresHighRiskConfirmation: row.kind === "high_risk_claim" };
    });
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const relationRows = await this.db.prepare(
      `select r.id,p.key as predicate_key,p.label as predicate_label,o.id as target_id,o.object_kind,
              coalesce(e.canonical_name,ev.event_type_key,d.title,'연결된 기록') as target_label,r.source_class
       from v2_relation_edges r join v2_predicate_definitions p on p.id=r.predicate_definition_id and p.user_id=r.user_id
       join v2_objects o on o.id=r.object_object_id and o.user_id=r.user_id and o.lifecycle_status='active'
       left join v2_entity_records e on e.object_id=o.id
       left join v2_event_records ev on ev.object_id=o.id
       left join v2_documents d on d.object_id=o.id
       where r.user_id=? and r.subject_object_id=? and ${legacyVisibility} and r.review_status='accepted' and r.superseded_at is null
         and (o.object_kind<>'document' or d.privacy_level in ('normal','sensitive'))
       order by p.key,target_label`,
    ).bind(this.userId, recordId).all<ConnectionRow>();
    const connections: PresentedConnection[] = await Promise.all(relationRows.results.map(async (row) => ({
      relationId: row.id, predicateKey: row.predicate_key, predicateLabel: row.predicate_label, targetObjectId: row.target_id,
      targetKind: row.object_kind, targetLabel: row.target_label, sourceLabel: sourceLabel(row.source_class), evidence: await this.targetEvidence("relation", row.id, evidenceIdentities),
    })));
    const accepted = fields.filter((field) => field.reviewStatus === "accepted");
    const highlights = accepted.filter((field) => field.renderer === "rating" || field.renderer === "number" || field.fieldKey.includes("date")).slice(0, 4);
    const sections = [
      { key: "user_facts" as const, title: "내 기록", fields: accepted.filter((field) => ["user_locked", "user_explicit", "user_context", "image_ocr", "transcript_extract", "exif"].includes(field.sourceClass)) },
      { key: "external_facts" as const, title: "대상 정보", fields: accepted.filter((field) => field.sourceClass === "external_grounded") },
      { key: "topics" as const, title: "주제와 색인", fields: accepted.filter((field) => field.sourceClass === "ai_inferred") },
      { key: "other" as const, title: "기타 정보", fields: accepted.filter((field) => !["user_locked", "user_explicit", "user_context", "image_ocr", "transcript_extract", "exif", "external_grounded", "ai_inferred"].includes(field.sourceClass)) },
    ].filter((section) => section.fields.length);
    const preset = resolveRecordPreset(type?.key ?? null, type?.default_record_preset_key && isAllowedRecordPreset(type.default_record_preset_key) ? type.default_record_preset_key : null);
    const finalPolicy = await this.policy(recordId, relationRows.results, evidenceIdentities, restrictedUnlocked);
    if (!finalPolicy || finalPolicy.current_version !== initialPolicy.current_version || finalPolicy.current_revision_id !== initialPolicy.current_revision_id
      || finalPolicy.capture_id !== initialPolicy.capture_id || finalPolicy.privacy_level !== initialPolicy.privacy_level) return closedPresentation();
    const allowedRelations = new Set<string>(JSON.parse(finalPolicy.allowed_relations_json));
    const allowedEvidence = new Set<string>(JSON.parse(finalPolicy.allowed_evidence_json));
    const safeEvidence = (items: readonly PresentedEvidence[]) => items.filter((item) => allowedEvidence.has(item.evidenceId));
    const safeFields = new Map(fields.map((field) => [field.propertyId, { ...field, evidence: safeEvidence(field.evidence) }]));
    const safeField = (field: PresentedField) => safeFields.get(field.propertyId)!;
    const contextModule = projectFirstContextModule({ preset, fields: accepted.map(safeField), privacyLevel: finalPolicy.privacy_level });
    return {
      contractVersion: "record-presentation-v1",
      displayType: type ? { typeKey: type.key, label: type.label, iconKey: type.icon_key && isAllowedSemanticIcon(type.icon_key, "type") ? type.icon_key : suggestSemanticIconForType(type.key), status: type.status, tentative: type.review_status !== "accepted" || type.status === "candidate", recordPresetKey: preset.presetKey } : { typeKey: null, label: "기록", iconKey: "type.document", status: "fallback", tentative: false, recordPresetKey: preset.presetKey },
      highlights: highlights.map(safeField), sections: sections.map((section) => ({ ...section, fields: section.fields.map(safeField) })),
      connections: connections.filter((connection) => allowedRelations.has(connection.relationId)).map((connection) => ({ ...connection, evidence: safeEvidence(connection.evidence) })),
      modules: contextModule ? [contextModule] : [], reviewItems: reviewItems.map((item) => ({ ...item, field: item.field ? safeField(item.field) : null })),
    };
  }
}
