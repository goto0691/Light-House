import { ulid } from "ulidx";

import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

export class EntityCurationError extends Error {
  constructor(readonly code: "entity_not_found" | "entity_name_invalid" | "entity_merge_invalid" | "entity_changed", message: string) {
    super(message);
    this.name = "EntityCurationError";
  }
}

const NAME_LIMIT = 100;
const SAME_NAME = (expression: string) => `lower(replace(trim(${expression}),' ',''))`;

type ActiveEntity = { id: string; entity_kind: string; canonical_name: string; resolution_status: string };

/**
 * The owner's own corrections to people, companies, works and platforms (06 §10).
 * Nothing here runs automatically: a rename or merge happens only when the owner asks.
 * - Rename keeps the old name as an alternate name, so a later import or analysis that
 *   still says the old name finds the same entity.
 * - Merge moves the links and values of one entity onto another, keeps the merged one
 *   (archived, its name as an alternate name, its id redirecting to the survivor), and
 *   writes an audit event. Original evidence stays where it was.
 * Alternate names are archived entity rows whose object points at the survivor through
 * `canonical_object_id`.
 */
export class D1EntityCurationRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {
    if (!userId.trim()) throw new Error("A scoped repository requires a userId.");
  }

  private async active(entityId: string): Promise<ActiveEntity> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db, "eo");
    const row = await this.db.prepare(
      `select eo.id,e.entity_kind,e.canonical_name,e.resolution_status from v2_entity_records e
       join v2_objects eo on eo.id=e.object_id and eo.user_id=? and eo.object_kind='entity' and eo.lifecycle_status='active'
       where e.object_id=? and ${visibility} limit 1`,
    ).bind(this.userId, entityId).first<ActiveEntity>();
    if (!row) throw new EntityCurationError("entity_not_found", "The entity is not an active entity of this owner.");
    return row;
  }

  /** The active entity an id now stands for: itself, or the survivor it was merged into. */
  async resolve(entityId: string): Promise<string | null> {
    let current = entityId;
    for (let hop = 0; hop < 5; hop += 1) {
      const row = await this.db.prepare(`select id,lifecycle_status,canonical_object_id from v2_objects where id=? and user_id=? and object_kind='entity' limit 1`)
        .bind(current, this.userId).first<{ id: string; lifecycle_status: string; canonical_object_id: string | null }>();
      if (!row) return null;
      if (row.lifecycle_status === "active") return row.id;
      if (!row.canonical_object_id || row.canonical_object_id === row.id) return null;
      current = row.canonical_object_id;
    }
    return null;
  }

  /** Alternate names of an active entity (old names and merged entities). */
  async alternateNames(entityId: string): Promise<string[]> {
    const rows = await this.db.prepare(
      `select distinct e.canonical_name from v2_entity_records e join v2_objects o on o.id=e.object_id and o.user_id=? and o.lifecycle_status<>'active'
       where o.canonical_object_id=? order by e.canonical_name`,
    ).bind(this.userId, entityId).all<{ canonical_name: string }>();
    return rows.results.map((row) => row.canonical_name);
  }

  /** Other active entities whose name contains the text, for choosing a merge target. */
  async candidates(entityId: string, text: string, limit = 10) {
    const query = text.trim().slice(0, NAME_LIMIT);
    if (!query) return [];
    const visibility = await legacyProjectionVisibilityPredicate(this.db, "eo");
    const rows = await this.db.prepare(
      `select eo.id,e.entity_kind,e.canonical_name,(select count(*) from v2_relation_edges r where r.user_id=eo.user_id and r.object_object_id=eo.id and r.superseded_at is null) as links
       from v2_entity_records e join v2_objects eo on eo.id=e.object_id and eo.user_id=? and eo.object_kind='entity' and eo.lifecycle_status='active'
       where eo.id<>? and instr(lower(e.canonical_name),lower(?))>0 and ${visibility}
       order by links desc,e.canonical_name limit ?`,
    ).bind(this.userId, entityId, query, Math.max(1, Math.min(limit, 20))).all<{ id: string; entity_kind: string; canonical_name: string; links: number }>();
    return rows.results.map((row) => ({ entityId: row.id, kind: row.entity_kind, name: row.canonical_name, links: Number(row.links) }));
  }

  async rename(entityId: string, name: string, now: string) {
    const next = name.trim();
    if (!next || next.length > NAME_LIMIT) throw new EntityCurationError("entity_name_invalid", "An entity name must be 1-100 characters.");
    const entity = await this.active(entityId);
    if (entity.canonical_name === next) return { entityId, name: next, changed: false };
    const keepOld = entity.canonical_name.replace(/\s/g, "").toLowerCase() !== next.replace(/\s/g, "").toLowerCase()
      && !(await this.alternateNames(entityId)).some((alternate) => alternate === entity.canonical_name);
    const aliasId = ulid();
    await this.db.batch([
      this.db.prepare(`update v2_entity_records set canonical_name=? where object_id=? and canonical_name=?
        and exists (select 1 from v2_objects where id=? and user_id=? and lifecycle_status='active')`).bind(next, entityId, entity.canonical_name, entityId, this.userId),
      ...(keepOld ? [
        this.db.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,canonical_object_id,created_at,updated_at)
          select ?,?,'entity','archived',?,?,? where exists (select 1 from v2_entity_records where object_id=? and canonical_name=?)`).bind(aliasId, this.userId, entityId, now, now, entityId, next),
        this.db.prepare(`insert into v2_entity_records (object_id,proposal_temp_id,processing_run_id,entity_kind,canonical_name,resolution_status,created_at)
          select ?,null,null,?,?,?,? where exists (select 1 from v2_objects where id=? and user_id=?)`).bind(aliasId, entity.entity_kind, entity.canonical_name, entity.resolution_status, now, aliasId, this.userId),
      ] : []),
      this.db.prepare(`update v2_objects set updated_at=? where id=? and user_id=?`).bind(now, entityId, this.userId),
      this.db.prepare(`insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at)
        select ?,?,'entity.renamed','entity',?,?,? where exists (select 1 from v2_entity_records where object_id=? and canonical_name=?)`)
        .bind(ulid(), this.userId, entityId, JSON.stringify({ from: entity.canonical_name, to: next }), now, entityId, next),
    ]);
    if ((await this.active(entityId)).canonical_name !== next) throw new EntityCurationError("entity_changed", "The entity changed while it was being renamed.");
    return { entityId, name: next, changed: true };
  }

  /** Merge `sourceId` into `targetId`; the target survives under its own name and kind. */
  async merge(sourceId: string, targetId: string, now: string) {
    if (sourceId === targetId) throw new EntityCurationError("entity_merge_invalid", "An entity cannot be merged into itself.");
    const [source, target] = [await this.active(sourceId), await this.active(targetId)];
    const owner = this.userId;
    // A link the survivor already has (same record and relation) is kept once; the copy stays on
    // the merged entity, superseded. A link between the two entities would point at itself.
    const duplicateEdge = (column: "object_object_id" | "subject_object_id", other: "subject_object_id" | "object_object_id") =>
      `exists (select 1 from v2_relation_edges kept where kept.user_id=v2_relation_edges.user_id and kept.${column}=?
         and kept.${other}=v2_relation_edges.${other} and kept.predicate_definition_id=v2_relation_edges.predicate_definition_id
         and (kept.superseded_at is null or kept.processing_run_id is v2_relation_edges.processing_run_id))`;
    // Every later step applies only if the first one did, inside the same batch.
    const done = "exists (select 1 from v2_objects merged where merged.id=? and merged.user_id=? and merged.canonical_object_id=? and merged.lifecycle_status='archived')";
    const guard = [source.id, owner, target.id];
    await this.db.batch([
      this.db.prepare(`update v2_objects set lifecycle_status='archived',canonical_object_id=?,updated_at=? where id=? and user_id=? and lifecycle_status='active'
        and exists (select 1 from v2_objects survivor where survivor.id=? and survivor.user_id=? and survivor.lifecycle_status='active')`).bind(target.id, now, source.id, owner, target.id, owner),
      this.db.prepare(`update v2_relation_edges set superseded_at=? where user_id=? and superseded_at is null
        and ((object_object_id=? and subject_object_id=?) or (subject_object_id=? and object_object_id=?)) and ${done}`).bind(now, owner, source.id, target.id, source.id, target.id, ...guard),
      this.db.prepare(`update v2_relation_edges set superseded_at=coalesce(superseded_at,?) where user_id=? and object_object_id=? and ${duplicateEdge("object_object_id", "subject_object_id")} and ${done}`).bind(now, owner, source.id, target.id, ...guard),
      this.db.prepare(`update v2_relation_edges set object_object_id=? where user_id=? and object_object_id=? and superseded_at is null and ${done}`).bind(target.id, owner, source.id, ...guard),
      this.db.prepare(`update v2_relation_edges set superseded_at=coalesce(superseded_at,?) where user_id=? and subject_object_id=? and ${duplicateEdge("subject_object_id", "object_object_id")} and ${done}`).bind(now, owner, source.id, target.id, ...guard),
      this.db.prepare(`update v2_relation_edges set subject_object_id=? where user_id=? and subject_object_id=? and superseded_at is null and ${done}`).bind(target.id, owner, source.id, ...guard),
      // Values move unless the survivor already has a current value for that field.
      this.db.prepare(`update v2_property_values set owner_object_id=? where user_id=? and owner_object_id=? and superseded_at is null
        and not exists (select 1 from v2_property_values kept where kept.user_id=v2_property_values.user_id and kept.owner_object_id=?
          and kept.field_definition_id=v2_property_values.field_definition_id and kept.superseded_at is null and kept.review_status='accepted') and ${done}`).bind(target.id, owner, source.id, target.id, ...guard),
      // Names that already pointed at the merged entity now point at the survivor.
      this.db.prepare(`update v2_objects set canonical_object_id=?,updated_at=? where user_id=? and canonical_object_id=? and id<>? and ${done}`).bind(target.id, now, owner, source.id, target.id, ...guard),
      this.db.prepare(`update v2_objects set updated_at=? where id=? and user_id=? and ${done}`).bind(now, target.id, owner, ...guard),
      this.db.prepare(`insert into v2_audit_events (id,user_id,action,object_kind,object_id,metadata_json,created_at) select ?,?,'entity.merged','entity',?,?,? where ${done}`)
        .bind(ulid(), owner, target.id, JSON.stringify({ merged: source.id, mergedName: source.canonical_name, mergedKind: source.entity_kind, into: target.canonical_name }), now, ...guard),
    ]);
    const merged = await this.db.prepare(`select canonical_object_id from v2_objects where id=? and user_id=?`).bind(source.id, owner).first<{ canonical_object_id: string | null }>();
    if (merged?.canonical_object_id !== target.id) throw new EntityCurationError("entity_changed", "The entities changed while they were being merged.");
    const moved = await this.db.prepare(`select count(*) as n from v2_relation_edges where user_id=? and (object_object_id=? or subject_object_id=?) and superseded_at is null`)
      .bind(owner, target.id, target.id).first<{ n: number }>();
    return { entityId: target.id, mergedId: source.id, mergedName: source.canonical_name, links: Number(moved?.n ?? 0) };
  }
}

/** SQL for name lookups that also follow alternate names to the active survivor (alias `named`, result `target`). */
export function entityByNameSql(nameExpression: string) {
  return `from v2_entity_records e
    join v2_objects named on named.id=e.object_id and named.object_kind='entity' and (named.lifecycle_status='active' or named.canonical_object_id is not null)
    join v2_objects eo on eo.id=coalesce(named.canonical_object_id,named.id) and eo.user_id=named.user_id and eo.object_kind='entity' and eo.lifecycle_status='active'
    where ${SAME_NAME("e.canonical_name")}=${SAME_NAME(nameExpression)}`;
}
