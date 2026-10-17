import { ulid } from "ulidx";

import { entityByNameSql } from "@/lib/v2/infrastructure/d1/entity-curation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { suggestSemanticIconForType } from "@/lib/v2/presentation/semantic-icons";

const CANONICAL_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const LABEL_LIMIT = 100;

export class ImportedKnowledgeError extends Error {
  constructor(readonly code: "imported_key_invalid" | "imported_label_invalid" | "imported_object_missing", message: string) {
    super(message);
    this.name = "ImportedKnowledgeError";
  }
}

export type ImportedDefinition = Readonly<{ key: string; label: string; definition?: string }>;
export type ImportedRelationProvenance = Readonly<{ sourceItemId: string; property: string }>;
export type ImportedFieldDataType = "short_text" | "long_text" | "decimal" | "boolean" | "date" | "ordered_list";
export type ImportedField = Readonly<{ key: string; label: string; dataType: ImportedFieldDataType }>;
/** A list (multi-select) is stored as a JSON array, with its items also joined as text for reading and search. */
export type ImportedValue = Readonly<{ kind: "text"; text: string } | { kind: "number"; number: number } | { kind: "boolean"; boolean: boolean } | { kind: "date"; date: string } | { kind: "list"; items: readonly string[] }>;

function key(value: string) {
  if (!CANONICAL_KEY.test(value)) throw new ImportedKnowledgeError("imported_key_invalid", "Imported keys must be canonical lowercase registry keys.");
  return value;
}

function label(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > LABEL_LIMIT) throw new ImportedKnowledgeError("imported_label_invalid", "Imported labels must be 1-100 characters.");
  return trimmed;
}

/**
 * Categories and links the owner already made in another tool (a Notion database,
 * a Notion relation property). They are the owner's explicit structure, not AI
 * proposals: imported types start active and imported relations start accepted.
 * Every write is idempotent and never overrides a user rejection or lock.
 */
