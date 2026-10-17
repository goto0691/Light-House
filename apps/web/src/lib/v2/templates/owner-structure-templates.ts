import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import type { TemplateDefinitionV1, TemplateInputKind } from "@/lib/v2/templates/template-definition-v1";
import { neutralFieldPrompt } from "@/lib/v2/templates/template-prompts";

const INPUT_KINDS: Readonly<Record<string, TemplateInputKind>> = { date: "date", boolean: "boolean", decimal: "number", integer: "number", long_text: "long_text", rating: "rating" };
const SIGNATURE = (typeKey: string) => `owner-structure:${typeKey}`;
const MAX_ITEMS = 12;
// Set by the old tool on its own (Notion 생성 일시); a new record already keeps its own time.
const AUTOMATIC_FIELDS = new Set(["created_on"]);

/**
 * One input guide per category the owner already kept (an imported database):
 * the fields the owner filled in on at least `minShare` of its records, under the
 * owner's own names. Like every generated template it starts as a draft and is
 * used only after the owner tries or keeps it (D-021/D-024). A category that
 * already has one, even dismissed, is left alone.
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
    const existing = await db.prepare(`select 1 as present from v2_capture_templates where user_id=? and pattern_signature=? limit 1`).bind(userId, SIGNATURE(type.key)).first();
    if (existing) continue;
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
          inputKind: INPUT_KINDS[field.data_type] ?? "text", cardinality: "one" as const,
          allowedAiOperations: ["extract_from_capture" as const],
        })),
      }],
    };
    await templates.createDraft({ definition, origin: "imported", generated: true, patternSignature: SIGNATURE(type.key) }, options.now);
    created.push(type.key);
  }
  return created;
}
