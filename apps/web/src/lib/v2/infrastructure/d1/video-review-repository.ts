import { ulid } from "ulidx";

import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { readVideoAnalysisSource, renderVideoAnalysisText, type VideoAnalysisSourceV1 } from "@/lib/v2/domain/video-analysis-source";
import { VIDEO_REVIEW_CONTRACT, VideoReviewError, videoReviewItemKey, videoReviewItems, videoReviewNoteFingerprint, videoReviewStableJson, type VideoReviewProjection, type VideoReviewReceipt, type VideoReviewRequest } from "@/lib/v2/domain/video-review-v1";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { videoAnalysisProofSql } from "@/lib/v2/infrastructure/d1/video-analysis-provenance";

type Access = { current_revision_id: string; current_link_snapshot_id: string | null; link_snapshot_version: number; privacy_level: string; raw_text: string; content_hash: string; source_metadata: string; is_current: number };
type Options = { restrictedExpiresAt?: string; writeEnabled?: boolean };
type JournalRow = { payload_json: string; action: string; result_status: string; created_at: string; prior_status: string; target_id: string | null; id: string };
type JournalPayload = { contract: typeof VIDEO_REVIEW_CONTRACT; noteFingerprint: string; itemKey: string; stateVersion: number; idempotencyKey: string; requestHash: string };

/** The existing canonical review journal stores user decisions, not AI facts.
 * Sources and their searchable immutable text are never rewritten by a review. */
