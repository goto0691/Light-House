import { ulid } from "ulidx";
import { canonicalLinkJson, linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { parseCreatePromptCurationRequest, parseRevisePromptCurationRequest, parseMigratePromptCurationRequest, promptCurationId,
  type CreatePromptCurationRequest, type RevisePromptCurationRequest, type PromptCurationContent } from "@/lib/v2/domain/prompt-curation-request";
import { copyPromptCuration, PromptCurationError, type PromptCopyRole } from "@/lib/v2/domain/prompt-curation-v1";
import { planPromptCurationMigration } from "@/lib/v2/domain/prompt-curation-migration";
import { PROMPT_CURATION_PAGE_SIZE, STORED_PROMPT_CURATION_CONTRACT, type PromptCurationDetail, type PromptCurationPage,
  type PromptCurationReceipt, type PromptCurationSummary, type StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { curationCatalogFence, loadCurationCatalog, loadCurationMigrationTargetProof, prepareMigratedCurationCatalog, type CurationCatalog } from "@/lib/v2/infrastructure/d1/prompt-curation-catalog";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { sqlConjunction } from "@/lib/v2/infrastructure/d1/sql-conjunction";

export type PromptCurationAccess = Readonly<{ restrictedGrantExpiresAt?: string }>;
type DocumentRow = { object_id: string; capture_id: string; current_revision_id: string; current_link_snapshot_id: string | null;
  link_snapshot_version: number; privacy_level: string };
type RevisionRow = { id: string; user_id: string; document_object_id: string; snapshot_id: string; group_key: string; revision_number: number;
  parent_revision_id: string | null; based_on_revision_id: string | null; change_reason: PromptCurationSummary["changeReason"];
  title: string; relation_kind: PromptCurationContent["relationKind"]; relationship_confirmation: PromptCurationContent["relationshipConfirmation"];
  order_confirmation: PromptCurationContent["orderConfirmation"]; status: "active" | "archived"; separator: string;
  manifest_version: string; render_version: string; manifest_json: string; manifest_hash: string; created_at: string };
type StoredRows = { row: RevisionRow; content: PromptCurationContent };
type Fence = { catalogs?: readonly Pick<CurationCatalog, "proof">[]; revisions?: readonly StoredRows[]; summaries?: readonly PromptCurationSummary[] };
const summaryColumns = "id,group_key,snapshot_id,revision_number,parent_revision_id,based_on_revision_id,change_reason,title,relation_kind,status,created_at,manifest_hash";
type SummaryRow = Pick<RevisionRow, "id" | "group_key" | "snapshot_id" | "revision_number" | "parent_revision_id" | "based_on_revision_id" | "change_reason" | "title" | "relation_kind" | "status" | "created_at" | "manifest_hash">;
const revisionColumns = ["id", "user_id", "document_object_id", "snapshot_id", "group_key", "revision_number", "parent_revision_id", "based_on_revision_id",
  "change_reason", "title", "relation_kind", "relationship_confirmation", "order_confirmation", "status", "separator", "manifest_version", "render_version", "manifest_json", "manifest_hash", "created_at"] as const;
function fail(code: string, message: string): never { throw new PromptCurationError(code, message); }
function summary(row: SummaryRow): PromptCurationSummary {
  return { id: row.id, groupKey: row.group_key, snapshotId: row.snapshot_id, revisionNumber: row.revision_number,
    parentRevisionId: row.parent_revision_id, basedOnRevisionId: row.based_on_revision_id, changeReason: row.change_reason,
    title: row.title, relationKind: row.relation_kind, status: row.status, createdAt: row.created_at, manifestHash: row.manifest_hash };
}
function stored(row: RevisionRow, content: PromptCurationContent, catalog: CurationCatalog): StoredPromptCuration {
  return { ...summary(row), content, prepared: catalog.prepared, items: catalog.input.items, examples: catalog.input.examples };
}
function sameDocument(a: DocumentRow, b: DocumentRow) {
  return a.capture_id === b.capture_id && a.current_revision_id === b.current_revision_id && a.current_link_snapshot_id === b.current_link_snapshot_id
    && a.link_snapshot_version === b.link_snapshot_version && a.privacy_level === b.privacy_level;
}
function contentIdentity(content: PromptCurationContent) {
  return canonicalLinkJson({ ...content,
    items: [...content.items].sort((a, b) => (a.copyRole < b.copyRole ? -1 : a.copyRole > b.copyRole ? 1 : a.position - b.position)),
    examples: [...content.examples].sort((a, b) => a.position - b.position),
  });
}
export function revisionFence() {
  const json = (alias: string, names: readonly string[]) => names.map((name) => `json_extract(${alias}.value,'$.${name}')`).join(",");
  const revisions = `from revision_proofs p join v2_link_curation_revisions r on r.id=json_extract(p.value,'$.row.id')
    and r.user_id=o.user_id and r.document_object_id=d.object_id`;
  const subset = (expected: string, actual: string) => `not exists(${expected} except ${actual})`;
  const checks = [
    subset(`select ${json("p", revisionColumns.map((name) => `row.${name}`))} from revision_proofs p`,
      `select ${revisionColumns.map((name) => `r.${name}`).join(",")} ${revisions}`),
    subset(`select json_extract(p.value,'$.row.id'),json_array_length(p.value,'$.content.items'),json_array_length(p.value,'$.content.examples') from revision_proofs p`,
      `select r.id,(select count(*) from v2_link_curation_items i where i.curation_revision_id=r.id),
        (select count(*) from v2_link_curation_examples e where e.curation_revision_id=r.id) ${revisions}`),
    subset(`select json_extract(p.value,'$.row.id'),${json("item", ["itemKey", "fragmentId", "copyRole", "position", "expectedFragmentStateVersion"])}
       from revision_proofs p,json_each(p.value,'$.content.items') item`,
      `select r.id,i.item_key,i.fragment_id,i.copy_role,i.position,i.fragment_state_version ${revisions}
       join json_each(p.value,'$.content.items') item
       join v2_link_curation_items i on i.curation_revision_id=r.id and i.user_id=o.user_id and i.item_key=json_extract(item.value,'$.itemKey')`),
    subset(`select json_extract(p.value,'$.row.id'),${json("example", ["exampleKey", "itemKey", "memberId", "attachmentId", "position", "evidenceMethod"])}
       from revision_proofs p,json_each(p.value,'$.content.examples') example`,
      `select r.id,e.example_key,i.item_key,e.member_id,e.attachment_id,e.position,e.evidence_method ${revisions}
       join json_each(p.value,'$.content.examples') example
       join v2_link_curation_examples e on e.curation_revision_id=r.id and e.user_id=o.user_id and e.example_key=json_extract(example.value,'$.exampleKey')
       left join v2_link_curation_items i on i.id=e.item_id and i.curation_revision_id=r.id and i.user_id=o.user_id
       where e.item_id is null or i.id is not null`),
  ];
  return `(with revision_proofs as materialized (select value from json_each(?)) select ${sqlConjunction(checks)})`;
}

export class D1PromptCurationRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}
  private async available() {
    const rows = await this.db.prepare("select name from sqlite_master where type='table' and name in ('v2_link_curation_revisions','v2_link_curation_items','v2_link_curation_examples')").all();
    if (rows.results.length !== 3) fail("prompt_curation_schema_unavailable", "정리본 저장소에는 0032 스키마가 필요합니다. 보관한 원문은 유지됩니다.");
  }
  private async access(recordId: string, expiry: string | undefined, expected?: DocumentRow, fence: Fence = {}): Promise<DocumentRow> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db), proofs: string[] = [], bindings: unknown[] = [];
    if (fence.catalogs?.length) { proofs.push(curationCatalogFence()); bindings.push(canonicalLinkJson(fence.catalogs.map((catalog) => catalog.proof))); }
    if (fence.revisions?.length) { proofs.push(revisionFence()); bindings.push(canonicalLinkJson(fence.revisions)); }
    if (fence.summaries?.length) {
      proofs.push(`not exists(select 1 from json_each(?) p where not exists(select 1 from v2_link_curation_revisions r
        where r.user_id=o.user_id and r.document_object_id=d.object_id and r.id=json_extract(p.value,'$.id')
        and r.manifest_hash=json_extract(p.value,'$.manifestHash') and r.status=json_extract(p.value,'$.status')))`);
      bindings.push(canonicalLinkJson(fence.summaries));
    }
    const row = await this.db.prepare(`select d.object_id,d.capture_id,d.current_revision_id,d.current_link_snapshot_id,d.link_snapshot_version,d.privacy_level,
      (${proofs.length ? proofs.join(" and ") : "1"}) as integrity from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
      where d.object_id=? and o.user_id=? and o.lifecycle_status in ('active','archived') and ${visibility} limit 1`)
      .bind(...bindings, recordId, this.userId).first<DocumentRow & { integrity: number }>();
    if (!row) return fail("record_not_found", "접근할 수 있는 기록을 찾지 못했습니다.");
    if (row.privacy_level === "restricted" && !(expiry && Date.parse(expiry) > Date.now())) fail("restricted_record_locked", "정리본을 열거나 저장하려면 기록의 잠금을 해제해 주세요.");
    if (expected && !sameDocument(expected, row)) fail("prompt_curation_conflict", "처리 중 기록 또는 자료 버전이 변경되었습니다.");
    if (row.integrity !== 1) fail("prompt_curation_integrity_invalid", "조회한 원문·조각·이미지 또는 정리본의 보존 정보가 변경되었습니다.");
    return row;
  }
  private async snapshot(recordId: string, snapshotId: string, expiry: string | undefined) {
    const result = await new D1LinkSnapshotRepository(this.db, this.userId).getSnapshot(recordId, snapshotId, Boolean(expiry && Date.parse(expiry) > Date.now()));
    if (!result) { await this.access(recordId, expiry); return fail("link_snapshot_not_found", "이 자료 버전에 접근할 수 없습니다."); }
    return result;
  }
  private head(recordId: string, groupKey: string) {
    return this.db.prepare("select * from v2_link_curation_revisions where user_id=? and document_object_id=? and group_key=? order by revision_number desc limit 1")
      .bind(this.userId, recordId, groupKey).first<RevisionRow>();
  }
  private async rows(recordId: string, groupKey: string, id: string): Promise<StoredRows> {
    const row = await this.db.prepare("select * from v2_link_curation_revisions where id=? and user_id=? and document_object_id=? and group_key=?")
      .bind(id, this.userId, recordId, groupKey).first<RevisionRow>();
    if (!row) return fail("prompt_curation_not_found", "이 기록의 정리본 버전을 찾지 못했습니다.");
    const [items, examples] = await Promise.all([
      this.db.prepare(`select item_key as itemKey,fragment_id as fragmentId,copy_role as copyRole,position,fragment_state_version as expectedFragmentStateVersion
        from v2_link_curation_items where curation_revision_id=? and user_id=? order by copy_role,position`).bind(id, this.userId).all<PromptCurationContent["items"][number]>(),
      this.db.prepare(`select e.example_key as exampleKey,i.item_key as itemKey,e.member_id as memberId,e.attachment_id as attachmentId,e.position,e.evidence_method as evidenceMethod
        from v2_link_curation_examples e left join v2_link_curation_items i on i.id=e.item_id and i.user_id=e.user_id and i.curation_revision_id=e.curation_revision_id
        where e.curation_revision_id=? and e.user_id=? order by e.position`).bind(id, this.userId).all<PromptCurationContent["examples"][number]>(),
    ]);
    const content = { title: row.title, relationKind: row.relation_kind, relationshipConfirmation: row.relationship_confirmation,
      orderConfirmation: row.order_confirmation, items: items.results, examples: examples.results };
    if (row.separator !== "\n" || row.manifest_version !== "prompt-curation-manifest.v1" || row.render_version !== "prompt-curation-render.v1")
      fail("prompt_curation_integrity_invalid", "지원하지 않는 정리본 보존 계약입니다.");
    return { row, content };
  }
  private async checked(recordId: string, rows: StoredRows, expiry: string | undefined) {
    const snapshot = await this.snapshot(recordId, rows.row.snapshot_id, expiry);
    const catalog = await loadCurationCatalog(this.db, this.userId, recordId, snapshot, rows.content, false);
    if (catalog.prepared.manifestJson !== rows.row.manifest_json || catalog.prepared.manifestHash !== rows.row.manifest_hash)
      fail("prompt_curation_integrity_invalid", "정리본의 manifest가 보관한 조각·이미지와 일치하지 않습니다.");
    return catalog;
  }
  /** A receipt is a pointer, not authority to return any valid group revision.
   * Bind its result to the original requested transition before disclosing it. */
  private async replayBasis(recordId: string, groupKey: string, prior: StoredRows,
    request: CreatePromptCurationRequest | RevisePromptCurationRequest, creating: boolean): Promise<StoredRows[]> {
    const invalid = () => fail("prompt_curation_integrity_invalid", "저장 영수증의 버전이 원래 정리본 요청과 일치하지 않습니다.");
    if (prior.row.snapshot_id !== request.expectedSnapshotId) invalid();
    if (creating) {
      if (prior.row.revision_number !== 1 || prior.row.parent_revision_id !== null || prior.row.based_on_revision_id !== null
        || prior.row.change_reason !== "create" || prior.row.status !== "active"
        || contentIdentity(prior.content) !== contentIdentity((request as CreatePromptCurationRequest).content)) invalid();
      return [];
    }
    const revision = request as RevisePromptCurationRequest;
    if (prior.row.parent_revision_id !== revision.expectedCurationRevisionId || prior.row.revision_number !== revision.expectedCurationRevisionNumber + 1
      || prior.row.change_reason !== revision.action || prior.row.based_on_revision_id !== (revision.action === "undo" ? revision.restoreRevisionId : null)) invalid();
    const parent = await this.rows(recordId, groupKey, revision.expectedCurationRevisionId);
    if (parent.row.snapshot_id !== request.expectedSnapshotId || parent.row.revision_number !== revision.expectedCurationRevisionNumber) invalid();
    const basis = revision.action === "undo" && revision.restoreRevisionId !== parent.row.id
      ? await this.rows(recordId, groupKey, revision.restoreRevisionId) : parent;
    if (basis.row.snapshot_id !== request.expectedSnapshotId || basis.row.revision_number > parent.row.revision_number) invalid();
    const expectedContent = revision.action === "edit" ? revision.content : basis.content;
    const expectedStatus = revision.action === "archive" ? "archived" : revision.action === "unarchive" ? "active" : basis.row.status;
    if (prior.row.status !== expectedStatus || contentIdentity(prior.content) !== contentIdentity(expectedContent)) invalid();
    return basis === parent ? [parent] : [parent, basis];
  }
  async create(recordId: string, value: unknown, options: PromptCurationAccess = {}): Promise<PromptCurationReceipt> {
    promptCurationId(recordId); const request = parseCreatePromptCurationRequest(value), expiry = options.restrictedGrantExpiresAt;
    return this.write(recordId, request.groupKey, request, expiry, true);
  }
  async revise(recordId: string, groupKey: string, value: unknown, options: PromptCurationAccess = {}): Promise<PromptCurationReceipt> {
    promptCurationId(recordId); promptCurationId(groupKey); const request = parseRevisePromptCurationRequest(value), expiry = options.restrictedGrantExpiresAt;
    return this.write(recordId, groupKey, request, expiry, false);
  }

  private async migrationContext(recordId: string, groupKey: string, revisionId: string, expectedRevisionId: string,
    targetSnapshotId: string, expiry: string | undefined) {
    const source = await this.rows(recordId, groupKey, revisionId), sourceCatalog = await this.checked(recordId, source, expiry);
    const snapshot = await this.snapshot(recordId, targetSnapshotId, expiry), targetProof = await loadCurationMigrationTargetProof(this.db, this.userId, snapshot);
    const plan = await planPromptCurationMigration({ recordId, sourceGroupKey: groupKey, sourceRevisionId: revisionId,
      sourceSnapshotId: source.row.snapshot_id, sourceManifestHash: source.row.manifest_hash, expectedRevisionId,
      expectedSnapshotId: targetSnapshotId, expectedManifestHash: snapshot.snapshot.manifestHash }, source.content, sourceCatalog.input, snapshot.members);
    return { source, sourceCatalog, snapshot, targetProof, plan };
  }
  private async migrationTarget(context: Awaited<ReturnType<D1PromptCurationRepository["migrationContext"]>>, prior?: PromptCurationContent) {
    const { source, sourceCatalog, snapshot, plan } = context;
    if (!plan.ready) fail("prompt_curation_migration_conflict", "모든 원문·이미지가 정확히 대응해야 이관할 수 있습니다. 누락·모호한 항목을 확인해 주세요.");
    const ids = new Map<string, string>();
    const items = source.content.items.map((item) => {
      const previous = prior?.items.find((row) => row.itemKey === item.itemKey)?.fragmentId;
      if (prior && !previous) fail("prompt_curation_integrity_invalid", "이관 영수증에 원래 항목이 없습니다.");
      const id = ids.get(item.fragmentId) ?? previous ?? ulid();
      if (previous && previous !== id || !ids.has(item.fragmentId) && [...ids.values()].includes(id))
        fail("prompt_curation_integrity_invalid", "이관 영수증의 수동 발췌 연결이 다릅니다.");
      ids.set(item.fragmentId, id);
      return { ...item, fragmentId: id, expectedFragmentStateVersion: 1 };
    });
    const content: PromptCurationContent = { ...source.content, items,
      examples: source.content.examples.map((example) => {
        const match = plan.examples.find((row) => row.exampleKey === example.exampleKey)!;
        return { ...example, memberId: match.memberId, attachmentId: match.attachmentId };
      }) };
    const selections = [...ids].map(([oldId, id]) => {
      const match = plan.items.find((item) => item.fragmentId === oldId)!;
      return { id, memberId: match.memberId, original: sourceCatalog.input.items.find((item) => item.itemKey === match.itemKey)!.fragment };
    });
    return { content, ...await prepareMigratedCurationCatalog(this.db, this.userId, snapshot, content, selections) };
  }
  async previewMigration(recordId: string, groupKey: string, revisionId: string, options: PromptCurationAccess = {}) {
    [recordId, groupKey, revisionId].forEach(promptCurationId);
    const expiry = options.restrictedGrantExpiresAt;
    await this.available(); const document = await this.access(recordId, expiry);
    if (!document.current_link_snapshot_id) fail("link_snapshot_not_found", "현재 자료 버전이 없습니다.");
    const context = await this.migrationContext(recordId, groupKey, revisionId, document.current_revision_id, document.current_link_snapshot_id, expiry);
    const target = context.plan.ready ? await this.migrationTarget(context) : null;
    await this.access(recordId, expiry, document, { catalogs: [context.sourceCatalog, context.targetProof, ...(target ? [target.catalog] : [])], revisions: [context.source] });
    return context.plan;
  }
  async migrate(recordId: string, sourceGroupKey: string, sourceRevisionId: string, value: unknown, options: PromptCurationAccess = {}): Promise<PromptCurationReceipt> {
    [recordId, sourceGroupKey, sourceRevisionId].forEach(promptCurationId);
    const request = parseMigratePromptCurationRequest(value), expiry = options.restrictedGrantExpiresAt;
    await this.available(); const document = await this.access(recordId, expiry), operation = "prompt_curation.migrate.v1";
    const payloadHash = await linkSha256Hex(canonicalLinkJson({ recordId, sourceGroupKey, sourceRevisionId, request: { ...request, idempotencyKey: null } }));
    const context = await this.migrationContext(recordId, sourceGroupKey, sourceRevisionId, request.expectedRevisionId, request.expectedSnapshotId, expiry);
    if (context.plan.planHash !== request.expectedPlanHash || context.plan.expectedManifestHash !== request.expectedManifestHash)
      fail("prompt_curation_migration_conflict", "이관 미리보기의 자료가 변경되었습니다. 다시 확인해 주세요.");
    const replay = async (): Promise<PromptCurationReceipt | null> => {
      const receipt = await this.db.prepare("select payload_hash,response_json from v2_idempotency_records where user_id=? and operation=? and idempotency_key=?")
        .bind(this.userId, operation, request.idempotencyKey).first<{ payload_hash: string; response_json: string }>();
      if (!receipt) return null;
      if (receipt.payload_hash !== payloadHash) fail("idempotency_conflict", "이 요청 키는 다른 이관에 사용되었습니다.");
      let id: unknown; try { id = JSON.parse(receipt.response_json).revisionId; } catch { fail("prompt_curation_integrity_invalid", "이관 영수증이 손상되었습니다."); }
      const prior = await this.rows(recordId, request.groupKey, promptCurationId(id)), target = await this.migrationTarget(context, prior.content);
      if (prior.row.snapshot_id !== request.expectedSnapshotId || prior.row.change_reason !== "migrate" || prior.row.revision_number !== 1
        || prior.row.parent_revision_id !== null || prior.row.based_on_revision_id !== sourceRevisionId || prior.row.status !== "active"
        || contentIdentity(target.content) !== contentIdentity(prior.content) || target.catalog.prepared.manifestHash !== prior.row.manifest_hash)
        fail("prompt_curation_integrity_invalid", "이관 영수증이 원래 확인한 정리본과 다릅니다.");
      const catalog = await loadCurationCatalog(this.db, this.userId, recordId, context.snapshot, prior.content, false);
      if (catalog.prepared.manifestJson !== prior.row.manifest_json || catalog.prepared.manifestHash !== prior.row.manifest_hash
        || catalog.input.items.some((item) => item.fragment.selectionOrigin !== "user_selected")) fail("prompt_curation_integrity_invalid", "이관은 확인한 정리본과 새 수동 발췌를 보존해야 합니다.");
      await this.access(recordId, expiry, document, { catalogs: [context.sourceCatalog, context.targetProof, catalog], revisions: [context.source, prior] });
      return { contract: STORED_PROMPT_CURATION_CONTRACT, item: stored(prior.row, prior.content, catalog), replayed: true };
    };
    const existing = await replay(); if (existing) return existing;
    if (document.current_revision_id !== request.expectedRevisionId || document.current_link_snapshot_id !== request.expectedSnapshotId
      || request.groupKey === sourceGroupKey || await this.head(recordId, request.groupKey)) fail("prompt_curation_migration_conflict", "현재 자료 버전에 새 그룹으로만 이관할 수 있습니다.");
    const { content, catalog, pending } = await this.migrationTarget(context), now = new Date().toISOString(), id = ulid();
    const row: RevisionRow = { id, user_id: this.userId, document_object_id: recordId, snapshot_id: request.expectedSnapshotId, group_key: request.groupKey,
      revision_number: 1, parent_revision_id: null, based_on_revision_id: sourceRevisionId, change_reason: "migrate", status: "active",
      title: content.title, relation_kind: content.relationKind, relationship_confirmation: content.relationshipConfirmation,
      order_confirmation: content.orderConfirmation, separator: "\n", manifest_version: catalog.prepared.manifestVersion, render_version: catalog.prepared.renderVersion,
      manifest_json: catalog.prepared.manifestJson, manifest_hash: catalog.prepared.manifestHash, created_at: now };
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const guard = `exists(select 1 from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
      where ${sqlConjunction(["d.object_id=?", "o.user_id=?", "o.lifecycle_status in ('active','archived')", `(${visibility})`,
      "d.capture_id=?", "d.current_revision_id=?", "d.current_link_snapshot_id=?", "d.link_snapshot_version=?", "d.privacy_level=?",
      "(d.privacy_level<>'restricted' or julianday(?)>julianday('now'))",
      "not exists(select 1 from v2_link_curation_revisions where user_id=o.user_id and document_object_id=d.object_id and group_key=?)",
      curationCatalogFence(), revisionFence()])})`;
    const itemRows = content.items.map((item) => ({ ...item, id: ulid() }));
    const exampleRows = content.examples.map((example) => ({ ...example, id: ulid(), itemId: example.itemKey === null ? null : itemRows.find((item) => item.itemKey === example.itemKey)!.id }));
    const evidenceRows = pending.flatMap((fragment) => (JSON.parse(fragment.evidence_json) as Record<string, unknown>[]).map((entry) => ({ ...entry, fragment_id: fragment.id })));
    try {
      await this.db.batch([
        this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
          values(case when ${guard} then ? else null end,?,'link.curation_saved','document',?,?,?)`)
          .bind(recordId, this.userId, document.capture_id, request.expectedRevisionId, request.expectedSnapshotId, document.link_snapshot_version, document.privacy_level,
            expiry ?? null, request.groupKey, canonicalLinkJson([context.sourceCatalog.proof, context.targetProof.proof, catalog.proof]), canonicalLinkJson([context.source]),
            ulid(), this.userId, recordId, canonicalLinkJson({ groupKey: request.groupKey, revisionId: id, changeReason: "migrate", basedOnRevisionId: sourceRevisionId }), now),
        this.db.prepare(`insert into v2_link_fragments(id,user_id,document_object_id,snapshot_id,primary_member_id,processing_run_id,fragment_key,
          role,source_class,text_start,text_end,raw_text,raw_text_hash,derived_text,details_json,completeness,display_order,review_status,locked_by_user,state_version,created_at)
          select json_extract(value,'$.id'),?,?,?,json_extract(value,'$.primary_member_id'),null,json_extract(value,'$.fragment_key'),
          json_extract(value,'$.role'),'source_extract',json_extract(value,'$.text_start'),json_extract(value,'$.text_end'),json_extract(value,'$.raw_text'),
          json_extract(value,'$.raw_text_hash'),null,json_extract(value,'$.details_json'),json_extract(value,'$.completeness'),0,'confirmed',1,1,? from json_each(?)`)
          .bind(this.userId, recordId, request.expectedSnapshotId, now, canonicalLinkJson(pending)),
        this.db.prepare(`insert into v2_link_fragment_evidence(id,user_id,fragment_id,member_id,relation_kind,evidence_method,text_start,text_end,display_order,locked_by_user,state_version,created_at)
          select json_extract(value,'$.id'),?,json_extract(value,'$.fragment_id'),json_extract(value,'$.member_id'),'supports','user_confirmed',
          json_extract(value,'$.text_start'),json_extract(value,'$.text_end'),0,1,1,? from json_each(?)`).bind(this.userId, now, canonicalLinkJson(evidenceRows)),
        this.db.prepare(`insert into v2_link_curation_revisions(${revisionColumns.join(",")}) values(${revisionColumns.map(() => "?").join(",")})`).bind(...revisionColumns.map((column) => row[column])),
        this.db.prepare(`insert into v2_link_curation_items(id,user_id,curation_revision_id,item_key,fragment_id,copy_role,position,fragment_state_version)
          select json_extract(value,'$.id'),?,?,json_extract(value,'$.itemKey'),json_extract(value,'$.fragmentId'),json_extract(value,'$.copyRole'),json_extract(value,'$.position'),json_extract(value,'$.expectedFragmentStateVersion') from json_each(?)`)
          .bind(this.userId, id, canonicalLinkJson(itemRows)),
        this.db.prepare(`insert into v2_link_curation_examples(id,user_id,curation_revision_id,example_key,item_id,member_id,attachment_id,position,evidence_method)
          select json_extract(value,'$.id'),?,?,json_extract(value,'$.exampleKey'),json_extract(value,'$.itemId'),json_extract(value,'$.memberId'),json_extract(value,'$.attachmentId'),json_extract(value,'$.position'),json_extract(value,'$.evidenceMethod') from json_each(?)`)
          .bind(this.userId, id, canonicalLinkJson(exampleRows)),
        this.db.prepare("insert into v2_idempotency_records(user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at) values(?,?,?,?,?,201,?)")
          .bind(this.userId, operation, request.idempotencyKey, payloadHash, canonicalLinkJson({ revisionId: id }), now),
      ]);
    } catch (error) {
      await this.access(recordId, expiry); const concurrent = await replay(); if (concurrent) return concurrent;
      if (/NOT NULL constraint failed|UNIQUE constraint failed|prompt_curation_.*mismatch/.test(error instanceof Error ? error.message : String(error)))
        fail("prompt_curation_migration_conflict", "처리 중 보존 정보가 변경되어 이관을 저장하지 않았습니다.");
      throw error;
    }
    const freshCatalog = await loadCurationCatalog(this.db, this.userId, recordId, context.snapshot, content, false);
    if (freshCatalog.prepared.manifestJson !== row.manifest_json || freshCatalog.prepared.manifestHash !== row.manifest_hash)
      fail("prompt_curation_integrity_invalid", "이관 저장 직후의 정리본이 변경되었습니다.");
    // Reuse the verified snapshot, but not unverified DB state: the final single
    // SQL fences its entire source/attachment set, freshly read fragment/evidence
    // and the exact server-created revision/children. No extra snapshot roundtrip
    // or awaited digest follows it (leave query capacity for authentication).
    await this.access(recordId, expiry, document, { catalogs: [context.sourceCatalog, context.targetProof, freshCatalog], revisions: [context.source, { row, content }] });
    return { contract: STORED_PROMPT_CURATION_CONTRACT, item: stored(row, content, freshCatalog), replayed: false };
  }
  private async write(recordId: string, groupKey: string, request: CreatePromptCurationRequest | RevisePromptCurationRequest, expiry: string | undefined, creating: boolean): Promise<PromptCurationReceipt> {
    await this.available(); const document = await this.access(recordId, expiry);
    const operation = creating ? "prompt_curation.create.v1" : "prompt_curation.revise.v1";
    const payloadHash = await linkSha256Hex(canonicalLinkJson({ recordId, groupKey, request: { ...request, idempotencyKey: null } }));
    const replay = async (): Promise<PromptCurationReceipt | null> => {
      const receipt = await this.db.prepare("select payload_hash,response_json from v2_idempotency_records where user_id=? and operation=? and idempotency_key=?")
        .bind(this.userId, operation, request.idempotencyKey).first<{ payload_hash: string; response_json: string }>();
      if (!receipt) return null;
      if (receipt.payload_hash !== payloadHash) fail("idempotency_conflict", "이 요청 키는 다른 정리본 요청에 사용되었습니다.");
      let id: unknown; try { id = JSON.parse(receipt.response_json).revisionId; } catch { fail("prompt_curation_integrity_invalid", "저장 영수증이 손상되었습니다."); }
      const prior = await this.rows(recordId, groupKey, promptCurationId(id));
      const basis = await this.replayBasis(recordId, groupKey, prior, request, creating);
      const catalog = await this.checked(recordId, prior, expiry);
      if (catalog.proof.manifestHash !== request.expectedManifestHash) fail("prompt_curation_integrity_invalid", "저장 영수증의 원문 manifest가 요청과 일치하지 않습니다.");
      await this.access(recordId, expiry, document, { catalogs: [catalog], revisions: [prior, ...basis] });
      return { contract: STORED_PROMPT_CURATION_CONTRACT, item: stored(prior.row, prior.content, catalog), replayed: true };
    };
    const replayed = await replay(); if (replayed) return replayed;
    if (document.current_revision_id !== request.expectedRevisionId || document.current_link_snapshot_id !== request.expectedSnapshotId)
      fail("prompt_curation_conflict", "현재 본문과 자료 버전을 다시 확인해 주세요.");
    const snapshot = await this.snapshot(recordId, request.expectedSnapshotId, expiry);
    if (snapshot.snapshot.manifestHash !== request.expectedManifestHash) fail("prompt_curation_conflict", "자료 manifest가 변경되었습니다.");
    const head = await this.head(recordId, groupKey), revisionRequest = creating ? null : request as RevisePromptCurationRequest;
    if (creating && head || !creating && (!head || head.id !== revisionRequest!.expectedCurationRevisionId || head.revision_number !== revisionRequest!.expectedCurationRevisionNumber
      || head.snapshot_id !== request.expectedSnapshotId)) fail("prompt_curation_conflict", "정리본의 최신 버전이 변경되었습니다.");
    let content: PromptCurationContent, basedOn: StoredRows | null = null, status: "active" | "archived" = head?.status ?? "active";
    const changeReason = creating ? "create" : revisionRequest!.action;
    if (creating) content = (request as CreatePromptCurationRequest).content;
    else if (revisionRequest!.action === "edit") content = revisionRequest!.content;
    else {
      const targetId = revisionRequest!.action === "undo" ? revisionRequest!.restoreRevisionId : head!.id;
      basedOn = await this.rows(recordId, groupKey, targetId);
      if (basedOn.row.snapshot_id !== request.expectedSnapshotId || basedOn.row.revision_number > head!.revision_number)
        fail("prompt_curation_conflict", "되돌릴 버전이 같은 자료·그룹의 과거 상태가 아닙니다.");
      const priorCatalog = await loadCurationCatalog(this.db, this.userId, recordId, snapshot, basedOn.content, false);
      if (priorCatalog.prepared.manifestJson !== basedOn.row.manifest_json || priorCatalog.prepared.manifestHash !== basedOn.row.manifest_hash)
        fail("prompt_curation_integrity_invalid", "되돌릴 버전의 원문·이미지 연결을 확인할 수 없습니다.");
      content = basedOn.content;
      status = revisionRequest!.action === "archive" ? "archived" : revisionRequest!.action === "unarchive" ? "active" : basedOn.row.status;
    }
    const catalog = await loadCurationCatalog(this.db, this.userId, recordId, snapshot, content, creating || changeReason === "edit");
    const now = new Date().toISOString(), id = ulid();
    const row: RevisionRow = { id, user_id: this.userId, document_object_id: recordId, snapshot_id: request.expectedSnapshotId, group_key: groupKey,
      revision_number: (head?.revision_number ?? 0) + 1, parent_revision_id: head?.id ?? null,
      based_on_revision_id: changeReason === "undo" ? basedOn!.row.id : null, change_reason: changeReason,
      title: content.title, relation_kind: content.relationKind, relationship_confirmation: content.relationshipConfirmation, order_confirmation: content.orderConfirmation,
      status, separator: "\n", manifest_version: catalog.prepared.manifestVersion, render_version: catalog.prepared.renderVersion,
      manifest_json: catalog.prepared.manifestJson, manifest_hash: catalog.prepared.manifestHash, created_at: now };
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const guard = `exists(select 1 from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
      where ${sqlConjunction(["d.object_id=?", "o.user_id=?", "o.lifecycle_status in ('active','archived')", `(${visibility})`,
      "d.capture_id=?", "d.current_revision_id=?", "d.current_link_snapshot_id=?", "d.link_snapshot_version=?", "d.privacy_level=?",
      "(d.privacy_level<>'restricted' or julianday(?)>julianday('now'))",
      "(select id from v2_link_curation_revisions where user_id=o.user_id and document_object_id=d.object_id and group_key=? order by revision_number desc limit 1) is ?",
      curationCatalogFence(), revisionFence()])})`;
    const itemRows = content.items.map((item) => ({ ...item, id: ulid() }));
    const exampleRows = content.examples.map((example) => ({ ...example, id: ulid(), itemId: example.itemKey === null ? null : itemRows.find((item) => item.itemKey === example.itemKey)!.id }));
    try {
      await this.db.batch([
        this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
          values(case when ${guard} then ? else null end,?,'link.curation_saved','document',?,?,?)`)
          .bind(recordId, this.userId, document.capture_id, request.expectedRevisionId, request.expectedSnapshotId, document.link_snapshot_version, document.privacy_level,
            expiry ?? null, groupKey, head?.id ?? null, canonicalLinkJson([catalog.proof]), canonicalLinkJson(basedOn ? [basedOn] : []),
            ulid(), this.userId, recordId, canonicalLinkJson({ groupKey, revisionId: id, changeReason }), now),
        this.db.prepare(`insert into v2_link_curation_revisions(${revisionColumns.join(",")}) values(${revisionColumns.map(() => "?").join(",")})`).bind(...revisionColumns.map((column) => row[column])),
        this.db.prepare(`insert into v2_link_curation_items(id,user_id,curation_revision_id,item_key,fragment_id,copy_role,position,fragment_state_version)
          select json_extract(value,'$.id'),?,?,json_extract(value,'$.itemKey'),json_extract(value,'$.fragmentId'),json_extract(value,'$.copyRole'),json_extract(value,'$.position'),json_extract(value,'$.expectedFragmentStateVersion') from json_each(?)`)
          .bind(this.userId, id, canonicalLinkJson(itemRows)),
        this.db.prepare(`insert into v2_link_curation_examples(id,user_id,curation_revision_id,example_key,item_id,member_id,attachment_id,position,evidence_method)
          select json_extract(value,'$.id'),?,?,json_extract(value,'$.exampleKey'),json_extract(value,'$.itemId'),json_extract(value,'$.memberId'),json_extract(value,'$.attachmentId'),json_extract(value,'$.position'),json_extract(value,'$.evidenceMethod') from json_each(?)`)
          .bind(this.userId, id, canonicalLinkJson(exampleRows)),
        this.db.prepare("insert into v2_idempotency_records(user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at) values(?,?,?,?,?,201,?)")
          .bind(this.userId, operation, request.idempotencyKey, payloadHash, canonicalLinkJson({ revisionId: id }), now),
      ]);
    } catch (error) {
      await this.access(recordId, expiry);
      const concurrent = await replay(); if (concurrent) return concurrent;
      if (/NOT NULL constraint failed|UNIQUE constraint failed|prompt_curation_.*mismatch/.test(error instanceof Error ? error.message : String(error)))
        fail("prompt_curation_conflict", "처리 중 보존 정보가 변경되어 정리본을 저장하지 않았습니다.");
      throw error;
    }
    await this.access(recordId, expiry, document, { catalogs: [catalog], revisions: [{ row, content }] });
    return { contract: STORED_PROMPT_CURATION_CONTRACT, item: stored(row, content, catalog), replayed: false };
  }

  private async cursor(scope: unknown, cursor: string | undefined, revisionOrder = false): Promise<{ identity: string; boundary: [string, string] | null }> {
    const identity = await linkSha256Hex(canonicalLinkJson({ userId: this.userId, scope }));
    if (cursor === undefined) return { identity, boundary: null };
    try {
      if (!cursor || cursor.length > 1600) throw new Error();
      const value: unknown = JSON.parse(decodeURIComponent(cursor));
      if (!Array.isArray(value) || value.length !== 4 || value[0] !== STORED_PROMPT_CURATION_CONTRACT || value[1] !== identity
        || typeof value[2] !== "string" || (revisionOrder
          ? !/^[1-9]\d*$/.test(value[2]) || !Number.isSafeInteger(Number(value[2]))
          : !Number.isFinite(Date.parse(value[2])))) throw new Error();
      return { identity, boundary: [value[2], promptCurationId(value[3])] };
    } catch { return fail("prompt_curation_cursor_invalid", "이 소유자·기록·목록의 커서가 아닙니다."); }
  }
  private page(rows: SummaryRow[], identity: string, revisionOrder = false) {
    const items = rows.slice(0, PROMPT_CURATION_PAGE_SIZE).map(summary), last = items.at(-1);
    return { items, nextCursor: rows.length > items.length && last ? encodeURIComponent(JSON.stringify([STORED_PROMPT_CURATION_CONTRACT, identity,
      revisionOrder ? String(last.revisionNumber) : last.createdAt, last.id])) : null };
  }
  async list(recordId: string, options: PromptCurationAccess & { snapshotId?: string; cursor?: string } = {}): Promise<PromptCurationPage> {
    promptCurationId(recordId); const expiry = options.restrictedGrantExpiresAt, requested = options.snapshotId === undefined ? undefined : promptCurationId(options.snapshotId), cursorValue = options.cursor;
    await this.available(); const document = await this.access(recordId, expiry), snapshotId = requested ?? document.current_link_snapshot_id;
    const base = { contract: STORED_PROMPT_CURATION_CONTRACT, recordId, currentRevisionId: document.current_revision_id,
      currentSnapshotId: document.current_link_snapshot_id, selectedSnapshotId: snapshotId, isHistorical: snapshotId !== document.current_link_snapshot_id };
    const cursor = await this.cursor({ recordId, snapshotId, kind: "groups" }, cursorValue);
    if (!snapshotId) { await this.access(recordId, expiry, document); return { ...base, items: [], nextCursor: null }; }
    // Metadata-only pages do not materialize every group's source text or assembly.
    const snapshot = await this.db.prepare("select id from v2_link_snapshots where id=? and user_id=? and document_object_id=? and capture_id=?")
      .bind(snapshotId, this.userId, recordId, document.capture_id).first();
    if (!snapshot) fail("link_snapshot_not_found", "이 자료 버전에 접근할 수 없습니다.");
    const rows = await this.db.prepare(`select ${summaryColumns.split(",").map((column) => `c.${column}`).join(",")} from v2_link_curation_revisions c
      where c.user_id=? and c.document_object_id=? and c.snapshot_id=? and not exists(select 1 from v2_link_curation_revisions newer
        where newer.user_id=c.user_id and newer.document_object_id=c.document_object_id and newer.group_key=c.group_key and newer.revision_number>c.revision_number)
      ${cursor.boundary ? "and (c.created_at<? or (c.created_at=? and c.id<?))" : ""} order by c.created_at desc,c.id desc limit ?`)
      .bind(this.userId, recordId, snapshotId, ...(cursor.boundary ? [cursor.boundary[0], cursor.boundary[0], cursor.boundary[1]] : []), PROMPT_CURATION_PAGE_SIZE + 1).all<SummaryRow>();
    const page = this.page(rows.results, cursor.identity);
    await this.access(recordId, expiry, document, { summaries: page.items }); return { ...base, ...page };
  }
  async get(recordId: string, groupKey: string, options: PromptCurationAccess & { revisionId?: string; cursor?: string } = {}): Promise<PromptCurationDetail> {
    promptCurationId(recordId); promptCurationId(groupKey); const expiry = options.restrictedGrantExpiresAt,
      requested = options.revisionId === undefined ? undefined : promptCurationId(options.revisionId), cursorValue = options.cursor;
    await this.available(); const document = await this.access(recordId, expiry), head = await this.head(recordId, groupKey);
    if (!head) return fail("prompt_curation_not_found", "이 기록의 정리본을 찾지 못했습니다.");
    const rows = await this.rows(recordId, groupKey, requested ?? head.id), catalog = await this.checked(recordId, rows, expiry);
    const cursor = await this.cursor({ recordId, groupKey, kind: "history" }, cursorValue, true);
    const history = await this.db.prepare(`select ${summaryColumns} from v2_link_curation_revisions where user_id=? and document_object_id=? and group_key=?
      ${cursor.boundary ? "and revision_number<?" : ""} order by revision_number desc limit ?`)
      .bind(this.userId, recordId, groupKey, ...(cursor.boundary ? [Number(cursor.boundary[0])] : []), PROMPT_CURATION_PAGE_SIZE + 1).all<SummaryRow>();
    const page = this.page(history.results, cursor.identity, true);
    await this.access(recordId, expiry, document, { catalogs: [catalog], revisions: [rows], summaries: [summary(head), ...page.items] });
    return { contract: STORED_PROMPT_CURATION_CONTRACT, recordId, currentRevisionId: document.current_revision_id, currentSnapshotId: document.current_link_snapshot_id,
      isHistorical: rows.row.snapshot_id !== document.current_link_snapshot_id || rows.row.id !== head.id,
      item: stored(rows.row, rows.content, catalog), head: { id: head.id, revisionNumber: head.revision_number }, history: page };
  }
  async copy(recordId: string, groupKey: string, revisionId: string, request: { role: PromptCopyRole; mode: "standard" | "available_only" }, options: PromptCurationAccess = {}) {
    promptCurationId(recordId); promptCurationId(groupKey); promptCurationId(revisionId);
    const selected = { role: request.role, mode: request.mode }, expiry = options.restrictedGrantExpiresAt;
    await this.available(); const document = await this.access(recordId, expiry), rows = await this.rows(recordId, groupKey, revisionId);
    const catalog = await this.checked(recordId, rows, expiry), result = await copyPromptCuration(catalog.input, selected);
    await this.access(recordId, expiry, document, { catalogs: [catalog], revisions: [rows] });
    return { contract: STORED_PROMPT_CURATION_CONTRACT, revisionId, ...result };
  }
}
