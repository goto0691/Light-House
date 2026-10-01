import { ulid } from "ulidx";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { createBackupSnapshot, type BackupRetentionClass } from "@/lib/v2/portability/backup-snapshot-v1";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { advanceBackupWorkflow, stageBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";
import { canonicalJson, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";

const DAY_MS = 86_400_000;
const RETENTION_LIMIT: Readonly<Record<Exclude<BackupRetentionClass, "manual">, number>> = { daily: 30, weekly: 12, monthly: 12 };
// Six bound values per kept row; 15 stays below D1's 100-parameter ceiling.
const INVENTORY_PAGE = 15;
const RECEIPT_PAGE = 12;
const OBJECT_DELETE_PAGE = 20;
const BLOB_REF_PAGE = 20;
const BLOB_GC_DELETE_PAGE = 5;
const MAX_ANCESTOR_DEPTH = 256;

type RetentionPhase = "inventory" | "ancestor_closure" | "pruning" | "gc_references" | "gc_deleting" | "complete";
type RetentionRunRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  status: "running" | "succeeded" | "failed";
  phase: RetentionPhase;
  cursor_json: string;
  state_revision: number;
  failure_code: string | null;
  started_at: string;
  last_progress_at: string;
  finished_at: string | null;
};
type InventoryCursor = {
  lastCreatedAt?: string;
  lastId?: string;
  dailyCount?: number;
  weeklyCount?: number;
  monthlyCount?: number;
};
type SnapshotWorkCursor = { metadataPath?: string; legacyPathIndex?: number; blobSha256?: string };
type SnapshotWorkRow = {
  run_id: string;
  user_id: string;
  snapshot_id: string;
  status: "receipting" | "deleting_objects" | "marking_blobs" | "finalizing" | "complete" | "cancelled";
  cursor_json: string;
};

export type RetentionSnapshot = Readonly<{ id: string; baseSnapshotId: string | null; retentionClass: BackupRetentionClass; pinned: boolean; createdAt: string }>;

export function planBackupRetention(rows: readonly RetentionSnapshot[]) {
  if (rows.some((row) => !["manual", "daily", "weekly", "monthly"].includes(row.retentionClass))) throw new Error("backup_retention_class_invalid");
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keep = new Set(rows.filter((row) => row.pinned || row.retentionClass === "manual").map((row) => row.id));
  for (const retentionClass of ["daily", "weekly", "monthly"] as const) {
    rows.filter((row) => row.retentionClass === retentionClass).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, RETENTION_LIMIT[retentionClass]).forEach((row) => keep.add(row.id));
  }
  for (const id of [...keep]) {
    let current = byId.get(id)?.baseSnapshotId ?? null;
    const visited = new Set([id]);
    while (current) {
      if (visited.has(current)) throw new Error("backup_retention_chain_cycle");
      const ancestor = byId.get(current);
      if (!ancestor) throw new Error("backup_retention_chain_missing_ancestor");
      visited.add(current);
      keep.add(current);
      current = ancestor.baseSnapshotId;
    }
  }
  return { keep: [...keep].sort(), prune: rows.filter((row) => !keep.has(row.id)).map((row) => row.id).sort() };
}

export function chooseAutomatedBackup(rows: readonly Pick<RetentionSnapshot, "retentionClass" | "createdAt">[], now: Date) {
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  if (!rows.some((row) => row.retentionClass === "monthly" && row.createdAt.slice(0, 7) === month)) return { kind: "full", retentionClass: "monthly" } as const;
  if (!rows.some((row) => row.retentionClass === "weekly" && now.getTime() - new Date(row.createdAt).getTime() < 7 * DAY_MS)) return { kind: "full", retentionClass: "weekly" } as const;
  if (!rows.some((row) => row.retentionClass === "daily" && row.createdAt.slice(0, 10) === today)) return { kind: rows.length ? "incremental" : "full", retentionClass: "daily" } as const;
  return null;
}

function parseJsonObject<T extends object>(value: string): T {
  try {
    const parsed = JSON.parse(value) as T;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {} as T;
  } catch {
    return {} as T;
  }
}

function changes(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as { changes?: unknown }).changes;
  return typeof value === "number" ? value : null;
}

function requireCasChange(result: unknown, code = "backup_retention_revision_conflict") {
  if (changes(result) === 0) throw new Error(code);
}

function requireBatchCas(results: unknown[], index = results.length - 1, code = "backup_retention_revision_conflict") {
  requireCasChange(results[index], code);
}

function valuesSql(rows: number, columns: number) {
  return Array.from({ length: rows }, () => `(${Array.from({ length: columns }, () => "?").join(",")})`).join(",");
}

function normalizedNow(value: string | undefined) {
  const now = value ?? new Date().toISOString();
  if (Number.isNaN(new Date(now).getTime())) throw new Error("backup_retention_time_invalid");
  return now;
}

async function retentionRunRow(db: D1DatabaseBinding, userId: string, runId: string) {
  return db.prepare(`select id,user_id,idempotency_key,status,phase,cursor_json,state_revision,failure_code,started_at,last_progress_at,finished_at from v2_backup_retention_runs where id=? and user_id=? limit 1`)
    .bind(runId, userId).first<RetentionRunRow>();
}

const RETENTION_VIEW_SELECT = `select r.id,r.user_id,r.idempotency_key,r.status,r.phase,r.state_revision,r.failure_code,r.started_at,r.last_progress_at,r.finished_at,
    (select count(*) from v2_backup_retention_keep k where k.run_id=r.id) as kept_snapshots,
    (select count(*) from v2_backup_retention_snapshot_work w where w.run_id=r.id and w.status='complete') as pruned_snapshots,
    (select count(*) from v2_backup_retention_object_receipts o where o.run_id=r.id and o.status='deleted') as deleted_objects
    from v2_backup_retention_runs r`;

function retentionView(row: Record<string, unknown>) {
  return {
    runId: String(row.id), status: String(row.status), phase: String(row.phase), stateRevision: Number(row.state_revision),
    failureCode: row.failure_code === null ? null : String(row.failure_code), startedAt: String(row.started_at),
    lastProgressAt: String(row.last_progress_at), finishedAt: row.finished_at === null ? null : String(row.finished_at),
    progress: { keptSnapshots: Number(row.kept_snapshots ?? 0), prunedSnapshots: Number(row.pruned_snapshots ?? 0), deletedObjects: Number(row.deleted_objects ?? 0) },
  };
}