export class D1VideoReviewRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async source(recordId: string, sourceItemId: string, options: Options) {
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db.prepare(`select d.current_revision_id,d.current_link_snapshot_id,d.link_snapshot_version,d.privacy_level,s.raw_text,s.content_hash,s.source_metadata,
      exists (select 1 from v2_link_snapshot_sources current_member where current_member.snapshot_id=d.current_link_snapshot_id and current_member.source_item_id=s.id and current_member.user_id=o.user_id) as is_current
      from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_document_source_links source_link on source_link.document_object_id=d.object_id
      join v2_source_items s on s.id=source_link.source_item_id and s.user_id=o.user_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status='active' and s.id=? and ${visibility} and ${videoAnalysisProofSql()} limit 1`)
      .bind(recordId, this.userId, sourceItemId).first<Access>();
    if (!row) throw new VideoReviewError("video_review_not_found", "영상 분석 노트를 찾을 수 없습니다.");
    if (row.privacy_level === "restricted" && !(options.restrictedExpiresAt && Date.parse(options.restrictedExpiresAt) > Date.now())) {
      throw new VideoReviewError("restricted_record_locked", "민감 기록을 다시 인증한 뒤 영상 노트를 확인해 주세요.");
    }
    let note: VideoAnalysisSourceV1 | null = null;
    try { note = readVideoAnalysisSource(JSON.parse(row.source_metadata)); } catch { /* invalid source fails closed */ }
    if (!note || renderVideoAnalysisText(note) !== row.raw_text || `sha256:${await linkSha256Hex(row.raw_text)}` !== row.content_hash) {
      throw new VideoReviewError("video_review_not_found", "보존 정보가 맞는 영상 분석 노트를 찾을 수 없습니다.");
    }
    return { row, note, fingerprint: await videoReviewNoteFingerprint(note, row.content_hash) };
  }

  private async journal(recordId: string, fingerprint: string) {
    const result = await this.db.prepare(`select r.id,r.payload_json,rr.action,rr.result_status,rr.prior_status,rr.created_at,rr.target_id
      from v2_review_items r left join v2_review_receipts rr on rr.review_item_id=r.id and rr.user_id=r.user_id and rr.object_id=r.object_id and rr.target_kind='review_item'
      where r.user_id=? and r.object_id=? and r.kind='analysis_review' and r.processing_run_id is null and r.status='resolved'
      and case when json_valid(r.payload_json) then json_extract(r.payload_json,'$.contract') end=?
      and json_extract(r.payload_json,'$.noteFingerprint')=?`)
      .bind(this.userId, recordId, VIDEO_REVIEW_CONTRACT, fingerprint).all<JournalRow>();
    return result.results.map((row) => {
      const payload = JSON.parse(row.payload_json) as JournalPayload;
      if (row.target_id !== null || !["accept", "reject"].includes(row.action)
        || row.result_status !== (row.action === "accept" ? "confirmed" : "rejected")
        || !Number.isSafeInteger(payload.stateVersion) || payload.stateVersion < 1 || !Number.isFinite(Date.parse(row.created_at))
        || typeof payload.itemKey !== "string" || typeof payload.idempotencyKey !== "string" || !/^[a-f0-9]{64}$/.test(payload.requestHash)) {
        throw new VideoReviewError("video_review_history_invalid", "영상 노트의 사용자 판단 이력을 확인할 수 없습니다.");
      }
      return { row, payload };
    });
  }

  async project(recordId: string, sourceItemId: string, options: Options = {}): Promise<VideoReviewProjection> {
    const { row, note, fingerprint } = await this.source(recordId, sourceItemId, options);
    const journal = await this.journal(recordId, fingerprint);
    const items = videoReviewItems(note).map((item) => {
      const history = journal.filter((entry) => entry.payload.itemKey === item.itemKey).sort((a, b) => a.payload.stateVersion - b.payload.stateVersion);
      for (let index = 0; index < history.length; index++) if (history[index].payload.stateVersion !== index + 1
        || history[index].row.prior_status !== (index ? history[index - 1].row.result_status : "unreviewed")) {
        throw new VideoReviewError("video_review_history_invalid", "영상 노트 판단 이력의 버전이 맞지 않습니다.");
      }
      const latest = history.at(-1);
      return latest ? { ...item, status: latest.row.result_status as "confirmed" | "rejected", stateVersion: latest.payload.stateVersion, reviewedAt: latest.row.created_at } : item;
    });
    if (journal.some((entry) => !items.some((item) => item.itemKey === entry.payload.itemKey))) throw new VideoReviewError("video_review_history_invalid", "영상 노트의 항목과 판단 이력이 맞지 않습니다.");
    const final = await this.source(recordId, sourceItemId, options);
    if (final.row.current_revision_id !== row.current_revision_id || final.row.current_link_snapshot_id !== row.current_link_snapshot_id || final.row.link_snapshot_version !== row.link_snapshot_version || final.fingerprint !== fingerprint) {
      throw new VideoReviewError("video_review_conflict", "기록이나 선택한 원문 버전이 바뀌었습니다. 다시 불러와 주세요.");
    }
    return { contract: VIDEO_REVIEW_CONTRACT, recordId, sourceItemId, contentHash: row.content_hash,
      currentRevisionId: row.current_revision_id, currentSnapshotId: row.current_link_snapshot_id, currentSnapshotVersion: row.link_snapshot_version,
      canReview: options.writeEnabled === true && row.is_current === 1, items };
  }

  private async replay(recordId: string, request: VideoReviewRequest, requestHash: string, fingerprint: string): Promise<VideoReviewReceipt | null> {
    const row = await this.db.prepare(`select r.id,r.payload_json,rr.action,rr.result_status,rr.prior_status,rr.created_at,rr.target_id
      from v2_review_items r join v2_review_receipts rr on rr.review_item_id=r.id and rr.user_id=r.user_id and rr.object_id=r.object_id and rr.target_kind='review_item'
      where r.user_id=? and r.object_id=? and r.kind='analysis_review' and r.status='resolved' and r.processing_run_id is null
      and case when json_valid(r.payload_json) then json_extract(r.payload_json,'$.contract') end=?
      and json_extract(r.payload_json,'$.idempotencyKey')=? limit 1`)
      .bind(this.userId, recordId, VIDEO_REVIEW_CONTRACT, request.idempotencyKey).first<JournalRow>();
    if (!row) return null;
    const payload = JSON.parse(row.payload_json) as JournalPayload;
    if (payload.requestHash !== requestHash || payload.noteFingerprint !== fingerprint) throw new VideoReviewError("video_review_conflict", "같은 요청 번호에 다른 판단이나 노트를 보낼 수 없습니다.");
    if (row.target_id !== null || payload.itemKey !== videoReviewItemKey(request.kind, request.index)
      || payload.stateVersion !== request.expectedStateVersion + 1 || row.action !== (request.action === "confirm" ? "accept" : "reject")
      || row.result_status !== (request.action === "confirm" ? "confirmed" : "rejected")) {
      throw new VideoReviewError("video_review_history_invalid", "영상 노트 판단 영수증이 원 요청과 맞지 않습니다.");
    }
    return { itemKey: payload.itemKey, status: row.result_status as "confirmed" | "rejected", stateVersion: payload.stateVersion, reviewedAt: row.created_at, replayed: true };
  }

  async resolve(recordId: string, sourceItemId: string, input: VideoReviewRequest, options: Options = {}) {
    const source = await this.source(recordId, sourceItemId, options);
    const requestHash = await linkSha256Hex(videoReviewStableJson({ recordId, sourceItemId, ...input }));
    const priorReceipt = await this.replay(recordId, input, requestHash, source.fingerprint);
    if (priorReceipt) { await this.source(recordId, sourceItemId, options); return priorReceipt; }
    const projection = await this.project(recordId, sourceItemId, { ...options, writeEnabled: true });
    const itemKey = videoReviewItemKey(input.kind, input.index);
    const item = projection.items.find((candidate) => candidate.itemKey === itemKey);
    if (!item) throw new VideoReviewError("video_review_invalid", "이 노트에 없는 항목입니다.");
    if (!projection.canReview || projection.currentRevisionId !== input.expectedRevisionId || projection.currentSnapshotId !== input.expectedSnapshotId
      || projection.currentSnapshotVersion !== input.expectedSnapshotVersion || projection.contentHash !== input.contentHash || item.stateVersion !== input.expectedStateVersion) {
      throw new VideoReviewError("video_review_conflict", "기록이나 사용자 판단이 바뀌었습니다. 최신 상태를 불러온 뒤 다시 판단해 주세요.");
    }
    const now = new Date().toISOString(), reviewId = ulid(), status = input.action === "confirm" ? "confirmed" : "rejected";
    const payload: JournalPayload = { contract: VIDEO_REVIEW_CONTRACT, noteFingerprint: source.fingerprint, itemKey, stateVersion: item.stateVersion + 1, idempotencyKey: input.idempotencyKey, requestHash };
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const gate = `exists (select 1 from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_document_source_links source_link on source_link.document_object_id=d.object_id
      join v2_source_items s on s.id=source_link.source_item_id and s.user_id=o.user_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status='active' and s.id=? and s.content_hash=? and s.source_metadata=? and s.raw_text=?
      and d.current_revision_id=? and d.current_link_snapshot_id=? and d.link_snapshot_version=?
      and (d.privacy_level<>'restricted' or julianday(?)>julianday('now')) and ${visibility} and ${videoAnalysisProofSql()}
      and exists (select 1 from v2_link_snapshot_sources member where member.snapshot_id=d.current_link_snapshot_id and member.source_item_id=s.id and member.user_id=o.user_id))`;
    try {
      await this.db.batch([
        this.db.prepare(`insert into v2_review_items(id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at,resolved_at)
          values (case when ${gate}
          and (select count(*) from v2_review_items r where r.user_id=? and r.object_id=? and r.kind='analysis_review' and r.processing_run_id is null
            and case when json_valid(r.payload_json) then json_extract(r.payload_json,'$.contract') end=?
            and json_extract(r.payload_json,'$.noteFingerprint')=? and json_extract(r.payload_json,'$.itemKey')=?)=?
          and not exists (select 1 from v2_review_items r where r.user_id=? and r.object_id=?
            and case when json_valid(r.payload_json) then json_extract(r.payload_json,'$.contract') end=? and json_extract(r.payload_json,'$.idempotencyKey')=?)
          then ? else null end,?,?,null,'analysis_review','resolved',?,?,?)`)
          .bind(recordId, this.userId, sourceItemId, input.contentHash, source.row.source_metadata, source.row.raw_text, input.expectedRevisionId, input.expectedSnapshotId, input.expectedSnapshotVersion, options.restrictedExpiresAt ?? null,
            this.userId, recordId, VIDEO_REVIEW_CONTRACT, source.fingerprint, itemKey, input.expectedStateVersion, this.userId, recordId, VIDEO_REVIEW_CONTRACT, input.idempotencyKey,
            reviewId, this.userId, recordId, JSON.stringify(payload), now, now),
        this.db.prepare(`insert into v2_review_receipts(id,review_item_id,user_id,object_id,action,target_kind,target_id,prior_status,result_status,high_risk_confirmed,created_at)
          values (?,?,?,?,?,'review_item',null,?,?,0,?)`).bind(ulid(), reviewId, this.userId, recordId, input.action === "confirm" ? "accept" : "reject", item.status, status, now),
        this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
          values (?,?,'video_item.reviewed','document',?,?,?)`).bind(ulid(), this.userId, recordId, JSON.stringify({ reviewId, itemKey, status, stateVersion: payload.stateVersion }), now),
      ]);
    } catch (error) {
      const currentSource = await this.source(recordId, sourceItemId, options);
      const replayed = await this.replay(recordId, input, requestHash, currentSource.fingerprint);
      if (replayed) { await this.source(recordId, sourceItemId, options); return replayed; }
      const fresh = await this.project(recordId, sourceItemId, { ...options, writeEnabled: true });
      if (!fresh.canReview || fresh.currentRevisionId !== input.expectedRevisionId || fresh.currentSnapshotId !== input.expectedSnapshotId
        || fresh.currentSnapshotVersion !== input.expectedSnapshotVersion || fresh.items.find((candidate) => candidate.itemKey === itemKey)?.stateVersion !== input.expectedStateVersion) {
        throw new VideoReviewError("video_review_conflict", "다른 화면에서 기록이나 사용자 판단이 바뀌었습니다. 최신 상태를 불러와 주세요.");
      }
      throw error;
    }
    await this.source(recordId, sourceItemId, options);
    return { itemKey, status, stateVersion: payload.stateVersion, reviewedAt: now, replayed: false } satisfies VideoReviewReceipt;
  }
}
