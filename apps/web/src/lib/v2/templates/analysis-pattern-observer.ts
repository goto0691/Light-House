import type { V2ProcessingJob } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";
import type { TemplateDefinitionV1, TemplateInputKind } from "@/lib/v2/templates/template-definition-v1";
import { neutralFieldPrompt, OWNER_LABEL_ORIGINS } from "@/lib/v2/templates/template-prompts";

type PatternField = Readonly<{ key: string; value_kind: string }>;
export type AnalysisPatternObservationOutcome = "skipped" | "observed" | "generated";

const CANONICAL_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const INPUT_KINDS: Readonly<Record<string, TemplateInputKind>> = {
  text: "text", number: "number", boolean: "boolean", date: "date", rating: "rating",
};
const SAFE_PROMPTS: Readonly<Record<string, string>> = {
  distance_km: "거리를 남길까요?",
  duration_min: "시간을 남길까요?",
  average_heart_rate: "평균 심박수를 남길까요?",
  user_rating: "평점을 남길까요?",
  subject_name: "이름이나 제목을 남길까요?",
};
const SAFE_TYPE_NAMES: Readonly<Record<string, string>> = {
  review: "리뷰 기록 안내",
  workout_log: "운동 기록 안내",
};

function localObservedDate(timestamp: string, timeZone: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return null;
  }
}

function fieldKeys(definition: TemplateDefinitionV1) {
  return definition.sections.flatMap((section) => section.items)
    .filter((item) => item.kind === "field" && item.binding?.ownerRole === "primary_document" && item.binding.fieldKey)
    .map((item) => `${item.binding!.fieldKey}:${item.inputKind === "measurement" ? "number" : item.inputKind}`).sort();
}

/** Names the owner wrote (imported/user/system definitions); AI-generated labels never enter a template. */
type OwnerNames = Readonly<{ typeName: string | null; fieldNames: ReadonlyMap<string, string> }>;

function candidateDefinition(typeKey: string | null, fields: readonly PatternField[], names: OwnerNames = { typeName: null, fieldNames: new Map() }): TemplateDefinitionV1 {
  const safeType = typeKey && SAFE_TYPE_NAMES[typeKey] ? SAFE_TYPE_NAMES[typeKey] : null;
  return {
    contractVersion: 1,
    name: safeType ?? (names.typeName ? `${names.typeName} 안내` : "반복 기록 안내"),
    description: "서로 다른 날짜의 기록에서 반복된 입력 구조입니다. 필요한 항목만 사용하세요.",
    expectedTypeIds: typeKey && (safeType || names.typeName) ? [typeKey] : [],
    objectRoles: [{ role: "primary_document", optional: false }],
    sections: [{
      key: "repeated_fields",
      label: "반복해서 기록한 항목",
      items: fields.map((field, index) => ({
        key: field.key,
        kind: "field" as const,
        prompt: SAFE_PROMPTS[field.key] ?? (names.fieldNames.has(field.key) ? neutralFieldPrompt(names.fieldNames.get(field.key)!) : `반복 항목 ${index + 1}을 기록할까요?`),
        prominence: index < 3 ? "core" as const : "suggested" as const,
        binding: { ownerRole: "primary_document" as const, fieldKey: field.key },
        inputKind: INPUT_KINDS[field.value_kind],
        cardinality: "one" as const,
        allowedAiOperations: ["extract_from_capture" as const],
      })),
    }],
  };
}

