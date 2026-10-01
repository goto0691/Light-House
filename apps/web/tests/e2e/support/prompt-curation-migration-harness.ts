import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { planPromptCurationMigration } from "../../../src/lib/v2/domain/prompt-curation-migration";
import { parseMigratePromptCurationRequest, type MigratePromptCurationRequest } from "../../../src/lib/v2/domain/prompt-curation-request";
import { extractManualPromptFragment } from "../../../src/lib/v2/domain/prompt-curation-v1";
import type { PromptCurationReceipt } from "../../../src/lib/v2/domain/stored-prompt-curation";
import { curationHarness, recordId } from "./prompt-curation-harness";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/** Actual React components, synthetic HTTP only. The DB migration/receipt
 * atomicity is tested separately by prompt-curation-migration.test.ts. */
export async function migrationHarness(page: Page) {
  const h = await curationHarness(page);
  const source = await h.commit({ expectedRevisionId: h.state.currentRevisionId!, expectedSnapshotId: h.state.currentSnapshotId!,
    expectedManifestHash: h.state.selectedSnapshot!.manifestHash, groupKey: "original-group", idempotencyKey: "original-request",
    content: { title: "옮길 창가 프롬프트", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [
        { itemKey: "manual-a", fragmentId: "manual-1", expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 },
        { itemKey: "manual-duplicate", fragmentId: "manual-1", expectedFragmentStateVersion: 1, copyRole: "prompt", position: 1 },
        { itemKey: "ai-range", fragmentId: "prompt-one", expectedFragmentStateVersion: 1, copyRole: "prompt", position: 2 },
        { itemKey: "negative", fragmentId: "manual-3", expectedFragmentStateVersion: 1, copyRole: "negative_prompt", position: 0 },
        { itemKey: "parameters", fragmentId: "manual-4", expectedFragmentStateVersion: 1, copyRole: "parameters", position: 0 },
      ], examples: [{ exampleKey: "example-one", memberId: "member-image", attachmentId: "analysis-image-file", itemKey: "manual-a", position: 0, evidenceMethod: "unresolved" }] } });
  const old = h.state, snapshot = { ...old.selectedSnapshot!, id: "snapshot-three", parentSnapshotId: old.currentSnapshotId, snapshotVersion: 3, manifestHash: "d".repeat(64) };
  h.state = { ...old, currentRevisionId: "revision-three", currentSnapshotId: snapshot.id, currentSnapshotVersion: 3, selectedSnapshot: snapshot,
    members: old.members.map((row) => ({ ...row, memberId: `${row.memberId}-new`, contentHash: digest(row.rawText ?? "image") })),
    selectedRun: null, publishedRun: null, fragments: [], latestAttempt: null,
    snapshotHistory: { items: [snapshot, ...old.snapshotHistory.items], nextCursor: null } };
  const writes: MigratePromptCurationRequest[] = [], receipts = new Map<string, PromptCurationReceipt>();
  const endpoint = `/api/v2/records/${recordId}/links/curations/${source.groupKey}/revisions/${source.id}/migration`;
  let onWrite: ((route: Route, body: MigratePromptCurationRequest) => Promise<boolean>) | null = null;
  let onPreview: ((route: Route) => Promise<boolean>) | null = null;
  let reads = 0;
  async function plan() {
    return planPromptCurationMigration({ recordId, sourceGroupKey: source.groupKey, sourceRevisionId: source.id,
      sourceSnapshotId: source.snapshotId, sourceManifestHash: source.manifestHash, expectedRevisionId: h.state.currentRevisionId!,
      expectedSnapshotId: h.state.currentSnapshotId!, expectedManifestHash: h.state.selectedSnapshot!.manifestHash }, source.content, h.rows[0].input,
    h.state.members.map((row) => ({ ...row, id: row.memberId!, snapshotId: h.state.currentSnapshotId!, memberKey: row.memberKey!, metadata: null, sourceFingerprint: digest(row.memberKey!) })));
  }
  async function commit(body: MigratePromptCurationRequest) {
    if (receipts.has(body.idempotencyKey)) return { ...receipts.get(body.idempotencyKey)!, replayed: true };
    const preview = await plan(), ids = new Map<string, string>();
    for (const mapping of preview.items) if (!ids.has(mapping.fragmentId)) {
      const original = source.items.find((row) => row.itemKey === mapping.itemKey)!.fragment;
      const member = h.state.members.find((row) => row.memberId === mapping.memberId)!;
      const originalSource = h.rows[0].input.sources.find((row) => row.memberKey === original.memberKey)!;
      const fragment = await extractManualPromptFragment({ ...originalSource, memberKey: member.memberKey!, rawText: member.rawText!, contentHash: digest(member.rawText!) },
        { textStart: original.textStart, textEnd: original.textEnd, role: original.role });
      const id = `migrated-${body.groupKey}-${ids.size}`; ids.set(mapping.fragmentId, id);
      h.manuals = [...h.manuals, { id, fragmentKey: id, snapshotId: body.expectedSnapshotId, primaryMemberId: member.memberId!, stateVersion: 1, reviewStatus: "confirmed", createdAt: "2026-09-08T05:00:00.000Z", fragment }];
    }
    const content = { ...source.content, items: source.content.items.map((item) => ({ ...item, fragmentId: ids.get(item.fragmentId)!, expectedFragmentStateVersion: 1 })),
      examples: source.content.examples.map((item) => { const mapping = preview.examples.find((row) => row.exampleKey === item.exampleKey)!; return { ...item, memberId: mapping.memberId, attachmentId: mapping.attachmentId }; }) };
    const created = await h.commit({ expectedRevisionId: body.expectedRevisionId, expectedSnapshotId: body.expectedSnapshotId,
      expectedManifestHash: body.expectedManifestHash, groupKey: body.groupKey, idempotencyKey: body.idempotencyKey, content });
    const item = { ...created, changeReason: "migrate" as const, basedOnRevisionId: source.id };
    h.rows.at(-1)!.stored = item;
    const receipt: PromptCurationReceipt = { contract: "stored-prompt-curation.v1", item, replayed: false };
    receipts.set(body.idempotencyKey, receipt); return receipt;
  }
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() === "GET") {
      reads++; if (onPreview && await onPreview(route)) return;
      return h.json(route, await plan());
    }
    const body = parseMigratePromptCurationRequest(route.request().postDataJSON()); writes.push(body);
    if (onWrite && await onWrite(route, body)) return;
    if (receipts.has(body.idempotencyKey)) return h.json(route, await commit(body));
    const preview = await plan();
    if (!preview.ready || preview.planHash !== body.expectedPlanHash || body.expectedRevisionId !== h.state.currentRevisionId
      || body.expectedSnapshotId !== h.state.currentSnapshotId || body.expectedManifestHash !== h.state.selectedSnapshot!.manifestHash) return h.error(route, 409, "prompt_curation_conflict");
    return h.json(route, await commit(body), 201);
  });
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await page.getByRole("combobox", { name: "자료 버전", exact: true }).selectOption(source.snapshotId);
  await page.getByRole("button", { name: "정리본 열기", exact: true }).click();
  await page.getByRole("button", { name: `정리본 보기 · ${source.title}`, exact: true }).click();
  return { h, source, writes, plan, commit, get reads() { return reads; }, onWrite(handler: typeof onWrite) { onWrite = handler; }, onPreview(handler: typeof onPreview) { onPreview = handler; } };
}