export async function getBackupRetentionRun(db: D1DatabaseBinding, userId: string, runId: string) {
  const row = await db.prepare(`${RETENTION_VIEW_SELECT} where r.id=? and r.user_id=? limit 1`).bind(runId, userId).first<Record<string, unknown>>();
  if (!row) throw new Error("backup_retention_run_not_found");
  return retentionView(row);
}

export async function stageBackupRetentionRun(input: { db: D1DatabaseBinding; userId: string; idempotencyKey?: string; now?: string }) {
  const now = normalizedNow(input.now);
  const idempotencyKey = input.idempotencyKey ?? `retention:${now.slice(0, 10)}`;
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) throw new Error("backup_retention_idempotency_invalid");
  const existing = input.idempotencyKey
    ? await input.db.prepare(`${RETENTION_VIEW_SELECT} where r.user_id=? and r.idempotency_key=? limit 1`).bind(input.userId, idempotencyKey).first<Record<string, unknown>>()
    : await input.db.prepare(`${RETENTION_VIEW_SELECT} where r.user_id=? and (r.status='running' or r.idempotency_key=?) order by case when r.status='running' then 0 else 1 end,r.started_at limit 1`).bind(input.userId, idempotencyKey).first<Record<string, unknown>>();
  if (existing) return retentionView(existing);
  const runId = ulid();
  try {
    await input.db.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at) values (?,?,?,'running','inventory','{}',0,?,?)`)
      .bind(runId, input.userId, idempotencyKey, now, now).run();
  } catch (error) {
    const replay = await input.db.prepare(`select id from v2_backup_retention_runs where user_id=? and idempotency_key=? limit 1`).bind(input.userId, idempotencyKey).first<{ id: string }>();
    if (!replay) throw error;
    return getBackupRetentionRun(input.db, input.userId, replay.id);
  }
  return {
    runId, status: "running", phase: "inventory", stateRevision: 0, failureCode: null,
    startedAt: now, lastProgressAt: now, finishedAt: null,
    progress: { keptSnapshots: 0, prunedSnapshots: 0, deletedObjects: 0 },
  };
}

async function advanceInventory(input: { db: D1DatabaseBinding; run: RetentionRunRow; now: string }) {
  const cursor = parseJsonObject<InventoryCursor>(input.run.cursor_json);
  const rows = await input.db.prepare(`select id,base_snapshot_id,retention_class,pinned,created_at from v2_backup_snapshots
    where user_id=? and status='succeeded' and pruned_at is null
      and (? is null or created_at<? or (created_at=? and id<?))
    order by created_at desc,id desc limit ?`)
    .bind(input.run.user_id, cursor.lastCreatedAt ?? null, cursor.lastCreatedAt ?? "", cursor.lastCreatedAt ?? "", cursor.lastId ?? "", INVENTORY_PAGE)
    .all<{ id: string; base_snapshot_id: string | null; retention_class: BackupRetentionClass; pinned: number; created_at: string }>();
  const counts = { daily: Number(cursor.dailyCount ?? 0), weekly: Number(cursor.weeklyCount ?? 0), monthly: Number(cursor.monthlyCount ?? 0) };
  const keep: { id: string; reason: string }[] = [];
  for (const row of rows.results) {
    if (!["manual", "daily", "weekly", "monthly"].includes(row.retention_class)) throw new Error("backup_retention_class_invalid");
    let byPolicy = false;
    if (row.retention_class !== "manual") {
      counts[row.retention_class] += 1;
      byPolicy = counts[row.retention_class] <= RETENTION_LIMIT[row.retention_class];
    }
    if (row.pinned || row.retention_class === "manual" || byPolicy) keep.push({ id: row.id, reason: row.pinned ? "pinned" : row.retention_class === "manual" ? "manual" : row.retention_class });
  }
  const statements: D1PreparedStatementBinding[] = [];
  if (keep.length) {
    statements.push(input.db.prepare(`insert into v2_backup_retention_keep (run_id,user_id,snapshot_id,reason,chain_checked,created_at) values ${valuesSql(keep.length, 6)} on conflict(run_id,snapshot_id) do nothing`)
      .bind(...keep.flatMap((row) => [input.run.id, input.run.user_id, row.id, row.reason, 0, input.now])));
  }
  const last = rows.results.at(-1);
  const finished = rows.results.length < INVENTORY_PAGE;
  const nextCursor: InventoryCursor = last ? { lastCreatedAt: last.created_at, lastId: last.id, dailyCount: counts.daily, weeklyCount: counts.weekly, monthlyCount: counts.monthly } : cursor;
  statements.push(input.db.prepare(`update v2_backup_retention_runs set phase=?,cursor_json=?,state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
    .bind(finished ? "ancestor_closure" : "inventory", canonicalJson(finished ? {} : nextCursor), input.now, input.run.id, input.run.user_id, input.run.state_revision));
  const results = await input.db.batch(statements);
  requireBatchCas(results);
}

type ChainRow = { id: string; base_snapshot_id: string | null; depth: number; cycle: number };
const ANCESTOR_CHAIN_CTE = `with recursive chain(id,base_snapshot_id,depth,path,cycle) as (
  select id,base_snapshot_id,0,json_array(id),0 from v2_backup_snapshots where id=? and user_id=? and status='succeeded' and pruned_at is null
  union all
  select parent.id,parent.base_snapshot_id,chain.depth+1,json_insert(chain.path,'$[#]',parent.id),
    case when exists (select 1 from json_each(chain.path) where value=parent.id) then 1 else 0 end
  from chain join v2_backup_snapshots parent on parent.id=chain.base_snapshot_id and parent.user_id=? and parent.status='succeeded' and parent.pruned_at is null
  where chain.base_snapshot_id is not null and chain.cycle=0 and chain.depth<?
)`;
const ACTIVE_BACKUP_DEPENDENCY_CTE = `with recursive protected(id) as (
  select s.base_snapshot_id from v2_backup_snapshots s
  where s.user_id=? and s.status='building' and s.base_snapshot_id is not null
  union
  select b.source_ref from v2_restore_batches b
  where b.user_id=? and b.source_kind='backup' and b.source_ref is not null
    and b.status not in ('succeeded','failed','rolled_back','rollback_conflicted')
  union
  select k.snapshot_id from v2_backup_retention_keep k
  join v2_backup_retention_runs r on r.id=k.run_id
  where k.user_id=? and r.status='running'
  union
  select s.base_snapshot_id from v2_backup_snapshots s join protected p on s.id=p.id
  where s.user_id=? and s.base_snapshot_id is not null
)`;