async function patternSignature(typeKey: string | null, fields: readonly PatternField[]) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, typeKey, fields }));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `pattern.structure.v1.${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

export async function observeCompletedAnalysisPattern(
  db: D1DatabaseBinding,
  input: Readonly<{ job: V2ProcessingJob; runId: string; now: string }>,
): Promise<AnalysisPatternObservationOutcome> {
  const { job, runId } = input;
  if (job.stage !== "analyze") return "skipped";
  const legacyVisibility = await legacyProjectionVisibilityPredicate(db);
  const source = await db.prepare(
    `select c.captured_at,c.client_timezone,r.model_id,r.prompt_version
     from v2_processing_jobs j
     join v2_processing_runs r on r.job_id=j.id and r.user_id=j.user_id and r.id=? and r.status='succeeded'
     join v2_objects o on o.id=j.object_id and o.user_id=j.user_id and o.lifecycle_status='active'
     join v2_documents d on d.object_id=o.id and d.capture_id=j.capture_id
       and d.current_revision_id=j.input_revision_id and d.analyzed_revision_id=j.input_revision_id and d.privacy_level='normal'
     join v2_capture_bundles c on c.id=d.capture_id and c.user_id=j.user_id and c.ai_enabled=1
     where j.id=? and j.user_id=? and j.object_id=? and j.capture_id=? and j.input_revision_id=?
       and j.stage='analyze' and j.status='succeeded' and ${legacyVisibility} limit 1`,
  ).bind(runId, job.id, job.userId, job.objectId, job.captureId, job.inputRevisionId)
    .first<{ captured_at: string; client_timezone: string; model_id: string; prompt_version: string }>();
  if (!source) return "skipped";
  const observedDate = localObservedDate(source.captured_at, source.client_timezone);
  if (!observedDate) return "skipped";

  const storedFields = await db.prepare(
    `select distinct f.key,p.value_kind from v2_property_values p
     join v2_field_definitions f on f.id=p.field_definition_id and f.user_id=p.user_id
     where p.user_id=? and p.owner_object_id=? and p.processing_run_id=?
       and p.review_status='accepted' and p.claim_risk='low' and p.superseded_at is null
       and f.status not in ('archived','merged') order by f.key limit 12`,
  ).bind(job.userId, job.objectId, runId).all<PatternField>();
  const fields = storedFields.results.filter((field) => CANONICAL_KEY.test(field.key) && INPUT_KINDS[field.value_kind]).slice(0, 8);
  if (fields.length < 3) return "skipped";
  // The record's confirmed main category comes first: reusing a category the record already
  // has writes no new assignment for this run, and the owner's category is what the guide is for.
  const type = await db.prepare(
    `select t.key from v2_object_type_assignments a
     join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id
     where a.user_id=? and a.object_id=? and t.applies_to_kind='document' and t.status not in ('archived','merged')
       and ((a.role='primary' and a.review_status='accepted') or (a.processing_run_id=? and a.review_status in ('accepted','proposed')))
     order by case when a.role='primary' and a.review_status='accepted' then 0 when a.role='primary' then 1 when a.role='secondary' then 2 else 3 end,t.key limit 1`,
  ).bind(job.userId, job.objectId, runId).first<{ key: string }>();
  const typeKey = type && CANONICAL_KEY.test(type.key) ? type.key : null;
  const typeRow = typeKey ? await db.prepare(`select label,origin from v2_type_definitions where user_id=? and key=? limit 1`).bind(job.userId, typeKey).first<{ label: string; origin: string }>() : null;
  const labelRows = await db.prepare(
    `select key,label,origin from v2_field_definitions where user_id=? and key in (${fields.map(() => "?").join(",")})`,
  ).bind(job.userId, ...fields.map((field) => field.key)).all<{ key: string; label: string; origin: string }>();
  const names: OwnerNames = {
    typeName: typeRow && OWNER_LABEL_ORIGINS.has(typeRow.origin) ? typeRow.label : null,
    fieldNames: new Map(labelRows.results.filter((row) => OWNER_LABEL_ORIGINS.has(row.origin)).map((row) => [row.key, row.label])),
  };
  const definition = candidateDefinition(typeKey, fields, names);
  const structure = fieldKeys(definition);
  if (typeKey && SYSTEM_TEMPLATE_SEEDS.some((seed) => seed.definition.expectedTypeIds.includes(typeKey)
    && fields.every((field) => fieldKeys(seed.definition).includes(`${field.key}:${INPUT_KINDS[field.value_kind]}`)))) return "skipped";

  const repository = new D1TemplateRepository(db, job.userId);
  const existing = await repository.list({ captureEligibleOnly: true });
  if (existing.some((template) => fieldKeys(template.definition).join("|") === structure.join("|")
    && (typeKey ? template.definition.expectedTypeIds.includes(typeKey) : template.definition.expectedTypeIds.length === 0))) return "skipped";
  // A pattern another template already covers (same or broader fields, or one field more) makes no new
  // template, including against templates the owner dismissed or archived. This pattern's own draft is
  // not "another" template: its later observations still count toward it.
  const signature = await patternSignature(typeKey, fields);
  const mine = new Set(fields.map((field) => field.key));
  const covered = (await repository.list({ includeArchived: true })).some((template) => {
    if (template.patternSignature === signature) return false;
    const expected = template.definition.expectedTypeIds;
    if (expected.length && !(typeKey && expected.includes(typeKey))) return false;
    const theirs = new Set(fieldKeys(template.definition).map((entry) => entry.split(":")[0]!));
    return [...mine].every((key) => theirs.has(key)) || ([...theirs].every((key) => mine.has(key)) && mine.size - theirs.size <= 1);
  });
  if (covered) return "skipped";
  const result = await repository.observePattern({
    patternSignature: signature,
    sourceDocumentId: job.objectId,
    sourceRevisionId: job.inputRevisionId,
    observedDate,
    typeKey,
    features: { kind: "confirmed_analysis_fields_v1", fields: fields.map((field) => ({ key: field.key, valueKind: field.value_kind })) },
    candidateDefinition: definition,
    similarity: 1,
    sourceModel: source.model_id,
    promptVersion: source.prompt_version,
  }, input.now);
  return result.generated ? "generated" : "observed";
}
