import { ulid } from "ulidx";
import { canonicalLinkJson, linkSha256Hex, LinkSnapshotError, normalizeLinkHash, type LinkSnapshotMemberV1 } from "@/lib/v2/domain/link-snapshot-v1";
import {
  MANUAL_LINK_FRAGMENT_CONTRACT, MANUAL_LINK_FRAGMENT_PAGE_BYTES, MANUAL_LINK_FRAGMENT_PAGE_SIZE,
  manualFragmentId, parseManualLinkFragmentRequest, type ManualLinkFragmentPage, type ManualLinkFragmentReceipt, type StoredManualLinkFragment,
} from "@/lib/v2/domain/manual-link-fragment-v1";
import { extractManualPromptFragment, type PromptCopyRole, type PromptCurationSource } from "@/lib/v2/domain/prompt-curation-v1";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { D1LinkSnapshotRepository, type LinkSnapshotProjection } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

const OPERATION = "link_fragment.create.v1";
const DETAILS = canonicalLinkJson({ contract: MANUAL_LINK_FRAGMENT_CONTRACT, selectionOrigin: "user_selected" });
const encoder = new TextEncoder();
/** Trusted server grant, never read from the POST body. Keep expiry live across awaits. */
export type ManualLinkFragmentAccess = Readonly<{ restrictedGrantExpiresAt?: string }>;
type DocumentRow = { object_id: string; capture_id: string; current_revision_id: string; current_link_snapshot_id: string | null;
  link_snapshot_version: number; privacy_level: string };
type FragmentRow = { id: string; fragment_key: string; snapshot_id: string; primary_member_id: string; created_at: string;
  state_version: number; review_status: StoredManualLinkFragment["reviewStatus"]; role: PromptCopyRole; text_start: number; text_end: number;
  raw_text: string; raw_text_hash: string; completeness: string; locked_by_user: number; evidence_valid: number };
type SourceProof = { id: string; raw_text: string; content_hash: string; source_metadata: string | null };
type ReadFence = { snapshotId: string; manifestHash: string; memberCount: number;
  sources: readonly (SourceProof & { member_id: string; member_key: string; source_fingerprint: string })[];
  replay?: { expectedRevisionId: string; idempotencyKey: string; payloadHash: string; responseJson: string; item: StoredManualLinkFragment } };

function fail(code: string, message: string): never { throw new LinkSnapshotError(code, message); }
function unlocked(expiry: string | undefined) { return typeof expiry === "string" && Date.parse(expiry) > Date.now(); }
function sameDocument(a: DocumentRow, b: DocumentRow) {
  return a.capture_id === b.capture_id && a.current_revision_id === b.current_revision_id && a.current_link_snapshot_id === b.current_link_snapshot_id
    && a.link_snapshot_version === b.link_snapshot_version && a.privacy_level === b.privacy_level;
}
export function manualPromptSource(member: LinkSnapshotMemberV1): PromptCurationSource {
  if (member.kind !== "url" || !member.manualLink || member.rawText === null) return fail("manual_link_fragment_source_invalid", "보관한 외부 텍스트에서만 발췌할 수 있습니다. 개인 메모나 미확인 OCR은 원문으로 대체하지 않습니다.");
  const claim = (value: number | null) => ({ value, origin: value === null ? "unknown" as const : "user_declared" as const });
  return { memberKey: member.memberKey, sourceFingerprint: member.sourceFingerprint, rawText: member.rawText,
    contentHash: normalizeLinkHash(member.contentHash), completeness: member.manualLink.completeness,
    parts: { number: claim(member.manualLink.partNumber), total: claim(member.manualLink.totalParts) } };
}

