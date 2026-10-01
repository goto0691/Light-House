import type {
  D1DatabaseBinding,
  D1PreparedStatementBinding,
} from "@/lib/v2/infrastructure/d1/source-commit-repository";

export type WorkflowLeaseFenceV1 = Readonly<{
  kind: "backup" | "restore";
  workflowId: string;
  userId: string;
  leaseToken: string;
  stateRevision: number;
  expectedStatus: string;
}>;

export class WorkflowLeaseLostError extends Error {
  readonly code: string;

  constructor(kind: WorkflowLeaseFenceV1["kind"]) {
    super(`${kind}_workflow_lease_lost`);
    this.name = "WorkflowLeaseLostError";
    this.code = `${kind}_workflow_lease_lost`;
  }
}

export function d1ResultChanges(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const result = value as { changes?: number; meta?: { changes?: number } };
  return Number(result.meta?.changes ?? result.changes ?? 0);
}

function normalizeFenceError(error: unknown, kind: WorkflowLeaseFenceV1["kind"]): never {
  if (error instanceof WorkflowLeaseLostError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(`${kind}_workflow_lease_lost`) || message.includes(`${kind}_workflow_progress_not_committed`)) {
    throw new WorkflowLeaseLostError(kind);
  }
  throw error;
}

export async function runWorkflowLeaseFencedBatch(input: {
  db: D1DatabaseBinding;
  fence: WorkflowLeaseFenceV1;
  nextStatus: string;
  statements?: readonly D1PreparedStatementBinding[];
  parentProgress: D1PreparedStatementBinding;
  now: string;
}) {
  const assertionId = crypto.randomUUID();
  const assertion = input.db.prepare(`insert into v2_workflow_lease_assertions
    (assertion_id,workflow_kind,workflow_id,user_id,lease_token,state_revision,expected_status,next_status,created_at)
    values (?,?,?,?,?,?,?,?,?)`)
    .bind(
      assertionId,
      input.fence.kind,
      input.fence.workflowId,
      input.fence.userId,
      input.fence.leaseToken,
      input.fence.stateRevision,
      input.fence.expectedStatus,
      input.nextStatus,
      input.now,
    );
  const releaseAssertion = input.db.prepare(`delete from v2_workflow_lease_assertions where assertion_id=?`).bind(assertionId);
  const childStatements = [...(input.statements ?? [])];
  let results: unknown[];
  try {
    results = await input.db.batch([
      assertion,
      ...childStatements,
      input.parentProgress,
      releaseAssertion,
    ]);
  } catch (error) {
    normalizeFenceError(error, input.fence.kind);
  }
  // The DELETE assertion trigger is the authoritative in-transaction changes=1
  // check. Some workerd D1 batch results report zero changes for this parent
  // UPDATE even though the following trigger observes the committed revision.
  return results;
}

export async function runRestoreTransitionFencedBatch(input: {
  db: D1DatabaseBinding;
  restoreId: string;
  userId: string;
  expectedRevision: number;
  expectedStatus: string;
  nextStatus: string;
  requireUnleased: boolean;
  parentTransition: D1PreparedStatementBinding;
  statements?: readonly D1PreparedStatementBinding[];
  now: string;
}) {
  const assertionId = crypto.randomUUID();
  const assertion = input.db.prepare(`insert into v2_restore_transition_assertions
    (assertion_id,restore_id,user_id,expected_revision,expected_status,next_status,require_unleased,created_at) values (?,?,?,?,?,?,?,?)`)
    .bind(assertionId, input.restoreId, input.userId, input.expectedRevision, input.expectedStatus, input.nextStatus, input.requireUnleased ? 1 : 0, input.now);
  const release = input.db.prepare(`delete from v2_restore_transition_assertions where assertion_id=?`).bind(assertionId);
  try {
    return await input.db.batch([assertion, input.parentTransition, ...(input.statements ?? []), release]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("restore_transition_lost") || message.includes("restore_transition_not_committed")) {
      throw new WorkflowLeaseLostError("restore");
    }
    throw error;
  }
}
