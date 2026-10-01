import { ulid } from "ulidx";

import { LINK_ANALYSIS_LIMITS } from "@/lib/v2/ai/link-analysis-v1";
import {
  LINK_HISTORY_PAGE_SIZE, LINK_PRESENTATION_CONTRACT, type LinkFragmentReviewReceipt, type LinkFragmentReviewRequest,
  type LinkPresentationV1, type LinkProjectionOptions, type PresentedLinkEvidence, type PresentedLinkFragment,
  type PresentedLinkRun, type PresentedLinkSnapshot, type PresentedLinkSource,
} from "@/lib/v2/domain/link-presentation-v1";
import { canonicalLinkJson, linkSha256Hex, LinkSnapshotError, normalizeLinkHash, type LinkSnapshotMemberV1 } from "@/lib/v2/domain/link-snapshot-v1";
import { readManualLinkSource } from "@/lib/v2/domain/manual-link-source";
import { readPublicFetchSource } from "@/lib/v2/domain/public-fetch-source";
import { readVideoAnalysisSource, VIDEO_ANALYSIS_ADAPTER_VERSION } from "@/lib/v2/domain/video-analysis-source";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

const REVIEW_OPERATION = "link_fragment.review.v1";
type DocumentRow = { object_id: string; capture_id: string; current_revision_id: string; current_link_snapshot_id: string | null;
  link_snapshot_version: number; published_link_run_id: string | null; privacy_level: string };
type SnapshotRow = { id: string; parent_snapshot_id: string | null; snapshot_version: number; manifest_version: "link-source-manifest.v1";
  manifest_hash: string; acquisition_method: PresentedLinkSnapshot["acquisitionMethod"]; adapter_version: string;
  capture_state: PresentedLinkSnapshot["captureState"]; coverage_json: string; created_at: string; source_count: number };
type RunRow = { id: string; job_id: string; input_link_snapshot_id: string; input_revision_id: string; status: string;
  created_at: string; finished_at: string | null };
type FragmentRow = { id: string; fragment_key: string; snapshot_id: string; processing_run_id: string; role: PresentedLinkFragment["role"];
  source_class: PresentedLinkFragment["sourceClass"]; raw_text: string | null; raw_text_hash: string | null; derived_text: string | null;
  text_start: number | null; text_end: number | null; completeness: string; review_status: PresentedLinkFragment["reviewStatus"];
  locked_by_user: number; state_version: number; display_order: number; primary_member_id: string };
type EvidenceRow = { id: string; fragment_id: string; member_id: string; relation_kind: string; evidence_method: string;
  text_start: number | null; text_end: number | null; display_order: number };

