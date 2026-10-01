import { ulid } from "ulidx";

import {
  canonicalLinkJson, createLinkSourceFingerprint, hashLinkSourceManifest, LINK_SNAPSHOT_MANIFEST_VERSION,
  LINK_SNAPSHOT_MAX_SOURCES, linkSha256Hex, LinkSnapshotError, normalizeLinkHash,
  type LinkSnapshotAttachmentV1, type LinkSnapshotMemberV1, type LinkSnapshotV1,
} from "@/lib/v2/domain/link-snapshot-v1";
import { MANUAL_LINK_LIMITS, normalizeManualLinkSource, readManualLinkSource, type ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import { PUBLIC_FETCH_SOURCE_CONTRACT, readPublicFetchSource, type PublicFetchSourceV1 } from "@/lib/v2/domain/public-fetch-source";
import {
  parseYouTubeVideoUrl, readVideoAnalysisSource, renderVideoAnalysisText, VIDEO_ANALYSIS_ADAPTER_VERSION, VIDEO_ANALYSIS_LIMITS,
  VIDEO_ANALYSIS_SOURCE_CONTRACT, type VideoAnalysisSourceV1,
} from "@/lib/v2/domain/video-analysis-source";
import { VIDEO_ANALYSIS_PROMPT_VERSION, type ResolvedVideoAnalysis } from "@/lib/v2/ai/video-analysis-v1";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

const OPERATION = "link_snapshot.create.v1";
const ADAPTER_VERSION = "manual-link-snapshot.v1";
const PUBLIC_FETCH_OPERATION = "link_snapshot.public_fetch.v1";
const PUBLIC_FETCH_ADAPTER = "public-web-fetch.v1";
const VIDEO_ANALYSIS_OPERATION = "link_snapshot.video_analysis.v1";
/** Only this server adapter may introduce an AI video note into a snapshot. */
const VIDEO_ANALYSIS_ORIGIN = `${VIDEO_ANALYSIS_ADAPTER_VERSION}|api`;

type DocumentRow = {
  object_id: string; capture_id: string; current_revision_id: string; current_link_snapshot_id: string | null;
  link_snapshot_version: number; privacy_level: string;
};
type SnapshotRow = {
  id: string; user_id: string; document_object_id: string; capture_id: string; parent_snapshot_id: string | null;
  snapshot_version: number; manifest_version: typeof LINK_SNAPSHOT_MANIFEST_VERSION; manifest_hash: string;
  acquisition_method: LinkSnapshotV1["acquisitionMethod"]; adapter_version: string; capture_state: LinkSnapshotV1["captureState"];
  coverage_json: string; created_at: string;
};
type SourceRow = {
  id: string; item_kind: string; raw_text: string | null; content_hash: string; source_metadata: string | null;
  attachment_id: string | null; attachment_hash: string | null; mime_type: string | null; size_bytes: number | null; filename: string | null;
  introduced_by: string | null;
};
type MemberRow = { id: string; snapshot_id: string; source_item_id: string; member_key: string; source_order: number; source_fingerprint: string };
type LoadedSource = Omit<LinkSnapshotMemberV1, "id" | "snapshotId" | "memberKey" | "sourceOrder">;
export type LinkSnapshotProjection = Readonly<{ documentRevisionId: string; snapshot: LinkSnapshotV1; members: readonly LinkSnapshotMemberV1[] }>;
export type LinkSnapshotReceipt = LinkSnapshotProjection & Readonly<{ replayed: boolean }>;
export type CreateLinkSnapshotInput = Readonly<{
  documentId: string;
  expectedRevisionId: string;
  expectedSnapshotId: string | null;
  expectedSnapshotVersion: number;
  sourceItemIds: readonly string[];
  newManualSources?: readonly Readonly<{ rawText: string; metadata: Readonly<Record<string, unknown>> }>[];
  idempotencyKey: string;
  restrictedUnlocked?: boolean;
  now?: string;
}>;
export type PublicFetchAttempt = Readonly<{
  state: "captured" | "partial" | "needs_input" | "unavailable";
  reason: string | null;
  sourceUrl: string;
  finalUrl: string | null;
  mimeType: "text/plain" | "text/html" | null;
  rawText: string | null;
  extraction: "plain_text" | "html_visible_text_v1" | null;
}>;
export type PublicFetchSnapshotRequest = Readonly<{
  documentId: string;
  sourceItemId: string;
  expectedRevisionId: string;
  expectedSnapshotId: string | null;
  expectedSnapshotVersion: number;
  idempotencyKey: string;
}>;
export type PublicFetchCandidate = Readonly<{
  url: string;
  replayed: LinkSnapshotReceipt | null;
}>;
export type VideoAnalysisSnapshotRequest = Readonly<{
  documentId: string;
  sourceItemId: string;
  expectedRevisionId: string;
  expectedSnapshotId: string | null;
  expectedSnapshotVersion: number;
  /** Null uses the saved link's start time (or 0) and a default window. */
  startSeconds: number | null;
  endSeconds: number | null;
  idempotencyKey: string;
  now?: string;
}>;
export type VideoAnalysisCandidate = Readonly<{
  requestedUrl: string;
  videoId: string;
  videoUrl: string;
  purpose: ManualLinkSourceV1["purpose"];
  range: Readonly<{ startSeconds: number; endSeconds: number }>;
  replayed: LinkSnapshotReceipt | null;
}>;
export type VideoAnalysisResultInput = Readonly<{ result: ResolvedVideoAnalysis; modelId: string }>;
type VideoAnalysisAcquisition = Readonly<{ sourceItemId: string; added: LoadedSource; coverage: Readonly<Record<string, unknown>> }>;

function metadataObject(value: string | null): Readonly<Record<string, unknown>> | null {
  if (value === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new LinkSnapshotError("link_source_metadata_invalid", "Source metadata is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new LinkSnapshotError("link_source_metadata_invalid", "Source metadata must be an object.");
  return parsed as Record<string, unknown>;
}

function validateIdempotencyKey(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new LinkSnapshotError("link_snapshot_invalid", "Provide an idempotency key of at most 200 characters.");
  }
}

function snapshotProjection(row: SnapshotRow): LinkSnapshotV1 {
  return {
    id: row.id, userId: row.user_id, documentId: row.document_object_id, captureId: row.capture_id,
    parentSnapshotId: row.parent_snapshot_id, snapshotVersion: row.snapshot_version, manifestVersion: row.manifest_version,
    manifestHash: row.manifest_hash, acquisitionMethod: row.acquisition_method, adapterVersion: row.adapter_version,
    captureState: row.capture_state, coverage: metadataObject(row.coverage_json) ?? {}, createdAt: row.created_at,
  };
}

export class D1LinkSnapshotRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  async isAvailable() {
    const rows = await this.db.prepare("select name from sqlite_master where type='table' and name in ('v2_link_snapshots','v2_link_snapshot_sources','v2_link_fragments','v2_link_fragment_evidence')").all<{ name: string }>();
    if (rows.results.length !== 4) return false;
    const columns = await this.db.prepare("pragma table_info(v2_documents)").all<{ name: string }>();
    const jobColumns = await this.db.prepare("pragma table_info(v2_processing_jobs)").all<{ name: string }>();
    return ["current_link_snapshot_id", "link_snapshot_version", "published_link_run_id"].every((name) => columns.results.some((column) => column.name === name))
      && ["input_link_snapshot_id", "input_source_manifest_hash", "input_source_manifest_version"].every((name) => jobColumns.results.some((column) => column.name === name));
  }

  private async assertAvailable() {
    if (!await this.isAvailable()) throw new LinkSnapshotError("link_snapshot_schema_unavailable", "Link snapshots require migration 0031; the manual originals remain available.");
  }

  private async document(documentId: string, restrictedUnlocked: boolean): Promise<DocumentRow | null> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    return this.db.prepare(`select d.object_id,d.capture_id,d.current_revision_id,d.current_link_snapshot_id,d.link_snapshot_version,d.privacy_level
      from v2_documents d join v2_objects o on o.id=d.object_id join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility}
        and (?=1 or d.privacy_level<>'restricted') limit 1`).bind(documentId, this.userId, restrictedUnlocked ? 1 : 0).first<DocumentRow>();
  }

  private async loadSources(documentId: string, captureId: string, sourceItemIds: readonly string[]): Promise<LoadedSource[]> {
    if (!sourceItemIds.length) return [];
    // The earliest snapshot of this record that contains a source proves who introduced it.
    // Snapshots are immutable and only server adapters write 'api' snapshots, so user-editable
    // metadata alone can never claim AI video-analysis origin. Restore remaps both FKs together.
    const rows = await this.db.prepare(`select s.id,s.item_kind,s.raw_text,s.content_hash,s.source_metadata,
      a.id as attachment_id,a.sha256 as attachment_hash,a.mime_type,a.size_bytes,a.filename,
      (select origin.adapter_version||'|'||origin.acquisition_method from v2_link_snapshot_sources origin_member
        join v2_link_snapshots origin on origin.id=origin_member.snapshot_id and origin.user_id=origin_member.user_id
        where origin_member.source_item_id=s.id and origin_member.user_id=s.user_id and origin.document_object_id=?
        order by origin.snapshot_version limit 1) as introduced_by
      from v2_source_items s join v2_document_source_links dsl on dsl.source_item_id=s.id and dsl.document_object_id=?
      left join v2_source_attachment_links sal on sal.source_item_id=s.id and sal.user_id=s.user_id
      left join v2_attachment_reservations a on a.id=sal.attachment_id and a.user_id=s.user_id and a.status='committed'
      where s.user_id=? and s.capture_id=? and s.id in (${sourceItemIds.map(() => "?").join(",")})`)
      .bind(documentId, documentId, this.userId, captureId, ...sourceItemIds).all<SourceRow>();
    const result: LoadedSource[] = [];
    for (const sourceId of sourceItemIds) {
      const group = rows.results.filter((row) => row.id === sourceId);
      const source = group[0];
      if (!source) throw new LinkSnapshotError("link_source_not_found", "A selected original does not belong to this record.");
      const metadata = metadataObject(source.source_metadata);
      const manualLink = readManualLinkSource(metadata);
      const attachments: LinkSnapshotAttachmentV1[] = group.filter((row) => row.attachment_id !== null).map((row) => ({
        id: row.attachment_id!, sha256: row.attachment_hash!, mimeType: row.mime_type!, sizeBytes: row.size_bytes!, filename: row.filename!,
      }));
      const videoNote = source.item_kind === "transcript" && !attachments.length && source.introduced_by === VIDEO_ANALYSIS_ORIGIN
        && source.raw_text !== null && readVideoAnalysisSource(metadata) !== null;
      if (!(source.item_kind === "url" && manualLink) && !(["image", "audio", "video", "document"].includes(source.item_kind) && attachments.length) && !videoNote) {
        throw new LinkSnapshotError("link_source_not_external", "Select explicit manual link material or a verified attachment; user notes are not external sources.");
      }
      if (attachments.some((attachment) => normalizeLinkHash(attachment.sha256) !== normalizeLinkHash(source.content_hash))) {
        throw new LinkSnapshotError("link_source_hash_mismatch", "Attachment and source hashes do not match.");
      }
      result.push({ sourceItemId: source.id, kind: source.item_kind, rawText: source.raw_text, contentHash: source.content_hash,
        metadata, manualLink, attachments,
        sourceFingerprint: await createLinkSourceFingerprint({ kind: source.item_kind, contentHash: source.content_hash, rawText: source.raw_text, metadata, attachments }),
      });
    }
    return result;
  }

  async getCurrent(documentId: string, restrictedUnlocked = false): Promise<LinkSnapshotProjection | null> {
    await this.assertAvailable();
    const document = await this.document(documentId, restrictedUnlocked);
    if (!document?.current_link_snapshot_id) return null;
    return this.getSnapshot(documentId, document.current_link_snapshot_id, restrictedUnlocked);
  }

  async getSnapshot(documentId: string, snapshotId: string, restrictedUnlocked = false): Promise<LinkSnapshotProjection | null> {
    await this.assertAvailable();
    const document = await this.document(documentId, restrictedUnlocked);
    if (!document) return null;
    const snapshot = await this.db.prepare("select * from v2_link_snapshots where id=? and user_id=? and document_object_id=? and capture_id=? limit 1")
      .bind(snapshotId, this.userId, documentId, document.capture_id).first<SnapshotRow>();
    if (!snapshot) return null;
    const rows = await this.db.prepare("select * from v2_link_snapshot_sources where snapshot_id=? and user_id=? order by source_order")
      .bind(snapshotId, this.userId).all<MemberRow>();
    const sources = await this.loadSources(documentId, document.capture_id, rows.results.map((row) => row.source_item_id));
    const members: LinkSnapshotMemberV1[] = rows.results.map((row, index) => ({ ...sources[index], id: row.id, snapshotId: row.snapshot_id,
      memberKey: row.member_key, sourceOrder: row.source_order, sourceFingerprint: row.source_fingerprint }));
    if (members.some((member, index) => member.sourceFingerprint !== sources[index].sourceFingerprint)
      || snapshot.manifest_version !== LINK_SNAPSHOT_MANIFEST_VERSION || await hashLinkSourceManifest({ members }) !== snapshot.manifest_hash) {
      throw new LinkSnapshotError("link_snapshot_integrity_invalid", "The immutable snapshot manifest no longer matches its sources.");
    }
    // Check the visibility boundary once more after reading source contents.
    const currentDocument = await this.document(documentId, restrictedUnlocked);
    if (!currentDocument) return null;
    return { documentRevisionId: currentDocument.current_revision_id, snapshot: snapshotProjection(snapshot), members };
  }

  private async replay(documentId: string, idempotencyKey: string, payloadHash: string, restrictedUnlocked: boolean, operation = OPERATION) {
    const existing = await this.db.prepare("select payload_hash,response_json from v2_idempotency_records where user_id=? and operation=? and idempotency_key=? limit 1")
      .bind(this.userId, operation, idempotencyKey).first<{ payload_hash: string; response_json: string }>();
    if (!existing) return null;
    if (existing.payload_hash !== payloadHash) throw new LinkSnapshotError("idempotency_conflict", "This idempotency key belongs to another snapshot request.");
    const response = metadataObject(existing.response_json);
    const stored = typeof response?.snapshotId === "string" ? await this.getSnapshot(documentId, response.snapshotId, restrictedUnlocked) : null;
    if (!stored) throw new LinkSnapshotError("link_snapshot_not_found", "The replayed snapshot is not accessible.");
    return { ...stored, replayed: true };
  }

  async bootstrapManualSources(input: Readonly<{ documentId: string; expectedRevisionId: string; idempotencyKey: string; restrictedUnlocked?: boolean; now?: string }>): Promise<LinkSnapshotReceipt> {
    await this.assertAvailable();
    validateIdempotencyKey(input.idempotencyKey);
    const requestBasis = { kind: "bootstrap", documentId: input.documentId, expectedRevisionId: input.expectedRevisionId };
    const payloadHash = await linkSha256Hex(canonicalLinkJson(requestBasis));
    const replayed = await this.replay(input.documentId, input.idempotencyKey, payloadHash, Boolean(input.restrictedUnlocked));
    if (replayed) return replayed;
    const document = await this.document(input.documentId, Boolean(input.restrictedUnlocked));
    if (!document) throw new LinkSnapshotError("link_snapshot_not_found", "The record is not accessible.");
    if (document.current_revision_id !== input.expectedRevisionId) throw new LinkSnapshotError("link_snapshot_conflict", "The document revision changed.");
    if (document.current_link_snapshot_id) {
      const current = await this.getSnapshot(input.documentId, document.current_link_snapshot_id, Boolean(input.restrictedUnlocked));
      if (!current) throw new LinkSnapshotError("link_snapshot_not_found", "The current snapshot is not accessible.");
      return { ...current, replayed: true };
    }
    const rows = await this.db.prepare(`select s.id,s.item_kind,s.source_metadata from v2_source_items s
      join v2_document_source_links dsl on dsl.source_item_id=s.id and dsl.document_object_id=?
      where s.user_id=? and s.capture_id=? order by dsl.source_order,s.id`)
      .bind(input.documentId, this.userId, document.capture_id).all<{ id: string; item_kind: string; source_metadata: string | null }>();
    const sourceItemIds = rows.results.filter((source) => {
      if (["image", "audio", "video", "document"].includes(source.item_kind)) return true;
      return source.item_kind === "url" && readManualLinkSource(metadataObject(source.source_metadata));
    }).map((source) => source.id);
    return this.createSnapshotInternal({ ...input, expectedSnapshotId: null, expectedSnapshotVersion: 0, sourceItemIds }, payloadHash);
  }

  async createSnapshot(input: CreateLinkSnapshotInput): Promise<LinkSnapshotReceipt> {
    const payloadHash = await linkSha256Hex(canonicalLinkJson({ kind: "selection", documentId: input.documentId, expectedRevisionId: input.expectedRevisionId,
      expectedSnapshotId: input.expectedSnapshotId, expectedSnapshotVersion: input.expectedSnapshotVersion, sourceItemIds: input.sourceItemIds,
      newManualSources: input.newManualSources ?? [] }));
    return this.createSnapshotInternal(input, payloadHash);
  }

  private async publicFetchHash(input: PublicFetchSnapshotRequest) {
    return linkSha256Hex(canonicalLinkJson({ kind: "public_fetch", documentId: input.documentId, sourceItemId: input.sourceItemId,
      expectedRevisionId: input.expectedRevisionId, expectedSnapshotId: input.expectedSnapshotId,
      expectedSnapshotVersion: input.expectedSnapshotVersion }));
  }

  /** Resolve only a saved, URL-only original owned by this record. This read precedes all network work. */
  async publicFetchCandidate(input: PublicFetchSnapshotRequest): Promise<PublicFetchCandidate> {
    await this.assertAvailable();
    validateIdempotencyKey(input.idempotencyKey);
    const document = await this.document(input.documentId, false);
    if (!document) throw new LinkSnapshotError("link_snapshot_not_found", "The record is not accessible.");
    if (document.privacy_level === "restricted") throw new LinkSnapshotError("public_fetch_restricted_disabled", "Public fetching is unavailable for restricted records.");
    const [source] = await this.loadSources(input.documentId, document.capture_id, [input.sourceItemId]);
    if (!source.manualLink || source.manualLink.provider !== "web" || source.kind !== "url"
      || source.rawText?.trim() || readPublicFetchSource(source.metadata)) {
      throw new LinkSnapshotError("public_fetch_source_invalid", "Choose a saved URL-only public web source.");
    }
    const replayed = await this.replay(input.documentId, input.idempotencyKey, await this.publicFetchHash(input), false, PUBLIC_FETCH_OPERATION);
    if (replayed) return { url: source.manualLink.url, replayed };
    const beforeFetch = await this.document(input.documentId, false);
    if (!beforeFetch || beforeFetch.capture_id !== document.capture_id
      || beforeFetch.current_revision_id !== input.expectedRevisionId || beforeFetch.current_link_snapshot_id !== input.expectedSnapshotId
      || beforeFetch.link_snapshot_version !== input.expectedSnapshotVersion) {
      throw new LinkSnapshotError("link_snapshot_conflict", "The document revision or source snapshot changed.");
    }
    return { url: source.manualLink.url, replayed: null };
  }

  async createPublicFetchSnapshot(input: PublicFetchSnapshotRequest, collection: PublicFetchAttempt): Promise<LinkSnapshotReceipt> {
    const candidate = await this.publicFetchCandidate(input);
    if (candidate.replayed) return candidate.replayed;
    if (collection.sourceUrl !== candidate.url || !["captured", "partial", "needs_input", "unavailable"].includes(collection.state)
      || collection.reason !== null && !/^[a-z][a-z0-9_]{0,63}$/.test(collection.reason)) {
      throw new LinkSnapshotError("public_fetch_result_invalid", "The collection result does not match the saved URL.");
    }
    const hasText = typeof collection.rawText === "string" && Boolean(collection.rawText.trim());
    if ((collection.state === "captured" || collection.state === "partial") !== hasText
      || hasText && (collection.mimeType !== "text/plain" && collection.mimeType !== "text/html" || !collection.extraction || !collection.finalUrl)
      || new TextEncoder().encode(collection.rawText ?? "").byteLength > MANUAL_LINK_LIMITS.textBytes) {
      throw new LinkSnapshotError("public_fetch_result_invalid", "The fetched text or its provenance is invalid.");
    }
    const current = input.expectedSnapshotId ? await this.getCurrent(input.documentId) : null;
    if (input.expectedSnapshotId && (!current || current.snapshot.id !== input.expectedSnapshotId)) {
      throw new LinkSnapshotError("link_snapshot_conflict", "The source snapshot changed.");
    }
    const replacePrevious = Boolean(collection.rawText?.trim());
    const retained = current?.members.filter((member) => !replacePrevious
      || readPublicFetchSource(member.metadata)?.requestedSourceItemId !== input.sourceItemId)
      .map((member) => member.sourceItemId) ?? [];
    if (!retained.includes(input.sourceItemId)) retained.push(input.sourceItemId);
    return this.createSnapshotInternal({ ...input, sourceItemIds: retained }, await this.publicFetchHash(input), {
      operation: PUBLIC_FETCH_OPERATION, sourceItemId: input.sourceItemId, collection,
    });
  }

  private async videoAnalysisHash(input: VideoAnalysisSnapshotRequest, range: VideoAnalysisCandidate["range"]) {
    return linkSha256Hex(canonicalLinkJson({ kind: "video_analysis", documentId: input.documentId, sourceItemId: input.sourceItemId,
      expectedRevisionId: input.expectedRevisionId, expectedSnapshotId: input.expectedSnapshotId,
      expectedSnapshotVersion: input.expectedSnapshotVersion, startSeconds: range.startSeconds, endSeconds: range.endSeconds }));
  }

  /** Resolve a saved public YouTube link of this record. This read precedes any provider call. */
  async videoAnalysisCandidate(input: VideoAnalysisSnapshotRequest): Promise<VideoAnalysisCandidate> {
    await this.assertAvailable();
    validateIdempotencyKey(input.idempotencyKey);
    const document = await this.document(input.documentId, false);
    if (!document) throw new LinkSnapshotError("link_snapshot_not_found", "The record is not accessible.");
    if (document.privacy_level === "restricted") throw new LinkSnapshotError("video_analysis_restricted_disabled", "Video analysis is unavailable for restricted records.");
    const [source] = await this.loadSources(input.documentId, document.capture_id, [input.sourceItemId]);
    const manualLink = source.kind === "url" ? source.manualLink : null;
    const video = manualLink?.provider === "youtube" && !readPublicFetchSource(source.metadata) ? parseYouTubeVideoUrl(manualLink.url) : null;
    if (!manualLink || !video) throw new LinkSnapshotError("video_analysis_source_invalid", "Choose a saved public YouTube video link.");
    const limits = VIDEO_ANALYSIS_LIMITS;
    const startSeconds = input.startSeconds ?? manualLink.startSeconds ?? 0;
    const savedEnd = input.startSeconds === null && manualLink.endSeconds !== null && manualLink.endSeconds > startSeconds
      && manualLink.endSeconds - startSeconds <= limits.maxWindowSeconds ? manualLink.endSeconds : null;
    const endSeconds = input.endSeconds ?? savedEnd ?? startSeconds + limits.defaultWindowSeconds;
    if (!Number.isSafeInteger(startSeconds) || !Number.isSafeInteger(endSeconds) || startSeconds < 0 || startSeconds > limits.maxStartSeconds
      || endSeconds <= startSeconds || endSeconds - startSeconds > limits.maxWindowSeconds) {
      throw new LinkSnapshotError("video_analysis_range_invalid", `Choose a range of at most ${limits.maxWindowSeconds / 60} minutes.`);
    }
    const range = { startSeconds, endSeconds };
    const replayed = await this.replay(input.documentId, input.idempotencyKey, await this.videoAnalysisHash(input, range), false, VIDEO_ANALYSIS_OPERATION);
    const candidate = { requestedUrl: manualLink.url, videoId: video.videoId, videoUrl: video.videoUrl, purpose: manualLink.purpose, range };
    if (replayed) return { ...candidate, replayed };
    const current = await this.document(input.documentId, false);
    if (!current || current.capture_id !== document.capture_id || current.current_revision_id !== input.expectedRevisionId
      || current.current_link_snapshot_id !== input.expectedSnapshotId || current.link_snapshot_version !== input.expectedSnapshotVersion) {
      throw new LinkSnapshotError("link_snapshot_conflict", "The document revision or source snapshot changed.");
    }
    return { ...candidate, replayed: null };
  }

  /** Saves a validated AI note as a new immutable source. Other clips of the same video stay;
   * only an earlier note for the exact same clip leaves the current selection (history keeps it). */
  async createVideoAnalysisSnapshot(input: VideoAnalysisSnapshotRequest, analysis: VideoAnalysisResultInput): Promise<LinkSnapshotReceipt> {
    const candidate = await this.videoAnalysisCandidate(input);
    if (candidate.replayed) return candidate.replayed;
    const now = input.now ?? new Date().toISOString();
    const result = analysis.result;
    const videoAnalysisV1: VideoAnalysisSourceV1 = {
      contract: VIDEO_ANALYSIS_SOURCE_CONTRACT, requestedSourceItemId: input.sourceItemId, requestedUrl: candidate.requestedUrl,
      videoId: candidate.videoId, videoUrl: candidate.videoUrl,
      requestedStartSeconds: candidate.range.startSeconds, requestedEndSeconds: candidate.range.endSeconds,
      observedEndSeconds: result.observedEndSeconds, timecodeBasis: result.timecodeBasis, analyzedAt: now,
      modelId: analysis.modelId, promptVersion: VIDEO_ANALYSIS_PROMPT_VERSION, method: "gemini_youtube_url",
      originalVideoStored: false, captionsAcquired: false, summary: result.summary,
      segments: result.segments, speech: result.speech, screenText: result.screenText, limitations: result.limitations,
    };
    const metadata = { videoAnalysisV1 };
    if (!readVideoAnalysisSource(metadata)) throw new LinkSnapshotError("video_analysis_result_invalid", "The video analysis result is not a valid note.");
    const rawText = renderVideoAnalysisText(videoAnalysisV1);
    if (new TextEncoder().encode(rawText).byteLength > VIDEO_ANALYSIS_LIMITS.textBytes) {
      throw new LinkSnapshotError("video_analysis_result_invalid", "The video analysis note exceeds the preserved-text limit.");
    }
    const contentHash = `sha256:${await linkSha256Hex(rawText)}`;
    const added: LoadedSource = { sourceItemId: ulid(), kind: "transcript", rawText, contentHash, metadata, manualLink: null, attachments: [],
      sourceFingerprint: await createLinkSourceFingerprint({ kind: "transcript", contentHash, rawText, metadata, attachments: [] }) };
    const current = input.expectedSnapshotId ? await this.getCurrent(input.documentId) : null;
    if (input.expectedSnapshotId && (!current || current.snapshot.id !== input.expectedSnapshotId)) {
      throw new LinkSnapshotError("link_snapshot_conflict", "The source snapshot changed.");
    }
    const sameClip = (value: unknown) => {
      const note = readVideoAnalysisSource(value);
      return note?.requestedSourceItemId === input.sourceItemId && note.requestedStartSeconds === candidate.range.startSeconds
        && note.requestedEndSeconds === candidate.range.endSeconds;
    };
    const retained = current?.members.filter((member) => !(member.kind === "transcript" && sameClip(member.metadata)))
      .map((member) => member.sourceItemId) ?? [];
    if (!retained.includes(input.sourceItemId)) retained.push(input.sourceItemId);
    const coverage = { scope: "youtube_video_analysis", requestedSourceItemId: input.sourceItemId,
      requestedRange: { startSeconds: candidate.range.startSeconds, endSeconds: candidate.range.endSeconds },
      observedEndSeconds: result.observedEndSeconds, timecodeBasis: result.timecodeBasis, selectedSources: retained.length + 1,
      sampling: "provider_frame_and_audio_sampling", originalVideoStored: false, captionsAcquired: false,
      fullExternalScope: "unverified", analysis: "ai_video_note" };
    return this.createSnapshotInternal({ ...input, sourceItemIds: retained, now }, await this.videoAnalysisHash(input, candidate.range),
      undefined, { sourceItemId: input.sourceItemId, added, coverage });
  }

  private async createSnapshotInternal(input: CreateLinkSnapshotInput, payloadHash: string,
    publicFetch?: { operation: typeof PUBLIC_FETCH_OPERATION; sourceItemId: string; collection: PublicFetchAttempt },
    videoAnalysis?: VideoAnalysisAcquisition): Promise<LinkSnapshotReceipt> {
    await this.assertAvailable();
    validateIdempotencyKey(input.idempotencyKey);
    const operation = publicFetch?.operation ?? (videoAnalysis ? VIDEO_ANALYSIS_OPERATION : OPERATION);
    const replayed = await this.replay(input.documentId, input.idempotencyKey, payloadHash, Boolean(input.restrictedUnlocked), operation);
    if (replayed) return replayed;
    if (!Number.isSafeInteger(input.expectedSnapshotVersion) || input.expectedSnapshotVersion < 0 || (input.expectedSnapshotVersion === 0) !== (input.expectedSnapshotId === null)) {
      throw new LinkSnapshotError("link_snapshot_invalid", "Snapshot version and parent pointer do not agree.");
    }
    if (new Set(input.sourceItemIds).size !== input.sourceItemIds.length || input.sourceItemIds.some((id) => typeof id !== "string" || !id)) throw new LinkSnapshotError("link_snapshot_invalid", "Select each source exactly once.");
    const totalCount = input.sourceItemIds.length + (input.newManualSources?.length ?? 0)
      + (publicFetch?.collection.rawText?.trim() ? 1 : 0) + (videoAnalysis ? 1 : 0);
    if (totalCount < 1 || totalCount > LINK_SNAPSHOT_MAX_SOURCES) throw new LinkSnapshotError("link_snapshot_invalid", "Select between 1 and 40 source items.");
    const now = input.now ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(now))) throw new LinkSnapshotError("link_snapshot_invalid", "Snapshot creation time is invalid.");
    const document = await this.document(input.documentId, Boolean(input.restrictedUnlocked));
    if (!document) throw new LinkSnapshotError("link_snapshot_not_found", "The record is not accessible.");
    if (document.current_revision_id !== input.expectedRevisionId || document.current_link_snapshot_id !== input.expectedSnapshotId || document.link_snapshot_version !== input.expectedSnapshotVersion) {
      throw new LinkSnapshotError("link_snapshot_conflict", "The document revision or source snapshot changed.");
    }
    const existing = await this.loadSources(input.documentId, document.capture_id, input.sourceItemIds);
    const added: LoadedSource[] = [];
    for (const source of input.newManualSources ?? []) {
      if (typeof source.rawText !== "string") throw new LinkSnapshotError("link_snapshot_invalid", "A pasted original must be text.");
      let manualLink;
      try { manualLink = normalizeManualLinkSource(source.metadata?.manualLinkV1); }
      catch (error) { throw new LinkSnapshotError("link_snapshot_invalid", error instanceof Error ? error.message : "The manual source metadata is invalid."); }
      if (!source.rawText.trim() && manualLink.completeness === "complete") throw new LinkSnapshotError("link_snapshot_invalid", "An empty original cannot be complete.");
      const metadata = { manualLinkV1: manualLink };
      const contentHash = `sha256:${await linkSha256Hex(source.rawText)}`;
      added.push({ sourceItemId: ulid(), kind: "url", rawText: source.rawText, contentHash, metadata, manualLink, attachments: [],
        sourceFingerprint: await createLinkSourceFingerprint({ kind: "url", contentHash, rawText: source.rawText, metadata, attachments: [] }) });
    }
    if (publicFetch?.collection.rawText) {
      const original = existing.find((source) => source.sourceItemId === publicFetch.sourceItemId);
      if (!original?.manualLink || original.manualLink.provider !== "web" || original.rawText?.trim()
        || original.manualLink.url !== publicFetch.collection.sourceUrl) {
        throw new LinkSnapshotError("public_fetch_source_invalid", "The fetched text no longer matches its saved URL.");
      }
      const collection = publicFetch.collection;
      const fetchedText = collection.rawText!;
      const manualLink = normalizeManualLinkSource({ ...original.manualLink,
        completeness: collection.state === "captured" ? "complete" : "partial", publisher: null });
      const publicFetchV1: PublicFetchSourceV1 = {
        contract: PUBLIC_FETCH_SOURCE_CONTRACT, requestedSourceItemId: original.sourceItemId,
        requestedUrl: collection.sourceUrl, finalUrl: collection.finalUrl!, fetchedAt: now,
        contentType: collection.mimeType!, extractionVersion: collection.extraction!,
      };
      const metadata = { manualLinkV1: manualLink, publicFetchV1 };
      const contentHash = `sha256:${await linkSha256Hex(fetchedText)}`;
      added.push({ sourceItemId: ulid(), kind: "url", rawText: fetchedText, contentHash, metadata, manualLink, attachments: [],
        sourceFingerprint: await createLinkSourceFingerprint({ kind: "url", contentHash, rawText: fetchedText, metadata, attachments: [] }) });
    }
    if (videoAnalysis) {
      const original = existing.find((source) => source.sourceItemId === videoAnalysis.sourceItemId);
      const note = readVideoAnalysisSource(videoAnalysis.added.metadata);
      if (!original?.manualLink || original.manualLink.provider !== "youtube" || original.kind !== "url"
        || !note || note.requestedSourceItemId !== original.sourceItemId || note.requestedUrl !== original.manualLink.url) {
        throw new LinkSnapshotError("video_analysis_source_invalid", "The analyzed video no longer matches its saved link.");
      }
      added.push(videoAnalysis.added);
    }
    const sources = [...existing, ...added];
    if (!sources.some((source) => source.manualLink)) throw new LinkSnapshotError("link_snapshot_invalid", "A link snapshot needs at least one explicitly identified external link source.");
    if (sources.filter((source) => source.manualLink).length > MANUAL_LINK_LIMITS.sources || sources.reduce((total, source) => total + (source.manualLink ? new TextEncoder().encode(source.rawText ?? "").byteLength : 0), 0) > MANUAL_LINK_LIMITS.textBytes) {
      throw new LinkSnapshotError("link_snapshot_invalid", "Manual link sources exceed the preserved-text limit.");
    }
    const prior = await this.db.prepare(`select m.source_item_id,m.member_key from v2_link_snapshot_sources m join v2_link_snapshots s on s.id=m.snapshot_id
      where s.user_id=? and s.document_object_id=? order by s.snapshot_version,m.source_order`).bind(this.userId, input.documentId).all<{ source_item_id: string; member_key: string }>();
    const keys = new Map<string, string>();
    for (const item of prior.results) if (!keys.has(item.source_item_id)) keys.set(item.source_item_id, item.member_key);
    const snapshotId = ulid();
    const members: LinkSnapshotMemberV1[] = sources.map((source, sourceOrder) => ({ ...source, id: ulid(), snapshotId,
      memberKey: keys.get(source.sourceItemId) ?? `member_${ulid()}`, sourceOrder }));
    const manifestHash = await hashLinkSourceManifest({ members });
    const coverage = videoAnalysis ? videoAnalysis.coverage : publicFetch ? { scope: "public_web_single_url", requestedSourceItemId: publicFetch.sourceItemId,
      selectedSources: sources.length, reason: publicFetch.collection.reason, fullExternalScope: "unverified", analysis: "not_started" }
      : { scope: "user_selected", selectedSources: sources.length, pastedTexts: sources.filter((source) => source.rawText?.trim()).length,
        attachmentSources: sources.filter((source) => source.attachments.length).length, fullExternalScope: "unverified", analysis: "not_started" };
    // An AI note from sampled frames and audio is never a complete capture of the video.
    const captureState = videoAnalysis ? "partial" : publicFetch?.collection.state
      ?? (sources.some((source) => source.rawText?.trim() || source.attachments.length) ? "partial" : "link_only");
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const guard = `exists (select 1 from v2_documents d join v2_objects o on o.id=d.object_id
      where d.object_id=? and o.user_id=? and d.current_revision_id=? and d.current_link_snapshot_id is ? and d.link_snapshot_version=?
      and o.lifecycle_status in ('active','archived') and ${visibility} and (?=1 or d.privacy_level<>'restricted'))`;
    const guardBindings = [input.documentId, this.userId, input.expectedRevisionId, input.expectedSnapshotId, input.expectedSnapshotVersion, input.restrictedUnlocked ? 1 : 0];
    // The NOT NULL sentinel fails the whole batch if the source/revision CAS was lost.
    // A zero-row parent UPDATE alone would not roll back child rows in a D1 batch.
    const statements: D1PreparedStatementBinding[] = [this.db.prepare(`insert into v2_link_snapshots
      (id,user_id,document_object_id,capture_id,parent_snapshot_id,snapshot_version,manifest_version,manifest_hash,acquisition_method,adapter_version,capture_state,coverage_json,created_at)
      values (case when ${guard} then ? else null end,?,?,?,?,?,? ,?,?,?,?,?,?)`)
      .bind(...guardBindings, snapshotId, this.userId, input.documentId, document.capture_id, input.expectedSnapshotId, input.expectedSnapshotVersion + 1,
        LINK_SNAPSHOT_MANIFEST_VERSION, manifestHash, publicFetch ? "public_fetch" : videoAnalysis ? "api" : "user_paste",
        publicFetch ? PUBLIC_FETCH_ADAPTER : videoAnalysis ? VIDEO_ANALYSIS_ADAPTER_VERSION : ADAPTER_VERSION, captureState, canonicalLinkJson(coverage), now)];
    for (const source of added) {
      statements.push(this.db.prepare(`insert into v2_source_items(id,user_id,capture_id,item_kind,display_order,raw_text,content_hash,source_metadata,immutability_version,created_at)
        values (?,?,?,?,coalesce((select max(display_order)+1 from v2_source_items where capture_id=?),0),?,?,?,1,?)`)
        .bind(source.sourceItemId, this.userId, document.capture_id, source.kind, document.capture_id, source.rawText, source.contentHash, canonicalLinkJson(source.metadata), now));
      statements.push(this.db.prepare(`insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at)
        select ?,id,'evidence',display_order,? from v2_source_items where id=? and user_id=?`).bind(input.documentId, now, source.sourceItemId, this.userId));
    }
    for (const member of members) statements.push(this.db.prepare(`insert into v2_link_snapshot_sources(id,user_id,snapshot_id,source_item_id,member_key,source_order,source_fingerprint) values (?,?,?,?,?,?,?)`)
      .bind(member.id, this.userId, snapshotId, member.sourceItemId, member.memberKey, member.sourceOrder, member.sourceFingerprint));
    statements.push(this.db.prepare(`update v2_documents set current_link_snapshot_id=?,link_snapshot_version=link_snapshot_version+1,published_link_run_id=null
      where object_id=? and current_revision_id=? and current_link_snapshot_id is ? and link_snapshot_version=?`)
      .bind(snapshotId, input.documentId, input.expectedRevisionId, input.expectedSnapshotId, input.expectedSnapshotVersion));
    statements.push(this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
      values (case when exists (select 1 from v2_documents where object_id=? and current_link_snapshot_id=? and link_snapshot_version=?) then ? else null end,?,'link.snapshot_created','document',?,?,?)`)
      .bind(input.documentId, snapshotId, input.expectedSnapshotVersion + 1, ulid(), this.userId, input.documentId, canonicalLinkJson({ snapshotVersion: input.expectedSnapshotVersion + 1, manifestHash }), now));
    statements.push(this.db.prepare("insert into v2_idempotency_records(user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at) values (?,?,?,?,?,201,?)")
      .bind(this.userId, operation, input.idempotencyKey, payloadHash, canonicalLinkJson({ snapshotId }), now));
    try { await this.db.batch(statements); } catch (error) {
      const concurrentReplay = await this.replay(input.documentId, input.idempotencyKey, payloadHash, Boolean(input.restrictedUnlocked), operation);
      if (concurrentReplay) return concurrentReplay;
      const message = error instanceof Error ? error.message : String(error);
      if (/NOT NULL constraint failed|UNIQUE constraint failed|link_snapshot_(owner|parent|source_owner)_mismatch/.test(message)) {
        throw new LinkSnapshotError("link_snapshot_conflict", "The source snapshot changed before the write could commit.");
      }
      throw error;
    }
    const stored = await this.getSnapshot(input.documentId, snapshotId, Boolean(input.restrictedUnlocked));
    if (!stored) throw new LinkSnapshotError("link_snapshot_not_found", "The committed snapshot is no longer accessible.");
    return { ...stored, replayed: false };
  }
}
