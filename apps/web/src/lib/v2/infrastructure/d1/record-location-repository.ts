import { readVideoAnalysisSource } from "@/lib/v2/domain/video-analysis-source";
import { videoAnalysisProofSql } from "@/lib/v2/infrastructure/d1/video-analysis-provenance";
import { canonicalLinkJson, LinkSnapshotError, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import { readManualLinkSource } from "@/lib/v2/domain/manual-link-source";
import { analysisExtractionLabel, readAnalysisExtractionSource } from "@/lib/v2/domain/analysis-extraction-source";
import { analysisExtractionProofSql } from "./analysis-extraction-provenance";
import { curationCatalogFence, loadCurationCatalog, loadCurationMigrationTargetProof, type CurationCatalogProof } from "./prompt-curation-catalog";
import { legacyProjectionVisibilityPredicate } from "./legacy-projection-visibility";
import { D1LinkSnapshotRepository, type LinkSnapshotProjection } from "./link-snapshot-repository";
import { D1LinkFragmentEvidenceRepository } from "./link-fragment-evidence-repository";
import { D1ManualLinkFragmentRepository } from "./manual-link-fragment-repository";
import { D1PromptCurationRepository } from "./prompt-curation-repository";
import type { D1DatabaseBinding } from "./source-commit-repository";
import { assertRecordLocationText, parseRecordLocation, RECORD_LOCATION_RESULT_CONTRACT, RecordLocationError,
  recordLocationTextHash, type V2RecordLocationV1, type V2RecordLocationResult } from "@/lib/v2/retrieval/record-location-v1";

type Access = Readonly<{ restrictedGrantExpiresAt?: string }>;
type Frame = { capture_id: string; current_revision_id: string; current_version: number; privacy_level: V2RecordLocationResult["privacyLevel"];
  current_snapshot_id: string | null; published_run_id: string | null; selected_snapshot_version: number | null; material_json: string | null; integrity: number };
type MaterialSql = { sql: string; bindings: unknown[] };
const objectSql = (alias: string, columns: string) => {
  const fields = columns.split(" ");
  // D1 bounds SQL function arguments. Each field consumes a key and value.
  const chunks = Array.from({ length: Math.ceil(fields.length / 16) }, (_, index) =>
    `json_object(${fields.slice(index * 16, index * 16 + 16).map((column) => `'${column}',${alias}.${column}`).join(",")})`);
  return chunks.reduce((left, right) => `json_patch(${left},${right})`);
};
const fragmentColumns = "id user_id document_object_id snapshot_id primary_member_id processing_run_id fragment_key role source_class text_start text_end raw_text raw_text_hash derived_text details_json completeness display_order review_status locked_by_user state_version created_at";
const evidenceColumns = "id user_id fragment_id member_id relation_kind evidence_method text_start text_end image_region_json start_seconds end_seconds display_order locked_by_user state_version created_at";
const revisionColumns = "id user_id document_object_id snapshot_id group_key revision_number parent_revision_id based_on_revision_id change_reason title relation_kind relationship_confirmation order_confirmation status separator manifest_version render_version manifest_json manifest_hash created_at";
const itemColumns = "id user_id curation_revision_id item_key fragment_id copy_role position fragment_state_version";
const exampleColumns = "id user_id curation_revision_id example_key item_id member_id attachment_id position evidence_method";
const live = (expiry?: string) => typeof expiry === "string" && Date.parse(expiry) > Date.now();
function missing(): never { throw new RecordLocationError("record_location_not_found", "이 기록에 속한 정확한 보관 위치를 찾지 못했습니다. 최신 자료로 대체하지 않았습니다."); }
function damaged(): never { throw new RecordLocationError("record_location_integrity_invalid", "보관 위치의 원문·버전·근거 연결을 확인하지 못했습니다."); }
function conflict(): never { throw new RecordLocationError("record_location_conflict", "조회 중 기록 또는 검색 근거가 변경되었습니다. 정확한 위치를 다시 확인해 주세요."); }

/** Same bounded material representation before and after all awaited proof reads.
 * Source scope and access are enforced by the containing frame, never by the URL. */
function materialSql(location: V2RecordLocationV1, linkSchema: boolean): MaterialSql {
  if (location.kind === "document_title" || location.kind === "document_body") return {
    sql: `(select json_object('id',r.id,'body',r.body_markdown,'hash',r.content_hash,'number',r.revision_number,'status',r.revision_status,'title',d.title,
      'reason',r.change_reason,'parent',r.parent_revision_id,'captureHash',c.content_hash,'captureNote',c.user_note)
      from v2_document_revisions r where r.id=? and r.document_object_id=d.object_id)`, bindings: [location.revisionId],
  };
  if (location.kind === "source") return {
    sql: `(select json_object('id',s.id,'kind',s.item_kind,'text',s.raw_text,'hash',s.content_hash,'metadata',s.source_metadata,
      'analysisVerified',case when ${analysisExtractionProofSql()} then 1 else 0 end,
      'videoVerified',case when ${linkSchema ? videoAnalysisProofSql() : "0"} then 1 else 0 end,
      'attachments',(select json_group_array(json_object('attachmentId',a.id,'filename',a.filename,'mimeType',a.mime_type,'hash',a.sha256,'objectKey',a.object_key) order by a.id)
        from v2_source_attachment_links sal join v2_attachment_reservations a on a.id=sal.attachment_id and a.user_id=sal.user_id
        where sal.source_item_id=s.id and sal.user_id=s.user_id and a.status='committed' and a.committed_at is not null))
      from v2_source_items s join v2_document_source_links l on l.source_item_id=s.id and l.document_object_id=d.object_id
      where s.id=? and s.user_id=o.user_id and s.capture_id=d.capture_id)`, bindings: [location.sourceItemId],
  };
  if (location.kind === "manual_fragment" || location.kind === "ai_fragment") return {
    sql: `(select json_object('fragment',${objectSql("f", fragmentColumns)},
      'evidence',(select json_group_array(${objectSql("e", evidenceColumns)} order by e.id) from v2_link_fragment_evidence e where e.fragment_id=f.id),
      'run',(select json_object('run',${objectSql("r", "id user_id job_id model_role prompt_version schema_version input_hash status created_at finished_at")},
        'job',${objectSql("j", "id user_id capture_id object_id stage status input_hash input_revision_id input_link_snapshot_id input_source_manifest_hash input_source_manifest_version")})
        from v2_processing_runs r join v2_processing_jobs j on j.id=r.job_id where r.id=f.processing_run_id))
      from v2_link_fragments f where f.id=? and f.user_id=o.user_id and f.document_object_id=d.object_id and f.snapshot_id=?)`,
    bindings: [location.fragmentId, location.snapshotId],
  };
  if (location.kind !== "curation") return missing();
  return {
    sql: `(select json_object('revision',${objectSql("cr", revisionColumns)},
      'head',(select max(h.revision_number) from v2_link_curation_revisions h where h.user_id=o.user_id and h.document_object_id=d.object_id and h.group_key=cr.group_key),
      'items',(select json_group_array(${objectSql("ci", itemColumns)} order by ci.id) from v2_link_curation_items ci where ci.curation_revision_id=cr.id),
      'examples',(select json_group_array(${objectSql("ce", exampleColumns)} order by ce.id) from v2_link_curation_examples ce where ce.curation_revision_id=cr.id))
      from v2_link_curation_revisions cr where cr.id=? and cr.group_key=? and cr.snapshot_id=? and cr.document_object_id=d.object_id and cr.user_id=o.user_id)`,
    bindings: [location.revisionId, location.groupKey, location.snapshotId],
  };
}

export class D1RecordLocationRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async frame(recordId: string, location: V2RecordLocationV1, expiry: string | undefined, schema: boolean, proofs: readonly CurationCatalogProof[] = []): Promise<Frame> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db), material = materialSql(location, schema);
    const snapshotId = "snapshotId" in location ? location.snapshotId : null;
    const row = await this.db.prepare(`select d.capture_id,d.current_revision_id,d.current_version,d.privacy_level,
      ${schema ? "d.current_link_snapshot_id" : "null"} as current_snapshot_id,${schema ? "d.published_link_run_id" : "null"} as published_run_id,
      ${snapshotId ? "(select s.snapshot_version from v2_link_snapshots s where s.id=? and s.user_id=o.user_id and s.document_object_id=d.object_id and s.capture_id=d.capture_id)" : "null"} as selected_snapshot_version,
      ${material.sql} as material_json,${proofs.length ? curationCatalogFence() : "1"} as integrity
      from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions current on current.id=d.current_revision_id and current.document_object_id=d.object_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility} limit 1`)
      .bind(...(snapshotId ? [snapshotId] : []), ...material.bindings, ...(proofs.length ? [canonicalLinkJson(proofs)] : []), recordId, this.userId).first<Frame>();
    if (!row) return missing();
    if (row.privacy_level === "restricted" && !live(expiry)) throw new LinkSnapshotError("restricted_record_locked", "정확한 보관 위치를 열려면 다시 인증해 주세요.");
    if (!row.material_json) return missing();
    if (row.integrity !== 1) return damaged();
    return row;
  }

  async get(recordId: string, value: unknown, options: Access = {}): Promise<V2RecordLocationResult> {
    const location = parseRecordLocation(value), expiry = options.restrictedGrantExpiresAt;
    if (typeof recordId !== "string" || !recordId.trim() || recordId.length > 200) return missing();
    const snapshots = new D1LinkSnapshotRepository(this.db, this.userId), schema = await snapshots.isAvailable();
    const snapshotId = "snapshotId" in location ? location.snapshotId : null;
    if (snapshotId && !schema) throw new LinkSnapshotError("link_snapshot_schema_unavailable", "정확한 자료 버전 저장소가 아직 준비되지 않았습니다.");
    if (location.kind === "curation" && !await this.db.prepare("select name from sqlite_master where type='table' and name='v2_link_curation_revisions'").first())
      throw new LinkSnapshotError("prompt_curation_schema_unavailable", "정리본 저장소가 아직 준비되지 않았습니다.");
    const initial = await this.frame(recordId, location, expiry, schema);
    let snapshot: LinkSnapshotProjection | null = null;
    const proofs: CurationCatalogProof[] = [];
    if (snapshotId) {
      snapshot = await snapshots.getSnapshot(recordId, snapshotId, live(expiry)).catch((error: unknown) => {
        // A selected stored snapshot already establishes external provenance.
        // Damaged metadata is an integrity denial, not a generic server fault.
        if (error instanceof LinkSnapshotError && ["link_source_not_external", "link_source_metadata_invalid"].includes(error.code)) return damaged();
        throw error;
      });
      if (!snapshot || snapshot.snapshot.manifestHash !== (location as { manifestHash: string }).manifestHash) return missing();
      if (!Number.isSafeInteger(initial.selected_snapshot_version) || initial.selected_snapshot_version !== snapshot.snapshot.snapshotVersion) return conflict();
      proofs.push((await loadCurationMigrationTargetProof(this.db, this.userId, snapshot)).proof);
    }
    const material = JSON.parse(initial.material_json!) as Record<string, unknown>;
    const result: { -readonly [K in keyof V2RecordLocationResult]: V2RecordLocationResult[K] } = {
      contract: RECORD_LOCATION_RESULT_CONTRACT, recordId, location, origin: "source", label: "보관 원문", text: "", textHash: location.textHash, range: location.range,
      privacyLevel: initial.privacy_level, accessExpiresAt: initial.privacy_level === "restricted" ? expiry ?? null : null,
      reviewStatus: null, isHistorical: snapshotId !== null && snapshotId !== initial.current_snapshot_id,
      context: { documentRevisionId: initial.current_revision_id, snapshotId, snapshotVersion: snapshot?.snapshot.snapshotVersion ?? null,
        runId: null, groupKey: null, curationRevisionId: null }, evidence: [], attachments: [],
      copy: { allowed: true, mode: "exact", reason: null, warnings: [] },
    };
    if (location.kind === "document_title" || location.kind === "document_body") {
      if (material.number !== location.documentVersion || material.status !== "committed") return missing();
      if (location.kind === "document_title" && (initial.current_revision_id !== location.revisionId || initial.current_version !== location.documentVersion)) return conflict();
      result.text = String(location.kind === "document_title" ? material.title : material.body);
      if (location.kind === "document_body") {
        // source_commit stores the capture-payload digest, not the body digest.
        // Its immutable capture note/identity is the authoritative body basis.
        if (material.reason === "source_commit") {
          if (material.number !== 1 || material.parent !== null || material.body !== material.captureNote || material.hash !== material.captureHash) return damaged();
        } else if (normalizeLinkHash(String(material.hash)) !== recordLocationTextHash(result.text)) return damaged();
      }
      result.origin = location.kind; result.label = location.kind === "document_title" ? "기록 제목" : "내 글 · 보관한 본문 버전";
      result.context = { ...result.context, documentRevisionId: location.revisionId };
      result.isHistorical = location.revisionId !== initial.current_revision_id;
    } else if (location.kind === "source") {
      if (typeof material.text !== "string") return missing();
      result.text = material.text;
      let metadata: unknown = null;
      try { metadata = material.metadata === null ? null : JSON.parse(String(material.metadata)); }
      catch (error) { if (error instanceof SyntaxError) return damaged(); throw error; }
      const manual = readManualLinkSource(metadata);
      const extraction = material.analysisVerified === 1 ? readAnalysisExtractionSource(metadata) : null;
      const video = material.videoVerified === 1 ? readVideoAnalysisSource(metadata) : null;
      result.origin = manual ? "external_source" : video ? "ai_interpretation" : extraction ? "source" : material.kind === "text" ? "user_note" : "source";
      result.label = manual ? "외부 원문 · 사용자가 보관한 자료" : video ? "AI 영상 분석 · 원본 영상이나 공식 자막 아님" : extraction ? analysisExtractionLabel(extraction.kind) : material.kind === "text" ? "내 메모 · 최초 보관 원문" : "보관 원문 · OCR/녹취 여부는 원본 정보 기준";
      if (["text", "url", "transcript"].includes(String(material.kind)) && normalizeLinkHash(String(material.hash)) !== recordLocationTextHash(result.text)) return damaged();
      if (snapshot) {
        const member = snapshot.members.find((item) => item.id === location.memberId && item.sourceItemId === location.sourceItemId);
        if (!member || member.rawText !== result.text) return missing();
      }
      result.attachments = (material.attachments as { attachmentId: string; filename: string; mimeType: string }[]).map((attachment) => ({
        attachmentId: attachment.attachmentId, filename: attachment.filename, mimeType: attachment.mimeType, itemKey: null, evidenceMethod: "source_attachment",
      }));
    } else if (location.kind === "manual_fragment" || location.kind === "ai_fragment") {
      const member = snapshot?.members.find((item) => item.id === location.memberId && item.sourceItemId === location.sourceItemId);
      if (!member || !snapshot) return missing();
      if (location.kind === "manual_fragment") {
        const { item } = await new D1ManualLinkFragmentRepository(this.db, this.userId).get(recordId, location.fragmentId, { snapshotId: location.snapshotId, restrictedGrantExpiresAt: expiry });
        if (item.primaryMemberId !== location.memberId) return missing();
        result.text = item.fragment.rawText; result.origin = "manual_extract"; result.label = "내가 선택한 정확한 발췌"; result.reviewStatus = item.reviewStatus;
        result.evidence = [{ sourceItemId: member.sourceItemId, memberId: member.id, label: "사용자 선택 원문 범위", quote: item.fragment.rawText,
          textStart: item.fragment.textStart, textEnd: item.fragment.textEnd }];
      } else {
        const evidence = await new D1LinkFragmentEvidenceRepository(this.db, this.userId).get(recordId, location.fragmentId, { snapshotId: location.snapshotId,
          manifestHash: location.manifestHash, restrictedGrantExpiresAt: expiry });
        if (evidence.run.id !== location.runId || evidence.fragment.primaryMemberId !== location.memberId) return missing();
        result.text = evidence.fragment.rawText ?? evidence.fragment.derivedText ?? "";
        result.origin = evidence.fragment.sourceClass === "ai_interpretation" ? "ai_interpretation" : "ai_extract";
        result.label = result.origin === "ai_interpretation" ? "AI 해석 · 원문이나 내 주장 아님" : "AI가 선택한 원문 발췌";
        result.reviewStatus = evidence.fragment.reviewStatus; result.isHistorical = !evidence.run.isPublished;
        result.context = { ...result.context, documentRevisionId: evidence.run.documentRevisionId, runId: evidence.run.id };
        result.evidence = evidence.fragment.evidence.map((entry) => ({ sourceItemId: entry.sourceItemId, memberId: entry.memberId,
          label: "AI가 연결한 보관 원문 근거", quote: entry.quote ?? "", textStart: entry.textStart, textEnd: entry.textEnd }));
      }
      if (["rejected", "superseded"].includes(result.reviewStatus ?? "")) result.copy = { allowed: false, mode: null, reason: "거절되거나 대체된 조각입니다.", warnings: [result.reviewStatus!] };
      result.attachments = member.attachments.map((attachment) => ({ attachmentId: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType,
        itemKey: null, evidenceMethod: "source_attachment" }));
    } else {
      if (location.kind !== "curation") return missing();
      if (!snapshot) return missing();
      const detail = await new D1PromptCurationRepository(this.db, this.userId).get(recordId, location.groupKey, { revisionId: location.revisionId, restrictedGrantExpiresAt: expiry });
      if (detail.item.snapshotId !== location.snapshotId) return missing();
      const catalog = await loadCurationCatalog(this.db, this.userId, recordId, snapshot, detail.item.content, false);
      if (catalog.prepared.manifestHash !== detail.item.manifestHash) return damaged();
      proofs.push(catalog.proof);
      const items = location.role === "title" ? [] : detail.item.items.filter((item) => item.copyRole === location.role).sort((a, b) => a.position - b.position);
      result.text = location.role === "title" ? detail.item.title : items.map((item) => item.fragment.rawText).join("\n");
      result.origin = "curation"; result.label = location.role === "title" ? "정리본 제목" : `정리본 · ${location.role} 역할의 보관 조각`;
      result.isHistorical = detail.isHistorical; result.reviewStatus = detail.item.status;
      result.context = { ...result.context, groupKey: location.groupKey, curationRevisionId: location.revisionId };
      if (location.role !== "title") {
        const channel = detail.item.prepared.channels[location.role];
        result.copy = channel.canStandardCopy ? { allowed: true, mode: "standard", reason: null, warnings: channel.warnings }
          : channel.canAvailableOnlyCopy ? { allowed: true, mode: "available_only", reason: "확보한 조각만 복사하며 외부 원문 전체가 아닙니다.", warnings: channel.warnings }
            : { allowed: false, mode: null, reason: channel.blockedReason, warnings: channel.warnings };
      }
      result.evidence = items.map((item) => {
        const member = snapshot!.members.find((entry) => entry.memberKey === item.fragment.memberKey);
        if (!member) return damaged();
        return { sourceItemId: member.sourceItemId, memberId: member.id, label: `항목 ${item.itemKey} · 위치 ${item.position + 1}`, quote: item.fragment.rawText,
          textStart: item.fragment.textStart, textEnd: item.fragment.textEnd };
      });
      result.attachments = detail.item.content.examples.map((example) => {
        const member = snapshot!.members.find((entry) => entry.id === example.memberId), attachment = member?.attachments.find((entry) => entry.id === example.attachmentId);
        if (!attachment) return damaged();
        return { attachmentId: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType, itemKey: example.itemKey, evidenceMethod: example.evidenceMethod };
      });
    }
    assertRecordLocationText(location, result.text);
    // All returned bytes and authority share this last SQL boundary. No await follows.
    const final = await this.frame(recordId, location, expiry, schema, proofs);
    if (canonicalLinkJson(final) !== canonicalLinkJson(initial)) return conflict();
    return result;
  }
}