function fail(code: string, message: string): never { throw new LinkSnapshotError(code, message); }
function coverage(status: PresentedLinkSnapshot["captureState"], value: unknown): NonNullable<PresentedLinkSnapshot["coverage"]> {
  const reason = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).reason : null;
  return { status, ...(typeof reason === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(reason) ? { reason } : {}) };
}
function summary(row: SnapshotRow): PresentedLinkSnapshot {
  let parsed: unknown = null;
  try { parsed = JSON.parse(row.coverage_json); } catch { /* Invalid legacy coverage has no reason. */ }
  return { id: row.id, parentSnapshotId: row.parent_snapshot_id, snapshotVersion: row.snapshot_version,
    manifestVersion: row.manifest_version, manifestHash: row.manifest_hash, acquisitionMethod: row.acquisition_method,
    adapterVersion: row.adapter_version, captureState: row.capture_state, coverage: coverage(row.capture_state, parsed),
    createdAt: row.created_at, sourceCount: row.source_count };
}
function source(member: LinkSnapshotMemberV1): PresentedLinkSource {
  return { sourceItemId: member.sourceItemId, memberId: member.id, memberKey: member.memberKey, sourceOrder: member.sourceOrder,
    kind: member.kind, rawText: member.rawText, contentHash: member.contentHash, manualLink: member.manualLink,
    publicFetch: readPublicFetchSource(member.metadata),
    // Snapshot members were proven by the snapshot repository before projection.
    videoAnalysis: member.kind === "transcript" ? readVideoAnalysisSource(member.metadata) : null,
    attachments: member.attachments };
}
function run(row: RunRow, publishedId: string | null): PresentedLinkRun {
  return { id: row.id, jobId: row.job_id, snapshotId: row.input_link_snapshot_id, documentRevisionId: row.input_revision_id,
    status: row.status, createdAt: row.created_at, finishedAt: row.finished_at, isPublished: row.id === publishedId };
}
function cursor(value: string | undefined, kind: string, scope: string): unknown[] | null {
  if (!value) return null;
  try {
    const data: unknown = JSON.parse(decodeURIComponent(value));
    if (value.length > 1600 || !Array.isArray(data) || data[0] !== kind || data[1] !== scope) throw new Error();
    return data;
  } catch { return fail("link_history_cursor_invalid", "The history cursor does not belong to this view."); }
}
function empty(recordId: string, available: boolean, document: DocumentRow | null, reason: string): LinkPresentationV1 {
  return { contract: LINK_PRESENTATION_CONTRACT, schemaAvailable: available, recordId, currentRevisionId: document?.current_revision_id ?? null,
    currentSnapshotId: document?.current_link_snapshot_id ?? null, currentSnapshotVersion: document?.link_snapshot_version ?? 0,
    selectedSnapshot: null, members: [], availableSources: [], snapshotHistory: { items: [], nextCursor: null },
    selectedRun: null, publishedRun: null, runHistory: { items: [], nextCursor: null }, latestAttempt: null, fragments: [], isHistorical: false,
    capabilities: { canCreateSnapshot: false, canAnalyze: false, canReview: false, reason } };
}
function sameDocument(a: DocumentRow, b: DocumentRow) {
  return a.capture_id === b.capture_id && a.current_revision_id === b.current_revision_id
    && a.current_link_snapshot_id === b.current_link_snapshot_id && a.link_snapshot_version === b.link_snapshot_version
    && a.published_link_run_id === b.published_link_run_id && a.privacy_level === b.privacy_level;
}