export class D1ImportedKnowledgeRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async activeObject(objectId: string, kind?: "document" | "entity") {
    const row = await this.db.prepare(`select object_kind from v2_objects where id=? and user_id=? and lifecycle_status='active' limit 1`)
      .bind(objectId, this.userId).first<{ object_kind: string }>();
    if (!row || (kind && row.object_kind !== kind)) throw new ImportedKnowledgeError("imported_object_missing", "The imported target is not an active object of this owner.");
    return row.object_kind;
  }

  /** Make the owner's source category (e.g. a Notion database) the record's primary type. */
  async assignType(documentId: string, type: ImportedDefinition, now: string) {
    const typeKey = key(type.key);
    const typeLabel = label(type.label);
    await this.activeObject(documentId, "document");
    await this.db.batch([
      this.db.prepare(
        `insert or ignore into v2_type_definitions
         (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
         values (?,?,?,?,'document','active','imported',?,1,0,0,?,?)`,
      ).bind(ulid(), this.userId, typeKey, typeLabel, type.definition ?? `Imported owner category: ${typeLabel}`, now, now),
      this.db.prepare(
        `insert into v2_object_type_assignments
         (id,user_id,object_id,type_definition_id,role,source_class,review_status,processing_run_id,locked_by_user,created_at,updated_at)
         select ?,?,?,id,'primary','import','accepted',null,0,?,?
         from v2_type_definitions where user_id=? and key=? and status not in ('archived','merged') limit 1
         on conflict do update set role='primary',source_class='import',review_status='accepted',updated_at=excluded.updated_at
         where v2_object_type_assignments.locked_by_user=0 and v2_object_type_assignments.review_status<>'rejected'`,
      ).bind(ulid(), this.userId, documentId, now, now, this.userId, typeKey),
      this.db.prepare(
        `insert or ignore into v2_type_presentation_profiles
         (id,user_id,type_definition_id,icon_key,accent_role,default_collection_preset_key,default_record_preset_key,source,version,status,created_at,updated_at)
         select ?,?,id,?,'neutral','collection.generic.list.v1','record.document.v1','ai_suggested',1,'candidate',?,?
         from v2_type_definitions where user_id=? and key=? limit 1`,
      ).bind(ulid(), this.userId, suggestSemanticIconForType(typeKey), now, now, this.userId, typeKey),
      this.db.prepare(
        `update v2_type_definitions
         set usage_count=(select count(*) from v2_object_type_assignments a where a.type_definition_id=v2_type_definitions.id and a.user_id=v2_type_definitions.user_id and a.review_status not in ('rejected','superseded')),
             updated_at=?
         where user_id=? and key=?`,
      ).bind(now, this.userId, typeKey),
    ]);
  }

  /**
   * Store one value the owner already wrote (a Notion property) as an accepted field.
   * An existing current value is never overwritten: the owner may have corrected it.
   * A same-key AI field keeps its data type; only its generated label gives way to the owner's.
   */
  async setValue(documentId: string, field: ImportedField, value: ImportedValue, provenance: ImportedRelationProvenance | null, now: string): Promise<"created" | "exists" | "kept_existing" | "type_conflict"> {
    const fieldKey = key(field.key);
    const fieldLabel = label(field.label);
    await this.activeObject(documentId, "document");
    const columns = {
      kind: value.kind === "list" ? "json" : value.kind,
      text: value.kind === "text" ? value.text : value.kind === "list" ? value.items.join(", ") : null,
      number: value.kind === "number" ? value.number : null,
      boolean: value.kind === "boolean" ? (value.boolean ? 1 : 0) : null,
      date: value.kind === "date" ? value.date : null,
      json: JSON.stringify(value.kind === "text" ? value.text : value.kind === "number" ? value.number : value.kind === "boolean" ? value.boolean : value.kind === "list" ? value.items : value.date),
    };
    await this.db.batch([
      this.db.prepare(
        `insert or ignore into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
         values (?,?,?,?,?,?,'active','imported',1,0,?,?)`,
      ).bind(ulid(), this.userId, fieldKey, fieldLabel, `Owner field: ${fieldLabel}`, field.dataType, now, now),
      this.db.prepare(`update v2_field_definitions set label=?,updated_at=? where user_id=? and key=? and origin='ai_proposed'`).bind(fieldLabel, now, this.userId, fieldKey),
    ]);
    const definition = await this.db.prepare(`select id,data_type from v2_field_definitions where user_id=? and key=? limit 1`).bind(this.userId, fieldKey).first<{ id: string; data_type: string }>();
    if (!definition || definition.data_type !== field.dataType) return "type_conflict";
    const current = await this.db.prepare(
      `select value_json from v2_property_values where user_id=? and owner_object_id=? and field_definition_id=? and review_status='accepted' and superseded_at is null limit 1`,
    ).bind(this.userId, documentId, definition.id).first<{ value_json: string }>();
    if (current) return current.value_json === columns.json ? "exists" : "kept_existing";
    const propertyId = ulid();
    const statements = [
      this.db.prepare(
        `insert into v2_property_values
         (id,user_id,owner_object_id,field_definition_id,proposal_temp_id,value_kind,value_text,value_number,value_boolean,value_date,value_json,source_class,claim_risk,review_status,locked_by_user,processing_run_id,created_at)
         values (?,?,?,?,null,?,?,?,?,?,?,'imported','low','accepted',0,null,?)`,
      ).bind(propertyId, this.userId, documentId, definition.id, columns.kind, columns.text, columns.number, columns.boolean, columns.date, columns.json, now),
      this.db.prepare(
        `update v2_field_definitions set usage_count=(select count(distinct p.owner_object_id) from v2_property_values p where p.field_definition_id=v2_field_definitions.id and p.user_id=v2_field_definitions.user_id and p.review_status not in ('rejected','superseded')),
           updated_at=? where id=? and user_id=?`,
      ).bind(now, definition.id, this.userId),
    ];
    if (provenance) {
      statements.push(this.db.prepare(
        `insert or ignore into v2_evidence_refs (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
         select ?,?,'property_value',?,s.id,'form_field',?,? from v2_source_items s where s.id=? and s.user_id=?`,
      ).bind(ulid(), this.userId, propertyId, JSON.stringify({ property: label(provenance.property) }), now, provenance.sourceItemId, this.userId));
    }
    await this.db.batch(statements);
    return "created";
  }

  /** Reuse an active entity with the same kind and name (or that name as an alternate name), or create one. */
  async ensureEntity(kind: string, name: string, now: string): Promise<string> {
    const entityKind = key(kind);
    const canonicalName = label(name);
    const existing = await this.db.prepare(
      `select eo.id as object_id ${entityByNameSql("?")} and named.user_id=? and e.entity_kind=?
       order by named.canonical_object_id is not null,e.created_at,e.object_id limit 1`,
    ).bind(canonicalName, this.userId, entityKind).first<{ object_id: string }>();
    if (existing) return existing.object_id;
    const objectId = ulid();
    await this.db.batch([
      this.db.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values (?,?,'entity','active',?,?)`).bind(objectId, this.userId, now, now),
      this.db.prepare(
        `insert into v2_entity_records (object_id,proposal_temp_id,processing_run_id,entity_kind,canonical_name,resolution_status,created_at)
         values (?,null,null,?,?,'local_candidate',?)`,
      ).bind(objectId, entityKind, canonicalName, now),
    ]);
    return objectId;
  }

  /** Record one owner-made link. The source property name is kept as relation evidence. */
  async addRelation(input: Readonly<{ subjectObjectId: string; objectObjectId: string; predicate: ImportedDefinition; provenance?: ImportedRelationProvenance; now: string }>): Promise<"created" | "exists"> {
    const predicateKey = key(input.predicate.key);
    const predicateLabel = label(input.predicate.label);
    await this.activeObject(input.subjectObjectId);
    await this.activeObject(input.objectObjectId);
    const existing = await this.db.prepare(
      `select r.id from v2_relation_edges r join v2_predicate_definitions p on p.id=r.predicate_definition_id and p.user_id=r.user_id
       where r.user_id=? and r.subject_object_id=? and r.object_object_id=? and p.key=? and r.superseded_at is null and r.review_status<>'rejected' limit 1`,
    ).bind(this.userId, input.subjectObjectId, input.objectObjectId, predicateKey).first<{ id: string }>();
    if (existing) return "exists";
    const relationId = ulid();
    const statements = [
      this.db.prepare(
        `insert or ignore into v2_predicate_definitions (id,user_id,key,label,definition,inverse_key,status,origin,schema_version,created_at,updated_at)
         values (?,?,?,?,?,null,'active','imported',1,?,?)`,
      ).bind(ulid(), this.userId, predicateKey, predicateLabel, input.predicate.definition ?? `Imported owner link: ${predicateLabel}`, input.now, input.now),
      this.db.prepare(
        `insert into v2_relation_edges
         (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,processing_run_id,locked_by_user,created_at)
         select ?,?,?,id,?,'imported','low','accepted',null,0,? from v2_predicate_definitions where user_id=? and key=? limit 1`,
      ).bind(relationId, this.userId, input.subjectObjectId, input.objectObjectId, input.now, this.userId, predicateKey),
    ];
    if (input.provenance) {
      statements.push(this.db.prepare(
        `insert or ignore into v2_evidence_refs (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
         select ?,?,'relation',?,s.id,'form_field',?,? from v2_source_items s where s.id=? and s.user_id=?`,
      ).bind(ulid(), this.userId, relationId, JSON.stringify({ property: label(input.provenance.property) }), input.now, input.provenance.sourceItemId, this.userId));
    }
    await this.db.batch(statements);
    return "created";
  }
}
