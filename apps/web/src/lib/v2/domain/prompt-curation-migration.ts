import { canonicalLinkJson, linkSha256Hex, normalizeLinkHash, type LinkSnapshotMemberV1 } from "@/lib/v2/domain/link-snapshot-v1";
import type { PromptCurationContent } from "@/lib/v2/domain/prompt-curation-request";
import type { PromptCurationFragment, PromptCurationInput, PromptSourceCompleteness } from "@/lib/v2/domain/prompt-curation-v1";

export const PROMPT_CURATION_MIGRATION_CONTRACT = "prompt-curation-migration.v1" as const;
export type PromptCurationMigrationPlan = {
  contract: typeof PROMPT_CURATION_MIGRATION_CONTRACT;
  recordId: string; sourceGroupKey: string; sourceRevisionId: string; sourceSnapshotId: string; sourceManifestHash: string;
  expectedRevisionId: string; expectedSnapshotId: string; expectedManifestHash: string;
  items: { itemKey: string; fragmentId: string; memberId: string; match: "member_key" | "fingerprint" }[];
  examples: { exampleKey: string; memberId: string; attachmentId: string; match: "member_key" | "fingerprint" }[];
  issues: { kind: "snapshot" | "item" | "example"; key: string; reason: "same_snapshot" | "missing" | "changed" | "ambiguous" | "range_changed" | "coverage_changed" }[];
  /** Explicit POST confirms these formerly AI-selected ranges. It does not
   * confirm OCR, omitted material, or the completeness of the external source. */
  selectionConfirmations: string[];
  ready: boolean; planHash: string;
};

export function migrationCoverageMatches(fragment: PromptCurationFragment, sourceCompleteness: PromptSourceCompleteness) {
  if (fragment.selectionOrigin === "user_selected") return fragment.completeness === sourceCompleteness;
  // link-analysis.v1 marks AI ranges separately from the supplied source's
  // acquisition scope. Explicit manual selection may resolve only the former.
  return fragment.completeness === (sourceCompleteness === "ocr_unverified" ? "ocr_unverified"
    : sourceCompleteness === "partial" ? "truncated" : "selection_unverified");
}

/** Inputs are server-verified canonical catalogs, never client assertions. No
 * fuzzy text matching, normalization, nearest image, or partial migration. */
export async function planPromptCurationMigration(basis: Pick<PromptCurationMigrationPlan,
  "recordId" | "sourceGroupKey" | "sourceRevisionId" | "sourceSnapshotId" | "sourceManifestHash" | "expectedRevisionId" | "expectedSnapshotId" | "expectedManifestHash">,
  content: PromptCurationContent, source: PromptCurationInput, targets: readonly LinkSnapshotMemberV1[]): Promise<PromptCurationMigrationPlan> {
  const issues: PromptCurationMigrationPlan["issues"] = [], items: PromptCurationMigrationPlan["items"] = [], examples: PromptCurationMigrationPlan["examples"] = [];
  if (basis.sourceSnapshotId === basis.expectedSnapshotId) issues.push({ kind: "snapshot", key: basis.expectedSnapshotId, reason: "same_snapshot" });
  function match(memberKey: string, fingerprint: string, kind: "item" | "example", key: string) {
    const keyed = targets.filter((member) => member.memberKey === memberKey);
    const candidates = keyed.length ? keyed.filter((member) => member.sourceFingerprint === fingerprint) : targets.filter((member) => member.sourceFingerprint === fingerprint);
    if (candidates.length !== 1) {
      issues.push({ kind, key, reason: candidates.length > 1 ? "ambiguous" : keyed.length ? "changed" : "missing" });
      return null;
    }
    return { member: candidates[0], match: keyed.length ? "member_key" as const : "fingerprint" as const };
  }
  for (const item of source.items) {
    const fragment = item.fragment, original = source.sources.find((row) => row.memberKey === fragment.memberKey)!;
    const candidate = match(original.memberKey, original.sourceFingerprint, "item", item.itemKey);
    if (!candidate) continue;
    const { member } = candidate;
    const range = member.rawText?.slice(fragment.textStart, fragment.textEnd);
    if (member.kind !== "url" || !member.manualLink || range !== fragment.rawText || await linkSha256Hex(range) !== fragment.rawTextHash) {
      issues.push({ kind: "item", key: item.itemKey, reason: "range_changed" }); continue;
    }
    if (member.manualLink.completeness !== original.completeness || !migrationCoverageMatches(fragment, original.completeness)) {
      issues.push({ kind: "item", key: item.itemKey, reason: "coverage_changed" }); continue;
    }
    items.push({ itemKey: item.itemKey, fragmentId: content.items.find((row) => row.itemKey === item.itemKey)!.fragmentId,
      memberId: member.id, match: candidate.match });
  }
  for (const example of source.examples ?? []) {
    const candidate = match(example.memberKey, example.sourceFingerprint, "example", example.exampleKey);
    if (!candidate) continue;
    const images = candidate.member.kind === "image" ? candidate.member.attachments.filter((image) => normalizeLinkHash(image.sha256) === example.sha256
      && image.mimeType === example.mimeType && image.sizeBytes === example.sizeBytes) : [];
    if (images.length !== 1) { issues.push({ kind: "example", key: example.exampleKey, reason: images.length ? "ambiguous" : "missing" }); continue; }
    examples.push({ exampleKey: example.exampleKey, memberId: candidate.member.id, attachmentId: images[0].id, match: candidate.match });
  }
  const plan = { contract: PROMPT_CURATION_MIGRATION_CONTRACT, ...basis, items, examples, issues,
    selectionConfirmations: source.items.filter((item) => item.fragment.selectionOrigin === "ai_selected").map((item) => item.itemKey), ready: issues.length === 0 };
  return { ...plan, planHash: await linkSha256Hex(canonicalLinkJson(plan)) };
}