function activeDependencyBindings(userId: string) {
  return [userId, userId, userId, userId] as const;
}

async function isActiveBackupDependency(db: D1DatabaseBinding, userId: string, snapshotId: string) {
  return Boolean(await db.prepare(`${ACTIVE_BACKUP_DEPENDENCY_CTE} select 1 as value from protected where id=? limit 1`)
    .bind(...activeDependencyBindings(userId), snapshotId).first<{ value: number }>());
}

async function advanceAncestorClosure(input: { db: D1DatabaseBinding; run: RetentionRunRow; now: string }) {
  const seed = await input.db.prepare(`select snapshot_id from v2_backup_retention_keep where run_id=? and chain_checked=0 order by snapshot_id limit 1`).bind(input.run.id).first<{ snapshot_id: string }>();
  if (!seed) {
    const result = await input.db.prepare(`update v2_backup_retention_runs set phase='pruning',cursor_json='{}',state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
      .bind(input.now, input.run.id, input.run.user_id, input.run.state_revision).run();
    requireCasChange(result);
    return;
  }
  const chain = await input.db.prepare(`${ANCESTOR_CHAIN_CTE} select id,base_snapshot_id,depth,cycle from chain order by depth`)
    .bind(seed.snapshot_id, input.run.user_id, input.run.user_id, MAX_ANCESTOR_DEPTH).all<ChainRow>();
  if (!chain.results.length) throw new Error("backup_retention_chain_missing_ancestor");
  if (chain.results.some((row) => Boolean(row.cycle))) throw new Error("backup_retention_chain_cycle");
  const ids = new Set(chain.results.map((row) => row.id));
  const unresolved = chain.results.find((row) => row.base_snapshot_id && !ids.has(row.base_snapshot_id));
  if (unresolved) {
    if (unresolved.depth >= MAX_ANCESTOR_DEPTH) throw new Error("backup_retention_chain_too_deep");
    throw new Error("backup_retention_chain_missing_ancestor");
  }
  const results = await input.db.batch([
    input.db.prepare(`${ANCESTOR_CHAIN_CTE}
      insert into v2_backup_retention_keep (run_id,user_id,snapshot_id,reason,chain_checked,created_at)
      select ?,?,id,case when depth=0 then 'policy' else 'ancestor' end,1,? from chain where cycle=0
      on conflict(run_id,snapshot_id) do update set chain_checked=1`)
      .bind(seed.snapshot_id, input.run.user_id, input.run.user_id, MAX_ANCESTOR_DEPTH, input.run.id, input.run.user_id, input.now),
    input.db.prepare(`update v2_backup_retention_runs set state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
      .bind(input.now, input.run.id, input.run.user_id, input.run.state_revision),
  ]);
  requireBatchCas(results);
}

async function currentSnapshotWork(db: D1DatabaseBinding, runId: string) {
  return db.prepare(`select run_id,user_id,snapshot_id,status,cursor_json from v2_backup_retention_snapshot_work where run_id=? and status not in ('complete','cancelled') order by snapshot_id limit 1`)
    .bind(runId).first<SnapshotWorkRow>();
}

async function addObjectReceipts(input: { db: D1DatabaseBinding; work: SnapshotWorkRow; rows: readonly { objectKey: string; kind: string }[]; now: string }) {
  if (!input.rows.length) return;
  await input.db.prepare(`insert into v2_backup_retention_object_receipts (run_id,user_id,snapshot_id,object_key,object_kind,status,created_at) values ${valuesSql(input.rows.length, 7)} on conflict(run_id,object_key) do nothing`)
    .bind(...input.rows.flatMap((row) => [input.work.run_id, input.work.user_id, input.work.snapshot_id, row.objectKey, row.kind, "pending", input.now])).run();
}

async function advanceReceiptPlanning(input: { db: D1DatabaseBinding; work: SnapshotWorkRow; now: string }) {
  const snapshot = await input.db.prepare(`select workflow_version,manifest_object_key from v2_backup_snapshots where id=? and user_id=? and status='pruning' and prune_run_id=? and pruned_at is null limit 1`)
    .bind(input.work.snapshot_id, input.work.user_id, input.work.run_id).first<{ workflow_version: number; manifest_object_key: string | null }>();
  if (!snapshot) throw new Error("backup_retention_snapshot_changed");
  const cursor = parseJsonObject<SnapshotWorkCursor>(input.work.cursor_json);
  if (snapshot.workflow_version >= 2) {
    const files = await input.db.prepare(`select path,object_key from v2_backup_metadata_files where snapshot_id=? and path>? order by path limit ?`)
      .bind(input.work.snapshot_id, cursor.metadataPath ?? "", RECEIPT_PAGE).all<{ path: string; object_key: string }>();
    if (files.results.length) {
      await addObjectReceipts({ ...input, rows: files.results.map((row) => ({ objectKey: row.object_key, kind: "metadata" })) });
      await input.db.prepare(`update v2_backup_retention_snapshot_work set cursor_json=? where run_id=? and snapshot_id=? and status='receipting'`)
        .bind(canonicalJson({ ...cursor, metadataPath: files.results.at(-1)!.path }), input.work.run_id, input.work.snapshot_id).run();
      return;
    }
  } else {
    const paths = [...new Set(CANONICAL_TABLES_V1.map((descriptor) => descriptor.path))];
    const index = Number(cursor.legacyPathIndex ?? 0);
    const page = paths.slice(index, index + RECEIPT_PAGE);
    if (page.length) {
      const owner = sha256Hex(input.work.user_id).slice(0, 24);
      await addObjectReceipts({ ...input, rows: page.map((path) => ({ objectKey: `users/${owner}/backups/snapshots/${input.work.snapshot_id}/metadata/${path}`, kind: "metadata" })) });
      await input.db.prepare(`update v2_backup_retention_snapshot_work set cursor_json=? where run_id=? and snapshot_id=? and status='receipting'`)
        .bind(canonicalJson({ ...cursor, legacyPathIndex: index + page.length }), input.work.run_id, input.work.snapshot_id).run();
      return;
    }
  }
  if (snapshot.manifest_object_key) await addObjectReceipts({ ...input, rows: [{ objectKey: snapshot.manifest_object_key, kind: "manifest" }] });
  const transitioned = await input.db.prepare(`update v2_backup_retention_snapshot_work set status='deleting_objects'
    where run_id=? and snapshot_id=? and status='receipting'
      and not exists (${ACTIVE_BACKUP_DEPENDENCY_CTE} select 1 from protected where id=?)`)
    .bind(input.work.run_id, input.work.snapshot_id, ...activeDependencyBindings(input.work.user_id), input.work.snapshot_id).run();
  requireCasChange(transitioned, "backup_retention_dependency_changed");
}

