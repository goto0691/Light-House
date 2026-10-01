import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", async (original) => ({
  ...await original<typeof import("@/lib/v2/auth/restricted-grant")>(), getActiveRestrictedGrant: harness.grant,
}));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("SSR_NOT_FOUND"); } }));
// Exercise actual page/repository SQL and the props crossing its client boundary.
// Client rendering and actual browser RSC transport belong to root's UI checks.
vi.mock("@/components/v2/editor/editor-recovery-policy", () => ({ EditorRecoveryPolicy: () => null }));
vi.mock("@/components/v2/restricted-unlock", () => ({ RestrictedUnlock: () => null }));
vi.mock("@/components/v2/record-link-analysis", () => ({ RecordLinkAnalysis: () => null }));
vi.mock("@/components/v2/record-lifecycle-actions", () => ({ RecordLifecycleActions: () => null }));
vi.mock("@/components/v2/record-knowledge", () => ({ RecordKnowledge: () => null, RecordTypeBadge: () => null }));
vi.mock("@/components/v2/record-source-materials", () => ({ RecordSourceMaterials: () => null }));
vi.mock("@/components/v2/record-search-location", () => ({ RecordSearchLocation: () => null }));

import recordPage from "@/app/v2/records/[recordId]/page";
import { RecordKnowledge } from "@/components/v2/record-knowledge";
import { prepareCaptureCommit, type CapturePrivacyLevel, type PreparedCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";
import { LinkMemoryD1 } from "./link-presentation-fixture";

const now = "2026-09-22T12:30:00.000Z";
const metric = 424242;
let db: LinkMemoryD1;
beforeEach(() => {
  db = new LinkMemoryD1(32); vi.stubGlobal("React", React);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "0"); vi.stubEnv("FLAG_V2_AI", "0");
  harness.session.mockResolvedValue({ sessionId: "module-audit", userId: "link-owner", expiresAt: Date.now() + 120_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

async function seedRecord(privacy: CapturePrivacyLevel = "normal", title = "Synthetic module record", bodyMarkdown = "SYNTHETIC ORIGINAL BODY") {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title,
    bodyMarkdown, aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: privacy, capturedAt: now,
  }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  return capture;
}
async function seedWorkout(privacy: CapturePrivacyLevel = "normal") {
  const capture = await seedRecord(privacy);
  db.sql.prepare(`insert into v2_type_definitions(id,user_id,key,label,applies_to_kind,status,origin,definition,created_at,updated_at)
    values ('workout-type','link-owner','workout','운동','document','active','user_created','audit',?,?)`).run(now, now);
  db.sql.prepare(`insert into v2_object_type_assignments(id,user_id,object_id,type_definition_id,role,source_class,review_status,created_at,updated_at)
    values ('workout-assignment','link-owner',?,'workout-type','primary','user','accepted',?,?)`).run(capture.objectId, now, now);
  for (const [key, numeric] of [["distance", metric], ["duration", 3600]] as const) {
    db.sql.prepare(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
      values (?,'link-owner',?,?,'audit','decimal','active','user_created',?,?)`).run(`field-${key}`, key, key, now, now);
    db.sql.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,created_at)
      values (?,'link-owner',?,?,'number',?,'null','user_explicit','low','accepted',?)`).run(`property-${key}`, capture.objectId, `field-${key}`, numeric, now);
    db.sql.prepare(`insert into v2_evidence_refs(id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
      values (?,'link-owner','property_value',?,?,'text_span',?,?)`).run(`evidence-${key}`, `property-${key}`, capture.sources[0].id, JSON.stringify({ start: 0, end: 9 }), now);
  }
  return capture;
}
function addMapping(capture: PreparedCaptureCommit, status: string) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_legacy_source_envelopes(id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
    values (?,'link-owner','notes',?,'{}',?,?,'audit','[]','module-audit')`).run(id, id, id, now);
  db.sql.prepare(`insert into v2_legacy_source_mappings(id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,created_at)
    values (?,'link-owner',?,'notes',?,'audit-v1',?,?,'document',?,?)`).run(id, id, id, capture.sources[0].id, capture.objectId, status, now);
}
function connect(source: PreparedCaptureCommit, target: PreparedCaptureCommit) {
  db.sql.prepare(`insert or ignore into v2_predicate_definitions(id,user_id,key,label,definition,status,origin,created_at,updated_at)
    values ('related','link-owner','related_to','관련','audit','active','user_created',?,?)`).run(now, now);
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_relation_edges(id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,created_at)
    values (?,'link-owner',?,'related',?,'user_explicit','low','accepted',?)`).run(id, source.objectId, target.objectId, now);
  db.sql.prepare(`insert into v2_evidence_refs(id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
    values (?,'link-owner','relation',?,?,'text_span',?,?)`).run(`e-${id}`, id, target.sources[0].id, JSON.stringify({ start: 0, end: 24 }), now);
  return id;
}
function render(recordId: string) { return recordPage({ params: Promise.resolve({ recordId }), searchParams: Promise.resolve({}) }); }
function knowledge(node: unknown): RecordKnowledgePresentation[] {
  if (Array.isArray(node)) return node.flatMap(knowledge);
  if (!React.isValidElement<{ children?: unknown; presentation?: RecordKnowledgePresentation; presentationJson?: string }>(node)) return [];
  if (node.type === RecordKnowledge) {
    if (typeof node.props.presentationJson === "string") return [JSON.parse(node.props.presentationJson) as RecordKnowledgePresentation];
    if (node.props.presentation) return [node.props.presentation];
  }
  return knowledge(node.props.children);
}
function serialized(node: unknown) { return JSON.stringify(node, (key, value) => key === "type" || key === "_owner" ? undefined : value); }
function assertEmpty(presentation: RecordKnowledgePresentation) {
  expect(presentation).toMatchObject({ highlights: [], sections: [], connections: [], modules: [], reviewItems: [] });
  expect(serialized(presentation)).not.toContain(String(metric));
}
function assertRedacted(presentation: RecordKnowledgePresentation) {
  expect(presentation.modules).toEqual([expect.objectContaining({ moduleKey: "workout.metrics.v1", previewPolicy: "redacted", fields: [], sourceLabels: [] })]);
  expect(serialized(presentation.modules)).not.toContain(String(metric));
  expect(serialized(presentation.modules)).not.toContain("SYNTHETIC");
  expect(presentation.sections.flatMap((section) => section.fields)).toEqual(expect.arrayContaining([expect.objectContaining({ fieldKey: "distance", value: metric })]));
}

test("normal repository projection retains registered module metrics and field evidence", async () => {
  const capture = await seedWorkout();
  const presentation = await new D1PresentationRepository(db, "link-owner").project(capture.objectId);
  expect(presentation.modules).toEqual([expect.objectContaining({ moduleKey: "workout.metrics.v1", previewPolicy: "full", fields: expect.arrayContaining([
    expect.objectContaining({ fieldKey: "distance", value: metric, evidence: [expect.objectContaining({ quote: "SYNTHETIC" })] }),
  ]) })]);
});
test("sensitive repository module carries redacted data, not merely a redacted display flag", async () => {
  const capture = await seedWorkout("sensitive");
  assertRedacted(await new D1PresentationRepository(db, "link-owner").project(capture.objectId));
});
test("actual sensitive SSR keeps generic fields while its module client props contain no metric values or evidence", async () => {
  const capture = await seedWorkout("sensitive");
  const tree = await render(capture.objectId);
  assertRedacted(knowledge(tree).find((item) => item.sections.length)!);
  expect(serialized(tree)).toContain("SYNTHETIC ORIGINAL BODY");
});
test("false locked argument does not itself authorize a restricted repository read", async () => {
  const capture = await seedWorkout("restricted");
  assertEmpty(await new D1PresentationRepository(db, "link-owner").project(capture.objectId, false));
});
test("an explicitly locked repository projection does not execute content SQL", async () => {
  const capture = await seedWorkout("restricted");
  const read = vi.fn(); db.afterRead = read;
  assertEmpty(await new D1PresentationRepository(db, "link-owner").project(capture.objectId, true));
  expect(read).not.toHaveBeenCalled();
});
test("trusted restricted unlock opens generic fields but never the active workout preview module", async () => {
  const capture = await seedWorkout("restricted");
  const projection = await new D1PresentationRepository(db, "link-owner").project(capture.objectId, false, { restrictedUnlocked: true });
  expect(projection.sections.flatMap((section) => section.fields).map((field) => field.value)).toContain(metric);
  expect(projection.modules).toEqual([]);
});
test("actual locked SSR sends neither module props nor record content without a grant", async () => {
  const capture = await seedWorkout("restricted"), tree = await render(capture.objectId);
  expect(knowledge(tree)).toEqual([]);
  expect(serialized(tree)).not.toContain(String(metric));
  expect(serialized(tree)).not.toContain("SYNTHETIC ORIGINAL BODY");
});
test("actual unlocked restricted SSR passes the trusted grant for fields but not workout preview", async () => {
  const capture = await seedWorkout("restricted");
  harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 120_000).toISOString() });
  const tree = await render(capture.objectId), presentations = knowledge(tree);
  expect(serialized(tree)).toContain(String(metric));
  expect(presentations.flatMap((item) => item.modules)).toEqual([]);
  expect(serialized(tree)).toContain("SYNTHETIC ORIGINAL BODY");
});
test.each(["cross_owner", "absent", "wrong_revision", "hidden_legacy", "orphan_legacy"] as const)("repository and actual SSR refuse %s subjects", async (kind) => {
  const capture = await seedWorkout();
  let owner = "link-owner", recordId = capture.objectId;
  if (kind === "cross_owner") { owner = "link-other"; harness.session.mockResolvedValue({ userId: owner, sessionId: "other" }); }
  if (kind === "absent") recordId = "absent-record";
  if (kind === "wrong_revision") {
    const other = await seedRecord();
    db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(other.revisionId, capture.objectId);
  }
  if (kind === "hidden_legacy") addMapping(capture, "preserved");
  if (kind === "orphan_legacy") db.sql.prepare("update v2_capture_bundles set draft_id=? where id=?").run(`legacy:orphan:${capture.captureId}`, capture.captureId);
  assertEmpty(await new D1PresentationRepository(db, owner).project(recordId));
  await expect(render(recordId)).rejects.toThrow("SSR_NOT_FOUND");
});
test("projected legacy subjects remain readable with the same registered module", async () => {
  const capture = await seedWorkout(); addMapping(capture, "projected");
  const tree = await render(capture.objectId);
  expect(knowledge(tree).flatMap((item) => item.modules).map((item) => item.moduleKey)).toEqual(["workout.metrics.v1"]);
});
test("trash detail remains readable; active-only collection filtering is not imported into record privacy checks", async () => {
  const capture = await seedWorkout();
  db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(capture.objectId);
  expect(serialized(await render(capture.objectId))).toContain("SYNTHETIC ORIGINAL BODY");
});
test.each(["privacy", "version", "owner", "legacy"] as const)("repository does not release gathered metrics after a late %s change", async (change) => {
  const capture = await seedWorkout(); let fired = false;
  db.afterRead = (query) => {
    if (fired || !query.includes("from v2_review_items")) return;
    fired = true;
    if (change === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(capture.objectId);
    if (change === "version") db.sql.prepare("update v2_documents set current_version=current_version+1 where object_id=?").run(capture.objectId);
    if (change === "owner") db.sql.prepare("update v2_objects set user_id='link-other' where id=?").run(capture.objectId);
    if (change === "legacy") addMapping(capture, "preserved");
  };
  assertEmpty(await new D1PresentationRepository(db, "link-owner").project(capture.objectId));
  expect(fired).toBe(true);
});
test.each([false, true])("restricted connection target title/evidence never enters actual SSR summary even with grant=%s", async (grant) => {
  const source = await seedWorkout(), target = await seedRecord("restricted", "RESTRICTED TARGET SENTINEL"); connect(source, target);
  if (grant) harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 120_000).toISOString() });
  const tree = await render(source.objectId);
  expect(knowledge(tree).flatMap((item) => item.connections)).toEqual([]);
  expect(serialized(tree)).not.toContain("RESTRICTED TARGET SENTINEL");
});
test("normal connection targets remain summarized with their own source evidence", async () => {
  const source = await seedWorkout(), target = await seedRecord("normal", "NORMAL TARGET SENTINEL"); connect(source, target);
  const presentation = await new D1PresentationRepository(db, "link-owner").project(source.objectId);
  expect(presentation.connections).toEqual([expect.objectContaining({ targetLabel: "NORMAL TARGET SENTINEL", evidence: [expect.objectContaining({ sourceItemId: target.sources[0].id })] })]);
});
test.each(["owner", "legacy", "deleted"] as const)("connection targets still obey existing %s boundaries", async (change) => {
  const source = await seedWorkout(), target = await seedRecord("normal", "HIDDEN TARGET SENTINEL"); connect(source, target);
  if (change === "owner") db.sql.prepare("update v2_objects set user_id='link-other' where id=?").run(target.objectId);
  if (change === "legacy") addMapping(target, "preserved");
  if (change === "deleted") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(target.objectId);
  const tree = await render(source.objectId);
  expect(knowledge(tree).flatMap((item) => item.connections)).toEqual([]);
  expect(serialized(tree)).not.toContain("HIDDEN TARGET SENTINEL");
});
test("a connection target becoming restricted after its row read is not released through actual SSR", async () => {
  const source = await seedWorkout(), target = await seedRecord("normal", "LATE RESTRICTED TARGET SENTINEL"); connect(source, target);
  let fired = false;
  db.afterRead = (query) => {
    if (fired || !query.includes("from v2_relation_edges r join")) return;
    fired = true;
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(target.objectId);
  };
  const tree = await render(source.objectId);
  expect(fired).toBe(true);
  expect(knowledge(tree).flatMap((item) => item.connections)).toEqual([]);
  expect(serialized(tree)).not.toContain("LATE RESTRICTED TARGET SENTINEL");
});
test("a mutable caller option cannot grant a restricted read after the asynchronous lookup begins", async () => {
  const capture = await seedWorkout("restricted");
  const options = { restrictedUnlocked: false }; let fired = false;
  db.afterRead = () => { fired = true; options.restrictedUnlocked = true; };
  assertEmpty(await new D1PresentationRepository(db, "link-owner").project(capture.objectId, false, options));
  expect(fired).toBe(true);
});
test.each(["retarget", "target_label", "predicate_key", "predicate_label", "source_class", "target_revision", "target_capture_owner"] as const)(
  "the final connection tuple rejects a late %s change without replaying the old DTO", async (change) => {
    const source = await seedWorkout(), target = await seedRecord("normal", "OLD TARGET SENTINEL");
    const replacement = await seedRecord("normal", "NEW TARGET SENTINEL"), relationId = connect(source, target);
    let fired = false;
    db.afterRead = (query) => {
      if (fired || !query.includes("from v2_relation_edges r join")) return;
      fired = true;
      if (change === "retarget") {
        db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(target.objectId);
        db.sql.prepare("update v2_relation_edges set object_object_id=? where id=?").run(replacement.objectId, relationId);
      }
      if (change === "target_label") db.sql.prepare("update v2_documents set title='RENAMED TARGET' where object_id=?").run(target.objectId);
      if (change === "predicate_key") db.sql.prepare("update v2_predicate_definitions set key='changed_predicate' where id='related'").run();
      if (change === "predicate_label") db.sql.prepare("update v2_predicate_definitions set label='변경한 관계' where id='related'").run();
      if (change === "source_class") db.sql.prepare("update v2_relation_edges set source_class='ai_inferred' where id=?").run(relationId);
      if (change === "target_revision") db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(replacement.revisionId, target.objectId);
      if (change === "target_capture_owner") db.sql.prepare("update v2_capture_bundles set user_id='link-other' where id=?").run(target.captureId);
    };
    const tree = await render(source.objectId);
    expect(fired).toBe(true);
    expect(knowledge(tree).flatMap((item) => item.connections)).toEqual([]);
    expect(serialized(tree)).not.toContain("OLD TARGET SENTINEL");
    expect(knowledge(tree).flatMap((item) => item.modules)).toHaveLength(1);
  },
);
test("changing the subject revision ID without its version still closes an already gathered module projection", async () => {
  const capture = await seedWorkout(), nextRevisionId = crypto.randomUUID();
  db.sql.prepare(`insert into v2_document_revisions(id,document_object_id,parent_revision_id,body_markdown,content_hash,author_kind,change_reason,created_at,revision_number)
    values (?,?,?,'NEW SYNTHETIC BODY','new-audit-hash','user','audit',?,2)`).run(nextRevisionId, capture.objectId, capture.revisionId, now);
  let fired = false;
  db.afterRead = (query) => {
    if (fired || !query.includes("from v2_review_items")) return;
    fired = true;
    db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(nextRevisionId, capture.objectId);
  };
  assertEmpty(await new D1PresentationRepository(db, "link-owner").project(capture.objectId));
  expect(fired).toBe(true);
});
test("actual record SSR places the canonical body before the first knowledge or context module component", async () => {
  const capture = await seedWorkout(), tree = await render(capture.objectId), order: string[] = [];
  function visit(node: unknown): void {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!React.isValidElement<{ children?: unknown; className?: string; presentationJson?: string }>(node)) return;
    if (node.type === "pre" && node.props.className === "v2-record-markdown") order.push("body");
    if (node.type === RecordKnowledge) {
      expect(node.props.presentationJson).toEqual(expect.any(String));
      order.push("knowledge");
    }
    visit(node.props.children);
  }
  visit(tree);
  expect(knowledge(tree).flatMap((item) => item.modules)).toHaveLength(1);
  expect(order[0]).toBe("body");
  expect(order.indexOf("knowledge")).toBeGreaterThan(order.indexOf("body"));
});
test("an otherwise public connection cannot quote a third restricted document's evidence source", async () => {
  const source = await seedWorkout(), target = await seedRecord("normal", "VISIBLE TARGET");
  const hidden = await seedRecord("restricted", "HIDDEN EVIDENCE DOCUMENT", "RESTRICTED EVIDENCE SENTINEL"), relationId = connect(source, target);
  // The owner/FK-valid reference could predate a privacy change or arrive through
  // an import; target visibility alone is not authority over this source.
  db.sql.prepare("update v2_evidence_refs set source_item_id=?,locator_json=? where target_kind='relation' and target_id=?")
    .run(hidden.sources[0].id, JSON.stringify({ start: 0, end: 100 }), relationId);
  const tree = await render(source.objectId), connections = knowledge(tree).flatMap((item) => item.connections);
  expect(connections.map((item) => item.targetLabel)).toContain("VISIBLE TARGET");
  expect(serialized(connections)).not.toContain("RESTRICTED EVIDENCE SENTINEL");
  expect(serialized(connections)).not.toContain(hidden.sources[0].id);
});