export class D1LinkPresentationRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async document(recordId: string, schemaAvailable: boolean) {
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    return this.db.prepare(`select d.object_id,d.capture_id,d.current_revision_id,d.privacy_level,
      ${schemaAvailable ? "d.current_link_snapshot_id,d.link_snapshot_version,d.published_link_run_id" : "null as current_link_snapshot_id,0 as link_snapshot_version,null as published_link_run_id"}
      from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions revision on revision.id=d.current_revision_id and revision.document_object_id=d.object_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility} limit 1`)
      .bind(recordId, this.userId).first<DocumentRow>();
  }

  private async availableSources(document: DocumentRow, schemaAvailable: boolean): Promise<PresentedLinkSource[]> {
    const rows = await this.db.prepare(`select s.id,s.item_kind,s.raw_text,s.content_hash,s.source_metadata,dsl.source_order,
      a.id as attachment_id,a.sha256,a.mime_type,a.size_bytes,a.filename,
      ${schemaAvailable ? `(select origin.adapter_version||'|'||origin.acquisition_method from v2_link_snapshot_sources origin_member
        join v2_link_snapshots origin on origin.id=origin_member.snapshot_id and origin.user_id=origin_member.user_id
        where origin_member.source_item_id=s.id and origin_member.user_id=s.user_id and origin.document_object_id=dsl.document_object_id
        order by origin.snapshot_version limit 1)` : "null"} as introduced_by
      from v2_source_items s
      join v2_document_source_links dsl on dsl.source_item_id=s.id and dsl.document_object_id=?
      left join v2_source_attachment_links sal on sal.source_item_id=s.id and sal.user_id=s.user_id
      left join v2_attachment_reservations a on a.id=sal.attachment_id and a.user_id=s.user_id and a.status='committed'
      where s.user_id=? and s.capture_id=? and s.item_kind in ('url','image','audio','video','document','transcript') order by dsl.source_order,s.id,a.id`)
      .bind(document.object_id, this.userId, document.capture_id).all<{
        id: string; item_kind: string; raw_text: string | null; content_hash: string; source_metadata: string | null; source_order: number;
        attachment_id: string | null; sha256: string; mime_type: string; size_bytes: number; filename: string; introduced_by: string | null;
      }>();
    const result: PresentedLinkSource[] = [];
    for (const id of new Set(rows.results.map((item) => item.id))) {
      const group = rows.results.filter((item) => item.id === id), item = group[0];
      let metadata: unknown = null;
      try { metadata = item.source_metadata ? JSON.parse(item.source_metadata) : null; } catch { continue; }
      const manualLink = readManualLinkSource(metadata);
      const publicFetch = readPublicFetchSource(metadata);
      const attachments = group.filter((row) => row.attachment_id).map((row) => ({ id: row.attachment_id!, sha256: row.sha256,
        mimeType: row.mime_type, sizeBytes: row.size_bytes, filename: row.filename }));
      const videoAnalysis = item.item_kind === "transcript" && !attachments.length && item.introduced_by === `${VIDEO_ANALYSIS_ADAPTER_VERSION}|api`
        ? readVideoAnalysisSource(metadata) : null;
      if (!(item.item_kind === "url" && manualLink) && !(["image", "audio", "video", "document"].includes(item.item_kind) && attachments.length) && !videoAnalysis) continue;
      if ((item.item_kind === "url" || videoAnalysis) && (item.raw_text === null || await linkSha256Hex(item.raw_text) !== normalizeLinkHash(item.content_hash))) fail("link_source_hash_mismatch", "A preserved original failed its content hash check.");
      if (attachments.some((a) => normalizeLinkHash(a.sha256) !== normalizeLinkHash(item.content_hash))) fail("link_source_hash_mismatch", "An attachment failed its source hash check.");
      result.push({ sourceItemId: id, memberId: null, memberKey: null, sourceOrder: item.source_order, kind: item.item_kind,
        rawText: item.raw_text, contentHash: item.content_hash, manualLink, publicFetch, videoAnalysis, attachments });
    }
    return result;
  }

  private runQuery() {
    return `select r.id,r.job_id,j.input_link_snapshot_id,j.input_revision_id,r.status,r.created_at,r.finished_at
      from v2_processing_runs r join v2_processing_jobs j on j.id=r.job_id and j.user_id=r.user_id
      join v2_link_snapshots s on s.id=j.input_link_snapshot_id and s.user_id=j.user_id and s.document_object_id=j.object_id and s.capture_id=j.capture_id
      join v2_documents link_document on link_document.object_id=s.document_object_id and link_document.capture_id=s.capture_id
      where r.user_id=? and j.object_id=? and j.stage='link_analyze' and r.input_hash=j.input_hash
        and j.input_source_manifest_hash=s.manifest_hash and j.input_source_manifest_version=s.manifest_version`;
  }

  async project(recordId: string, options: LinkProjectionOptions = {}): Promise<LinkPresentationV1 | null> {
    const snapshots = new D1LinkSnapshotRepository(this.db, this.userId), schemaAvailable = await snapshots.isAvailable();
    const document = await this.document(recordId, schemaAvailable);
    if (!document) return null;
    if (document.privacy_level === "restricted" && !options.restrictedUnlocked) return empty(recordId, schemaAvailable, null, "restricted_record_locked");
    const availableSources = await this.availableSources(document, schemaAvailable);
    if (!schemaAvailable) {
      const final = await this.document(recordId, false);
      if (!final) return null;
      if (final.privacy_level === "restricted" && !options.restrictedUnlocked) return empty(recordId, false, null, "restricted_record_locked");
      if (!sameDocument(document, final)) fail("link_projection_conflict", "The record changed while it was being read.");
      return { ...empty(recordId, false, document, "link_snapshot_schema_unavailable"), availableSources };
    }
    const snapshotId = options.snapshotId ?? document.current_link_snapshot_id;
    const projection = snapshotId ? await snapshots.getSnapshot(recordId, snapshotId, Boolean(options.restrictedUnlocked)) : null;
    if (snapshotId && !projection) fail("link_snapshot_not_found", "The selected source version is not accessible.");
    const snapshotCursor = cursor(options.snapshotCursor, "snapshots", recordId);
    if (snapshotCursor && (snapshotCursor.length !== 3 || !Number.isSafeInteger(snapshotCursor[2]) || Number(snapshotCursor[2]) < 1)) fail("link_history_cursor_invalid", "Invalid source history position.");
    const history = await this.db.prepare(`select s.*,(select count(*) from v2_link_snapshot_sources m where m.snapshot_id=s.id and m.user_id=s.user_id) as source_count
      from v2_link_snapshots s where s.user_id=? and s.document_object_id=? and s.capture_id=? ${snapshotCursor ? "and s.snapshot_version<?" : ""}
      order by s.snapshot_version desc limit ?`).bind(this.userId, recordId, document.capture_id,
        ...(snapshotCursor ? [snapshotCursor[2]] : []), LINK_HISTORY_PAGE_SIZE + 1).all<SnapshotRow>();
    const snapshotItems = history.results.slice(0, LINK_HISTORY_PAGE_SIZE).map(summary);
    const snapshotHistory = { items: snapshotItems, nextCursor: history.results.length > LINK_HISTORY_PAGE_SIZE
      ? encodeURIComponent(JSON.stringify(["snapshots", recordId, snapshotItems.at(-1)!.snapshotVersion])) : null };
    const publishedRow = document.published_link_run_id && document.current_link_snapshot_id
      ? await this.db.prepare(`${this.runQuery()} and r.id=? and j.input_revision_id=? and j.input_link_snapshot_id=? and r.status in ('succeeded','partial') limit 1`)
        .bind(this.userId, recordId, document.published_link_run_id, document.current_revision_id, document.current_link_snapshot_id).first<RunRow>() : null;
    const publishedRun = publishedRow ? run(publishedRow, publishedRow.id) : null;
    const runCursor = cursor(options.runCursor, "runs", snapshotId ?? "");
    if (runCursor && (runCursor.length !== 4 || typeof runCursor[2] !== "string" || typeof runCursor[3] !== "string")) fail("link_history_cursor_invalid", "Invalid analysis history position.");
    const runRows = snapshotId ? (await this.db.prepare(`${this.runQuery()} and j.input_link_snapshot_id=?
      ${runCursor ? "and (r.created_at<? or (r.created_at=? and r.id<?))" : ""} order by r.created_at desc,r.id desc limit ?`)
      .bind(this.userId, recordId, snapshotId, ...(runCursor ? [runCursor[2], runCursor[2], runCursor[3]] : []), LINK_HISTORY_PAGE_SIZE + 1).all<RunRow>()).results : [];
    const runItems = runRows.slice(0, LINK_HISTORY_PAGE_SIZE).map((row) => run(row, publishedRun?.id ?? null));
    const runHistory = { items: runItems, nextCursor: runRows.length > LINK_HISTORY_PAGE_SIZE
      ? encodeURIComponent(JSON.stringify(["runs", snapshotId, runItems.at(-1)!.createdAt, runItems.at(-1)!.id])) : null };
    let selectedRun: PresentedLinkRun | null = null;
    if (options.runId) {
      const row = await this.db.prepare(`${this.runQuery()} and r.id=? and j.input_link_snapshot_id=? limit 1`)
        .bind(this.userId, recordId, options.runId, snapshotId).first<RunRow>();
      if (!row) fail("link_run_not_found", "The selected analysis does not belong to this source version.");
      selectedRun = run(row, publishedRun?.id ?? null);
    } else if (snapshotId === document.current_link_snapshot_id) selectedRun = publishedRun;
    else if (snapshotId) {
      // Paging the history must not silently change the selected analysis.
      const latest = runCursor ? await this.db.prepare(`${this.runQuery()} and j.input_link_snapshot_id=? order by r.created_at desc,r.id desc limit 1`)
        .bind(this.userId, recordId, snapshotId).first<RunRow>() : runRows[0] ?? null;
      selectedRun = latest ? run(latest, publishedRun?.id ?? null) : null;
    }
    const latestJob = snapshotId ? await this.db.prepare(`select j.id,j.input_link_snapshot_id,j.input_revision_id,j.status,j.attempt,j.next_attempt_at,j.last_error_code,j.created_at,j.finished_at
      from v2_processing_jobs j join v2_link_snapshots s on s.id=j.input_link_snapshot_id and s.user_id=j.user_id and s.document_object_id=j.object_id and s.capture_id=j.capture_id
      where j.user_id=? and j.object_id=? and j.input_link_snapshot_id=? and j.stage='link_analyze'
      and j.input_source_manifest_hash=s.manifest_hash and j.input_source_manifest_version=s.manifest_version order by j.created_at desc,j.id desc limit 1`)
      .bind(this.userId, recordId, snapshotId).first<{ id: string; input_link_snapshot_id: string; input_revision_id: string; status: string; attempt: number;
        next_attempt_at: string; last_error_code: string | null; created_at: string; finished_at: string | null }>() : null;
    const latestAttempt = latestJob ? { id: latestJob.id, snapshotId: latestJob.input_link_snapshot_id, documentRevisionId: latestJob.input_revision_id,
      status: latestJob.status, attempt: latestJob.attempt, nextAttemptAt: latestJob.next_attempt_at, lastErrorCode: latestJob.last_error_code,
      createdAt: latestJob.created_at, finishedAt: latestJob.finished_at,
      isCurrent: latestJob.input_link_snapshot_id === document.current_link_snapshot_id && latestJob.input_revision_id === document.current_revision_id } : null;
    const fragments = selectedRun && projection ? await this.fragments(recordId, selectedRun.id, projection.snapshot.id, projection.members) : [];
    const isHistorical = Boolean(snapshotId && snapshotId !== document.current_link_snapshot_id
      || selectedRun && (selectedRun.id !== publishedRun?.id || selectedRun.documentRevisionId !== document.current_revision_id));
    const canCreateSnapshot = Boolean(options.writeEnabled && !isHistorical);
    const hasText = projection?.members.some((member) => member.manualLink && member.rawText?.trim()) ?? false;
    const canAnalyze = Boolean(canCreateSnapshot && options.aiEnabled && document.privacy_level !== "restricted" && hasText);
    const canReview = Boolean(canCreateSnapshot && selectedRun && selectedRun.id === publishedRun?.id);
    const final = await this.document(recordId, true);
    if (!final) return null;
    if (final.privacy_level === "restricted" && !options.restrictedUnlocked) return empty(recordId, true, null, "restricted_record_locked");
    if (!sameDocument(document, final)) fail("link_projection_conflict", "The record or current source analysis changed while it was being read.");
    if (selectedRun) {
      const finalRun = await this.db.prepare(`${this.runQuery()} and r.id=? and j.input_link_snapshot_id=? limit 1`)
        .bind(this.userId, recordId, selectedRun.id, snapshotId).first<RunRow>();
      if (!finalRun || finalRun.status !== selectedRun.status || finalRun.input_revision_id !== selectedRun.documentRevisionId) fail("link_projection_conflict", "The selected analysis changed while it was being read.");
      const finalAccess = await this.document(recordId, true);
      if (!finalAccess) return null;
      if (finalAccess.privacy_level === "restricted" && !options.restrictedUnlocked) return empty(recordId, true, null, "restricted_record_locked");
      if (!sameDocument(document, finalAccess)) fail("link_projection_conflict", "The record changed during the final analysis check.");
    }
    return { contract: LINK_PRESENTATION_CONTRACT, schemaAvailable, recordId, currentRevisionId: document.current_revision_id,
      currentSnapshotId: document.current_link_snapshot_id, currentSnapshotVersion: document.link_snapshot_version,
      selectedSnapshot: projection ? { id: projection.snapshot.id, parentSnapshotId: projection.snapshot.parentSnapshotId,
        snapshotVersion: projection.snapshot.snapshotVersion, manifestVersion: projection.snapshot.manifestVersion, manifestHash: projection.snapshot.manifestHash,
        acquisitionMethod: projection.snapshot.acquisitionMethod, adapterVersion: projection.snapshot.adapterVersion, captureState: projection.snapshot.captureState,
        coverage: coverage(projection.snapshot.captureState, projection.snapshot.coverage),
        createdAt: projection.snapshot.createdAt, sourceCount: projection.members.length } : null,
      members: projection?.members.map(source) ?? [], availableSources, snapshotHistory, publishedRun, selectedRun, runHistory,
      latestAttempt, fragments, isHistorical, capabilities: { canCreateSnapshot, canAnalyze, canReview,
        canCreateManualFragment: Boolean(options.writeEnabled && projection && snapshotId === document.current_link_snapshot_id),
        reason: isHistorical ? "link_history_read_only" : !options.writeEnabled ? "v2_write_disabled" : document.privacy_level === "restricted" ? "restricted_ai_forbidden"
          : !projection ? "link_snapshot_required" : !hasText ? "link_analysis_needs_input" : !options.aiEnabled ? "v2_ai_disabled" : null } };
  }

  private async fragments(recordId: string, runId: string, snapshotId: string, members: readonly LinkSnapshotMemberV1[]): Promise<PresentedLinkFragment[]> {
    const rows = await this.db.prepare("select * from v2_link_fragments where user_id=? and document_object_id=? and snapshot_id=? and processing_run_id=? order by display_order,id limit ?")
      .bind(this.userId, recordId, snapshotId, runId, LINK_ANALYSIS_LIMITS.fragments + 1).all<FragmentRow>();
    const maxEvidenceRows = LINK_ANALYSIS_LIMITS.fragments * 16;
    const evidenceRows = await this.db.prepare(`select e.* from v2_link_fragment_evidence e join v2_link_fragments f on f.id=e.fragment_id and f.user_id=e.user_id
      where f.user_id=? and f.document_object_id=? and f.snapshot_id=? and f.processing_run_id=? order by e.display_order,e.id limit ?`)
      .bind(this.userId, recordId, snapshotId, runId, maxEvidenceRows + 1).all<EvidenceRow>();
    const byId = new Map(members.map((member) => [member.id, member]));
    if (rows.results.length > LINK_ANALYSIS_LIMITS.fragments) fail("link_fragment_integrity_invalid", "The stored analysis exceeds the fragment budget.");
    if (evidenceRows.results.length > maxEvidenceRows) fail("link_fragment_integrity_invalid", "The stored analysis exceeds the evidence count budget.");
    let outputBytes = 0, evidenceBytes = 0;
    const encoder = new TextEncoder();
    function quote(memberId: string, start: number | null, end: number | null) {
      const member = byId.get(memberId);
      if (!member) return fail("link_fragment_integrity_invalid", "Fragment evidence does not belong to this source snapshot.");
      if (start === null && end === null) return null;
      if (member.rawText === null || start === null || end === null || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end || end > member.rawText.length) return fail("link_fragment_integrity_invalid", "Fragment evidence lies outside the exact preserved text.");
      return member.rawText.slice(start, end);
    }
    const result: PresentedLinkFragment[] = [];
    for (const row of rows.results) {
      outputBytes += encoder.encode(row.raw_text ?? row.derived_text ?? "").byteLength;
      if (outputBytes > LINK_ANALYSIS_LIMITS.outputTextBytes) fail("link_fragment_integrity_invalid", "The stored analysis exceeds the exact text budget.");
      const original = quote(row.primary_member_id, row.text_start, row.text_end);
      if (row.source_class === "source_extract" && (original !== row.raw_text || row.raw_text === null || await linkSha256Hex(row.raw_text) !== row.raw_text_hash)) fail("link_fragment_integrity_invalid", "An extracted fragment no longer matches its original.");
      const evidence: PresentedLinkEvidence[] = evidenceRows.results.filter((item) => item.fragment_id === row.id).map((item) => {
        const exact = quote(item.member_id, item.text_start, item.text_end), member = byId.get(item.member_id)!;
        evidenceBytes += encoder.encode(exact ?? "").byteLength;
        if (evidenceBytes > LINK_ANALYSIS_LIMITS.evidenceTextBytes) fail("link_fragment_integrity_invalid", "The stored analysis exceeds the evidence text budget.");
        return { id: item.id, memberId: item.member_id, memberKey: member.memberKey, sourceItemId: member.sourceItemId, relationKind: item.relation_kind,
          evidenceMethod: item.evidence_method, textStart: item.text_start, textEnd: item.text_end, quote: exact, displayOrder: item.display_order };
      });
      result.push({ id: row.id, fragmentKey: row.fragment_key, snapshotId: row.snapshot_id, runId: row.processing_run_id, role: row.role,
        sourceClass: row.source_class, rawText: row.raw_text, rawTextHash: row.raw_text_hash, derivedText: row.derived_text, completeness: row.completeness,
        reviewStatus: row.review_status, lockedByUser: row.locked_by_user === 1, stateVersion: row.state_version, displayOrder: row.display_order,
        primaryMemberId: row.primary_member_id, evidence });
    }
    return result;
  }

  private async reviewAccess(recordId: string, request: LinkFragmentReviewRequest, unlocked: boolean) {
    const document = await this.document(recordId, true);
    if (!document) fail("link_record_not_found", "The record is not accessible.");
    if (document.privacy_level === "restricted" && !unlocked) fail("restricted_record_locked", "Unlock this record before reviewing its source material.");
    if (document.current_revision_id !== request.expectedRevisionId || document.current_link_snapshot_id !== request.expectedSnapshotId || document.published_link_run_id !== request.expectedRunId) fail("link_fragment_conflict", "The current document, source snapshot, or published analysis changed.");
    return document;
  }

  async reviewFragment(recordId: string, fragmentId: string, request: LinkFragmentReviewRequest, options: { restrictedUnlocked?: boolean } = {}): Promise<LinkFragmentReviewReceipt> {
    if (!new Set(["confirm", "reject"]).has(request.action) || !Number.isSafeInteger(request.expectedStateVersion) || request.expectedStateVersion < 1
      || [recordId, fragmentId, request.expectedRevisionId, request.expectedSnapshotId, request.expectedRunId, request.idempotencyKey].some((value) => typeof value !== "string" || !value.trim() || value.length > 200)) fail("link_review_invalid", "The fragment review request is invalid.");
    if (!await new D1LinkSnapshotRepository(this.db, this.userId).isAvailable()) fail("link_snapshot_schema_unavailable", "Link review storage is not available.");
    const unlocked = Boolean(options.restrictedUnlocked);
    await this.reviewAccess(recordId, request, unlocked);
    const projection = await new D1LinkSnapshotRepository(this.db, this.userId).getSnapshot(recordId, request.expectedSnapshotId, unlocked);
    await this.reviewAccess(recordId, request, unlocked);
    if (!projection) fail("link_snapshot_not_found", "The current preserved source version is not accessible.");
    // Reuse exact UTF-16 slice/hash validation even for direct PATCH and replays.
    // A known fragment ID must not bypass the integrity checks used by GET.
    const validated = await this.fragments(recordId, request.expectedRunId, request.expectedSnapshotId, projection.members);
    await this.reviewAccess(recordId, request, unlocked);
    if (!validated.some((item) => item.id === fragmentId)) fail("link_fragment_not_found", "The fragment does not belong to the current analysis.");
    const payloadHash = await linkSha256Hex(canonicalLinkJson({ recordId, fragmentId, action: request.action, expectedRevisionId: request.expectedRevisionId,
      expectedSnapshotId: request.expectedSnapshotId, expectedRunId: request.expectedRunId, expectedStateVersion: request.expectedStateVersion }));
    const readFragment = () => this.db.prepare(`select f.review_status,f.state_version from v2_link_fragments f
      join v2_processing_runs r on r.id=f.processing_run_id and r.user_id=f.user_id
      join v2_processing_jobs j on j.id=r.job_id and j.user_id=r.user_id and j.object_id=f.document_object_id
      join v2_link_snapshots s on s.id=f.snapshot_id and s.user_id=f.user_id and s.document_object_id=f.document_object_id and s.capture_id=j.capture_id
      where f.id=? and f.user_id=? and f.document_object_id=? and f.snapshot_id=? and f.processing_run_id=? and j.stage='link_analyze'
      and j.input_revision_id=? and j.input_link_snapshot_id=s.id and j.input_source_manifest_hash=s.manifest_hash and j.input_source_manifest_version=s.manifest_version
      and r.input_hash=j.input_hash and r.status in ('succeeded','partial') limit 1`).bind(fragmentId, this.userId, recordId, request.expectedSnapshotId, request.expectedRunId, request.expectedRevisionId)
      .first<{ review_status: PresentedLinkFragment["reviewStatus"]; state_version: number }>();
    const replay = async () => {
      const row = await this.db.prepare("select payload_hash,response_json from v2_idempotency_records where user_id=? and operation=? and idempotency_key=? limit 1")
        .bind(this.userId, REVIEW_OPERATION, request.idempotencyKey).first<{ payload_hash: string; response_json: string }>();
      if (!row) return null;
      await this.reviewAccess(recordId, request, unlocked);
      if (row.payload_hash !== payloadHash) fail("idempotency_conflict", "This request key belongs to a different review.");
      const receipt = JSON.parse(row.response_json) as LinkFragmentReviewReceipt, fragment = await readFragment();
      await this.reviewAccess(recordId, request, unlocked);
      if (!fragment || fragment.state_version !== receipt.stateVersion || fragment.review_status !== receipt.reviewStatus) fail("link_fragment_conflict", "This fragment has changed since the saved review.");
      return { fragmentId, reviewStatus: receipt.reviewStatus, stateVersion: receipt.stateVersion, replayed: true };
    };
    const existing = await replay();
    if (existing) return existing;
    const fragment = await readFragment();
    if (!fragment) fail("link_fragment_not_found", "The fragment does not belong to the current analysis.");
    if (fragment.state_version !== request.expectedStateVersion || fragment.review_status === "superseded") fail("link_fragment_conflict", "The fragment review state changed.");
    const reviewStatus = request.action === "confirm" ? "confirmed" : "rejected";
    const receipt: LinkFragmentReviewReceipt = { fragmentId, reviewStatus, stateVersion: request.expectedStateVersion + 1, replayed: false };
    const visibility = await legacyProjectionVisibilityPredicate(this.db), now = new Date().toISOString();
    const guard = `exists (select 1 from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_link_fragments f on f.document_object_id=d.object_id and f.user_id=o.user_id
      join v2_processing_runs r on r.id=f.processing_run_id and r.user_id=f.user_id
      join v2_processing_jobs j on j.id=r.job_id and j.user_id=r.user_id and j.object_id=d.object_id and j.capture_id=d.capture_id
      join v2_link_snapshots s on s.id=f.snapshot_id and s.user_id=f.user_id and s.document_object_id=d.object_id and s.capture_id=d.capture_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility}
      and (?=1 or d.privacy_level<>'restricted') and d.current_revision_id=? and d.current_link_snapshot_id=? and d.published_link_run_id=?
      and f.id=? and f.snapshot_id=d.current_link_snapshot_id and f.processing_run_id=d.published_link_run_id and f.state_version=? and f.review_status<>'superseded'
      and j.stage='link_analyze' and j.input_revision_id=d.current_revision_id and j.input_link_snapshot_id=s.id
      and j.input_source_manifest_hash=s.manifest_hash and j.input_source_manifest_version=s.manifest_version and r.input_hash=j.input_hash and r.status in ('succeeded','partial'))`;
    try {
      await this.db.batch([
        this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
          values(case when ${guard} then ? else null end,?,'link.fragment_reviewed','document',?,?,?)`)
          .bind(recordId, this.userId, unlocked ? 1 : 0, request.expectedRevisionId, request.expectedSnapshotId, request.expectedRunId, fragmentId,
            request.expectedStateVersion, ulid(), this.userId, recordId, canonicalLinkJson({ fragmentId, runId: request.expectedRunId, reviewStatus }), now),
        this.db.prepare("update v2_link_fragments set review_status=?,locked_by_user=1,state_version=state_version+1 where id=? and user_id=? and state_version=?")
          .bind(reviewStatus, fragmentId, this.userId, request.expectedStateVersion),
        this.db.prepare(`insert into v2_idempotency_records(user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
          values(?,?,case when exists(select 1 from v2_link_fragments where id=? and user_id=? and state_version=? and review_status=?) then ? else null end,?,?,200,?)`)
          .bind(this.userId, REVIEW_OPERATION, fragmentId, this.userId, receipt.stateVersion, reviewStatus, request.idempotencyKey, payloadHash, canonicalLinkJson(receipt), now),
      ]);
    } catch (error) {
      await this.reviewAccess(recordId, request, unlocked);
      const concurrent = await replay();
      if (concurrent) return concurrent;
      if (/NOT NULL constraint failed|UNIQUE constraint failed/.test(error instanceof Error ? error.message : String(error))) fail("link_fragment_conflict", "The fragment changed before the review could be saved.");
      throw error;
    }
    await this.reviewAccess(recordId, request, unlocked);
    const final = await readFragment();
    await this.reviewAccess(recordId, request, unlocked);
    if (!final || final.state_version !== receipt.stateVersion || final.review_status !== receipt.reviewStatus) fail("link_fragment_conflict", "The fragment changed after the review was saved.");
    return receipt;
  }
}