async function advanceObjectDeletion(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; work: SnapshotWorkRow; now: string }) {
  const rows = await input.db.prepare(`select object_key from v2_backup_retention_object_receipts where run_id=? and snapshot_id=? and status='pending' order by object_key limit ?`)
    .bind(input.work.run_id, input.work.snapshot_id, OBJECT_DELETE_PAGE).all<{ object_key: string }>();
  if (!rows.results.length) {
    await input.db.prepare(`update v2_backup_retention_snapshot_work set status='marking_blobs',cursor_json='{}' where run_id=? and snapshot_id=? and status='deleting_objects'`)
      .bind(input.work.run_id, input.work.snapshot_id).run();
    return;
  }
  await input.bucket.delete(rows.results.map((row) => row.object_key));
  await input.db.prepare(`update v2_backup_retention_object_receipts set status='deleted',deleted_at=? where run_id=? and snapshot_id=? and status='pending' and object_key in (${rows.results.map(() => "?").join(",")})`)
    .bind(input.now, input.work.run_id, input.work.snapshot_id, ...rows.results.map((row) => row.object_key)).run();
}

async function advanceBlobReferenceMarking(input: { db: D1DatabaseBinding; work: SnapshotWorkRow; now: string }) {
  const cursor = parseJsonObject<SnapshotWorkCursor>(input.work.cursor_json);
  const refs = await input.db.prepare(`select sha256,object_key from v2_backup_blob_refs where snapshot_id=? and user_id=? and sha256>? order by sha256 limit ?`)
    .bind(input.work.snapshot_id, input.work.user_id, cursor.blobSha256 ?? "", BLOB_REF_PAGE).all<{ sha256: string; object_key: string }>();
  if (!refs.results.length) {
    await input.db.prepare(`update v2_backup_retention_snapshot_work set status='finalizing',cursor_json='{}' where run_id=? and snapshot_id=? and status='marking_blobs'`)
      .bind(input.work.run_id, input.work.snapshot_id).run();
    return;
  }
  const hashes = refs.results.map((row) => row.sha256);
  const results = await input.db.batch([
    input.db.prepare(`insert into v2_backup_blob_gc_marks (user_id,sha256,object_key,unreferenced_since,last_checked_at,deleted_at,delete_token,delete_claimed_at)
      select r.user_id,r.sha256,r.object_key,?,?,null,null,null from v2_backup_blob_refs r
      where r.snapshot_id=? and r.user_id=? and r.sha256 in (${hashes.map(() => "?").join(",")})
        and not exists (select 1 from v2_backup_blob_refs other where other.user_id=r.user_id and other.sha256=r.sha256 and other.snapshot_id<>r.snapshot_id)
      on conflict(user_id,sha256) do update set object_key=excluded.object_key,
        unreferenced_since=case when v2_backup_blob_gc_marks.deleted_at is not null then excluded.unreferenced_since else v2_backup_blob_gc_marks.unreferenced_since end,
        last_checked_at=excluded.last_checked_at,deleted_at=null,delete_token=null,delete_claimed_at=null`)
      .bind(input.now, input.now, input.work.snapshot_id, input.work.user_id, ...hashes),
    input.db.prepare(`delete from v2_backup_blob_refs where snapshot_id=? and user_id=? and sha256 in (${hashes.map(() => "?").join(",")})`)
      .bind(input.work.snapshot_id, input.work.user_id, ...hashes),
    input.db.prepare(`update v2_backup_retention_snapshot_work set status=?,cursor_json=? where run_id=? and snapshot_id=? and status='marking_blobs'`)
      .bind(refs.results.length < BLOB_REF_PAGE ? "finalizing" : "marking_blobs", canonicalJson({ blobSha256: refs.results.at(-1)!.sha256 }), input.work.run_id, input.work.snapshot_id),
  ]);
  requireBatchCas(results, 2, "backup_retention_work_state_invalid");
}

async function finalizeSnapshotPrune(input: { db: D1DatabaseBinding; work: SnapshotWorkRow; now: string }) {
  const counts = await input.db.prepare(`select
    (select count(*) from v2_backup_retention_object_receipts where run_id=? and snapshot_id=? and status<>'deleted') as pending_objects,
    (select count(*) from v2_backup_blob_refs where snapshot_id=? and user_id=?) as blob_refs`)
    .bind(input.work.run_id, input.work.snapshot_id, input.work.snapshot_id, input.work.user_id).first<{ pending_objects: number; blob_refs: number }>();
  if (!counts || counts.pending_objects !== 0 || counts.blob_refs !== 0) throw new Error("backup_retention_prune_receipts_incomplete");
  const results = await input.db.batch([
    input.db.prepare(`delete from v2_backup_metadata_files where snapshot_id=?`).bind(input.work.snapshot_id),
    input.db.prepare(`delete from v2_backup_blob_work_items where snapshot_id=?`).bind(input.work.snapshot_id),
    input.db.prepare(`delete from v2_backup_blob_members where snapshot_id=?`).bind(input.work.snapshot_id),
    input.db.prepare(`update v2_backup_retention_snapshot_work set status='complete',completed_at=? where run_id=? and snapshot_id=? and status='finalizing'`).bind(input.now, input.work.run_id, input.work.snapshot_id),
    input.db.prepare(`update v2_backup_snapshots set status='pruned',pruned_at=?,manifest_object_key=null,prune_run_id=null where id=? and user_id=? and status='pruning' and prune_run_id=? and pruned_at is null`).bind(input.now, input.work.snapshot_id, input.work.user_id, input.work.run_id),
  ]);
  requireBatchCas(results, 3, "backup_retention_work_state_invalid");
  requireBatchCas(results, 4, "backup_retention_claim_lost");
}