function allFields(presentation: RecordKnowledgePresentation) {
  return [...presentation.highlights, ...presentation.sections.flatMap((section) => section.fields),
    ...presentation.modules.flatMap((module) => module.fields), ...presentation.reviewItems.flatMap((item) => item.field ? [item.field] : [])];
}
function pointMetricEvidenceTo(capture: PreparedCaptureCommit) {
  db.sql.prepare("update v2_evidence_refs set source_item_id=?,locator_json=? where id='evidence-distance'")
    .run(capture.sources[0].id, JSON.stringify({ start: 0, end: 100 }));
}
function attachMetricReview(capture: PreparedCaptureCommit) {
  db.sql.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at)
    values ('audit-job','link-owner',?,?,'analyze','succeeded','audit-job',3,?,?,'audit',?)`).run(capture.captureId, capture.objectId, now, capture.revisionId, now);
  db.sql.prepare(`insert into v2_processing_runs(id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
    values ('audit-run','audit-job','link-owner','structured','fake','p','s','r','m','audit','succeeded',?)`).run(now);
  db.sql.prepare("update v2_property_values set proposal_temp_id='metric',processing_run_id='audit-run' where id='property-distance'").run();
  db.sql.prepare(`insert into v2_review_items(id,user_id,object_id,processing_run_id,kind,payload_json,created_at)
    values ('audit-review','link-owner',?,'audit-run','analysis_review','{"proposalTempId":"metric"}',?)`).run(capture.objectId, now);
}
test.each(["normal", "sensitive"] as const)("property evidence from an owned canonical %s source retains its quote", async (privacy) => {
  const subject = await seedWorkout(), source = await seedRecord(privacy, "Evidence source", "ALLOWED EVIDENCE SENTINEL"); pointMetricEvidenceTo(source);
  const projection = await new D1PresentationRepository(db, "link-owner").project(subject.objectId);
  const fields = allFields(projection).filter((field) => field.fieldKey === "distance");
  expect(fields).toHaveLength(3);
  for (const field of fields) expect(field.evidence).toEqual([expect.objectContaining({ sourceItemId: source.sources[0].id, quote: "ALLOWED EVIDENCE SENTINEL" })]);
});
test.each([false, true])("third restricted source is excluded from highlights, sections, modules and review fields with trusted unlock=%s", async (restrictedUnlocked) => {
  const subject = await seedWorkout(), source = await seedRecord("restricted", "Hidden evidence", "THIRD RESTRICTED PROPERTY SENTINEL");
  pointMetricEvidenceTo(source); attachMetricReview(subject);
  const projection = await new D1PresentationRepository(db, "link-owner").project(subject.objectId, false, { restrictedUnlocked });
  const fields = allFields(projection).filter((field) => field.fieldKey === "distance");
  expect(fields).toHaveLength(4);
  for (const field of fields) expect(field).toMatchObject({ value: metric, evidence: [] });
  expect(serialized(projection)).not.toContain("THIRD RESTRICTED PROPERTY SENTINEL");
  expect(serialized(projection)).not.toContain(source.sources[0].id);
});
test("authorized restricted subjects retain their own source evidence without enabling a context module", async () => {
  const subject = await seedWorkout("restricted");
  const projection = await new D1PresentationRepository(db, "link-owner").project(subject.objectId, false, { restrictedUnlocked: true });
  const fields = allFields(projection).filter((field) => field.fieldKey === "distance");
  expect(fields).toHaveLength(2);
  for (const field of fields) expect(field.evidence).toEqual([expect.objectContaining({ sourceItemId: subject.sources[0].id, quote: "SYNTHETIC" })]);
  expect(projection.modules).toEqual([]);
});
test.each(["source_owner", "capture_owner", "document_owner", "legacy_mapping", "legacy_orphan", "canonical_revision", "missing_document"] as const)(
  "property evidence with invalid %s authority is omitted without deleting its generic value", async (change) => {
    const subject = await seedWorkout(), source = await seedRecord("normal", "Broken evidence", "BROKEN EVIDENCE SENTINEL"); pointMetricEvidenceTo(source);
    if (change === "source_owner") db.sql.prepare("update v2_source_items set user_id='link-other' where id=?").run(source.sources[0].id);
    if (change === "capture_owner") db.sql.prepare("update v2_capture_bundles set user_id='link-other' where id=?").run(source.captureId);
    if (change === "document_owner") db.sql.prepare("update v2_objects set user_id='link-other' where id=?").run(source.objectId);
    if (change === "legacy_mapping") addMapping(source, "preserved");
    if (change === "legacy_orphan") db.sql.prepare("update v2_capture_bundles set draft_id=? where id=?").run(`legacy:evidence:${source.captureId}`, source.captureId);
    if (change === "canonical_revision") db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(subject.revisionId, source.objectId);
    if (change === "missing_document") db.sql.prepare("delete from v2_documents where object_id=?").run(source.objectId);
    const projection = await new D1PresentationRepository(db, "link-owner").project(subject.objectId);
    const fields = allFields(projection).filter((field) => field.fieldKey === "distance");
    expect(fields).toHaveLength(3);
    for (const field of fields) expect(field).toMatchObject({ value: metric, evidence: [] });
    expect(serialized(projection)).not.toContain("BROKEN EVIDENCE SENTINEL");
    expect(serialized(projection)).not.toContain(source.sources[0].id);
  },
);
test.each(["property", "relation"] as const)("a late %s evidence source privacy change removes the already read quote", async (kind) => {
  const subject = await seedWorkout(), source = await seedRecord("normal", "Late evidence", "LATE EVIDENCE SENTINEL");
  let targetId = "property-distance";
  if (kind === "property") pointMetricEvidenceTo(source);
  else {
    const target = await seedRecord(), relationId = connect(subject, target);
    targetId = relationId;
    db.sql.prepare("update v2_evidence_refs set source_item_id=?,locator_json=? where target_kind='relation' and target_id=?")
      .run(source.sources[0].id, JSON.stringify({ start: 0, end: 100 }), relationId);
  }
  let fired = false;
  // Both evidence kinds now share the same SQL. Observe the actual bound target
  // instead of a query-text discriminator or an incidental read ordinal.
  const binding: D1DatabaseBinding = {
    prepare(query) {
      let statement: D1PreparedStatementBinding = db.prepare(query), values: unknown[] = [];
      const wrapped: D1PreparedStatementBinding = {
        bind(...input) { values = input; statement = statement.bind(...input); return wrapped; },
        first: <T>() => statement.first<T>(), run: () => statement.run(),
        async all<T>() {
          const result = await statement.all<T>();
          if (!fired && query.includes("from v2_evidence_refs e") && values[1] === (kind === "property" ? "property_value" : "relation") && values[2] === targetId) {
            fired = true;
            db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(source.objectId);
          }
          return result;
        },
      };
      return wrapped;
    },
    batch: <T>(statements: D1PreparedStatementBinding[]) => db.batch<T>(statements),
  };
  const projection = await new D1PresentationRepository(binding, "link-owner").project(subject.objectId);
  expect(fired).toBe(true);
  expect(serialized(projection)).not.toContain("LATE EVIDENCE SENTINEL");
  expect(serialized(projection)).not.toContain(source.sources[0].id);
});
test.each(["source_id", "locator_kind", "locator_json", "target_kind", "target_id", "deleted"] as const)(
  "a late evidence %s replacement cannot authorize the old quote using only its row ID", async (change) => {
    const subject = await seedWorkout(), source = await seedRecord("normal", "Old evidence", "OLD EVIDENCE SENTINEL"), replacement = await seedRecord();
    pointMetricEvidenceTo(source); let fired = false;
    db.afterRead = (query) => {
      if (fired || !query.includes("from v2_review_items")) return;
      fired = true;
      if (change === "source_id") {
        db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(source.objectId);
        db.sql.prepare("update v2_evidence_refs set source_item_id=? where id='evidence-distance'").run(replacement.sources[0].id);
      }
      if (change === "locator_kind") db.sql.prepare("update v2_evidence_refs set locator_kind='image_region' where id='evidence-distance'").run();
      if (change === "locator_json") db.sql.prepare("update v2_evidence_refs set locator_json='{}' where id='evidence-distance'").run();
      if (change === "target_kind") db.sql.prepare("update v2_evidence_refs set target_kind='relation' where id='evidence-distance'").run();
      if (change === "target_id") db.sql.prepare("update v2_evidence_refs set target_id='another-property' where id='evidence-distance'").run();
      if (change === "deleted") db.sql.prepare("delete from v2_evidence_refs where id='evidence-distance'").run();
    };
    const projection = await new D1PresentationRepository(db, "link-owner").project(subject.objectId);
    expect(fired).toBe(true);
    const fields = allFields(projection).filter((field) => field.fieldKey === "distance");
    expect(fields).toHaveLength(3);
    for (const field of fields) expect(field.evidence).toEqual([]);
    expect(serialized(projection)).not.toContain("OLD EVIDENCE SENTINEL");
  },
);
test("source-less external citations retain their established locator contract", async () => {
  const subject = await seedWorkout();
  db.sql.prepare("update v2_evidence_refs set source_item_id=null,locator_kind='external_url',locator_json=? where id='evidence-distance'")
    .run(JSON.stringify({ url: "https://example.test/citation", title: "Public source" }));
  const projection = await new D1PresentationRepository(db, "link-owner").project(subject.objectId);
  for (const field of allFields(projection).filter((field) => field.fieldKey === "distance")) expect(field.evidence).toEqual([
    expect.objectContaining({ sourceItemId: null, locatorKind: "external_url", quote: null, locator: { url: "https://example.test/citation", title: "Public source" } }),
  ]);
});
test.each(["null", "[]", "17", "{malformed"])("a non-object evidence locator %s cannot crash canonical record rendering", async (locator) => {
  const subject = await seedWorkout();
  db.sql.prepare("update v2_evidence_refs set locator_json=? where id='evidence-distance'").run(locator);
  const tree = await render(subject.objectId), projection = knowledge(tree)[0];
  expect(serialized(tree)).toContain("SYNTHETIC ORIGINAL BODY");
  for (const field of allFields(projection).filter((field) => field.fieldKey === "distance")) expect(field.evidence).toEqual([
    expect.objectContaining({ sourceItemId: subject.sources[0].id, locator: {}, quote: null }),
  ]);
});
test("evidence identity preserves a valid raw locator's whitespace without comparing a reserialized variant", async () => {
  const subject = await seedWorkout();
  db.sql.prepare("update v2_evidence_refs set locator_json=? where id='evidence-distance'").run('{ "end" : 9, "start" : 0 }');
  const projection = await new D1PresentationRepository(db, "link-owner").project(subject.objectId);
  for (const field of allFields(projection).filter((field) => field.fieldKey === "distance")) expect(field.evidence).toEqual([
    expect.objectContaining({ locator: { end: 9, start: 0 }, quote: "SYNTHETIC" }),
  ]);
});
