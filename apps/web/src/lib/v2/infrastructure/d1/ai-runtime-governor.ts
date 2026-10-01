import type { V2ModelErrorCode } from "@/lib/v2/ai/gateway";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

export type GovernedModelRole = "main_analyzer" | "grounded_enricher";
export type AiRuntimeState = "healthy" | "throttled" | "quota_exhausted" | "circuit_open";

export type AiRuntimePermit = Readonly<
  | { allowed: true; state: AiRuntimeState; retryAt: string | null }
  | { allowed: false; state: AiRuntimeState; retryAt: string | null }
>;

type RuntimeRow = {
  state: AiRuntimeState;
  consecutive_failures: number;
  retry_after: string | null;
};

const PROVIDER_COOLDOWN_MS = 30_000;
const CIRCUIT_COOLDOWN_MS = 2 * 60_000;
const QUOTA_COOLDOWN_MS = 15 * 60_000;
// A daily quota resets once per day; never pause longer than a little over one day.
const MAX_QUOTA_COOLDOWN_MS = 26 * 60 * 60_000;
const PROBE_LEASE_MS = 2 * 60_000;

function plus(now: Date, milliseconds: number) {
  return new Date(now.getTime() + milliseconds).toISOString();
}

export class D1AiRuntimeGovernor {
  constructor(private readonly db: D1DatabaseBinding) {}

  async tryAcquire(role: GovernedModelRole, owner: string, now = new Date()): Promise<AiRuntimePermit> {
    const nowIso = now.toISOString();
    await this.db.prepare(
      `insert or ignore into v2_ai_runtime_state
       (model_role,state,consecutive_failures,updated_at)
       values (?,'healthy',0,?)`,
    ).bind(role, nowIso).run();

    const acquired = await this.db.prepare(
      `update v2_ai_runtime_state
       set probe_owner=?,probe_expires_at=?,updated_at=?
       where model_role=?
         and (probe_owner is null or probe_expires_at<=?)
         and (state='healthy' or retry_after is null or retry_after<=?)
       returning state,consecutive_failures,retry_after`,
    ).bind(owner, plus(now, PROBE_LEASE_MS), nowIso, role, nowIso, nowIso).first<RuntimeRow>();
    if (acquired) return { allowed: true, state: acquired.state, retryAt: acquired.retry_after };

    const row = await this.db.prepare(
      `select state,consecutive_failures,retry_after
       from v2_ai_runtime_state where model_role=? limit 1`,
    ).bind(role).first<RuntimeRow>();
    return { allowed: false, state: row?.state ?? "throttled", retryAt: row?.retry_after ?? null };
  }

  async release(role: GovernedModelRole, owner: string, now = new Date()) {
    await this.db.prepare(
      `update v2_ai_runtime_state
       set probe_owner=null,probe_expires_at=null,updated_at=?
       where model_role=? and probe_owner=?`,
    ).bind(now.toISOString(), role, owner).run();
  }

  async recordSuccess(role: GovernedModelRole, owner: string, now = new Date()) {
    await this.db.prepare(
      `update v2_ai_runtime_state
       set state='healthy',consecutive_failures=0,retry_after=null,
           probe_owner=null,probe_expires_at=null,last_error_code=null,updated_at=?
       where model_role=? and probe_owner=?`,
    ).bind(now.toISOString(), role, owner).run();
  }

  async recordFailure(role: GovernedModelRole, owner: string, code: V2ModelErrorCode, now = new Date(), retryAfterMs: number | null = null) {
    const row = await this.db.prepare(
      `select state,consecutive_failures,retry_after
       from v2_ai_runtime_state where model_role=? and probe_owner=? limit 1`,
    ).bind(role, owner).first<RuntimeRow>();
    if (!row) return;

    if (code === "invalid_schema") {
      await this.db.prepare(
        `update v2_ai_runtime_state
         set state='healthy',consecutive_failures=0,retry_after=null,
             probe_owner=null,probe_expires_at=null,last_error_code=?,updated_at=?
         where model_role=? and probe_owner=?`,
      ).bind(code, now.toISOString(), role, owner).run();
      return;
    }

    if (code === "quota_exhausted") {
      await this.db.prepare(
        `update v2_ai_runtime_state
         set state='quota_exhausted',consecutive_failures=consecutive_failures+1,retry_after=?,
             probe_owner=null,probe_expires_at=null,last_error_code=?,updated_at=?
         where model_role=? and probe_owner=?`,
      ).bind(plus(now, Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(QUOTA_COOLDOWN_MS, retryAfterMs ?? 0))), code, now.toISOString(), role, owner).run();
      return;
    }

    const failures = row.consecutive_failures + 1;
    const open = failures >= 3;
    const cooldown = open ? CIRCUIT_COOLDOWN_MS : Math.min(CIRCUIT_COOLDOWN_MS, PROVIDER_COOLDOWN_MS * 2 ** (failures - 1));
    await this.db.prepare(
      `update v2_ai_runtime_state
       set state=?,consecutive_failures=?,retry_after=?,
           probe_owner=null,probe_expires_at=null,last_error_code=?,updated_at=?
       where model_role=? and probe_owner=?`,
    ).bind(open ? "circuit_open" : "throttled", failures, plus(now, cooldown), code, now.toISOString(), role, owner).run();
  }

  async inspect(role: GovernedModelRole) {
    return this.db.prepare(
      `select state,consecutive_failures,retry_after,last_error_code,probe_owner,probe_expires_at,updated_at
       from v2_ai_runtime_state where model_role=? limit 1`,
    ).bind(role).first<RuntimeRow & { last_error_code: string | null; probe_owner: string | null; probe_expires_at: string | null; updated_at: string }>();
  }
}