async function advancePruning(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; run: RetentionRunRow; now: string }) {
  let work = await currentSnapshotWork(input.db, input.run.id);
  if (!work) {
    const uncheckedKeep = await input.db.prepare(`select 1 as value from v2_backup_retention_keep where run_id=? and chain_checked=0 limit 1`)
      .bind(input.run.id).first<{ value: number }>();
    if (uncheckedKeep) {
      const result = await input.db.prepare(`update v2_backup_retention_runs set phase='ancestor_closure',cursor_json='{}',state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
        .bind(input.now, input.run.id, input.run.user_id, input.run.state_revision).run();
      requireCasChange(result);
      return;
    }
    const candidate = await input.db.prepare(`select s.id from v2_backup_snapshots s where s.user_id=? and s.status='succeeded' and s.pruned_at is null
      and s.pinned=0 and s.retention_class in ('daily','weekly','monthly')
      and not exists (select 1 from v2_backup_retention_keep k where k.run_id=? and k.snapshot_id=s.id)
      and not exists (${ACTIVE_BACKUP_DEPENDENCY_CTE} select 1 from protected where id=s.id)
      order by s.created_at,s.id limit 1`).bind(input.run.user_id, input.run.id, ...activeDependencyBindings(input.run.user_id)).first<{ id: string }>();
    if (!candidate) {
      const result = await input.db.prepare(`update v2_backup_retention_runs set phase='gc_references',cursor_json='{}',state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`).bind(input.now, input.run.id, input.run.user_id, input.run.state_revision).run();
      requireCasChange(result);
      return;
    }
    const results = await input.db.batch([
      input.db.prepare(`update v2_backup_snapshots set status='pruning',prune_run_id=? where id=? and user_id=? and status='succeeded' and prune_run_id is null and pruned_at is null and pinned=0 and retention_class in ('daily','weekly','monthly')
        and not exists (select 1 from v2_backup_retention_keep k where k.run_id=? and k.snapshot_id=v2_backup_snapshots.id)
        and not exists (${ACTIVE_BACKUP_DEPENDENCY_CTE} select 1 from protected where id=v2_backup_snapshots.id)`)
        .bind(input.run.id, candidate.id, input.run.user_id, input.run.id, ...activeDependencyBindings(input.run.user_id)),
      input.db.prepare(`insert into v2_backup_retention_snapshot_work (run_id,user_id,snapshot_id,status,cursor_json,created_at)
        select ?,?,id,'receipting','{}',? from v2_backup_snapshots where id=? and user_id=? and status='pruning' and prune_run_id=?
        on conflict(run_id,snapshot_id) do nothing`)
        .bind(input.run.id, input.run.user_id, input.now, candidate.id, input.run.user_id, input.run.id),
      input.db.prepare(`update v2_backup_retention_runs set state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
        .bind(input.now, input.run.id, input.run.user_id, input.run.state_revision),
    ]);
    requireBatchCas(results, 2);
    if (changes(results[0]) === 1) requireBatchCas(results, 1, "backup_retention_claim_receipt_missing");
    return;
  }
  const ownership = await input.db.prepare(`select s.status,s.prune_run_id,exists(select 1 from v2_backup_retention_keep k where k.run_id=? and k.snapshot_id=s.id) as became_kept
    from v2_backup_snapshots s where s.id=? and s.user_id=? limit 1`).bind(input.run.id, work.snapshot_id, input.run.user_id).first<{ status: string; prune_run_id: string | null; became_kept: number }>();
  if (!ownership || ownership.status !== "pruning" || ownership.prune_run_id !== input.run.id) throw new Error("backup_retention_claim_lost");
  const becameDependency = work.status === "receipting"
    && (Boolean(ownership.became_kept) || await isActiveBackupDependency(input.db, input.run.user_id, work.snapshot_id));
  if (becameDependency) {
    const results = await input.db.batch([
      input.db.prepare(`update v2_backup_retention_snapshot_work set status='cancelled',completed_at=? where run_id=? and snapshot_id=? and status='receipting'`).bind(input.now, input.run.id, work.snapshot_id),
      input.db.prepare(`update v2_backup_snapshots set status='succeeded',prune_run_id=null where id=? and user_id=? and status='pruning' and prune_run_id=?`).bind(work.snapshot_id, input.run.user_id, input.run.id),
      input.db.prepare(`update v2_backup_retention_runs set phase='ancestor_closure',cursor_json='{}',state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`).bind(input.now, input.run.id, input.run.user_id, input.run.state_revision),
    ]);
    requireBatchCas(results, 1, "backup_retention_claim_lost");
    requireBatchCas(results, 2);
    return;
  }
  if (work.status === "receipting") await advanceReceiptPlanning({ ...input, work });
  else if (work.status === "deleting_objects") await advanceObjectDeletion({ ...input, work });
  else if (work.status === "marking_blobs") await advanceBlobReferenceMarking({ ...input, work });
  else if (work.status === "finalizing") await finalizeSnapshotPrune({ ...input, work });
  else throw new Error("backup_retention_work_state_invalid");
  const result = await input.db.prepare(`update v2_backup_retention_runs set state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`).bind(input.now, input.run.id, input.run.user_id, input.run.state_revision).run();
  requireCasChange(result);
}

