import { createHash } from "node:crypto";

import { canonical, exactKeys, record, type Expected } from "./contracts";

export type UserDelegatedApproval = {
  kind: "user_delegated";
  delegated_at: string;
  user_request_sha256: string;
  authored_by: string;
  reviewed_by: string;
  reviewed_at: string;
  grounding_path: string;
  grounding_sha256: string;
};

/** Bind review to the rules, without a circular dependency on its own proof hash. */
export function expectedRulesDigest(expected: Expected) {
  const rules = Object.fromEntries(Object.entries(expected).filter(([key]) => key !== "approval" && key !== "authoring_status"));
  return `sha256:${createHash("sha256").update(canonical(rules)).digest("hex")}`;
}

/** File-backed independent review is distinct from a person approving each answer. */
export async function approvedExpected(expected: Expected, readPrivateFile: (path: string) => Promise<Buffer>) {
  if (expected.authoring_status === "human_approved") return true;
  const approval = expected.approval;
  if (expected.authoring_status !== "assistant_reviewed" || !approval || approval.kind !== "user_delegated"
    || approval.authored_by === approval.reviewed_by || !Number.isFinite(Date.parse(approval.delegated_at))
    || !Number.isFinite(Date.parse(approval.reviewed_at)) || Date.parse(approval.reviewed_at) < Date.parse(approval.delegated_at)) return false;
  try {
    const bytes = await readPrivateFile(approval.grounding_path);
    if (bytes.length > 1024 * 1024 || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== approval.grounding_sha256) return false;
    const proof: unknown = JSON.parse(bytes.toString("utf8"));
    return record(proof) && proof.version === 1 && proof.case_id === expected.case_id
      && record(proof.delegation) && exactKeys(proof.delegation, ["kind", "delegated_at", "user_request_sha256"])
      && proof.delegation.kind === approval.kind && proof.delegation.delegated_at === approval.delegated_at
      && proof.delegation.user_request_sha256 === approval.user_request_sha256
      && proof.rules_sha256 === expectedRulesDigest(expected) && proof.evidence_checked === true
      && proof.authored_by === approval.authored_by && proof.reviewed_by === approval.reviewed_by
      && proof.reviewed_at === approval.reviewed_at && Array.isArray(proof.findings) && proof.findings.length === 0
      && Array.isArray(proof.source_hashes)
      && canonical([...proof.source_hashes].sort()) === canonical([...expected.source_hashes].sort());
  } catch { return false; }
}
