import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { LinkPresentationV1 } from "../../../src/lib/v2/domain/link-presentation-v1";
import type { LinkFragmentEvidenceV1 } from "../../../src/lib/v2/domain/link-fragment-evidence-v1";
import { parseManualLinkFragmentRequest, type CreateManualLinkFragmentRequest, type ManualLinkFragmentPage, type StoredManualLinkFragment } from "../../../src/lib/v2/domain/manual-link-fragment-v1";
import { parseCreatePromptCurationRequest, parseRevisePromptCurationRequest, type CreatePromptCurationRequest, type PromptCurationContent, type RevisePromptCurationRequest } from "../../../src/lib/v2/domain/prompt-curation-request";
import { copyPromptCuration, extractManualPromptFragment, preparePromptCuration, PromptCurationError, type PromptCopyRole, type PromptCurationFragment, type PromptCurationInput } from "../../../src/lib/v2/domain/prompt-curation-v1";
import type { PromptCurationDetail, PromptCurationPage, PromptCurationSummary, StoredPromptCuration } from "../../../src/lib/v2/domain/stored-prompt-curation";

export const recordId = "link-analysis-fixture";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Write = CreatePromptCurationRequest | RevisePromptCurationRequest;
type Row = { stored: StoredPromptCuration; input: PromptCurationInput };
export async function curationHarness(page: Page) {
  let state: LinkPresentationV1;
  const snapshots = new Map<string, LinkPresentationV1>();
  const aiEvidence = new Map<string, LinkFragmentEvidenceV1>();
  function rememberAi(projection: LinkPresentationV1) {
    if (!projection.selectedSnapshot || !projection.selectedRun) return;
    for (const fragment of projection.fragments) if (fragment.runId === projection.selectedRun.id) aiEvidence.set(fragment.id, structuredClone({
      contract: "link-fragment-evidence.v1", recordId, snapshotId: projection.selectedSnapshot.id,
      snapshotManifestHash: projection.selectedSnapshot.manifestHash, run: projection.selectedRun, fragment,
    }));
  }
  let manuals: StoredManualLinkFragment[] = [];
  const rows: Row[] = [], writes: Write[] = [], reads: string[] = [];
  const manualWrites: CreateManualLinkFragmentRequest[] = [];
  const receipts = new Map<string, { item: StoredPromptCuration; request: string; group: string }>();
  let onWrite: ((route: Route, request: Write) => Promise<boolean>) | null = null;
  let onRead: ((route: Route) => Promise<boolean>) | null = null;
  let policy = { ownerId: "link-owner", recordId, currentVersion: 1, privacyLevel: "normal" as "normal" | "sensitive" | "restricted" };
  const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
  const error = (route: Route, status: number, code: string) => json(route, { error: { code, message: `Synthetic ${code}` } }, status);
  const cursor = (scope: string, offset: number) => Buffer.from(JSON.stringify({ scope, offset })).toString("base64url");
  function offsetOf(url: URL, scope: string) {
    if (!url.searchParams.has("cursor")) return 0;
    const value = JSON.parse(Buffer.from(url.searchParams.get("cursor")!, "base64url").toString()) as { scope: string; offset: number };
    if (value.scope !== scope || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error("Invalid synthetic scoped cursor");
    return value.offset;
  }
  const summary = (row: StoredPromptCuration): PromptCurationSummary => ({ id: row.id, groupKey: row.groupKey, snapshotId: row.snapshotId,
    revisionNumber: row.revisionNumber, parentRevisionId: row.parentRevisionId, basedOnRevisionId: row.basedOnRevisionId,
    changeReason: row.changeReason, title: row.title, relationKind: row.relationKind, status: row.status, createdAt: row.createdAt, manifestHash: row.manifestHash });
  const head = (group: string) => [...rows].reverse().find((row) => row.stored.groupKey === group);
  function fragment(id: string): PromptCurationFragment {
    const manual = manuals.find((row) => row.id === id);
    if (manual) return manual.fragment;
    const ai = state.fragments.find((row) => row.id === id)!;
    const source = state.members.find((row) => row.memberId === ai.primaryMemberId)!;
    return { memberKey: source.memberKey!, sourceClass: "source_extract", role: ai.role as PromptCopyRole,
      selectionOrigin: "ai_selected", textStart: ai.evidence[0].textStart!, textEnd: ai.evidence[0].textEnd!,
      rawText: ai.rawText!, rawTextHash: digest(ai.rawText!), completeness: ai.completeness as PromptCurationFragment["completeness"] };
  }
  function preparedInput(content: PromptCurationContent): PromptCurationInput {
    return { snapshotManifestHash: state.selectedSnapshot!.manifestHash, title: content.title, relationKind: content.relationKind,
      relationshipConfirmation: content.relationshipConfirmation, orderConfirmation: content.orderConfirmation, separator: "\n",
      sources: state.members.filter((row) => Boolean(row.rawText?.length)).map((row) => ({ memberKey: row.memberKey!, sourceFingerprint: digest(row.memberKey!),
        rawText: row.rawText!, contentHash: digest(row.rawText!), completeness: row.manualLink?.completeness ?? "unknown",
        parts: { number: { value: row.manualLink?.partNumber ?? null, origin: row.manualLink?.partNumber ? "user_declared" : "unknown" },
          total: { value: row.manualLink?.totalParts ?? null, origin: row.manualLink?.totalParts ? "user_declared" : "unknown" } } })),
      items: content.items.map((item) => ({ itemKey: item.itemKey, copyRole: item.copyRole, position: item.position, fragment: fragment(item.fragmentId) })),
      examples: content.examples.map((example) => { const member = state.members.find((row) => row.memberId === example.memberId)!;
        const attachment = member.attachments.find((row) => row.id === example.attachmentId)!;
        return { exampleKey: example.exampleKey, itemKey: example.itemKey, memberKey: member.memberKey!, sourceFingerprint: digest(member.memberKey!),
          sha256: attachment.sha256, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, position: example.position, evidenceMethod: example.evidenceMethod }; }),
    };
  }
  async function commit(request: Write, groupKey?: string) {
    const group = "groupKey" in request ? request.groupKey : groupKey!, prior = head(group)?.stored;
    const action = "action" in request ? request.action : "create";
    const basis = action === "undo" ? rows.find((row) => row.stored.id === (request as Extract<RevisePromptCurationRequest, { action: "undo" }>).restoreRevisionId)?.stored : prior;
    const content = "content" in request ? request.content : basis!.content;
    const input = preparedInput(content), prepared = await preparePromptCuration(input);
    const stored: StoredPromptCuration = { id: `curation-${rows.length + 1}`, groupKey: group, snapshotId: request.expectedSnapshotId,
      revisionNumber: (prior?.revisionNumber ?? 0) + 1, parentRevisionId: prior?.id ?? null, basedOnRevisionId: action === "undo" ? basis!.id : null,
      changeReason: action, title: content.title, relationKind: content.relationKind,
      status: action === "archive" ? "archived" : action === "unarchive" ? "active" : basis?.status ?? prior?.status ?? "active",
      createdAt: new Date(Date.UTC(2026, 8, 8, 3, 0, rows.length)).toISOString(), manifestHash: prepared.manifestHash,
      content: structuredClone(content), prepared, items: input.items, examples: input.examples };
    rows.push({ stored, input }); receipts.set(request.idempotencyKey, { item: stored, request: JSON.stringify(request), group }); return stored;
  }
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } }));
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/attachments/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=", "base64") }));
  await page.route(`**/api/v2/records/${recordId}/recovery-policy`, (route) => json(route, { recoveryPolicy: policy, contentReadable: true }));
  await page.route(`**/api/v2/records/${recordId}/links**`, async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "POST") {
      if (url.pathname.endsWith("/fragments")) {
        const body = parseManualLinkFragmentRequest(request.postDataJSON()); manualWrites.push(body);
        const member = state.members.find((row) => row.memberId === body.memberId);
        if (!member?.rawText || body.expectedRevisionId !== state.currentRevisionId || body.expectedSnapshotId !== state.currentSnapshotId || body.expectedManifestHash !== state.selectedSnapshot?.manifestHash) return error(route, 409, "manual_link_fragment_conflict");
        const fragment = await extractManualPromptFragment({ memberKey: member.memberKey!, sourceFingerprint: digest(member.memberKey!), rawText: member.rawText,
          contentHash: digest(member.rawText), completeness: member.manualLink?.completeness ?? "unknown",
          parts: { number: { value: null, origin: "unknown" }, total: { value: null, origin: "unknown" } } }, { textStart: body.textStart, textEnd: body.textEnd, role: body.role });
        const item: StoredManualLinkFragment = { id: `saved-manual-${manualWrites.length}`, fragmentKey: `manual-saved-manual-${manualWrites.length}`,
          snapshotId: body.expectedSnapshotId, primaryMemberId: body.memberId, createdAt: "2026-09-08T04:00:00.000Z", stateVersion: 1, reviewStatus: "confirmed", fragment };
        manuals = [item, ...manuals]; return json(route, { contract: "manual-link-fragment.v1", item, replayed: false }, 201);
      }
      const body = url.pathname.endsWith("/curations") ? parseCreatePromptCurationRequest(request.postDataJSON()) : parseRevisePromptCurationRequest(request.postDataJSON());
      writes.push(body); if (onWrite && await onWrite(route, body)) return;
      const group = "groupKey" in body ? body.groupKey : decodeURIComponent(url.pathname.split("/").at(-2)!);
      const receipt = receipts.get(body.idempotencyKey);
      if (receipt) return receipt.request === JSON.stringify(body) && receipt.group === group
        ? json(route, { contract: "stored-prompt-curation.v1", item: receipt.item, replayed: true }) : error(route, 409, "prompt_curation_conflict");
      if (body.expectedRevisionId !== state.currentRevisionId || body.expectedSnapshotId !== state.currentSnapshotId
        || body.expectedManifestHash !== state.selectedSnapshot?.manifestHash
        || "expectedCurationRevisionId" in body && (body.expectedCurationRevisionId !== head(group)?.stored.id || body.expectedCurationRevisionNumber !== head(group)?.stored.revisionNumber)) return error(route, 409, "prompt_curation_conflict");
      if ("content" in body && body.content.items.some((item) => {
        const fragment = manuals.find((row) => row.id === item.fragmentId) ?? state.fragments.find((row) => row.id === item.fragmentId);
        return !fragment || fragment.snapshotId !== body.expectedSnapshotId || fragment.stateVersion !== item.expectedFragmentStateVersion || ["rejected", "superseded"].includes(fragment.reviewStatus);
      })) return error(route, 409, "prompt_curation_conflict");
      return json(route, { contract: "stored-prompt-curation.v1", item: await commit(body, group), replayed: false }, 201);
    }
    if (request.method() !== "GET") throw new Error(`Unexpected method: ${request.method()}`);
    reads.push(request.url()); if (onRead && await onRead(route)) return;
    if (url.pathname.endsWith("/links")) {
      const historical = snapshots.get(url.searchParams.get("snapshotId") ?? "");
      if (historical && historical.selectedSnapshot?.id !== state.currentSnapshotId) return json(route, { links: { ...historical,
        currentRevisionId: state.currentRevisionId, currentSnapshotId: state.currentSnapshotId, currentSnapshotVersion: state.currentSnapshotVersion,
        snapshotHistory: state.snapshotHistory, isHistorical: true,
        capabilities: { ...state.capabilities, canCreateSnapshot: false, canCreateManualFragment: false, canAnalyze: false, canReview: false, reason: "link_history_read_only" } } });
      if (url.searchParams.get("snapshotId") === "snapshot-one") return json(route, { links: { ...state,
        selectedSnapshot: state.snapshotHistory.items.find((row) => row.id === "snapshot-one"), isHistorical: true,
        capabilities: { ...state.capabilities, canCreateSnapshot: false, canCreateManualFragment: false, canAnalyze: false, canReview: false, reason: "link_history_read_only" } } });
      return json(route, { links: state });
    }
    if (url.pathname.endsWith("/fragments")) {
      const snapshotId = url.searchParams.get("snapshotId")!, scope = `manual:${snapshotId}`, offset = offsetOf(url, scope);
      const matching = manuals.filter((row) => row.snapshotId === snapshotId);
      const result: ManualLinkFragmentPage = { contract: "manual-link-fragment.v1", recordId, currentRevisionId: state.currentRevisionId!,
        currentSnapshotId: state.currentSnapshotId, selectedSnapshotId: snapshotId, isHistorical: snapshotId !== state.currentSnapshotId,
        items: matching.slice(offset, offset + 20), nextCursor: matching.length > offset + 20 ? cursor(scope, offset + 20) : null };
      return json(route, result);
    }
    const parts = url.pathname.split("/");
    if (parts.at(-1) === "evidence" && parts.at(-3) === "fragments") {
      const id = decodeURIComponent(parts.at(-2)!);
      const current = state.fragments.find((row) => row.id === id);
      if (current) rememberAi(state);
      const proof = aiEvidence.get(id);
      return proof && proof.snapshotId === url.searchParams.get("snapshotId") && proof.snapshotManifestHash === url.searchParams.get("manifestHash")
        ? json(route, { ...proof, run: { ...proof.run, isPublished: proof.run.id === state.publishedRun?.id && proof.run.documentRevisionId === state.currentRevisionId } })
        : error(route, 404, "link_fragment_not_found");
    }
    if (parts.at(-2) === "fragments") {
      const item = manuals.find((row) => row.id === decodeURIComponent(parts.at(-1)!) && row.snapshotId === url.searchParams.get("snapshotId"));
      return item ? json(route, { contract: "manual-link-fragment.v1", item }) : error(route, 404, "manual_link_fragment_not_found");
    }
    if (url.pathname.endsWith("/curations")) {
      const snapshotId = url.searchParams.get("snapshotId") ?? state.currentSnapshotId, scope = `groups:${snapshotId}`, offset = offsetOf(url, scope);
      const matching = [...new Set(rows.map((row) => row.stored.groupKey))].map((group) => head(group)!.stored).filter((row) => row.snapshotId === snapshotId).reverse();
      const result: PromptCurationPage = { contract: "stored-prompt-curation.v1", recordId, currentRevisionId: state.currentRevisionId!,
        currentSnapshotId: state.currentSnapshotId, selectedSnapshotId: snapshotId, isHistorical: snapshotId !== state.currentSnapshotId,
        items: matching.slice(offset, offset + 20).map(summary), nextCursor: matching.length > offset + 20 ? cursor(scope, offset + 20) : null };
      return json(route, result);
    }
    if (url.pathname.endsWith("/copy")) {
      const row = rows.find((row) => row.stored.id === decodeURIComponent(parts.at(-2)!) && row.stored.groupKey === decodeURIComponent(parts.at(-4)!));
      if (!row) return error(route, 404, "prompt_curation_not_found");
      try { return json(route, { contract: "stored-prompt-curation.v1", revisionId: row.stored.id,
        ...await copyPromptCuration(row.input, { role: url.searchParams.get("channel") as PromptCopyRole, mode: url.searchParams.get("mode") === "available_only" ? "available_only" : "standard" }) }); }
      catch (caught) { if (caught instanceof PromptCurationError) return error(route, 409, caught.code); throw caught; }
    }
    const group = decodeURIComponent(parts.at(-1)!), latest = head(group), scope = `history:${group}`, offset = offsetOf(url, scope);
    const selected = url.searchParams.get("revisionId") ? rows.find((row) => row.stored.id === url.searchParams.get("revisionId") && row.stored.groupKey === group) : latest;
    if (!selected || !latest) return error(route, 404, "prompt_curation_not_found");
    const history = rows.filter((row) => row.stored.groupKey === group).reverse();
    const detail: PromptCurationDetail = { contract: "stored-prompt-curation.v1", recordId, currentRevisionId: state.currentRevisionId!, currentSnapshotId: state.currentSnapshotId,
      isHistorical: selected.stored.id !== latest.stored.id || selected.stored.snapshotId !== state.currentSnapshotId, item: selected.stored,
      head: { id: latest.stored.id, revisionNumber: latest.stored.revisionNumber },
      history: { items: history.slice(offset, offset + 20).map((row) => summary(row.stored)), nextCursor: history.length > offset + 20 ? cursor(scope, offset + 20) : null } };
    return json(route, detail);
  });
  await page.goto("/v2-lab?surface=link-analysis");
  state = JSON.parse((await page.getByTestId("link-analysis-fixture-data").textContent())!) as LinkPresentationV1;
  rememberAi(state);
  const source = state.members[0], raw = source.rawText!, split = raw.indexOf("\r\n");
  manuals = ([["prompt", 0, split], ["prompt", split + 2, raw.length], ["negative_prompt", 2, 8], ["parameters", 9, 14]] as const).map(([role, start, end], index) => ({
    id: `manual-${index + 1}`, fragmentKey: `manual-key-${index + 1}`, snapshotId: state.currentSnapshotId!, primaryMemberId: source.memberId!,
    createdAt: "2026-09-08T01:00:00.000Z", stateVersion: 1, reviewStatus: "confirmed", fragment: { memberKey: source.memberKey!, sourceClass: "source_extract", role,
      selectionOrigin: "user_selected", textStart: start, textEnd: end, rawText: raw.slice(start, end), rawTextHash: digest(raw.slice(start, end)), completeness: "partial" },
  }));
  return { writes, manualWrites, reads, rows, aiEvidence, json, error, commit, get state() { return state; }, set state(value: LinkPresentationV1) {
    rememberAi(state);
    if (state.selectedSnapshot && value.currentSnapshotId !== state.currentSnapshotId) snapshots.set(state.selectedSnapshot.id, state);
    state = value;
    rememberAi(state);
  },
    get manuals() { return manuals; }, set manuals(value: StoredManualLinkFragment[]) { manuals = value; },
    get policy() { return policy; }, set policy(value: typeof policy) { policy = value; },
    onWrite(handler: typeof onWrite) { onWrite = handler; }, onRead(handler: typeof onRead) { onRead = handler; } };
}
