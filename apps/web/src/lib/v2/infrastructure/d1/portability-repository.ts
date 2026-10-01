import { ulid } from "ulidx";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { canonicalJson, type ExportManifestV1, type ExportProfile, type ExportScopeV1, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";

type ExportJobRow = {
  id: string; profile: ExportProfile; scope_json: string; scope_hash: string; status: string; base_sequence: number; end_sequence: number;
  bundle_object_key: string | null; bundle_sha256: string | null; bundle_size_bytes: number | null; manifest_json: string | null;
  created_at: string; started_at: string | null; finished_at: string | null; expires_at: string | null; failure_code: string | null;
};

export class PortabilityRepositoryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PortabilityRepositoryError"; }
}

export type ExportJobProjection = Readonly<{
  id: string; profile: ExportProfile; scope: ExportScopeV1; status: string; baseSequence: number; endSequence: number;
  bundleObjectKey: string | null; bundleSha256: string | null; bundleSizeBytes: number | null; manifest: ExportManifestV1 | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; expiresAt: string | null; failureCode: string | null;
}>;

function project(row: ExportJobRow): ExportJobProjection {
  return {
    id: row.id, profile: row.profile, scope: JSON.parse(row.scope_json) as ExportScopeV1, status: row.status,
    baseSequence: row.base_sequence, endSequence: row.end_sequence, bundleObjectKey: row.bundle_object_key,
    bundleSha256: row.bundle_sha256, bundleSizeBytes: row.bundle_size_bytes,
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) as ExportManifestV1 : null,
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, expiresAt: row.expires_at, failureCode: row.failure_code,
  };
}

export class D1PortabilityRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {
    if (!userId.trim()) throw new Error("A scoped repository requires a userId.");
  }

  async createExport(input: { profile: ExportProfile; scope: ExportScopeV1; idempotencyKey: string; now?: string }) {
    const now = input.now ?? new Date().toISOString();
    const scopeJson = canonicalJson(input.scope);
    const scopeHash = sha256Hex(`${input.profile}\0${scopeJson}`);
    const existing = await this.db.prepare(`select * from v2_export_jobs where user_id=? and idempotency_key=? limit 1`).bind(this.userId, input.idempotencyKey).first<ExportJobRow>();
    if (existing) {
      if (existing.scope_hash !== scopeHash || existing.profile !== input.profile) throw new PortabilityRepositoryError("idempotency_conflict", "The export idempotency key was used with another scope.");
      return project(existing);
    }
    const sequence = await this.db.prepare(`select coalesce(max(sequence),0) as value from v2_change_events where user_id=?`).bind(this.userId).first<{ value: number }>();
    const id = ulid();
    await this.db.prepare(`insert into v2_export_jobs (id,user_id,idempotency_key,profile,scope_json,scope_hash,status,base_sequence,end_sequence,created_at) values (?,?,?,?,?,?,'queued',0,?,?)`).bind(id, this.userId, input.idempotencyKey, input.profile, scopeJson, scopeHash, sequence?.value ?? 0, now).run();
    return this.getExport(id) as Promise<ExportJobProjection>;
  }

  async getExport(id: string) {
    const row = await this.db.prepare(`select * from v2_export_jobs where id=? and user_id=? limit 1`).bind(id, this.userId).first<ExportJobRow>();
    return row ? project(row) : null;
  }

  async listExports() {
    const rows = await this.db.prepare(`select * from v2_export_jobs where user_id=? order by created_at desc limit 50`).bind(this.userId).all<ExportJobRow>();
    return rows.results.map(project);
  }

  async claimExport(id: string, now = new Date().toISOString()) {
    const staleBefore = new Date(Date.parse(now) - 15 * 60_000).toISOString();
    await this.db.prepare(`update v2_export_jobs set status='running',started_at=?,failure_code=null where id=? and user_id=? and (status in ('queued','failed') or (status='running' and started_at<?))`).bind(now, id, this.userId, staleBefore).run();
    const row = await this.getExport(id);
    if (!row) throw new PortabilityRepositoryError("export_not_found", "Export job was not found.");
    if (row.status !== "running" || row.startedAt !== now) throw new PortabilityRepositoryError("export_not_claimable", "Export job is already running or completed.");
    return row;
  }

  async completeExport(id: string, input: { objectKey: string; sha256: string; bytes: number; manifest: ExportManifestV1; finishedAt?: string; expiresAt?: string }) {
    const finishedAt = input.finishedAt ?? new Date().toISOString();
    const expiresAt = input.expiresAt ?? new Date(Date.parse(finishedAt) + 24 * 60 * 60_000).toISOString();
    await this.db.prepare(`update v2_export_jobs set status='succeeded',bundle_object_key=?,bundle_sha256=?,bundle_size_bytes=?,manifest_json=?,finished_at=?,expires_at=? where id=? and user_id=? and status='running'`).bind(input.objectKey, input.sha256, input.bytes, canonicalJson(input.manifest), finishedAt, expiresAt, id, this.userId).run();
    return this.getExport(id);
  }

  async failExport(id: string, failureCode: string, now = new Date().toISOString()) {
    await this.db.prepare(`update v2_export_jobs set status='failed',failure_code=?,finished_at=? where id=? and user_id=? and status='running'`).bind(failureCode.slice(0, 100), now, id, this.userId).run();
  }
}

