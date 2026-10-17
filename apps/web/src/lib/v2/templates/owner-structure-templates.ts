import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import type { TemplateDefinitionV1, TemplateInputKind } from "@/lib/v2/templates/template-definition-v1";
import { neutralFieldPrompt } from "@/lib/v2/templates/template-prompts";

const INPUT_KINDS: Readonly<Record<string, TemplateInputKind>> = { date: "date", boolean: "boolean", decimal: "number", integer: "number", long_text: "long_text", rating: "rating", ordered_list: "chips" };
const SIGNATURE = (typeKey: string) => `owner-structure:${typeKey}`;
const MAX_ITEMS = 12;
/** What the owner would see change: the name and each question's field, prompt and input. */
const shape = (definition: TemplateDefinitionV1 | null) => definition ? JSON.stringify([definition.name, definition.sections.flatMap((section) => section.items)
  .map((item) => [item.binding?.fieldKey ?? null, item.prompt, item.inputKind ?? null, item.cardinality ?? "one"])]) : "";
// Set by the old tool on its own (Notion 생성 일시); a new record already keeps its own time.
const AUTOMATIC_FIELDS = new Set(["created_on"]);

/**
 * One input guide per category the owner already kept (an imported database):
 * the fields the owner filled in on at least `minShare` of its records, under the
 * owner's own names. Like every generated template it starts as a draft and is
 * used only after the owner tries or keeps it (D-021/D-024). A category that
 * already has one the owner tried, kept or dismissed is left alone; a draft the
 * owner never touched is rebuilt when the fields change (for example a field
 * that became a list).
 */
export async function createOwnerStructureTemplates(db: D1DatabaseBinding, userId: string, options: Readonly<{ now: string; minShare?: number }>) {
  const minShare = options.minShare ?? 0.3;
  const templates = new D1TemplateRepository(db, userId);
  const types = (await db.prepare(
    `select t.id,t.key,t.label,(select count(distinct a.object_id) from v2_object_type_assignments a
       join v2_objects o on o.id=a.object_id and o.user_id=a.user_id and o.lifecycle_status='active'
       where a.type_definition_id=t.id and a.user_id=t.user_id and a.role='primary' and a.review_status='accepted') as records
     from v2_type_definitions t where t.user_id=? and t.origin='imported' and t.status='active' order by t.key`,
  ).bind(userId).all<{ id: string; key: string; label: string; records: number }>()).results;
  const created: string[] = [];
  for (const type of types) {
    if (!type.records) continue;
    const existing = await db.prepare(
      `select t.id,t.status,t.usage_count,t.pinned,v.definition_json,
         exists (select 1 from v2_capture_template_sessions s join v2_capture_template_versions sv on sv.id=s.template_version_id where sv.template_id=t.id) as used
       from v2_capture_templates t left join v2_capture_template_versions v on v.id=t.current_version_id
       where t.user_id=? and t.pattern_signature=? limit 1`,
    ).bind(userId, SIGNATURE(type.key)).first<{ id: string; status: string; usage_count: number; pinned: number; definition_json: string | null; used: number }>();
    const untouched = existing && existing.status === "generated_draft" && !existing.usage_count && !existing.pinned && !existing.used;
    if (existing && !untouched) continue;
    const fields = (await db.prepare(
      `select f.key,f.label,f.data_type,count(distinct p.owner_object_id) as records from v2_property_values p
       join v2_field_definitions f on f.id=p.field_definition_id and f.user_id=p.user_id
       join v2_object_type_assignments a on a.object_id=p.owner_object_id and a.user_id=p.user_id and a.type_definition_id=? and a.role='primary' and a.review_status='accepted'
       where p.user_id=? and p.source_class='imported' and p.review_status='accepted' and p.superseded_at is null and f.status not in ('archived','merged')
       group by f.key,f.label,f.data_type order by records desc,f.key`,
    ).bind(type.id, userId).all<{ key: string; label: string; data_type: string; records: number }>()).results
      .filter((field) => !AUTOMATIC_FIELDS.has(field.key) && field.records / type.records >= minShare).slice(0, MAX_ITEMS);
    if (!fields.length) continue;
    const definition: TemplateDefinitionV1 = {
      contractVersion: 1,
      name: type.label,
      description: "자주 쓰던 항목으로 만든 입력 안내입니다. 필요한 항목만 쓰세요.",
      expectedTypeIds: [type.key],
      objectRoles: [{ role: "primary_document", optional: false }],
      sections: [{
        key: "frequent_fields",
        label: "자주 쓰던 항목",
        items: fields.map((field, index) => ({
          key: field.key, kind: "field" as const, prompt: neutralFieldPrompt(field.label),
          prominence: index < 3 ? "core" as const : "suggested" as const,
          binding: { ownerRole: "primary_document" as const, fieldKey: field.key },
          inputKind: INPUT_KINDS[field.data_type] ?? "text", cardinality: field.data_type === "ordered_list" ? "many" as const : "one" as const,
          allowedAiOperations: ["extract_from_capture" as const],
        })),
      }],
    };
    if (existing) {
      if (shape(existing.definition_json ? JSON.parse(existing.definition_json) as TemplateDefinitionV1 : null) === shape(definition)) continue;
      await db.prepare(`delete from v2_capture_templates where id=? and user_id=? and status='generated_draft' and usage_count=0 and pinned=0`).bind(existing.id, userId).run();
    }
    await templates.createDraft({ definition, origin: "imported", generated: true, patternSignature: SIGNATURE(type.key) }, options.now);
    created.push(type.key);
  }
  return created;
}