export class D1ManualLinkFragmentRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  private async available() {
    if (!await new D1LinkSnapshotRepository(this.db, this.userId).isAvailable()) fail("link_snapshot_schema_unavailable", "수동 발췌 저장에는 링크 snapshot 저장소가 필요합니다.");
  }
  private async access(recordId: string, expiry: string | undefined, expected?: DocumentRow, fence?: ReadFence): Promise<DocumentRow> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    // Compare captured source bytes at the same final SQL boundary as access.
    // Hash validation alone is insufficient if a source changes during an await.
    const proofSql = fence ? `,exists(select 1 from v2_link_snapshots s where s.id=? and s.user_id=o.user_id and s.document_object_id=d.object_id
      and s.capture_id=d.capture_id and s.manifest_hash=? and s.manifest_version='link-source-manifest.v1'
      and (select count(*) from v2_link_snapshot_sources m where m.snapshot_id=s.id and m.user_id=o.user_id)=?
      and not exists(select 1 from json_each(?) p where not exists(select 1 from v2_link_snapshot_sources m
        join v2_source_items source on source.id=m.source_item_id and source.user_id=m.user_id and source.capture_id=d.capture_id
        join v2_document_source_links dsl on dsl.source_item_id=source.id and dsl.document_object_id=d.object_id
        where m.id=json_extract(p.value,'$.member_id') and m.snapshot_id=s.id and m.user_id=o.user_id
        and m.member_key=json_extract(p.value,'$.member_key') and m.source_fingerprint=json_extract(p.value,'$.source_fingerprint')
        and source.id=json_extract(p.value,'$.id') and source.item_kind='url' and source.raw_text=json_extract(p.value,'$.raw_text')
        and source.content_hash=json_extract(p.value,'$.content_hash') and source.source_metadata is json_extract(p.value,'$.source_metadata')))) as source_integrity` : "";
    const replay = fence?.replay;
    // One final read boundary binds the exact receipt and still-existing original revision
    // to the validated fragment/evidence. Nothing here creates or retargets a selection.
    const replaySql = replay ? `,exists(select 1 from (${this.fragmentQuery()}) f
      join v2_idempotency_records i on i.user_id=o.user_id and i.operation='${OPERATION}' and i.idempotency_key=?
      join v2_document_revisions original on original.id=? and original.document_object_id=d.object_id
      where i.payload_hash=? and i.response_json=? and i.status_code=201
      and (f.id,f.fragment_key,f.primary_member_id,f.created_at,f.state_version,f.review_status,f.role,f.text_start,f.text_end,f.raw_text,f.raw_text_hash,f.completeness)
        =(?,?,?,?,?,?,?,?,?,?,?,?)
      and f.evidence_valid=1 and f.locked_by_user=1 and f.derived_text is null and f.details_json=?) as replay_integrity` : "";
    const item = replay?.item;
    const row = await this.db.prepare(`select d.object_id,d.capture_id,d.current_revision_id,d.current_link_snapshot_id,d.link_snapshot_version,d.privacy_level${proofSql}${replaySql}
      from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility} limit 1`)
      .bind(...(fence ? [fence.snapshotId, fence.manifestHash, fence.memberCount, canonicalLinkJson(fence.sources)] : []),
        ...(replay && item ? [this.userId, recordId, fence!.snapshotId, replay.idempotencyKey, replay.expectedRevisionId, replay.payloadHash, replay.responseJson,
          item.id, item.fragmentKey, item.primaryMemberId, item.createdAt, item.stateVersion, item.reviewStatus, item.fragment.role, item.fragment.textStart,
          item.fragment.textEnd, item.fragment.rawText, item.fragment.rawTextHash, item.fragment.completeness, DETAILS] : []), recordId, this.userId)
      .first<DocumentRow & { source_integrity?: number; replay_integrity?: number }>();
    if (!row) return fail("record_not_found", "접근할 수 있는 기록을 찾지 못했습니다.");
    if (row.privacy_level === "restricted" && !unlocked(expiry)) return fail("restricted_record_locked", "발췌한 원문을 열거나 저장하려면 기록의 잠금을 해제해 주세요.");
    if (expected && !sameDocument(expected, row)) return fail("manual_link_fragment_conflict", "처리 중 기록 또는 현재 자료 버전이 변경되었습니다.");
    if (fence && row.source_integrity !== 1) return fail("manual_link_fragment_integrity_invalid", "조회 도중 원문 또는 출처 연결이 변경되었습니다.");
    if (replay && row.replay_integrity !== 1) return fail("manual_link_fragment_integrity_invalid", "조회 도중 저장 영수증 또는 원래 발췌 근거가 변경되었습니다.");
    return row;
  }
  private async readFence(snapshot: LinkSnapshotProjection, memberIds: readonly string[]): Promise<ReadFence> {
    const sources: ReadFence["sources"][number][] = [];
    if (memberIds.length) {
      const rows = await this.db.prepare(`select source.id,source.raw_text,source.content_hash,source.source_metadata,
        m.id as member_id,m.member_key,m.source_fingerprint from v2_link_snapshot_sources m
        join v2_source_items source on source.id=m.source_item_id and source.user_id=m.user_id
        where m.snapshot_id=? and m.user_id=? and m.id in (${memberIds.map(() => "?").join(",")})`)
        .bind(snapshot.snapshot.id, this.userId, ...memberIds).all<ReadFence["sources"][number]>();
      for (const id of memberIds) {
        const member = snapshot.members.find((item) => item.id === id), proof = rows.results.find((row) => row.member_id === id);
        if (!member || !proof || proof.id !== member.sourceItemId || proof.raw_text !== member.rawText || proof.content_hash !== member.contentHash
          || proof.member_key !== member.memberKey || proof.source_fingerprint !== member.sourceFingerprint
          || canonicalLinkJson(proof.source_metadata === null ? null : JSON.parse(proof.source_metadata)) !== canonicalLinkJson(member.metadata))
          fail("manual_link_fragment_integrity_invalid", "조회한 원문이 자료 버전의 보존 정보와 일치하지 않습니다.");
        sources.push(proof);
      }
    }
    return { snapshotId: snapshot.snapshot.id, manifestHash: snapshot.snapshot.manifestHash, memberCount: snapshot.members.length, sources };
  }
  private async snapshot(recordId: string, snapshotId: string, expiry: string | undefined) {
    const snapshot = await new D1LinkSnapshotRepository(this.db, this.userId).getSnapshot(recordId, snapshotId, unlocked(expiry));
    if (!snapshot) {
      await this.access(recordId, expiry);
      return fail("link_snapshot_not_found", "선택한 자료 버전에 접근할 수 없습니다.");
    }
    return snapshot;
  }
  private fragmentQuery() {
    // Manual origin is explicit. Legacy/null-run rows without this marker are not silently relabelled.
    return `select f.*,(select count(*)=1 and sum(case when e.user_id=f.user_id and e.member_id=f.primary_member_id
      and e.relation_kind='supports' and e.evidence_method='user_confirmed' and e.text_start=f.text_start and e.text_end=f.text_end
      and e.image_region_json is null and e.start_seconds is null and e.end_seconds is null and e.display_order=0
      and e.locked_by_user=1 and e.state_version=1 then 1 else 0 end)=1 from v2_link_fragment_evidence e where e.fragment_id=f.id) as evidence_valid
      from v2_link_fragments f where f.user_id=? and f.document_object_id=? and f.snapshot_id=? and f.processing_run_id is null
      and f.source_class='source_extract' and json_extract(f.details_json,'$.contract')='manual-link-fragment.v1'
      and json_extract(f.details_json,'$.selectionOrigin')='user_selected'`;
  }
  private async validated(row: FragmentRow, snapshot: LinkSnapshotProjection): Promise<StoredManualLinkFragment> {
    const member = snapshot.members.find((item) => item.id === row.primary_member_id);
    if (!member || !row.evidence_valid || row.locked_by_user !== 1 || !["confirmed", "rejected", "superseded"].includes(row.review_status))
      return fail("manual_link_fragment_integrity_invalid", "발췌한 조각의 출처나 사용자 선택 근거가 일치하지 않습니다.");
    const fragment = await extractManualPromptFragment(manualPromptSource(member), { textStart: row.text_start, textEnd: row.text_end, role: row.role });
    if (row.raw_text !== fragment.rawText || row.raw_text_hash !== fragment.rawTextHash || row.completeness !== fragment.completeness)
      return fail("manual_link_fragment_integrity_invalid", "발췌한 조각이 보관 원문의 정확한 범위와 일치하지 않습니다.");
    return { id: row.id, fragmentKey: row.fragment_key, snapshotId: row.snapshot_id, primaryMemberId: row.primary_member_id,
      createdAt: row.created_at, stateVersion: row.state_version, reviewStatus: row.review_status, fragment };
  }
  private async readItem(recordId: string, snapshot: LinkSnapshotProjection, id: string) {
    const row = await this.db.prepare(`${this.fragmentQuery()} and f.id=? limit 1`).bind(this.userId, recordId, snapshot.snapshot.id, id).first<FragmentRow>();
    if (!row) return fail("manual_link_fragment_not_found", "이 자료 버전에 속한 수동 발췌를 찾지 못했습니다.");
    return this.validated(row, snapshot);
  }

  /** Explicit read for copying: do not trust a previously rendered list receipt. */
  async get(recordId: string, fragmentId: string, options: ManualLinkFragmentAccess & Readonly<{ snapshotId: string }>) {
    manualFragmentId(recordId); manualFragmentId(fragmentId);
    const snapshotId = manualFragmentId(options.snapshotId), expiry = options.restrictedGrantExpiresAt;
    await this.available();
    const document = await this.access(recordId, expiry), snapshot = await this.snapshot(recordId, snapshotId, expiry);
    const row = await this.db.prepare(`${this.fragmentQuery()} and f.id=? limit 1`).bind(this.userId, recordId, snapshotId, fragmentId).first<FragmentRow>();
    if (!row) return fail("manual_link_fragment_not_found", "이 자료 버전에 속한 수동 발췌를 찾지 못했습니다.");
    const fence = await this.readFence(snapshot, [row.primary_member_id]), item = await this.validated(row, snapshot);
    await this.access(recordId, expiry, document, fence);
    return { contract: MANUAL_LINK_FRAGMENT_CONTRACT, item };
  }

  async list(recordId: string, options: ManualLinkFragmentAccess & Readonly<{ snapshotId?: string; cursor?: string }> = {}): Promise<ManualLinkFragmentPage> {
    manualFragmentId(recordId);
    const expiry = options.restrictedGrantExpiresAt, requestedSnapshotId = options.snapshotId === undefined ? undefined : manualFragmentId(options.snapshotId), cursorValue = options.cursor;
    if (cursorValue !== undefined && (typeof cursorValue !== "string" || !cursorValue || cursorValue.length > 1600)) fail("manual_link_fragment_cursor_invalid", "목록 커서가 올바르지 않습니다.");
    await this.available();
    const document = await this.access(recordId, expiry), snapshotId = requestedSnapshotId ?? document.current_link_snapshot_id;
    const base = { contract: MANUAL_LINK_FRAGMENT_CONTRACT, recordId, currentRevisionId: document.current_revision_id,
      currentSnapshotId: document.current_link_snapshot_id, selectedSnapshotId: snapshotId, isHistorical: snapshotId !== document.current_link_snapshot_id };
    if (!snapshotId) {
      if (cursorValue) fail("manual_link_fragment_cursor_invalid", "아직 자료 버전이 없는 기록입니다.");
      await this.access(recordId, expiry, document);
      return { ...base, items: [], nextCursor: null };
    }
    const scope = await linkSha256Hex(canonicalLinkJson({ userId: this.userId, recordId, snapshotId }));
    let cursor: [string, string] | null = null;
    if (cursorValue) {
      try {
        const data: unknown = JSON.parse(decodeURIComponent(cursorValue));
        if (!Array.isArray(data) || data.length !== 4 || data[0] !== "manual-fragments.v1" || data[1] !== scope
          || typeof data[2] !== "string" || !Number.isFinite(Date.parse(data[2]))) throw new Error();
        cursor = [data[2], manualFragmentId(data[3])];
      } catch { fail("manual_link_fragment_cursor_invalid", "이 소유자·기록·자료 버전에 속한 목록 커서가 아닙니다."); }
    }
    const snapshot = await this.snapshot(recordId, snapshotId, expiry);
    const rows = await this.db.prepare(`${this.fragmentQuery()} ${cursor ? "and (f.created_at<? or (f.created_at=? and f.id<?))" : ""}
      order by f.created_at desc,f.id desc limit ?`).bind(this.userId, recordId, snapshotId,
        ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), MANUAL_LINK_FRAGMENT_PAGE_SIZE + 1).all<FragmentRow>();
    const fence = await this.readFence(snapshot, [...new Set(rows.results.map((row) => row.primary_member_id))]);
    const items: StoredManualLinkFragment[] = [];
    let bytes = 0;
    for (const row of rows.results) {
      if (items.length === MANUAL_LINK_FRAGMENT_PAGE_SIZE) break;
      const size = encoder.encode(row.raw_text).byteLength;
      if (size > MANUAL_LINK_FRAGMENT_PAGE_BYTES) fail("manual_link_fragment_output_limit", "조각이 발췌 출력 한도를 초과했습니다.");
      if (bytes + size > MANUAL_LINK_FRAGMENT_PAGE_BYTES) break;
      items.push(await this.validated(row, snapshot));
      bytes += size;
    }
    await this.access(recordId, expiry, document, fence);
    const last = items.at(-1);
    return { ...base, items, nextCursor: rows.results.length > items.length && last
      ? encodeURIComponent(JSON.stringify(["manual-fragments.v1", scope, last.createdAt, last.id])) : null };
  }

  async create(recordId: string, value: unknown, options: ManualLinkFragmentAccess = {}): Promise<ManualLinkFragmentReceipt> {
    manualFragmentId(recordId);
    const request = parseManualLinkFragmentRequest(value), expiry = options.restrictedGrantExpiresAt;
    await this.available();
    const document = await this.access(recordId, expiry);
    const payloadHash = await linkSha256Hex(canonicalLinkJson({ recordId, ...request, idempotencyKey: null }));
    const replay = async (current: DocumentRow): Promise<ManualLinkFragmentReceipt | null> => {
      const row = await this.db.prepare("select payload_hash,response_json,status_code from v2_idempotency_records where user_id=? and operation=? and idempotency_key=? limit 1")
        .bind(this.userId, OPERATION, request.idempotencyKey).first<{ payload_hash: string; response_json: string; status_code: number }>();
      if (!row) return null;
      await this.access(recordId, expiry, current);
      if (row.payload_hash !== payloadHash) fail("idempotency_conflict", "이 요청 키는 다른 발췌 요청에 사용되었습니다.");
      let receipt: { fragmentId?: unknown };
      try { receipt = JSON.parse(row.response_json); } catch { return fail("manual_link_fragment_integrity_invalid", "발췌 저장 영수증이 손상되었습니다."); }
      if (!receipt || typeof receipt.fragmentId !== "string" || !receipt.fragmentId.trim() || receipt.fragmentId.length > 200
        || Object.keys(receipt).length !== 1 || row.status_code !== 201) fail("manual_link_fragment_integrity_invalid", "발췌 저장 영수증을 확인할 수 없습니다.");
      let fresh: LinkSnapshotProjection;
      try { fresh = await this.snapshot(recordId, request.expectedSnapshotId, expiry); }
      catch (error) {
        if (error instanceof LinkSnapshotError && error.code === "link_source_not_external")
          fail("manual_link_fragment_integrity_invalid", "저장 영수증의 원래 외부 출처 정보가 손상되었습니다.");
        throw error;
      }
      if (fresh.snapshot.manifestHash !== request.expectedManifestHash) fail("manual_link_fragment_integrity_invalid", "저장 영수증의 원래 자료 목록과 요청이 일치하지 않습니다.");
      const originalMember = fresh.members.find((member) => member.id === request.memberId);
      if (!originalMember) fail("manual_link_fragment_integrity_invalid", "저장 영수증의 원래 출처를 찾을 수 없습니다.");
      const original = await extractManualPromptFragment(manualPromptSource(originalMember), { textStart: request.textStart, textEnd: request.textEnd, role: request.role });
      const fence = await this.readFence(fresh, [request.memberId]);
      const item = await this.readItem(recordId, fresh, receipt.fragmentId);
      if (item.primaryMemberId !== request.memberId || item.fragmentKey !== `manual-${item.id}` || canonicalLinkJson(item.fragment) !== canonicalLinkJson(original))
        fail("manual_link_fragment_integrity_invalid", "저장 영수증의 조각이 요청한 원문 범위와 다릅니다.");
      fence.replay = { expectedRevisionId: request.expectedRevisionId, idempotencyKey: request.idempotencyKey, payloadHash, responseJson: row.response_json, item };
      await this.access(recordId, expiry, current, fence);
      return { contract: MANUAL_LINK_FRAGMENT_CONTRACT, item, replayed: true };
    };
    const existing = await replay(document);
    if (existing) return existing;
    // Only a verified existing receipt can precede current CAS. Every new write
    // still uses the current revision/snapshot and the unchanged atomic guard.
    if (document.current_revision_id !== request.expectedRevisionId || document.current_link_snapshot_id !== request.expectedSnapshotId)
      fail("manual_link_fragment_conflict", "현재 본문과 자료 버전을 다시 확인해 주세요. 입력은 보존할 수 있습니다.");
    const snapshot = await this.snapshot(recordId, request.expectedSnapshotId, expiry);
    if (snapshot.snapshot.manifestHash !== request.expectedManifestHash) fail("manual_link_fragment_conflict", "원문 목록이 변경되었습니다.");
    const member = snapshot.members.find((item) => item.id === request.memberId);
    if (!member) fail("manual_link_fragment_source_invalid", "선택한 원문이 현재 자료 버전에 속하지 않습니다.");
    const fragment = await extractManualPromptFragment(manualPromptSource(member), { textStart: request.textStart, textEnd: request.textEnd, role: request.role });
    // Capture the exact stored metadata representation for the transaction fence.
    const proof = await this.db.prepare("select id,raw_text,content_hash,source_metadata from v2_source_items where id=? and user_id=? and capture_id=? and item_kind='url'")
      .bind(member.sourceItemId, this.userId, document.capture_id).first<SourceProof>();
    if (!proof || proof.raw_text !== member.rawText || proof.content_hash !== member.contentHash
      || canonicalLinkJson(proof.source_metadata === null ? null : JSON.parse(proof.source_metadata)) !== canonicalLinkJson(member.metadata))
      fail("manual_link_fragment_conflict", "원문이 발췌 도중 변경되었습니다.");
    const visibility = await legacyProjectionVisibilityPredicate(this.db), id = ulid(), now = new Date().toISOString();
    const guard = `exists(select 1 from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
      join v2_link_snapshots s on s.id=d.current_link_snapshot_id and s.user_id=o.user_id and s.document_object_id=d.object_id and s.capture_id=d.capture_id
      join v2_link_snapshot_sources m on m.snapshot_id=s.id and m.user_id=o.user_id
      join v2_source_items source on source.id=m.source_item_id and source.user_id=o.user_id and source.capture_id=d.capture_id
      join v2_document_source_links dsl on dsl.document_object_id=d.object_id and dsl.source_item_id=source.id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility}
      and (d.privacy_level<>'restricted' or julianday(?)>julianday('now')) and d.privacy_level=?
      and d.capture_id=? and d.current_revision_id=? and d.current_link_snapshot_id=? and d.link_snapshot_version=?
      and s.manifest_version=? and s.manifest_hash=? and m.id=? and m.member_key=? and m.source_fingerprint=?
      and source.id=? and source.item_kind='url' and source.raw_text=? and source.content_hash=? and source.source_metadata is ?)`;
    try {
      await this.db.batch([
        this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
          values(case when ${guard} then ? else null end,?,'link.fragment_created','document',?,?,?)`)
          .bind(recordId, this.userId, expiry ?? null, document.privacy_level, document.capture_id, request.expectedRevisionId, request.expectedSnapshotId,
            document.link_snapshot_version, snapshot.snapshot.manifestVersion, request.expectedManifestHash, member.id, member.memberKey, member.sourceFingerprint,
            proof.id, proof.raw_text, proof.content_hash, proof.source_metadata, ulid(), this.userId, recordId,
            canonicalLinkJson({ fragmentId: id, snapshotId: request.expectedSnapshotId, memberId: member.id, role: fragment.role }), now),
        this.db.prepare(`insert into v2_link_fragments(id,user_id,document_object_id,snapshot_id,primary_member_id,processing_run_id,fragment_key,
          role,source_class,text_start,text_end,raw_text,raw_text_hash,derived_text,details_json,completeness,display_order,review_status,locked_by_user,state_version,created_at)
          values(?,?,?,?,?,null,?,?,'source_extract',?,?,?,?,null,?,?,0,'confirmed',1,1,?)`)
          .bind(id, this.userId, recordId, request.expectedSnapshotId, member.id, `manual-${id}`, fragment.role, fragment.textStart, fragment.textEnd,
            fragment.rawText, fragment.rawTextHash, DETAILS, fragment.completeness, now),
        this.db.prepare(`insert into v2_link_fragment_evidence(id,user_id,fragment_id,member_id,relation_kind,evidence_method,text_start,text_end,
          display_order,locked_by_user,state_version,created_at) values(?,?,?,?,'supports','user_confirmed',?,?,0,1,1,?)`)
          .bind(ulid(), this.userId, id, member.id, fragment.textStart, fragment.textEnd, now),
        this.db.prepare(`insert into v2_idempotency_records(user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at) values(?,?,?,?,?,201,?)`)
          .bind(this.userId, OPERATION, request.idempotencyKey, payloadHash, canonicalLinkJson({ fragmentId: id }), now),
      ]);
    } catch (error) {
      const current = await this.access(recordId, expiry);
      const concurrent = await replay(current);
      if (concurrent) return concurrent;
      await this.access(recordId, expiry, document);
      if (/NOT NULL constraint failed|UNIQUE constraint failed/.test(error instanceof Error ? error.message : String(error)))
        fail("manual_link_fragment_conflict", "처리 중 자료가 변경되어 발췌를 저장하지 않았습니다.");
      throw error;
    }
    const fresh = await this.snapshot(recordId, request.expectedSnapshotId, expiry), fence = await this.readFence(fresh, [request.memberId]);
    const item = await this.readItem(recordId, fresh, id);
    await this.access(recordId, expiry, document, fence);
    return { contract: MANUAL_LINK_FRAGMENT_CONTRACT, item, replayed: false };
  }
}