async function advanceGcReferenceReconciliation(input: { db: D1DatabaseBinding; run: RetentionRunRow; now: string }) {
  const referenced = await input.db.prepare(`select g.sha256 from v2_backup_blob_gc_marks g where g.user_id=? and g.delete_token is null
    and exists (select 1 from v2_backup_blob_refs r where r.user_id=g.user_id and r.sha256=g.sha256)
    order by g.sha256 limit ?`).bind(input.run.user_id, BLOB_REF_PAGE).all<{ sha256: string }>();
  if (!referenced.results.length) {
    const result = await input.db.prepare(`update v2_backup_retention_runs set phase='gc_deleting',state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`).bind(input.now, input.run.id, input.run.user_id, input.run.state_revision).run();
    requireCasChange(result);
    return;
  }
  const results = await input.db.batch([
    input.db.prepare(`delete from v2_backup_blob_gc_marks where user_id=? and delete_token is null and sha256 in (${referenced.results.map(() => "?").join(",")})`).bind(input.run.user_id, ...referenced.results.map((row) => row.sha256)),
    input.db.prepare(`update v2_backup_retention_runs set state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`).bind(input.now, input.run.id, input.run.user_id, input.run.state_revision),
  ]);
  requireBatchCas(results);
}

async function advanceGcDeletion(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; run: RetentionRunRow; now: string }) {
  let claimed = await input.db.prepare(`select sha256,object_key,delete_token from v2_backup_blob_gc_marks where user_id=? and deleted_at is null and delete_token is not null order by delete_claimed_at,sha256 limit ?`).bind(input.run.user_id, BLOB_GC_DELETE_PAGE).all<{ sha256: string; object_key: string; delete_token: string }>();
  if (!claimed.results.length) {
    const cutoff = new Date(new Date(input.now).getTime() - 7 * DAY_MS).toISOString();
    const token = crypto.randomUUID();
    await input.db.prepare(`update v2_backup_blob_gc_marks set delete_token=?,delete_claimed_at=? where rowid in (
      select g.rowid from v2_backup_blob_gc_marks g where g.user_id=? and g.deleted_at is null and g.delete_token is null and g.unreferenced_since<=?
        and not exists (select 1 from v2_backup_blob_refs r where r.user_id=g.user_id and r.sha256=g.sha256)
      order by g.unreferenced_since,g.sha256 limit ?
    )`).bind(token, input.now, input.run.user_id, cutoff, BLOB_GC_DELETE_PAGE).run();
    claimed = await input.db.prepare(`select sha256,object_key,delete_token from v2_backup_blob_gc_marks where user_id=? and deleted_at is null and delete_token=? order by sha256 limit ?`).bind(input.run.user_id, token, BLOB_GC_DELETE_PAGE).all<{ sha256: string; object_key: string; delete_token: string }>();
  }
  if (!claimed.results.length) {
    const result = await input.db.prepare(`update v2_backup_retention_runs set status='succeeded',phase='complete',failure_code=null,state_revision=state_revision+1,last_progress_at=?,finished_at=? where id=? and user_id=? and status='running' and state_revision=?`).bind(input.now, input.now, input.run.id, input.run.user_id, input.run.state_revision).run();
    requireCasChange(result);
    return;
  }
  await input.bucket.delete(claimed.results.map((row) => row.object_key));
  const tokens = [...new Set(claimed.results.map((row) => row.delete_token))];
  const results = await input.db.batch([
    input.db.prepare(`update v2_backup_blob_gc_marks set deleted_at=?,last_checked_at=? where user_id=? and deleted_at is null and delete_token in (${tokens.map(() => "?").join(",")})`).bind(input.now, input.now, input.run.user_id, ...tokens),
    input.db.prepare(`update v2_backup_retention_runs set state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`).bind(input.now, input.run.id, input.run.user_id, input.run.state_revision),
  ]);
  requireBatchCas(results);
}

const FAIL_CLOSED_CODES = new Set(["backup_retention_class_invalid", "backup_retention_chain_cycle", "backup_retention_chain_missing_ancestor", "backup_retention_chain_too_deep", "backup_retention_snapshot_changed", "backup_retention_prune_receipts_incomplete", "backup_retention_claim_lost", "backup_retention_claim_receipt_missing", "backup_retention_dependency_changed"]);

