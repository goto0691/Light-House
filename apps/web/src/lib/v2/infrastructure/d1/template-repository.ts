import { ulid } from "ulidx";

import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { isAllowedSemanticIcon } from "@/lib/v2/presentation/semantic-icons";
import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";
import {
  TEMPLATE_REGISTRY_SNAPSHOT_VERSION,
  validateTemplateDefinitionV1,
  type TemplateDefinitionV1,
} from "@/lib/v2/templates/template-definition-v1";

type TemplateStatus = "draft" | "generated_draft" | "suggested" | "trial" | "active" | "dismissed" | "archived";
type TemplateOrigin = "system_seed" | "user_created" | "ai_derived" | "imported";
type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  icon_key: string;
  origin: TemplateOrigin;
  status: TemplateStatus;
  current_version_id: string;
  pattern_signature: string | null;
  pinned: number;
  usage_count: number;
  definition_json: string;
  version_number: number;
  created_at: string;
  updated_at: string;
};

export type CaptureTemplateProjection = Readonly<{
  id: string;
  name: string;
  description: string | null;
  iconKey: string;
  origin: TemplateOrigin;
  status: TemplateStatus;
  currentVersionId: string;
  versionNumber: number;
  patternSignature: string | null;
  pinned: boolean;
  usageCount: number;
  definition: TemplateDefinitionV1;
  createdAt: string;
  updatedAt: string;
}>;

export class TemplateRepositoryError extends Error {
  constructor(readonly code: "template_not_found" | "template_transition_invalid" | "template_pattern_invalid", message: string) {
    super(message);
    this.name = "TemplateRepositoryError";
  }
}

