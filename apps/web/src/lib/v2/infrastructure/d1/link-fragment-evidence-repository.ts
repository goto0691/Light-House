import { LINK_ANALYSIS_CONTRACT, LINK_ANALYSIS_LIMITS, LINK_ANALYSIS_PROMPT_VERSION, LINK_ANALYSIS_ROLES, prepareLinkAnalysis } from "@/lib/v2/ai/link-analysis-v1";
import { LINK_FRAGMENT_EVIDENCE_CONTRACT, type LinkFragmentEvidenceV1 } from "@/lib/v2/domain/link-fragment-evidence-v1";
import type { PresentedLinkEvidence, PresentedLinkFragment } from "@/lib/v2/domain/link-presentation-v1";
import { canonicalLinkJson, linkSha256Hex, LinkSnapshotError } from "@/lib/v2/domain/link-snapshot-v1";
import { promptCurationId } from "@/lib/v2/domain/prompt-curation-request";
import { legacyProjectionVisibilityPredicate } from "./legacy-projection-visibility";
import { D1LinkSnapshotRepository } from "./link-snapshot-repository";
import { curationCatalogFence, loadCurationMigrationTargetProof, type CurationCatalogProof } from "./prompt-curation-catalog";
import type { D1DatabaseBinding } from "./source-commit-repository";

type Access = Readonly<{ snapshotId: string; manifestHash: string; restrictedGrantExpiresAt?: string }>;
type Row = { capture_id: string; current_revision_id: string; current_version: number; privacy_level: string;
  current_link_snapshot_id: string | null; published_link_run_id: string | null; source_integrity: number;
  fragment_json: string; run_json: string; evidence_json: string };
type FragmentRow = { id: string | null; snapshot_id: string; processing_run_id: string; primary_member_id: string; fragment_key: string;
  role: PresentedLinkFragment["role"]; source_class: PresentedLinkFragment["sourceClass"]; text_start: number | null; text_end: number | null;
  raw_text: string | null; raw_text_hash: string | null; derived_text: string | null; details_json: string; completeness: string;
  review_status: PresentedLinkFragment["reviewStatus"]; locked_by_user: number; state_version: number; display_order: number; created_at: string };
type RunRow = { id: string; job_id: string; model_role: string; prompt_version: string; schema_version: string; input_hash: string; status: string; created_at: string; finished_at: string;
  job_user: string; job_capture: string; job_record: string; job_stage: string; job_status: string; job_hash: string;
  input_revision_id: string; input_link_snapshot_id: string; input_source_manifest_hash: string; input_source_manifest_version: string; original_revision_id: string | null };
type EvidenceRow = { id: string; user_id: string; member_id: string; relation_kind: string; evidence_method: string; text_start: number; text_end: number;
  image_region_json: string | null; start_seconds: number | null; end_seconds: number | null; display_order: number; locked_by_user: number; state_version: number; created_at: string };
const fragmentColumns = ["id", "snapshot_id", "processing_run_id", "primary_member_id", "fragment_key", "role", "source_class", "text_start", "text_end", "raw_text", "raw_text_hash", "derived_text", "details_json", "completeness", "review_status", "locked_by_user", "state_version", "display_order", "created_at"];
const runColumns = ["id", "job_id", "model_role", "prompt_version", "schema_version", "input_hash", "status", "created_at", "finished_at"];
const evidenceColumns = ["id", "user_id", "member_id", "relation_kind", "evidence_method", "text_start", "text_end", "image_region_json", "start_seconds", "end_seconds", "display_order", "locked_by_user", "state_version", "created_at"];
const jsonColumns = (alias: string, names: readonly string[]) => names.map((name) => `'${name}',${alias}.${name}`).join(",");
function fail(code: string, message: string): never { throw new LinkSnapshotError(code, message); }
function invalid(): never { return fail("link_fragment_evidence_integrity_invalid", "보관한 분석 조각의 원문·실행·근거 연결을 확인하지 못했습니다."); }
function unlocked(expiry?: string) { return typeof expiry === "string" && Date.parse(expiry) > Date.now(); }