async function recoverOrFailClosedRetentionRun(input: { db: D1DatabaseBinding; run: RetentionRunRow; code: string; now: string }) {
  const work = await currentSnapshotWork(input.db, input.run.id);
  const owned = await input.db.prepare(`select id from v2_backup_snapshots where user_id=? and status='pruning' and prune_run_id=? limit 1`)
    .bind(input.run.user_id, input.run.id).first<{ id: string }>();

  if (input.code === "backup_retention_dependency_changed" && work?.status === "receipting" && owned?.id === work.snapshot_id) {
    const results = await input.db.batch([
      input.db.prepare(`update v2_backup_retention_snapshot_work set status='cancelled',completed_at=? where run_id=? and snapshot_id=? and status='receipting'`)
        .bind(input.now, input.run.id, work.snapshot_id),
      input.db.prepare(`update v2_backup_snapshots set status='succeeded',prune_run_id=null where id=? and user_id=? and status='pruning' and prune_run_id=?`)
        .bind(work.snapshot_id, input.run.user_id, input.run.id),
      input.db.prepare(`update v2_backup_retention_runs set phase='ancestor_closure',cursor_json='{}',failure_code=null,state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
        .bind(input.now, input.run.id, input.run.user_id, input.run.state_revision),
    ]);
    requireBatchCas(results, 0, "backup_retention_work_state_invalid");
    requireBatchCas(results, 1, "backup_retention_claim_lost");
    requireBatchCas(results);
    return;
  }

  if (input.code === "backup_retention_prune_receipts_incomplete" && work?.status === "finalizing" && owned?.id === work.snapshot_id) {
    const counts = await input.db.prepare(`select
      (select count(*) from v2_backup_retention_object_receipts where run_id=? and snapshot_id=? and status<>'deleted') as pending_objects,
      (select count(*) from v2_backup_blob_refs where snapshot_id=? and user_id=?) as blob_refs`)
      .bind(input.run.id, work.snapshot_id, work.snapshot_id, input.run.user_id).first<{ pending_objects: number; blob_refs: number }>();
    const nextStatus = Number(counts?.pending_objects ?? 0) > 0
      ? "deleting_objects"
      : Number(counts?.blob_refs ?? 0) > 0 ? "marking_blobs" : null;
    if (nextStatus) {
      const results = await input.db.batch([
        input.db.prepare(`update v2_backup_retention_snapshot_work set status=?,cursor_json='{}' where run_id=? and snapshot_id=? and status='finalizing'`)
          .bind(nextStatus, input.run.id, work.snapshot_id),
        input.db.prepare(`update v2_backup_retention_runs set failure_code=null,state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
          .bind(input.now, input.run.id, input.run.user_id, input.run.state_revision),
      ]);
      requireBatchCas(results, 0, "backup_retention_work_state_invalid");
      requireBatchCas(results);
      return;
    }
  }

  // Once object or blob deletion has started, keep the persisted work resumable.
  // A transiently inconsistent finalization can then be retried without pretending
  // that the snapshot is an intact succeeded backup.
  if (work && owned?.id === work.snapshot_id && work.status !== "receipting") {
    const result = await input.db.prepare(`update v2_backup_retention_runs set failure_code=?,state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='running' and state_revision=?`)
      .bind(input.code, input.now, input.run.id, input.run.user_id, input.run.state_revision).run();
    requireCasChange(result);
    return;
  }

  const statements: D1PreparedStatementBinding[] = [];
  if (work) {
    statements.push(input.db.prepare(`update v2_backup_retention_snapshot_work set status='cancelled',completed_at=? where run_id=? and snapshot_id=? and status not in ('complete','cancelled')`)
      .bind(input.now, input.run.id, work.snapshot_id));
  }
  if (owned) {
    statements.push(input.db.prepare(`update v2_backup_snapshots set status='succeeded',pruned_at=null,prune_run_id=null where id=? and user_id=? and status='pruning' and prune_run_id=?`)
      .bind(owned.id, input.run.user_id, input.run.id));
  }
  statements.push(input.db.prepare(`update v2_backup_retention_runs set status='failed',failure_code=?,state_revision=state_revision+1,last_progress_at=?,finished_at=? where id=? and user_id=? and status='running' and state_revision=?`)
    .bind(input.code, input.now, input.now, input.run.id, input.run.user_id, input.run.state_revision));
  const results = await input.db.batch(statements);
  requireBatchCas(results);
}

export async function advanceBackupRetentionRun(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; runId: string; now?: string }) {
  const run = await retentionRunRow(input.db, input.userId, input.runId);
  if (!run) throw new Error("backup_retention_run_not_found");
  if (run.status !== "running") return getBackupRetentionRun(input.db, input.userId, input.runId);
  const now = normalizedNow(input.now);
  try {
    if (run.phase === "inventory") await advanceInventory({ ...input, run, now });
    else if (run.phase === "ancestor_closure") await advanceAncestorClosure({ ...input, run, now });
    else if (run.phase === "pruning") await advancePruning({ ...input, run, now });
    else if (run.phase === "gc_references") await advanceGcReferenceReconciliation({ ...input, run, now });
    else if (run.phase === "gc_deleting") await advanceGcDeletion({ ...input, run, now });
    else throw new Error("backup_retention_run_state_invalid");
  } catch (error) {
    const code = error instanceof Error ? error.message : "backup_retention_unknown_failure";
    if (!FAIL_CLOSED_CODES.has(code)) throw error;
    await recoverOrFailClosedRetentionRun({ db: input.db, run, code, now });
  }
  return getBackupRetentionRun(input.db, input.userId, input.runId);
}

async function claimNextMaintenanceUser(db: D1DatabaseBinding, now: string) {
  const state = await db.prepare(`select last_user_id,state_revision from v2_backup_maintenance_state where id=1`).first<{ last_user_id: string | null; state_revision: number }>();
  if (!state) throw new Error("backup_maintenance_state_missing");
  let user = await db.prepare(`select id from users where id>? order by id limit 1`).bind(state.last_user_id ?? "").first<{ id: string }>();
  if (!user) user = await db.prepare(`select id from users order by id limit 1`).first<{ id: string }>();
  if (!user) return null;
  const result = await db.prepare(`update v2_backup_maintenance_state set last_user_id=?,state_revision=state_revision+1,updated_at=? where id=1 and state_revision=?`).bind(user.id, now, state.state_revision).run();
  if (changes(result) === 0) return null;
  return user.id;
}

async function automatedBackupChoice(db: D1DatabaseBinding, userId: string, now: string) {
  const instant = new Date(now);
  const today = now.slice(0, 10);
  const month = today.slice(0, 7);
  const weekCutoff = new Date(instant.getTime() - 7 * DAY_MS).toISOString();
  const state = await db.prepare(`select count(*) as total,
    coalesce(max(case when retention_class='monthly' and substr(created_at,1,7)=? then 1 else 0 end),0) as has_monthly,
    coalesce(max(case when retention_class='weekly' and created_at>? then 1 else 0 end),0) as has_weekly,
    coalesce(max(case when retention_class='daily' and substr(created_at,1,10)=? then 1 else 0 end),0) as has_daily
    from v2_backup_snapshots where user_id=? and status='succeeded' and pruned_at is null`).bind(month, weekCutoff, today, userId).first<{ total: number; has_monthly: number; has_weekly: number; has_daily: number }>();
  if (!state?.has_monthly) return { kind: "full" as const, retentionClass: "monthly" as const, key: month };
  if (!state.has_weekly) return { kind: "full" as const, retentionClass: "weekly" as const, key: today };
  if (!state.has_daily) return { kind: state.total ? "incremental" as const : "full" as const, retentionClass: "daily" as const, key: today };
  return null;
}