function rowProjection(row: TemplateRow): CaptureTemplateProjection | null {
  try {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      iconKey: isAllowedSemanticIcon(row.icon_key, "template") ? row.icon_key : "type.template",
      origin: row.origin,
      status: row.status,
      currentVersionId: row.current_version_id,
      versionNumber: row.version_number,
      patternSignature: row.pattern_signature,
      pinned: Boolean(row.pinned),
      usageCount: row.usage_count,
      definition: validateTemplateDefinitionV1(JSON.parse(row.definition_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

function stableSeedId(userId: string, kind: "template" | "version" | "field", key: string) {
  return `${kind}:system:${userId}:${key}`;
}

const TEMPLATE_SELECT = `
  select t.id,t.name,t.description,t.icon_key,t.origin,t.status,t.current_version_id,t.pattern_signature,
         t.pinned,t.usage_count,t.created_at,t.updated_at,v.definition_json,v.version_number
  from v2_capture_templates t
  join v2_capture_template_versions v on v.id=t.current_version_id and v.template_id=t.id`;

function unchosenGeneratedVisibility(legacyVisibility: string, versionId: string) {
  return `(
    t.origin<>'ai_derived' or t.status not in ('generated_draft','suggested')
    or exists (
      select 1 from v2_template_source_links l
      join v2_template_pattern_observations p
        on p.user_id=t.user_id and p.pattern_signature=t.pattern_signature
       and p.source_document_id=l.source_document_id and p.source_revision_id=l.source_revision_id
       and p.outcome='generated'
      join v2_objects o on o.id=l.source_document_id and o.user_id=t.user_id and o.lifecycle_status='active'
      join v2_documents d on d.object_id=o.id and d.current_revision_id=l.source_revision_id
        and d.privacy_level='normal'
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=t.user_id and c.ai_enabled=1
      where l.template_version_id=${versionId} and l.role='pattern_source' and ${legacyVisibility}
      group by l.template_version_id
      having count(distinct l.source_document_id)>=3 and count(distinct p.observed_date)>=3
    )
  )`;
}

export class D1TemplateRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {
    if (!userId.trim()) throw new Error("A scoped template repository requires a userId.");
  }

  async ensureSystemSeeds(now = new Date().toISOString()) {
    for (const seed of SYSTEM_TEMPLATE_SEEDS) {
      const definition = validateTemplateDefinitionV1(seed.definition);
      const templateId = stableSeedId(this.userId, "template", seed.key);
      const versionId = stableSeedId(this.userId, "version", `${seed.key}:1`);
      await this.db.batch([
        this.db.prepare(
          `insert or ignore into v2_capture_templates
           (id,user_id,name,description,icon_key,origin,status,current_version_id,pattern_signature,pinned,usage_count,created_at,updated_at)
           values (?,?,?,?,?,'system_seed','active',null,null,0,0,?,?)`,
        ).bind(templateId, this.userId, definition.name, definition.description ?? null, seed.iconKey, now, now),
        this.db.prepare(
          `insert or ignore into v2_capture_template_versions
           (id,template_id,version_number,definition_json,registry_snapshot_version,source_model,prompt_version,approved_at,previous_version_id,created_at)
           values (?,?,1,?,? ,null,null,?,null,?)`,
        ).bind(versionId, templateId, JSON.stringify(definition), TEMPLATE_REGISTRY_SNAPSHOT_VERSION, now, now),
        this.db.prepare(`update v2_capture_templates set current_version_id=? where id=? and user_id=? and current_version_id is null`).bind(versionId, templateId, this.userId),
      ]);
    }
  }

  async list(options: { captureEligibleOnly?: boolean; includeArchived?: boolean } = {}) {
    const statuses = options.captureEligibleOnly ? ["active", "trial", "suggested"] : options.includeArchived ? null : ["draft", "generated_draft", "suggested", "trial", "active"];
    const where = statuses ? ` and t.status in (${statuses.map(() => "?").join(",")})` : "";
    const visibility = unchosenGeneratedVisibility(await legacyProjectionVisibilityPredicate(this.db), "v.id");
    const rows = await this.db.prepare(`${TEMPLATE_SELECT} where t.user_id=?${where} and ${visibility} order by t.pinned desc,t.status='active' desc,t.usage_count desc,t.updated_at desc`).bind(this.userId, ...(statuses ?? [])).all<TemplateRow>();
    return rows.results.map(rowProjection).filter((item): item is CaptureTemplateProjection => Boolean(item));
  }

  async get(templateId: string) {
    const visibility = unchosenGeneratedVisibility(await legacyProjectionVisibilityPredicate(this.db), "v.id");
    const row = await this.db.prepare(`${TEMPLATE_SELECT} where t.user_id=? and t.id=? and ${visibility} limit 1`).bind(this.userId, templateId).first<TemplateRow>();
    return row ? rowProjection(row) : null;
  }

  async getByVersion(versionId: string) {
    const visibility = unchosenGeneratedVisibility(await legacyProjectionVisibilityPredicate(this.db), "v.id");
    const row = await this.db.prepare(`${TEMPLATE_SELECT} where t.user_id=? and v.id=? and ${visibility} limit 1`).bind(this.userId, versionId).first<TemplateRow>();
    return row ? rowProjection(row) : null;
  }

  async createDraft(input: {
    definition: unknown;
    iconKey?: string | null;
    origin?: TemplateOrigin;
    generated?: boolean;
    patternSignature?: string | null;
    sourceModel?: string | null;
    promptVersion?: string | null;
  }, now = new Date().toISOString()) {
    const definition = validateTemplateDefinitionV1(input.definition);
    const id = ulid();
    const versionId = ulid();
    const origin = input.origin ?? "user_created";
    const status: TemplateStatus = input.generated ? "generated_draft" : "draft";
    const iconKey = input.iconKey && isAllowedSemanticIcon(input.iconKey, "template") ? input.iconKey : "type.template";
    await this.db.batch([
      this.db.prepare(
        `insert into v2_capture_templates
         (id,user_id,name,description,icon_key,origin,status,current_version_id,pattern_signature,pinned,usage_count,created_at,updated_at)
         values (?,?,?,?,?,?,?,null,?,0,0,?,?)`,
      ).bind(id, this.userId, definition.name, definition.description ?? null, iconKey, origin, status, input.patternSignature ?? null, now, now),
      this.db.prepare(
        `insert into v2_capture_template_versions
         (id,template_id,version_number,definition_json,registry_snapshot_version,source_model,prompt_version,approved_at,previous_version_id,created_at)
         select ?,?,1,?,?,?,?,null,null,?
         where exists (select 1 from v2_capture_templates where id=? and user_id=?)`,
      ).bind(versionId, id, JSON.stringify(definition), TEMPLATE_REGISTRY_SNAPSHOT_VERSION, input.sourceModel ?? null, input.promptVersion ?? null, now, id, this.userId),
      this.db.prepare(`update v2_capture_templates set current_version_id=? where id=? and user_id=?`).bind(versionId, id, this.userId),
    ]);
    return this.get(id);
  }

  async transition(templateId: string, action: "try" | "keep" | "dismiss" | "archive" | "pin" | "unpin", now = new Date().toISOString()) {
    const current = await this.get(templateId);
    if (!current) throw new TemplateRepositoryError("template_not_found", "Template not found.");
    let status = current.status;
    let pinned = current.pinned;
    if (action === "try") {
      if (!["generated_draft", "suggested", "trial", "active"].includes(status)) throw new TemplateRepositoryError("template_transition_invalid", "This template cannot be tried from its current state.");
      if (status !== "active") status = "trial";
    } else if (action === "keep") {
      if (["dismissed", "archived"].includes(status)) throw new TemplateRepositoryError("template_transition_invalid", "Restore the template before keeping it.");
      status = "active";
    } else if (action === "dismiss") {
      if (current.origin === "system_seed") throw new TemplateRepositoryError("template_transition_invalid", "System templates can be archived but not dismissed as generated suggestions.");
      status = "dismissed";
      pinned = false;
    } else if (action === "archive") {
      status = "archived";
      pinned = false;
    } else if (action === "pin") {
      if (status !== "active") throw new TemplateRepositoryError("template_transition_invalid", "Only an active template can be pinned.");
      pinned = true;
    } else pinned = false;
    const visibility = unchosenGeneratedVisibility(await legacyProjectionVisibilityPredicate(this.db), "t.current_version_id");
    // The eligibility read and the state change must agree on the same version
    // and state. A competing dismiss/archive/version change wins over stale UI.
    const updated = await this.db.prepare(`update v2_capture_templates as t set status=?,pinned=?,updated_at=?
      where t.id=? and t.user_id=? and t.status=? and t.current_version_id=? and t.pinned=? and ${visibility}`)
      .bind(status, pinned ? 1 : 0, now, templateId, this.userId, current.status, current.currentVersionId, current.pinned ? 1 : 0)
      .run() as { changes?: number; meta?: { changes?: number } };
    if (!Number(updated.meta?.changes ?? updated.changes ?? 0)) throw new TemplateRepositoryError("template_transition_invalid", "Template is no longer eligible for this action.");
    return this.get(templateId);
  }

  async markSubmitted(templateId: string, now: string) {
    await this.db.prepare(`update v2_capture_templates set usage_count=usage_count+1,updated_at=? where id=? and user_id=?`).bind(now, templateId, this.userId).run();
  }

  async observePattern(input: {
    patternSignature: string;
    sourceDocumentId: string;
    sourceRevisionId: string;
    observedDate: string;
    typeKey?: string | null;
    features: Readonly<Record<string, unknown>>;
    candidateDefinition: unknown;
    similarity?: number | null;
    sourceModel?: string | null;
    promptVersion?: string | null;
  }, now = new Date().toISOString()) {
    if (!/^[a-z0-9:._-]{8,200}$/.test(input.patternSignature) || !/^\d{4}-\d{2}-\d{2}$/.test(input.observedDate)) throw new TemplateRepositoryError("template_pattern_invalid", "Pattern signature or observation date is invalid.");
    const definition = validateTemplateDefinitionV1(input.candidateDefinition);
    const clusterId = `pattern:${input.patternSignature}`;
    const observationId = ulid();
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    // Recheck current source consent when counting and publishing a pattern.
    // An observation made while AI was enabled must stop contributing if the
    // owner later disables AI for that capture.
    const patternVisibility = `${legacyVisibility} and o.lifecycle_status='active' and d.privacy_level='normal' and exists (
      select 1 from v2_capture_bundles consent
      where consent.id=d.capture_id and consent.user_id=o.user_id and consent.ai_enabled=1
    )`;
    await this.db.prepare(
      `insert or ignore into v2_template_pattern_observations
       (id,user_id,pattern_signature,signature_version,source_document_id,source_revision_id,observed_date,type_key,features_json,candidate_definition_json,similarity,cluster_id,outcome,created_at)
       select ?,?,?,1,?,?,?,?,?,?,?,?,'observed',?
       where exists (
         select 1 from v2_objects o join v2_documents d on d.object_id=o.id
          where o.id=? and o.user_id=? and d.current_revision_id=? and ${patternVisibility}
       )`,
    ).bind(observationId, this.userId, input.patternSignature, input.sourceDocumentId, input.sourceRevisionId, input.observedDate, input.typeKey ?? null, JSON.stringify(input.features), JSON.stringify(definition), input.similarity ?? null, clusterId, now, input.sourceDocumentId, this.userId, input.sourceRevisionId).run();
    // One document contributes at most once to a pattern. If its current
    // revision is analyzed again, refresh the observation instead of leaving
    // the old revision permanently outside the three-document threshold.
    await this.db.prepare(
      `update v2_template_pattern_observations as p
       set source_revision_id=?,observed_date=?,type_key=?,features_json=?,candidate_definition_json=?,similarity=?,outcome='observed'
       where p.user_id=? and p.pattern_signature=? and p.source_document_id=? and p.source_revision_id<>?
         and exists (select 1 from v2_documents d join v2_objects o on o.id=d.object_id
           where d.object_id=p.source_document_id and o.user_id=p.user_id and d.current_revision_id=? and ${patternVisibility})`,
    ).bind(input.sourceRevisionId, input.observedDate, input.typeKey ?? null, JSON.stringify(input.features), JSON.stringify(definition), input.similarity ?? null,
      this.userId, input.patternSignature, input.sourceDocumentId, input.sourceRevisionId, input.sourceRevisionId).run();
    const observed = await this.db.prepare(
      `select 1 as observed from v2_template_pattern_observations p
        join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
        join v2_objects o on o.id=p.source_document_id and o.user_id=p.user_id
        where p.user_id=? and p.pattern_signature=? and p.source_document_id=? and p.source_revision_id=? and ${patternVisibility} limit 1`,
    ).bind(this.userId, input.patternSignature, input.sourceDocumentId, input.sourceRevisionId).first<{ observed: number }>();
    if (!observed) return { generated: false, documents: 0, dates: 0, template: null };
    const threshold = await this.db.prepare(
      `select count(distinct source_document_id) as documents,count(distinct observed_date) as dates
       from v2_template_pattern_observations p
       join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
       join v2_objects o on o.id=p.source_document_id and o.user_id=p.user_id
       where p.user_id=? and p.pattern_signature=? and p.outcome in ('observed','generated') and ${patternVisibility}`,
    ).bind(this.userId, input.patternSignature).first<{ documents: number; dates: number }>();
    if (!threshold || threshold.documents < 3 || threshold.dates < 3) return { generated: false, documents: threshold?.documents ?? 0, dates: threshold?.dates ?? 0, template: null };
    const existing = await this.db.prepare(`select id from v2_capture_templates where user_id=? and pattern_signature=? limit 1`).bind(this.userId, input.patternSignature).first<{ id: string }>();
    if (existing) {
      // Preserve historical links, while attaching newly eligible sources or
      // a newer analyzed revision to an unchosen generated draft. The version
      // definition stays immutable; visibility only counts current links.
      await this.db.batch([
        this.db.prepare(
          `insert or ignore into v2_template_source_links
           (template_version_id,source_document_id,source_revision_id,role,created_at)
           select v.id,p.source_document_id,p.source_revision_id,'pattern_source',?
           from v2_capture_templates t
           join v2_capture_template_versions v on v.id=t.current_version_id and v.template_id=t.id
           join v2_template_pattern_observations p
             on p.user_id=t.user_id and p.pattern_signature=t.pattern_signature
           join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
           join v2_objects o on o.id=d.object_id and o.user_id=p.user_id
           where t.id=? and t.user_id=? and t.pattern_signature=? and t.origin='ai_derived'
             and t.status in ('generated_draft','suggested') and p.outcome in ('observed','generated')
             and ${patternVisibility}`,
        ).bind(now, existing.id, this.userId, input.patternSignature),
        this.db.prepare(
          `update v2_template_pattern_observations as p set outcome='generated'
           where p.user_id=? and p.pattern_signature=? and p.outcome='observed'
             and exists (
               select 1 from v2_capture_templates t
               join v2_capture_template_versions v on v.id=t.current_version_id and v.template_id=t.id
               join v2_template_source_links l on l.template_version_id=v.id
                 and l.source_document_id=p.source_document_id and l.source_revision_id=p.source_revision_id
                 and l.role='pattern_source'
               where t.id=? and t.user_id=p.user_id and t.pattern_signature=p.pattern_signature
                 and t.origin='ai_derived' and t.status in ('generated_draft','suggested')
             ) and exists (
               select 1 from v2_documents d join v2_objects o on o.id=d.object_id
               where d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
                 and o.user_id=p.user_id and ${patternVisibility}
             )`,
        ).bind(this.userId, input.patternSignature, existing.id),
      ]);
      return { generated: false, documents: threshold.documents, dates: threshold.dates, template: await this.get(existing.id) };
    }
    const sourceStillVisible = await this.db.prepare(
      `select 1 as visible from v2_documents d join v2_objects o on o.id=d.object_id
       where d.object_id=? and d.current_revision_id=? and o.user_id=? and ${patternVisibility} limit 1`,
    ).bind(input.sourceDocumentId, input.sourceRevisionId, this.userId).first<{ visible: number }>();
    if (!sourceStillVisible) return { generated: false, documents: threshold.documents, dates: threshold.dates, template: null };
    const templateId = ulid();
    const versionId = ulid();
    await this.db.batch([
      this.db.prepare(
        `insert or ignore into v2_capture_templates
         (id,user_id,name,description,icon_key,origin,status,current_version_id,pattern_signature,pinned,usage_count,created_at,updated_at)
         select ?,?,?,?,?,'ai_derived','generated_draft',null,?,0,0,?,?
         where exists (
           select 1 from v2_documents d join v2_objects o on o.id=d.object_id
           where d.object_id=? and d.current_revision_id=? and o.user_id=? and ${patternVisibility}
         ) and exists (
           select 1 from v2_template_pattern_observations p
           join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
           join v2_objects o on o.id=p.source_document_id and o.user_id=p.user_id
           where p.user_id=? and p.pattern_signature=? and p.outcome in ('observed','generated') and ${patternVisibility}
           group by p.user_id,p.pattern_signature
           having count(distinct p.source_document_id)>=3 and count(distinct p.observed_date)>=3
         )`,
      ).bind(
        templateId, this.userId, definition.name, definition.description ?? null, "type.template", input.patternSignature, now, now,
        input.sourceDocumentId, input.sourceRevisionId, this.userId, this.userId, input.patternSignature,
      ),
      this.db.prepare(
        `insert into v2_capture_template_versions
         (id,template_id,version_number,definition_json,registry_snapshot_version,source_model,prompt_version,approved_at,previous_version_id,created_at)
         select ?,t.id,1,?,?,?,?,null,null,?
         from v2_capture_templates t
         where t.id=? and t.user_id=? and t.pattern_signature=? and t.current_version_id is null`,
      ).bind(
        versionId, JSON.stringify(definition), TEMPLATE_REGISTRY_SNAPSHOT_VERSION, input.sourceModel ?? null, input.promptVersion ?? null,
        now, templateId, this.userId, input.patternSignature,
      ),
      this.db.prepare(
        `insert into v2_template_source_links (template_version_id,source_document_id,source_revision_id,role,created_at)
         select v.id,p.source_document_id,p.source_revision_id,'pattern_source',?
         from v2_capture_template_versions v
         join v2_capture_templates t on t.id=v.template_id
         join v2_template_pattern_observations p
           on p.user_id=t.user_id and p.pattern_signature=t.pattern_signature
         join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
         join v2_objects o on o.id=p.source_document_id and o.user_id=p.user_id
         where v.id=? and t.id=? and t.user_id=?
           and p.outcome in ('observed','generated') and ${patternVisibility}`,
      ).bind(now, versionId, templateId, this.userId),
      this.db.prepare(
        `update v2_template_pattern_observations as p set outcome='generated'
         where p.user_id=? and p.pattern_signature=?
           and p.outcome in ('observed','generated')
           and exists (
             select 1 from v2_documents d join v2_objects o on o.id=d.object_id
             where d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
                and o.user_id=p.user_id and ${patternVisibility}
           ) and exists (
             select 1 from v2_capture_template_versions v
             join v2_capture_templates t on t.id=v.template_id
             where v.id=? and t.id=? and t.user_id=p.user_id and t.pattern_signature=p.pattern_signature
           )`,
      ).bind(this.userId, input.patternSignature, versionId, templateId),
      this.db.prepare(
        `update v2_capture_templates as t set current_version_id=?
         where t.id=? and t.user_id=? and t.pattern_signature=? and t.current_version_id is null
           and exists (
             select 1 from v2_capture_template_versions v where v.id=? and v.template_id=t.id
           ) and exists (
             select 1 from v2_documents d join v2_objects o on o.id=d.object_id
             where d.object_id=? and d.current_revision_id=? and o.user_id=t.user_id and ${patternVisibility}
           ) and exists (
             select 1 from v2_template_pattern_observations p
             join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
             join v2_objects o on o.id=p.source_document_id and o.user_id=p.user_id
             join v2_template_source_links l
               on l.template_version_id=? and l.source_document_id=p.source_document_id
              and l.source_revision_id=p.source_revision_id and l.role='pattern_source'
             where p.user_id=t.user_id and p.pattern_signature=t.pattern_signature
                and p.outcome='generated' and ${patternVisibility}
             group by p.user_id,p.pattern_signature
             having count(distinct p.source_document_id)>=3 and count(distinct p.observed_date)>=3
           ) and not exists (
             select 1 from v2_template_pattern_observations p
             join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
             join v2_objects o on o.id=p.source_document_id and o.user_id=p.user_id
             where p.user_id=t.user_id and p.pattern_signature=t.pattern_signature
                and p.outcome='generated' and ${patternVisibility}
               and not exists (
                 select 1 from v2_template_source_links l
                 where l.template_version_id=? and l.source_document_id=p.source_document_id
                   and l.source_revision_id=p.source_revision_id and l.role='pattern_source'
               )
           )`,
      ).bind(
        versionId, templateId, this.userId, input.patternSignature, versionId,
        input.sourceDocumentId, input.sourceRevisionId, versionId, versionId,
      ),
    ]);
    const template = await this.get(templateId);
    if (!template) {
      const winner = await this.db.prepare(
        `select id from v2_capture_templates where user_id=? and pattern_signature=? limit 1`,
      ).bind(this.userId, input.patternSignature).first<{ id: string }>();
      return {
        generated: false,
        documents: threshold.documents,
        dates: threshold.dates,
        template: winner ? await this.get(winner.id) : null,
      };
    }
    return { generated: true, documents: threshold.documents, dates: threshold.dates, template };
  }
}
