import { ulid } from "ulidx";

import type { AnalysisEnvelopeV1, AnalysisEvidenceRef } from "@/lib/v2/ai/analysis-envelope-v1";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { suggestSemanticIconForType } from "@/lib/v2/presentation/semantic-icons";

type KnowledgeCommitInput = Readonly<{
  userId: string;
  objectId: string;
  runId: string;
  envelope: AnalysisEnvelopeV1;
  evidenceSourceClasses?: ReadonlyMap<string, string>;
  now: string;
}>;

function fieldLabel(key: string) {
  return key.split(/[._-]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ") || key;
}

function fieldDataType(valueType: AnalysisEnvelopeV1["field_proposals"][number]["value_type"]) {
  if (valueType === "text") return "short_text";
  if (valueType === "number") return "decimal";
  return valueType;
}

function valueColumns(field: AnalysisEnvelopeV1["field_proposals"][number]) {
  return {
    text: field.value_type === "text" && typeof field.value === "string" ? field.value : null,
    number: (field.value_type === "number" || field.value_type === "rating") && typeof field.value === "number" ? field.value : null,
    boolean: field.value_type === "boolean" && typeof field.value === "boolean" ? (field.value ? 1 : 0) : null,
    date: field.value_type === "date" && typeof field.value === "string" ? field.value : null,
    json: JSON.stringify(field.value),
  };
}

function directLowRisk(field: AnalysisEnvelopeV1["field_proposals"][number]) {
  return field.disposition === "accepted"
    && field.claim_risk === "low"
    && field.value !== null
    && field.evidence_refs.some((ref) => ref.start !== null && ref.end !== null && ref.end > ref.start);
}

function evidenceStatement(
  db: D1DatabaseBinding,
  input: KnowledgeCommitInput,
  targetKind: "type_assignment" | "property_value" | "entity" | "event" | "relation",
  targetIdSql: string,
  targetBindings: readonly unknown[],
  ref: AnalysisEvidenceRef,
) {
  const locator = JSON.stringify({ start: ref.start, end: ref.end });
  return db.prepare(
    `insert or ignore into v2_evidence_refs
     (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
     select ?,?,?,(${targetIdSql}),?,'text_span',?,?
     where (${targetIdSql}) is not null`,
  ).bind(ulid(), input.userId, targetKind, ...targetBindings, ref.source_item_id, locator, input.now, ...targetBindings);
}

function reviewStatement(db: D1DatabaseBinding, input: KnowledgeCommitInput, kind: "registry_conflict" | "value_conflict" | "high_risk_claim" | "analysis_review" | "analysis_warning", payload: Readonly<Record<string, unknown>>) {
  return db.prepare(
    `insert into v2_review_items
     (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
     values (?,?,?,?,?,'open',?,?)`,
  ).bind(ulid(), input.userId, input.objectId, input.runId, kind, JSON.stringify(payload), input.now);
}

export function buildKnowledgeCommitStatements(db: D1DatabaseBinding, input: KnowledgeCommitInput): D1PreparedStatementBinding[] {
  const statements: D1PreparedStatementBinding[] = [];

  for (const document of input.envelope.document_proposals) {
    for (const assignment of document.type_assignments) {
      const proposedTypeId = ulid();
      const assignmentId = ulid();
      statements.push(
        db.prepare(
          `insert or ignore into v2_type_definitions
           (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
           values (?,?,?,?,'document','candidate','ai_proposed',?,1,0,0,?,?)`,
        ).bind(proposedTypeId, input.userId, assignment.type_key, assignment.label, `AI-proposed document classification: ${assignment.label}`, input.now, input.now),
        db.prepare(
            `insert into v2_object_type_assignments
           (id,user_id,object_id,type_definition_id,role,source_class,review_status,processing_run_id,locked_by_user,created_at,updated_at)
           select ?,?,?,id,'inferred','ai',case when ?='reuse' and status in ('observed','active') then 'accepted' else 'proposed' end,?,0,?,?
            from v2_type_definitions where user_id=? and key=? and status not in ('archived','merged') limit 1
            on conflict do update set review_status=excluded.review_status,processing_run_id=excluded.processing_run_id,source_class=excluded.source_class,updated_at=excluded.updated_at
            where v2_object_type_assignments.locked_by_user=0 and v2_object_type_assignments.review_status='superseded'`,
        ).bind(assignmentId, input.userId, input.objectId, assignment.registry_action, input.runId, input.now, input.now, input.userId, assignment.type_key),
        db.prepare(
          `insert or ignore into v2_type_presentation_profiles
           (id,user_id,type_definition_id,icon_key,accent_role,default_collection_preset_key,default_record_preset_key,source,version,status,created_at,updated_at)
           select ?,?,id,?,'neutral','collection.generic.list.v1','record.document.v1','ai_suggested',1,'candidate',?,?
           from v2_type_definitions where user_id=? and key=? limit 1`,
        ).bind(ulid(), input.userId, suggestSemanticIconForType(assignment.type_key), input.now, input.now, input.userId, assignment.type_key),
      );
      const targetSql = `select id from v2_object_type_assignments where user_id=? and object_id=? and type_definition_id=(select id from v2_type_definitions where user_id=? and key=? limit 1) limit 1`;
      for (const ref of assignment.evidence_refs) {
        statements.push(evidenceStatement(db, input, "type_assignment", targetSql, [input.userId, input.objectId, input.userId, assignment.type_key], ref));
      }
      statements.push(
        db.prepare(
          `update v2_type_definitions
            set usage_count=(select count(*) from v2_object_type_assignments a where a.type_definition_id=v2_type_definitions.id and a.user_id=v2_type_definitions.user_id and a.review_status not in ('rejected','superseded')),
                status=case when status='candidate' and (select count(*) from v2_object_type_assignments a where a.type_definition_id=v2_type_definitions.id and a.user_id=v2_type_definitions.user_id and a.review_status not in ('rejected','superseded'))>=3 then 'observed' else status end,
               updated_at=?
           where user_id=? and key=?`,
        ).bind(input.now, input.userId, assignment.type_key),
      );
      if (assignment.registry_action !== "propose_new") {
        statements.push(
          db.prepare(
            `insert into v2_review_items
             (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
             select ?,?,?,?,'registry_conflict','open',?,?
             where exists (select 1 from v2_type_definitions where user_id=? and key=? and status not in ('observed','active'))
                or ? not in ('reuse','propose_new')`,
          ).bind(ulid(), input.userId, input.objectId, input.runId, JSON.stringify({ target: "type", key: assignment.type_key, action: assignment.registry_action }), input.now, input.userId, assignment.type_key, assignment.registry_action),
        );
      } else {
        statements.push(reviewStatement(db, input, "analysis_review", {
          code: "type_confirmation",
          target: "type",
          key: assignment.type_key,
          label: assignment.label,
        }));
      }
    }
  }

  for (const field of input.envelope.field_proposals) {
    const proposedFieldId = ulid();
    const propertyId = ulid();
    const dataType = fieldDataType(field.value_type);
    const columns = valueColumns(field);
    const accepted = directLowRisk(field);
    const initialStatus = accepted ? "accepted" : "proposed";
    const sourceClass = accepted ? field.evidence_refs.map((ref) => input.evidenceSourceClasses?.get(ref.source_item_id)).find(Boolean) ?? "user_explicit" : "ai_inferred";
    statements.push(
      db.prepare(
        `insert or ignore into v2_field_definitions
         (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
         values (?,?,?,?,? ,?,'candidate','ai_proposed',1,0,?,?)`,
      ).bind(proposedFieldId, input.userId, field.field_key, fieldLabel(field.field_key), `AI-observed field: ${field.field_key}`, dataType, input.now, input.now),
      db.prepare(
        `insert or ignore into v2_property_values
         (id,user_id,owner_object_id,field_definition_id,proposal_temp_id,value_kind,value_text,value_number,value_boolean,value_date,value_json,source_class,claim_risk,review_status,locked_by_user,processing_run_id,created_at)
         select ?,?,?,id,?,?,?,?,?,?,?,?,?,
           case when ?='accepted' and exists (
             select 1 from v2_property_values current
              where current.user_id=v2_field_definitions.user_id and current.owner_object_id=? and current.field_definition_id=v2_field_definitions.id
               and current.review_status='accepted' and current.superseded_at is null and current.value_json<>?
           ) then 'disputed' else ? end,
           0,?,?
         from v2_field_definitions
         where user_id=? and key=? and data_type=?
           and not exists (
             select 1 from v2_property_values current
              where current.user_id=v2_field_definitions.user_id and current.owner_object_id=? and current.field_definition_id=v2_field_definitions.id
               and current.review_status='accepted' and current.superseded_at is null and current.value_json=?
           )
         limit 1`,
      ).bind(
        propertyId, input.userId, input.objectId, field.temp_id, field.value_type,
        columns.text, columns.number, columns.boolean, columns.date, columns.json,
        sourceClass, field.claim_risk,
        initialStatus, input.objectId, columns.json, initialStatus,
        input.runId, input.now,
        input.userId, field.field_key, dataType,
        input.objectId, columns.json,
      ),
    );
    const targetSql = `select coalesce(
      (select id from v2_property_values where id=? and user_id=?),
      (select p.id from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id
       where p.user_id=f.user_id and p.owner_object_id=? and f.user_id=? and f.key=? and p.review_status='accepted' and p.superseded_at is null and p.value_json=? limit 1)
    )`;
    for (const ref of field.evidence_refs) {
      statements.push(evidenceStatement(db, input, "property_value", targetSql, [propertyId, input.userId, input.objectId, input.userId, field.field_key, columns.json], ref));
    }
    statements.push(
      db.prepare(
        `update v2_field_definitions
         set usage_count=(select count(distinct owner_object_id) from v2_property_values p where p.field_definition_id=v2_field_definitions.id and p.user_id=v2_field_definitions.user_id and p.review_status not in ('rejected','superseded')),
             status=case when status='candidate' and (select count(distinct owner_object_id) from v2_property_values p where p.field_definition_id=v2_field_definitions.id and p.user_id=v2_field_definitions.user_id and p.review_status not in ('rejected','superseded'))>=3 then 'observed' else status end,
             updated_at=?
         where user_id=? and key=?`,
      ).bind(input.now, input.userId, field.field_key),
      db.prepare(
        `insert into v2_review_items
         (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
         select ?,?,?,?,'registry_conflict','open',?,?
         where exists (select 1 from v2_field_definitions where user_id=? and key=? and data_type<>?)`,
      ).bind(ulid(), input.userId, input.objectId, input.runId, JSON.stringify({ target: "field", key: field.field_key, proposedDataType: dataType }), input.now, input.userId, field.field_key, dataType),
    );
    if (accepted) {
      statements.push(
        db.prepare(
          `insert into v2_review_items
           (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
           select ?,?,?,?,'value_conflict','open',?,?
           where exists (
             select 1 from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id
              where p.user_id=f.user_id and p.owner_object_id=? and f.user_id=? and f.key=? and p.review_status='accepted' and p.superseded_at is null and p.value_json<>?
           )`,
        ).bind(ulid(), input.userId, input.objectId, input.runId, JSON.stringify({ fieldKey: field.field_key, proposalTempId: field.temp_id }), input.now, input.objectId, input.userId, field.field_key, columns.json),
      );
    }
    if (field.claim_risk === "social_high_risk") {
      statements.push(reviewStatement(db, input, "high_risk_claim", { fieldKey: field.field_key, proposalTempId: field.temp_id }));
    } else if (!accepted) {
      statements.push(reviewStatement(db, input, "analysis_review", { code: "field_confirmation", fieldKey: field.field_key, proposalTempId: field.temp_id }));
    }
  }

  const predicateSeeds = [
    { key: "mentions_entity", label: "언급한 대상", definition: "문서가 개체를 직접 언급한다." },
    { key: "records_event", label: "기록한 사건", definition: "문서가 사건을 기록한다." },
  ];
  for (const predicate of predicateSeeds) {
    statements.push(db.prepare(
      `insert or ignore into v2_predicate_definitions
       (id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at)
       values (?,?,?,?,?,'active','system_seed',1,?,?)`,
    ).bind(ulid(), input.userId, predicate.key, predicate.label, predicate.definition, input.now, input.now));
  }
  const unitSeeds = [
    { key: "m", label: "미터", dimension: "length", canonical: "m", factor: 1 },
    { key: "km", label: "킬로미터", dimension: "length", canonical: "m", factor: 1000 },
    { key: "ms", label: "밀리초", dimension: "duration", canonical: "ms", factor: 1 },
    { key: "minute", label: "분", dimension: "duration", canonical: "ms", factor: 60_000 },
    { key: "hour", label: "시간", dimension: "duration", canonical: "ms", factor: 3_600_000 },
    { key: "bpm", label: "분당 심박", dimension: "heart_rate", canonical: "bpm", factor: 1 },
    { key: "kcal", label: "킬로칼로리", dimension: "energy", canonical: "kcal", factor: 1 },
  ];
  for (const unit of unitSeeds) {
    statements.push(db.prepare(
      `insert or ignore into v2_unit_definitions
       (id,user_id,key,label,dimension,canonical_unit_key,conversion_factor,status,origin,schema_version,created_at,updated_at)
       values (?,?,?,?,?,?,?,'active','system_seed',1,?,?)`,
    ).bind(ulid(), input.userId, unit.key, unit.label, unit.dimension, unit.canonical, unit.factor, input.now, input.now));
  }

  for (const entity of input.envelope.entity_proposals) {
    const entityObjectId = ulid();
    const relationId = ulid();
    statements.push(
      db.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values (?,?,'entity','active',?,?)`).bind(entityObjectId, input.userId, input.now, input.now),
      db.prepare(
        `insert into v2_entity_records
         (object_id,proposal_temp_id,processing_run_id,entity_kind,canonical_name,resolution_status,created_at)
         values (?,?,?,?,?,?,?)`,
      ).bind(entityObjectId, entity.temp_id, input.runId, entity.entity_kind, entity.mention, entity.resolution_status, input.now),
      db.prepare(
        `insert into v2_relation_edges
         (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,processing_run_id,locked_by_user,created_at)
         select ?,?,?,id,?,'ai_inferred','low','proposed',?,0,?
         from v2_predicate_definitions where user_id=? and key='mentions_entity' limit 1`,
      ).bind(relationId, input.userId, input.objectId, entityObjectId, input.runId, input.now, input.userId),
      reviewStatement(db, input, "analysis_review", { code: "entity_resolution", entityTempId: entity.temp_id, entityObjectId, relationId, mention: entity.mention, entityKind: entity.entity_kind }),
    );
    for (const ref of entity.evidence_refs) {
      statements.push(
        evidenceStatement(db, input, "entity", "select ?", [entityObjectId], ref),
        evidenceStatement(db, input, "relation", "select ?", [relationId], ref),
      );
    }
  }

  for (const event of input.envelope.event_proposals) {
    const eventObjectId = ulid();
    const relationId = ulid();
    const precision = event.occurred_at_start ? (/^\d{4}-\d{2}-\d{2}T/.test(event.occurred_at_start) ? "exact" : /^\d{4}-\d{2}-\d{2}$/.test(event.occurred_at_start) ? "day" : /^\d{4}-\d{2}$/.test(event.occurred_at_start) ? "month" : /^\d{4}$/.test(event.occurred_at_start) ? "year" : "unknown") : "unknown";
    statements.push(
      db.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values (?,?,'event','active',?,?)`).bind(eventObjectId, input.userId, input.now, input.now),
      db.prepare(
        `insert into v2_event_records
         (object_id,proposal_temp_id,processing_run_id,event_type_key,occurred_at_start,time_precision,created_at)
         values (?,?,?,?,?,?,?)`,
      ).bind(eventObjectId, event.temp_id, input.runId, event.event_type_key, event.occurred_at_start, precision, input.now),
      db.prepare(
        `insert into v2_relation_edges
         (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,processing_run_id,locked_by_user,created_at)
         select ?,?,?,id,?,'ai_inferred','low','proposed',?,0,?
         from v2_predicate_definitions where user_id=? and key='records_event' limit 1`,
      ).bind(relationId, input.userId, input.objectId, eventObjectId, input.runId, input.now, input.userId),
      reviewStatement(db, input, "analysis_review", { code: "event_confirmation", eventTempId: event.temp_id, eventObjectId, relationId, eventTypeKey: event.event_type_key }),
    );
    for (const ref of event.evidence_refs) {
      statements.push(
        evidenceStatement(db, input, "event", "select ?", [eventObjectId], ref),
        evidenceStatement(db, input, "relation", "select ?", [relationId], ref),
      );
    }
  }

  for (const item of input.envelope.review_items) {
    statements.push(reviewStatement(db, input, "analysis_review", { code: item.code, message: item.message }));
  }
  for (const warning of input.envelope.warnings) {
    statements.push(reviewStatement(db, input, "analysis_warning", { message: warning }));
  }
  return statements;
}