export async function advanceBackupMaintenance(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; now?: string }) {
  const now = normalizedNow(input.now);
  const userId = await claimNextMaintenanceUser(input.db, now);
  if (!userId) return { processedUsers: 0, userId: null, backup: { action: "none" as const }, retention: null };
  const active = await input.db.prepare(`select id from v2_backup_snapshots where user_id=? and status='building' and workflow_version=2 order by created_at,id limit 1`).bind(userId).first<{ id: string }>();
  let backup: Record<string, unknown>;
  if (active) backup = { action: "advanced", snapshot: await advanceBackupWorkflow({ ...input, userId, snapshotId: active.id, now }) };
  else {
    const selected = await automatedBackupChoice(input.db, userId, now);
    backup = selected
      ? { action: "staged", snapshot: await stageBackupWorkflow({ db: input.db, userId, kind: selected.kind, retentionClass: selected.retentionClass, idempotencyKey: `auto:${selected.retentionClass}:${selected.key}`, now }) }
      : { action: "idle" };
  }
  const stagedRetention = await stageBackupRetentionRun({ db: input.db, userId, now });
  const retention = stagedRetention.status === "running" ? await advanceBackupRetentionRun({ ...input, userId, runId: stagedRetention.runId, now }) : stagedRetention;
  return { processedUsers: 1, userId, backup, retention };
}

function requireLegacySynchronousBackupHarness() {
  if (process.env.NODE_ENV !== "test") throw new Error("legacy_synchronous_backup_disabled");
}

/** @deprecated Test harness only. Production maintenance uses advanceBackupRetentionRun. */
export async function applyBackupRetention(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; now?: string }) {
  requireLegacySynchronousBackupHarness();
  const now = input.now ?? new Date().toISOString();
  const rows = await input.db.prepare(`select id,base_snapshot_id,retention_class,pinned,created_at from v2_backup_snapshots where user_id=? and status='succeeded' and pruned_at is null`).bind(input.userId).all<{ id: string; base_snapshot_id: string | null; retention_class: BackupRetentionClass; pinned: number; created_at: string }>();
  const plan = planBackupRetention(rows.results.map((row) => ({ id: row.id, baseSnapshotId: row.base_snapshot_id, retentionClass: row.retention_class, pinned: Boolean(row.pinned), createdAt: row.created_at })));
  const owner = sha256Hex(input.userId).slice(0, 24);
  const newlyUnreferenced = new Map<string, string>();
  for (const snapshotId of plan.prune) {
    const snapshot = await input.db.prepare(`select manifest_object_key from v2_backup_snapshots where id=? and user_id=? and status='succeeded' limit 1`).bind(snapshotId, input.userId).first<{ manifest_object_key: string | null }>();
    const refs = await input.db.prepare(`select sha256,object_key from v2_backup_blob_refs where snapshot_id=? and user_id=?`).bind(snapshotId, input.userId).all<{ sha256: string; object_key: string }>();
    refs.results.forEach((row) => newlyUnreferenced.set(row.sha256, row.object_key));
    const keys = CANONICAL_TABLES_V1.map((descriptor) => `users/${owner}/backups/snapshots/${snapshotId}/metadata/${descriptor.path}`);
    if (snapshot?.manifest_object_key) keys.push(snapshot.manifest_object_key);
    await input.bucket.delete(keys).catch(() => undefined);
    await input.db.prepare(`delete from v2_backup_blob_refs where snapshot_id=? and user_id=?`).bind(snapshotId, input.userId).run();
    await input.db.prepare(`update v2_backup_snapshots set status='pruned',pruned_at=?,manifest_object_key=null where id=? and user_id=? and status='succeeded'`).bind(now, snapshotId, input.userId).run();
  }
  await input.db.prepare(`delete from v2_backup_blob_gc_marks where user_id=? and deleted_at is null and exists (select 1 from v2_backup_blob_refs r where r.user_id=v2_backup_blob_gc_marks.user_id and r.sha256=v2_backup_blob_gc_marks.sha256)`).bind(input.userId).run();
  for (const [sha256, objectKey] of newlyUnreferenced) {
    await input.db.prepare(`insert into v2_backup_blob_gc_marks (user_id,sha256,object_key,unreferenced_since,last_checked_at,deleted_at) select ?,?,?,?,?,null where not exists (select 1 from v2_backup_blob_refs where user_id=? and sha256=?) on conflict(user_id,sha256) do update set object_key=excluded.object_key,last_checked_at=excluded.last_checked_at`).bind(input.userId, sha256, objectKey, now, now, input.userId, sha256).run();
  }
  const cutoff = new Date(new Date(now).getTime() - 7 * DAY_MS).toISOString();
  const due = await input.db.prepare(`select sha256,object_key from v2_backup_blob_gc_marks g where g.user_id=? and g.deleted_at is null and g.unreferenced_since<=? and not exists (select 1 from v2_backup_blob_refs r where r.user_id=g.user_id and r.sha256=g.sha256)`).bind(input.userId, cutoff).all<{ sha256: string; object_key: string }>();
  for (const blob of due.results) {
    await input.bucket.delete(blob.object_key);
    await input.db.prepare(`update v2_backup_blob_gc_marks set deleted_at=?,last_checked_at=? where user_id=? and sha256=? and deleted_at is null`).bind(now, now, input.userId, blob.sha256).run();
  }
  return { retainedSnapshotIds: plan.keep, prunedSnapshotIds: plan.prune, markedBlobCount: newlyUnreferenced.size, deletedBlobCount: due.results.length };
}

/** @deprecated Test harness only. Production maintenance stages and advances resumable workflows. */
export async function runAutomatedBackupForUser(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; now?: string }) {
  requireLegacySynchronousBackupHarness();
  const now = input.now ?? new Date().toISOString();
  const rows = await input.db.prepare(`select retention_class,created_at from v2_backup_snapshots where user_id=? and status='succeeded' and pruned_at is null`).bind(input.userId).all<{ retention_class: BackupRetentionClass; created_at: string }>();
  const selected = chooseAutomatedBackup(rows.results.map((row) => ({ retentionClass: row.retention_class, createdAt: row.created_at })), new Date(now));
  const snapshot = selected ? await createBackupSnapshot({ ...input, kind: selected.kind, retentionClass: selected.retentionClass, now }) : null;
  const retention = await applyBackupRetention({ ...input, now });
  return { createdSnapshotId: snapshot?.snapshotId ?? null, createdKind: snapshot?.snapshotKind ?? null, createdRetentionClass: snapshot?.retentionClass ?? null, retention };
}