/** Direct-ID reads only. No history scan, publication, source acquisition or model invocation. */
export class D1LinkFragmentEvidenceRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async read(recordId: string, fragmentId: string, access: Access, proof?: CurationCatalogProof): Promise<Row> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db.prepare(`select d.capture_id,d.current_revision_id,d.current_version,d.privacy_level,d.current_link_snapshot_id,d.published_link_run_id,
      ${proof ? curationCatalogFence() : "1"} as source_integrity,
      json_object(${jsonColumns("f", fragmentColumns)}) as fragment_json,
      json_object(${jsonColumns("r", runColumns)},'job_user',j.user_id,'job_capture',j.capture_id,'job_record',j.object_id,'job_stage',j.stage,'job_status',j.status,'job_hash',j.input_hash,
        'input_revision_id',j.input_revision_id,'input_link_snapshot_id',j.input_link_snapshot_id,'input_source_manifest_hash',j.input_source_manifest_hash,
        'input_source_manifest_version',j.input_source_manifest_version,'original_revision_id',original.id) as run_json,
      case when (select count(*) from v2_link_fragment_evidence where fragment_id=f.id)<=16 then
        (select json_group_array(json_object(${jsonColumns("e", evidenceColumns)}) order by e.display_order,e.id) from v2_link_fragment_evidence e where e.fragment_id=f.id)
        else 'null' end as evidence_json
      from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions current on current.id=d.current_revision_id and current.document_object_id=d.object_id
      left join v2_link_fragments f on f.id=? and f.user_id=o.user_id and f.document_object_id=d.object_id and f.snapshot_id=?
      left join v2_processing_runs r on r.id=f.processing_run_id and r.user_id=o.user_id
      left join v2_processing_jobs j on j.id=r.job_id
      left join v2_document_revisions original on original.id=j.input_revision_id and original.document_object_id=d.object_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility} limit 1`)
      .bind(...(proof ? [canonicalLinkJson([proof])] : []), fragmentId, access.snapshotId, recordId, this.userId).first<Row>();
    if (!row) return fail("link_record_not_found", "접근할 수 있는 기록을 찾지 못했습니다.");
    // Keep the grant live after the final database await; do not capture a boolean.
    if (row.privacy_level === "restricted" && !unlocked(access.restrictedGrantExpiresAt)) return fail("restricted_record_locked", "분석 근거를 열려면 제한된 기록을 다시 인증해 주세요.");
    if (row.source_integrity !== 1) invalid();
    return row;
  }

  async get(recordId: string, fragmentId: string, options: Access): Promise<LinkFragmentEvidenceV1> {
    let access: Access;
    try {
      promptCurationId(recordId); promptCurationId(fragmentId); promptCurationId(options.snapshotId);
      if (typeof options.manifestHash !== "string" || !/^[a-f0-9]{64}$/.test(options.manifestHash)) throw new Error();
      access = Object.freeze({ snapshotId: options.snapshotId, manifestHash: options.manifestHash, restrictedGrantExpiresAt: options.restrictedGrantExpiresAt });
    } catch { return fail("link_fragment_evidence_request_invalid", "기록·조각 ID와 정확한 자료 버전·manifest 해시를 지정해 주세요."); }
    const snapshots = new D1LinkSnapshotRepository(this.db, this.userId);
    if (!await snapshots.isAvailable()) return fail("link_snapshot_schema_unavailable", "링크 분석 근거 저장소가 아직 준비되지 않았습니다.");
    const initial = await this.read(recordId, fragmentId, access);
    const fragment = JSON.parse(initial.fragment_json) as FragmentRow, run = JSON.parse(initial.run_json) as RunRow;
    if (!fragment.id) return fail("link_fragment_not_found", "요청한 자료 버전에 이 조각이 없습니다.");
    if (!run.id || !fragment.processing_run_id) return fail("link_fragment_not_found", "저장된 AI 실행에 연결된 조각만 이 경로에서 조회할 수 있습니다.");
    if (run.input_source_manifest_hash !== access.manifestHash) return fail("link_fragment_evidence_conflict", "요청한 원래 자료 manifest와 분석 실행이 일치하지 않습니다.");
    if (run.job_user !== this.userId || run.job_record !== recordId || run.job_capture !== initial.capture_id || run.job_stage !== "link_analyze"
      || run.input_link_snapshot_id !== access.snapshotId || typeof run.input_revision_id !== "string" || !run.input_revision_id || run.input_revision_id !== run.original_revision_id || run.model_role !== "main_analyzer"
      || run.input_hash !== run.job_hash || !["succeeded", "partial"].includes(run.status) || run.job_status !== "succeeded"
      || typeof run.finished_at !== "string" || !Number.isFinite(Date.parse(run.finished_at))
      || run.schema_version !== LINK_ANALYSIS_CONTRACT || run.prompt_version !== LINK_ANALYSIS_PROMPT_VERSION) invalid();
    const snapshot = await snapshots.getSnapshot(recordId, access.snapshotId, unlocked(access.restrictedGrantExpiresAt)).catch((error: unknown) => {
      // This was an explicitly external source when the run was committed.
      // Missing that marker now is stored-evidence damage, not a server fault.
      // Preserve all unrelated DB/access errors and their existing handling.
      if (error instanceof LinkSnapshotError && error.code === "link_source_not_external") return invalid();
      throw error;
    });
    if (!snapshot) { await this.read(recordId, fragmentId, access); return fail("link_snapshot_not_found", "원래 자료 버전을 확인하지 못했습니다."); }
    if (snapshot.snapshot.manifestHash !== access.manifestHash || snapshot.snapshot.manifestVersion !== run.input_source_manifest_version) invalid();
    // Reuse the full bounded snapshot proof, including attachment membership. It
    // does not create a migration and is never returned to the browser.
    const { proof } = await loadCurationMigrationTargetProof(this.db, this.userId, snapshot);
    const prepared = await prepareLinkAnalysis({ snapshotId: access.snapshotId, documentRevisionId: run.input_revision_id,
      manifestVersion: snapshot.snapshot.manifestVersion, manifestHash: access.manifestHash }, snapshot.members.filter((member) => member.manualLink).map((member) => ({
      memberId: member.id, memberKey: member.memberKey, sourceItemId: member.sourceItemId, rawText: member.rawText, contentHash: member.contentHash, manualLink: member.manualLink!,
    })));
    if (prepared.inputHash !== run.input_hash) invalid();
    const rows = JSON.parse(initial.evidence_json) as EvidenceRow[] | null;
    if (!rows?.length || rows.length > 16 || !LINK_ANALYSIS_ROLES.includes(fragment.role)
      || !["source_extract", "ai_interpretation"].includes(fragment.source_class)
      || !Number.isSafeInteger(fragment.state_version) || fragment.state_version < 1
      || !["proposed", "confirmed", "rejected", "superseded"].includes(fragment.review_status)
      || ![0, 1].includes(fragment.locked_by_user)) invalid();
    let details: { contract?: string; scope?: string } | null;
    try { details = JSON.parse(fragment.details_json); } catch { invalid(); }
    if (!details || details.contract !== LINK_ANALYSIS_CONTRACT || details.scope !== "available_external_text") invalid();
    let evidenceBytes = 0;
    const evidence: PresentedLinkEvidence[] = rows.map((row, index) => {
      const source = prepared.sources.find((member) => member.memberId === row.member_id);
      if (!source?.rawText || row.user_id !== this.userId || row.relation_kind !== "supports" || row.evidence_method !== "ai_proposed"
        || row.image_region_json !== null || row.start_seconds !== null || row.end_seconds !== null || row.display_order !== index
        || ![0, 1].includes(row.locked_by_user) || !Number.isSafeInteger(row.state_version) || row.state_version < 1
        || !Number.isSafeInteger(row.text_start) || !Number.isSafeInteger(row.text_end) || row.text_start < 0 || row.text_start >= row.text_end || row.text_end > source.rawText.length
        || !source.blocks.some((block) => block.start === row.text_start) || !source.blocks.some((block) => block.end === row.text_end)) invalid();
      const quote = source.rawText.slice(row.text_start, row.text_end);
      evidenceBytes += new TextEncoder().encode(quote).byteLength;
      if (evidenceBytes > LINK_ANALYSIS_LIMITS.evidenceTextBytes) invalid();
      return { id: row.id, memberId: row.member_id, memberKey: source.memberKey, sourceItemId: source.sourceItemId,
        relationKind: row.relation_kind, evidenceMethod: row.evidence_method, textStart: row.text_start, textEnd: row.text_end, quote, displayOrder: row.display_order };
    });
    const supplied = rows.map((row) => prepared.sources.find((source) => source.memberId === row.member_id)!.manualLink.completeness);
    const completeness = supplied.includes("ocr_unverified") ? "ocr_unverified" : supplied.includes("partial") ? "truncated" : "selection_unverified";
    if (fragment.completeness !== completeness) invalid();
    if (fragment.primary_member_id !== evidence[0].memberId) invalid();
    if (fragment.source_class === "source_extract") {
      if (rows.length !== 1 || fragment.text_start !== evidence[0].textStart || fragment.text_end !== evidence[0].textEnd
        || fragment.raw_text !== evidence[0].quote || fragment.raw_text === null || fragment.derived_text !== null
        || await linkSha256Hex(fragment.raw_text) !== fragment.raw_text_hash) invalid();
    } else if (fragment.raw_text !== null || fragment.raw_text_hash !== null || fragment.text_start !== null || fragment.text_end !== null
      || typeof fragment.derived_text !== "string" || !["insight", "visual_tip"].includes(fragment.role)) invalid();
    if (new TextEncoder().encode(fragment.raw_text ?? fragment.derived_text ?? "").byteLength > LINK_ANALYSIS_LIMITS.outputTextBytes) invalid();
    const result: LinkFragmentEvidenceV1 = { contract: LINK_FRAGMENT_EVIDENCE_CONTRACT, recordId, snapshotId: access.snapshotId, snapshotManifestHash: access.manifestHash,
      run: { id: run.id, jobId: run.job_id, snapshotId: run.input_link_snapshot_id, documentRevisionId: run.input_revision_id, status: run.status,
        createdAt: run.created_at, finishedAt: run.finished_at, isPublished: initial.published_link_run_id === run.id && initial.current_link_snapshot_id === access.snapshotId && initial.current_revision_id === run.input_revision_id },
      fragment: { id: fragment.id, fragmentKey: fragment.fragment_key, snapshotId: fragment.snapshot_id, runId: fragment.processing_run_id,
        role: fragment.role, sourceClass: fragment.source_class, rawText: fragment.raw_text, rawTextHash: fragment.raw_text_hash, derivedText: fragment.derived_text,
        completeness: fragment.completeness, reviewStatus: fragment.review_status, lockedByUser: fragment.locked_by_user === 1,
        stateVersion: fragment.state_version, displayOrder: fragment.display_order, primaryMemberId: fragment.primary_member_id, evidence } };
    // All returned bytes/run/evidence and all source identities share this final
    // access SQL boundary. There is no digest, row lookup or other await after it.
    const final = await this.read(recordId, fragmentId, access, proof);
    if (canonicalLinkJson(final) !== canonicalLinkJson(initial)) return fail("link_fragment_evidence_conflict", "조회 중 기록 또는 원래 분석 근거가 변경되었습니다. 다시 확인해 주세요.");
    return result;
  }
}
