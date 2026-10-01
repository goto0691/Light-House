import { canonicalLinkJson, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import type { PromptCurationContent } from "@/lib/v2/domain/prompt-curation-request";
import { extractManualPromptFragment, preparePromptCuration, PromptCurationError, type PromptCurationFragment, type PromptCurationInput } from "@/lib/v2/domain/prompt-curation-v1";
import { ulid } from "ulidx";
import { migrationCoverageMatches } from "@/lib/v2/domain/prompt-curation-migration";
import type { LinkSnapshotProjection } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { manualPromptSource } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { sqlConjunction } from "@/lib/v2/infrastructure/d1/sql-conjunction";

type SourceProof = { id: string; item_kind: string; raw_text: string | null; content_hash: string; source_metadata: string | null };
type Evidence = { id: string; user_id: string; member_id: string; relation_kind: string; evidence_method: string;
  text_start: number | null; text_end: number | null; image_region_json: string | null; start_seconds: number | null; end_seconds: number | null;
  display_order: number; locked_by_user: number; state_version: number };
type FragmentProof = { id: string; primary_member_id: string; processing_run_id: string | null; fragment_key: string; role: PromptCurationFragment["role"];
  source_class: string; text_start: number; text_end: number; raw_text: string; raw_text_hash: string; completeness: PromptCurationFragment["completeness"];
  details_json: string; state_version: number; locked_by_user: number; review_status: string; evidence_json: string; valid_run_id: string | null };
type ImageProof = { id: string; member_id: string; source_item_id: string; sha256: string; mime_type: string; size_bytes: number;
  filename: string; object_key: string; status: string; committed_at: string };

export type CurationCatalogProof = {
  snapshotId: string; manifestHash: string; members: { id: string; sourceItemId: string; memberKey: string; sourceOrder: number; sourceFingerprint: string }[];
  sources: SourceProof[]; fragments: FragmentProof[]; images: ImageProof[];
  attachmentCounts?: { memberId: string; count: number }[];
};
export type CurationCatalog = Awaited<ReturnType<typeof loadCurationCatalog>>;
function invalid(message: string): never { throw new PromptCurationError("prompt_curation_integrity_invalid", message); }

// One bounded query, even for 64 selected fragments. The same expression is used
// in the final SQL fence, so evidence cannot change during an awaited hash.
const evidenceSql = `(select json_group_array(json_object('id',e.id,'user_id',e.user_id,'member_id',e.member_id,
  'relation_kind',e.relation_kind,'evidence_method',e.evidence_method,'text_start',e.text_start,'text_end',e.text_end,
  'image_region_json',e.image_region_json,'start_seconds',e.start_seconds,'end_seconds',e.end_seconds,
  'display_order',e.display_order,'locked_by_user',e.locked_by_user,'state_version',e.state_version) order by e.id)
  from v2_link_fragment_evidence e where e.fragment_id=f.id)`;
const fragmentColumns = ["id", "primary_member_id", "processing_run_id", "fragment_key", "role", "source_class", "text_start", "text_end",
  "raw_text", "raw_text_hash", "completeness", "details_json", "state_version", "locked_by_user", "review_status"] as const;
const validRunSql = `exists(select 1 from v2_processing_jobs j
  join v2_link_snapshots run_snapshot on run_snapshot.id=j.input_link_snapshot_id and run_snapshot.user_id=j.user_id
    and run_snapshot.document_object_id=j.object_id and run_snapshot.capture_id=j.capture_id
  where ${sqlConjunction(["j.id=r.job_id", "j.user_id=f.user_id", "j.object_id=f.document_object_id", "j.input_link_snapshot_id=f.snapshot_id",
    "j.stage='link_analyze'", "r.input_hash=j.input_hash", "j.input_source_manifest_hash=run_snapshot.manifest_hash",
    "j.input_source_manifest_version=run_snapshot.manifest_version"])})`;

export async function loadCurationCatalog(db: D1DatabaseBinding, userId: string, recordId: string, snapshot: LinkSnapshotProjection,
  content: PromptCurationContent, strictVersions: boolean) {
  const fragmentIds = [...new Set(content.items.map((item) => item.fragmentId))];
  const fragments = (await db.prepare(`select ${fragmentColumns.map((name) => `f.${name}`).join(",")},${evidenceSql} as evidence_json,r.id as valid_run_id
    from v2_link_fragments f left join v2_processing_runs r on r.id=f.processing_run_id and r.user_id=f.user_id
      and ${validRunSql}
    where f.user_id=? and f.document_object_id=? and f.snapshot_id=? and f.id in (select value from json_each(?))`)
    .bind(userId, recordId, snapshot.snapshot.id, canonicalLinkJson(fragmentIds)).all<FragmentProof>()).results;
  if (fragments.length !== fragmentIds.length) invalid("선택한 조각이 이 소유자·기록·자료 버전에 속하지 않습니다.");
  return buildCurationCatalog(db, userId, snapshot, content, strictVersions, fragments);
}

async function buildCurationCatalog(db: D1DatabaseBinding, userId: string, snapshot: LinkSnapshotProjection,
  content: PromptCurationContent, strictVersions: boolean, fragments: FragmentProof[]) {
  const memberIds = [...new Set([...fragments.map((fragment) => fragment.primary_member_id), ...content.examples.map((example) => example.memberId)])];
  const members = memberIds.map((id) => {
    const member = snapshot.members.find((row) => row.id === id);
    if (!member) return invalid("선택한 조각 또는 이미지의 원문 연결이 없습니다.");
    return member;
  });
  const sources = (await db.prepare(`select id,item_kind,raw_text,content_hash,source_metadata from v2_source_items
    where user_id=? and capture_id=? and id in (select value from json_each(?))`)
    .bind(userId, snapshot.snapshot.captureId, canonicalLinkJson(members.map((member) => member.sourceItemId))).all<SourceProof>()).results;
  for (const member of members) {
    const proof = sources.find((row) => row.id === member.sourceItemId);
    if (!proof || proof.item_kind !== member.kind || proof.raw_text !== member.rawText || proof.content_hash !== member.contentHash
      || canonicalLinkJson(proof.source_metadata === null ? null : JSON.parse(proof.source_metadata)) !== canonicalLinkJson(member.metadata))
      invalid("원문과 자료 버전의 보존 정보가 일치하지 않습니다.");
  }
  const images = content.examples.length ? (await db.prepare(`select a.id,m.id as member_id,m.source_item_id,a.sha256,a.mime_type,a.size_bytes,
      a.filename,a.object_key,a.status,a.committed_at from v2_link_snapshot_sources m
    join v2_source_attachment_links l on l.source_item_id=m.source_item_id and l.user_id=m.user_id
    join v2_attachment_reservations a on a.id=l.attachment_id and a.user_id=m.user_id
    where m.user_id=? and m.snapshot_id=? and exists(select 1 from json_each(?) j
      where json_extract(j.value,'$.memberId')=m.id and json_extract(j.value,'$.attachmentId')=a.id)`)
    .bind(userId, snapshot.snapshot.id, canonicalLinkJson(content.examples)).all<ImageProof>()).results : [];

  const items = content.items.map((item) => {
    const row = fragments.find((fragment) => fragment.id === item.fragmentId)!;
    if (row.source_class !== "source_extract" || row.role !== item.copyRole || !Number.isSafeInteger(row.state_version)
      || (strictVersions ? row.state_version !== item.expectedFragmentStateVersion : row.state_version < item.expectedFragmentStateVersion))
      throw new PromptCurationError("prompt_curation_fragment_conflict", "조각의 역할 또는 확인 버전이 변경되었습니다.");
    const member = members.find((candidate) => candidate.id === row.primary_member_id)!;
    let details: Record<string, unknown>, evidence: Evidence[];
    try { details = JSON.parse(row.details_json); evidence = JSON.parse(row.evidence_json); }
    catch { return invalid("조각의 선택 근거가 손상되었습니다."); }
    const manual = row.processing_run_id === null;
    if (!details || !Array.isArray(evidence) || (manual
      ? details.contract !== "manual-link-fragment.v1" || details.selectionOrigin !== "user_selected" || row.locked_by_user !== 1
      : details.contract !== "link-analysis.v1" || row.valid_run_id !== row.processing_run_id)) invalid("조각의 원문 선택 출처를 확인할 수 없습니다.");
    if (evidence.length !== 1 || !evidence.every((entry) => entry.user_id === userId && entry.member_id === row.primary_member_id
      && entry.relation_kind === "supports" && entry.evidence_method === (manual ? "user_confirmed" : "ai_proposed")
      && entry.text_start === row.text_start && entry.text_end === row.text_end && entry.image_region_json === null
      && entry.start_seconds === null && entry.end_seconds === null && entry.display_order === 0
      && (!manual || entry.locked_by_user === 1 && entry.state_version === 1))) invalid("정확한 원문 범위에 대응하는 선택 근거가 없습니다.");
    const source = manualPromptSource(member);
    if (manual && row.completeness !== source.completeness) invalid("수동 발췌가 원문의 확보 상태를 변경했습니다.");
    return { itemKey: item.itemKey, copyRole: item.copyRole, position: item.position, fragment: {
      memberKey: member.memberKey, sourceClass: "source_extract" as const, role: row.role,
      selectionOrigin: manual ? "user_selected" as const : "ai_selected" as const,
      textStart: row.text_start, textEnd: row.text_end, rawText: row.raw_text, rawTextHash: row.raw_text_hash, completeness: row.completeness,
    } };
  });
  const examples = content.examples.map((example) => {
    const member = members.find((row) => row.id === example.memberId)!, image = images.find((row) => row.member_id === example.memberId && row.id === example.attachmentId);
    if (member.kind !== "image" || !image || image.status !== "committed" || !image.committed_at || !image.mime_type.startsWith("image/")
      || !member.attachments.some((attachment) => attachment.id === image.id && normalizeLinkHash(attachment.sha256) === normalizeLinkHash(image.sha256)
        && attachment.mimeType === image.mime_type && attachment.sizeBytes === image.size_bytes && attachment.filename === image.filename))
      return invalid("이 자료 버전에 보관 완료된 전체 이미지만 예시로 연결할 수 있습니다.");
    return { exampleKey: example.exampleKey, itemKey: example.itemKey, memberKey: member.memberKey, sourceFingerprint: member.sourceFingerprint,
      sha256: normalizeLinkHash(image.sha256), mimeType: image.mime_type, sizeBytes: image.size_bytes, position: example.position, evidenceMethod: example.evidenceMethod };
  });
  const sourceKeys = new Set(items.map((item) => item.fragment.memberKey));
  const input: PromptCurationInput = { snapshotManifestHash: snapshot.snapshot.manifestHash, title: content.title, relationKind: content.relationKind,
    relationshipConfirmation: content.relationshipConfirmation, orderConfirmation: content.orderConfirmation, separator: "\n",
    sources: members.filter((member) => sourceKeys.has(member.memberKey)).map(manualPromptSource), items, examples };
  const prepared = await preparePromptCuration(input);
  const proof: CurationCatalogProof = { snapshotId: snapshot.snapshot.id, manifestHash: snapshot.snapshot.manifestHash,
    members: snapshot.members.map(({ id, sourceItemId, memberKey, sourceOrder, sourceFingerprint }) => ({ id, sourceItemId, memberKey, sourceOrder, sourceFingerprint })),
    sources, fragments, images };
  return { input, prepared, proof };
}

/** Only the migration repository calls this with its rederived, exact plan. It
 * re-extracts server ranges and creates locked manual evidence. Pending rows do
 * not exist at the pre-insert fence; all source/member/image proofs still do.
 * The repository must insert these rows atomically and load the normal catalog
 * before returning. This is not a client-supplied proof validation API. */
export async function prepareMigratedCurationCatalog(db: D1DatabaseBinding, userId: string, snapshot: LinkSnapshotProjection,
  content: PromptCurationContent, selections: readonly { id: string; memberId: string; original: PromptCurationFragment }[]) {
  const pending: FragmentProof[] = [];
  for (const selection of selections) {
    const member = snapshot.members.find((row) => row.id === selection.memberId);
    if (!member) invalid("이관할 원문이 자료 버전에 없습니다.");
    const { textStart, textEnd, role } = selection.original;
    const fragment = await extractManualPromptFragment(manualPromptSource(member), { textStart, textEnd, role });
    if (fragment.rawText !== selection.original.rawText || fragment.rawTextHash !== selection.original.rawTextHash
      || !migrationCoverageMatches(selection.original, fragment.completeness)) invalid("이관할 원문의 범위 또는 확보 상태가 변경되었습니다.");
    const evidence: Evidence = { id: ulid(), user_id: userId, member_id: member.id, relation_kind: "supports", evidence_method: "user_confirmed",
      text_start: fragment.textStart, text_end: fragment.textEnd, image_region_json: null, start_seconds: null, end_seconds: null,
      display_order: 0, locked_by_user: 1, state_version: 1 };
    pending.push({ id: selection.id, primary_member_id: member.id, processing_run_id: null, fragment_key: `manual-${selection.id}`,
      role: fragment.role, source_class: "source_extract", text_start: fragment.textStart, text_end: fragment.textEnd, raw_text: fragment.rawText,
      raw_text_hash: fragment.rawTextHash, completeness: fragment.completeness,
      details_json: canonicalLinkJson({ contract: "manual-link-fragment.v1", selectionOrigin: "user_selected" }),
      state_version: 1, locked_by_user: 1, review_status: "confirmed", evidence_json: canonicalLinkJson([evidence]), valid_run_id: null });
  }
  const catalog = await buildCurationCatalog(db, userId, snapshot, content, true, pending);
  return { catalog: { ...catalog, proof: { ...catalog.proof, fragments: [] } }, pending };
}

/** Snapshot matching examines all members, including unselected competitors.
 * Capture their exact bytes so a target cannot gain/lose a match during awaits. */
export async function loadCurationMigrationTargetProof(db: D1DatabaseBinding, userId: string, snapshot: LinkSnapshotProjection) {
  const sources = (await db.prepare(`select id,item_kind,raw_text,content_hash,source_metadata from v2_source_items
    where user_id=? and capture_id=? and id in (select value from json_each(?))`)
    .bind(userId, snapshot.snapshot.captureId, canonicalLinkJson(snapshot.members.map((member) => member.sourceItemId))).all<SourceProof>()).results;
  for (const member of snapshot.members) {
    const proof = sources.find((row) => row.id === member.sourceItemId);
    if (!proof || proof.item_kind !== member.kind || proof.raw_text !== member.rawText || proof.content_hash !== member.contentHash
      || canonicalLinkJson(proof.source_metadata === null ? null : JSON.parse(proof.source_metadata)) !== canonicalLinkJson(member.metadata)) invalid("이관 후보 원문이 변경되었습니다.");
  }
  const images = (await db.prepare(`select a.id,m.id as member_id,m.source_item_id,a.sha256,a.mime_type,a.size_bytes,
    a.filename,a.object_key,a.status,a.committed_at from v2_link_snapshot_sources m
    join v2_source_attachment_links l on l.source_item_id=m.source_item_id and l.user_id=m.user_id
    join v2_attachment_reservations a on a.id=l.attachment_id and a.user_id=m.user_id where m.user_id=? and m.snapshot_id=?`)
    .bind(userId, snapshot.snapshot.id).all<ImageProof>()).results;
  for (const member of snapshot.members) {
    const attachments = images.filter((image) => image.member_id === member.id);
    if (attachments.length !== member.attachments.length || attachments.some((image) => image.status !== "committed" || !image.committed_at
      || !member.attachments.some((expected) => expected.id === image.id && normalizeLinkHash(expected.sha256) === normalizeLinkHash(image.sha256)
        && expected.mimeType === image.mime_type && expected.sizeBytes === image.size_bytes && expected.filename === image.filename))) invalid("이관 후보의 첨부 목록이 변경되었습니다.");
  }
  return { proof: { snapshotId: snapshot.snapshot.id, manifestHash: snapshot.snapshot.manifestHash,
    members: snapshot.members.map(({ id, sourceItemId, memberKey, sourceOrder, sourceFingerprint }) => ({ id, sourceItemId, memberKey, sourceOrder, sourceFingerprint })),
    sources, fragments: [], images, attachmentCounts: snapshot.members.map((member) => ({ memberId: member.id, count: member.attachments.length })) } satisfies CurationCatalogProof };
}

/** SQL expression with exactly one JSON bind, inside the caller's access/CAS
 * statement. No awaited digest or individual row query may follow this fence. */
export function curationCatalogFence() {
  // Compare bounded expected rows with live relational rows. EXCEPT is NULL-safe
  // and checks every proof without nesting per-proof/per-row EXISTS expressions.
  // The CTE and every facet execute within the caller's single SQL statement.
  const columns = (alias: string, names: readonly string[]) => names.map((name) => `${alias}.${name}`).join(",");
  const json = (names: readonly string[], alias = "p") => names.map((name) => `json_extract(${alias}.value,'$.${name}')`).join(",");
  const subset = (expected: string, actual: string) => `not exists(${expected} except ${actual})`;
  const memberKeys = ["id", "sourceItemId", "memberKey", "sourceOrder", "sourceFingerprint"];
  const sourceKeys = ["id", "item_kind", "raw_text", "content_hash", "source_metadata"];
  const imageKeys = ["id", "sha256", "mime_type", "size_bytes", "filename", "object_key", "status", "committed_at"];
  const checks = [
    subset(`select json_extract(proof.value,'$.snapshotId'),${json(["memberId", "count"])} from proofs proof,json_each(proof.value,'$.attachmentCounts') p`,
      `select m.snapshot_id,m.id,(select count(*) from v2_source_attachment_links l where l.source_item_id=m.source_item_id and l.user_id=o.user_id)
       from proofs proof,json_each(proof.value,'$.attachmentCounts') p join v2_link_snapshot_sources m
       on m.id=json_extract(p.value,'$.memberId') and m.snapshot_id=json_extract(proof.value,'$.snapshotId') and m.user_id=o.user_id`),
    subset(`select ${json(["snapshotId", "manifestHash"], "proof")},json_array_length(proof.value,'$.members') from proofs proof`,
      `select snapshot.id,snapshot.manifest_hash,count(m.id) from proofs proof
       join v2_link_snapshots snapshot on snapshot.id=json_extract(proof.value,'$.snapshotId')
       left join v2_link_snapshot_sources m on m.snapshot_id=snapshot.id
       where snapshot.user_id=o.user_id and snapshot.document_object_id=d.object_id and snapshot.capture_id=d.capture_id
         and snapshot.manifest_version='link-source-manifest.v1' group by proof.key`),
    subset(`select json_extract(proof.value,'$.snapshotId'),${json(memberKeys)} from proofs proof,json_each(proof.value,'$.members') p`,
      `select m.snapshot_id,m.id,m.source_item_id,m.member_key,m.source_order,m.source_fingerprint
       from proofs proof,json_each(proof.value,'$.members') p
       join v2_link_snapshot_sources m on m.id=json_extract(p.value,'$.id') and m.user_id=o.user_id and m.snapshot_id=json_extract(proof.value,'$.snapshotId')
       join v2_document_source_links l on l.source_item_id=m.source_item_id and l.document_object_id=d.object_id`),
    subset(`select ${json(sourceKeys)} from proofs proof,json_each(proof.value,'$.sources') p`,
      `select ${columns("source", sourceKeys)} from proofs proof,json_each(proof.value,'$.sources') p
       join v2_source_items source on source.id=json_extract(p.value,'$.id') and source.user_id=o.user_id and source.capture_id=d.capture_id`),
    subset(`select json_extract(proof.value,'$.snapshotId'),${json(fragmentColumns)},${json(["valid_run_id", "evidence_json"])}
       from proofs proof,json_each(proof.value,'$.fragments') p`,
      `select f.snapshot_id,${columns("f", fragmentColumns)},r.id,${evidenceSql}
       from proofs proof,json_each(proof.value,'$.fragments') p
       join v2_link_fragments f on f.id=json_extract(p.value,'$.id') and f.user_id=o.user_id
         and f.document_object_id=d.object_id and f.snapshot_id=json_extract(proof.value,'$.snapshotId')
       left join v2_processing_runs r on r.id=f.processing_run_id and r.user_id=f.user_id and ${validRunSql}`),
    subset(`select json_extract(proof.value,'$.snapshotId'),${json(["member_id", "source_item_id", ...imageKeys])}
       from proofs proof,json_each(proof.value,'$.images') p`,
      `select m.snapshot_id,m.id,m.source_item_id,${columns("a", imageKeys)}
       from proofs proof,json_each(proof.value,'$.images') p
       join v2_attachment_reservations a on a.id=json_extract(p.value,'$.id') and a.user_id=o.user_id
      join v2_source_attachment_links l on l.attachment_id=a.id and l.user_id=a.user_id
      join v2_link_snapshot_sources m on m.id=json_extract(p.value,'$.member_id') and m.source_item_id=l.source_item_id
        and m.user_id=a.user_id and m.snapshot_id=json_extract(proof.value,'$.snapshotId')`),
  ];
  return `(with proofs as materialized (select key,value from json_each(?)) select ${sqlConjunction(checks)})`;
}
