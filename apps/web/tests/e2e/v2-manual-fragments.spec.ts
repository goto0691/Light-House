import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { LinkPresentationV1 } from "../../src/lib/v2/domain/link-presentation-v1";
import type { CreateManualLinkFragmentRequest, ManualLinkFragmentPage, StoredManualLinkFragment } from "../../src/lib/v2/domain/manual-link-fragment-v1";
import type { ManualFragmentDraft } from "../../src/lib/v2/editor/manual-fragment-draft";

const recordId = "link-analysis-fixture";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Policy = { ownerId: string; recordId: string; currentVersion: number; privacyLevel: "normal" | "sensitive" | "restricted" };
async function harness(page: Page) {
  let state: LinkPresentationV1;
  let policy: Policy = { ownerId: "link-owner", recordId, currentVersion: 1, privacyLevel: "normal" }, policyStatus = 200;
  let policyReadable: boolean | undefined;
  const snapshots = new Map<string, LinkPresentationV1>();
  const receipts = new Map<string, { body: string; item: StoredManualLinkFragment }>();
  let items: StoredManualLinkFragment[] = [];
  const writes: CreateManualLinkFragmentRequest[] = [], reads: string[] = [];
  let postHandler: ((route: Route, request: CreateManualLinkFragmentRequest) => Promise<void>) | null = null;
  let readHandler: ((route: Route) => Promise<boolean>) | null = null;
  const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
  function result(request: CreateManualLinkFragmentRequest): StoredManualLinkFragment {
    const source = snapshots.get(request.expectedSnapshotId) ?? state;
    const member = source.members.find((row) => row.memberId === request.memberId)!;
    const rawText = member.rawText!.slice(request.textStart, request.textEnd);
    return { id: `manual-${writes.length}`, fragmentKey: `manual-manual-${writes.length}`, snapshotId: request.expectedSnapshotId, primaryMemberId: request.memberId,
      createdAt: new Date().toISOString(), stateVersion: 1, reviewStatus: "confirmed", fragment: { memberKey: member.memberKey!, sourceClass: "source_extract",
        role: request.role, selectionOrigin: "user_selected", textStart: request.textStart, textEnd: request.textEnd, rawText, rawTextHash: digest(rawText), completeness: "partial" } };
  }
  function commit(request: CreateManualLinkFragmentRequest) {
    const item = result(request); items = [item, ...items];
    receipts.set(request.idempotencyKey, { body: JSON.stringify(request), item }); return item;
  }
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } }));
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/attachments/**", (route) => route.fulfill({ status: 404, body: "Synthetic missing image" }));
  await page.route(`**/api/v2/records/${recordId}/recovery-policy`, (route) => json(route,
    policyStatus === 200 ? { recoveryPolicy: policy, contentReadable: policyReadable ?? policy.privacyLevel !== "restricted" } : { error: { code: "synthetic_policy_failure" } }, policyStatus));
  await page.route(`**/api/v2/records/${recordId}/links**`, async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "POST") {
      const body = request.postDataJSON() as CreateManualLinkFragmentRequest; writes.push(body);
      if (postHandler) return postHandler(route, body);
      const receipt = receipts.get(body.idempotencyKey);
      if (receipt) return receipt.body === JSON.stringify(body) ? json(route, { contract: "manual-link-fragment.v1", item: receipt.item, replayed: true })
        : json(route, { error: { code: "manual_link_fragment_conflict" } }, 409);
      if (body.expectedRevisionId !== state.currentRevisionId || body.expectedSnapshotId !== state.currentSnapshotId || body.expectedManifestHash !== state.selectedSnapshot?.manifestHash)
        return json(route, { error: { code: "manual_link_fragment_conflict" } }, 409);
      return json(route, { contract: "manual-link-fragment.v1", item: commit(body), replayed: false }, 201);
    }
    if (request.method() !== "GET") throw new Error(`Unexpected ${request.method()}`);
    reads.push(request.url()); if (readHandler && await readHandler(route)) return;
    if (url.pathname.endsWith("/links")) {
      let selected = structuredClone(state);
      const historical = snapshots.get(url.searchParams.get("snapshotId") ?? "");
      if (historical && historical.selectedSnapshot?.id !== state.currentSnapshotId) {
        selected = { ...historical, currentRevisionId: state.currentRevisionId, currentSnapshotId: state.currentSnapshotId,
          currentSnapshotVersion: state.currentSnapshotVersion, snapshotHistory: state.snapshotHistory, isHistorical: true,
          capabilities: { canAnalyze: false, canCreateSnapshot: false, canCreateManualFragment: false, canReview: false, reason: "link_history_read_only" } };
      } else if (url.searchParams.get("snapshotId") === "snapshot-one") {
        selected = { ...selected, selectedSnapshot: selected.snapshotHistory.items.find((row) => row.id === "snapshot-one")!,
          isHistorical: true, capabilities: { canAnalyze: false, canCreateSnapshot: false, canCreateManualFragment: false, canReview: false, reason: "link_history_read_only" } };
      } else if (url.searchParams.get("runId") === "run-one") {
        selected = { ...selected, selectedRun: selected.runHistory.items.find((row) => row.id === "run-one")!, isHistorical: true,
          capabilities: { canAnalyze: false, canCreateSnapshot: false, canCreateManualFragment: true, canReview: false, reason: "link_history_read_only" } };
      }
      return json(route, { links: selected });
    }
    if (url.pathname.endsWith("/fragments")) {
      const selectedSnapshotId = url.searchParams.get("snapshotId")!;
      const offset = Number(url.searchParams.get("cursor") ?? "0"), matching = items.filter((row) => row.snapshotId === selectedSnapshotId);
      const body: ManualLinkFragmentPage = { contract: "manual-link-fragment.v1", recordId, currentRevisionId: state.currentRevisionId!, currentSnapshotId: state.currentSnapshotId,
        selectedSnapshotId, isHistorical: selectedSnapshotId !== state.currentSnapshotId, items: matching.slice(offset, offset + 20), nextCursor: matching.length > offset + 20 ? String(offset + 20) : null };
      return json(route, body);
    }
    const item = items.find((row) => row.id === url.pathname.split("/").at(-1));
    if (!item || item.snapshotId !== url.searchParams.get("snapshotId")) return json(route, { error: { message: "Not found" } }, 404);
    return json(route, { contract: "manual-link-fragment.v1", item });
  });
  await page.goto("/v2-lab?surface=link-analysis");
  state = JSON.parse((await page.getByTestId("link-analysis-fixture-data").textContent())!) as LinkPresentationV1;
  state = { ...state, capabilities: { ...state.capabilities, canCreateManualFragment: true } };
  return { writes, reads, result, commit, json, get state() { return state; }, set state(value: LinkPresentationV1) {
    if (state.selectedSnapshot && value.currentSnapshotId !== state.currentSnapshotId) snapshots.set(state.selectedSnapshot.id, structuredClone(state));
    state = value;
  }, set policy(value: Policy) { policy = value; }, set policyStatus(value: number) { policyStatus = value; }, set policyReadable(value: boolean) { policyReadable = value; },
    get items() { return items; }, set items(value: StoredManualLinkFragment[]) { items = value; },
    onPost(handler: typeof postHandler) { postHandler = handler; }, onRead(handler: typeof readHandler) { readHandler = handler; } };
}
async function open(page: Page) { await page.getByRole("button", { name: "수동 발췌 열기", exact: true }).click(); await expect(page.getByRole("button", { name: "수동 발췌 목록 새로고침" })).toBeEnabled(); }
async function select(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "발췌 범위 선택", exact: true });
  await input.click();
  const displayed = (await input.locator(".cm-line").allTextContents()).join("\n"), start = displayed.indexOf(text);
  if (start < 0) throw new Error("Selection missing from actual source view");
  // This helper deliberately covers short ASCII fixtures only. Keyboard movement
  // is grapheme-based and .cm-line is virtualized; Unicode/long-source tests use explicit keys.
  if (displayed.length > 200 || [...displayed].some((character) => character.charCodeAt(0) > 127)) {
    throw new Error("Use explicit keyboard sequences for Unicode or long-source fixtures");
  }
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < start; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");
  for (let index = 0; index < text.length; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(page.getByLabel("선택한 발췌 미리보기", { exact: true })).toBeVisible();
}
const manual = (page: Page) => page.locator(".v2-manual-fragments");
const save = (page: Page) => page.getByRole("button", { name: "선택 범위 발췌 저장", exact: true });
const recovery = (page: Page) => manual(page).getByRole("complementary", { name: "발췌 초안 기기 복구", exact: true });
async function draftRows(page: Page): Promise<{ id: string; encrypted: boolean; value?: { kind: string; payload: ManualFragmentDraft } }[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lighthouse_editor_working_copies_v1");
    request.onerror = () => reject(new Error("Synthetic database read failed"));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("links")) { db.close(); resolve([]); return; }
      const read = db.transaction("links").objectStore("links").getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(new Error("Synthetic rows read failed")); db.close(); };
    };
  }));
}
async function restoreManual(page: Page, index = 0) {
  await recovery(page).getByRole("button", { name: "이 초안 복구", exact: true }).nth(index).click();
  await expect(manual(page).getByRole("status")).toContainText("발췌 초안을 복구했습니다");
}
async function persisted(page: Page) { await expect(recovery(page).getByTestId("link-draft-recovery-status")).toContainText("이 기기에 초안 저장됨"); }
async function refresh(page: Page) { await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); }

test("manual recovery explicitly restores exact Unicode CRLF source, range and role without a POST", async ({ page }, info) => {
  const context = await harness(page), text = "  복구 🧭\r\n  공백  보존  ";
  context.state = { ...context.state, members: context.state.members.map((row, index) => index ? row : { ...row, rawText: text, contentHash: digest(text) }) };
  await refresh(page); await open(page);
  const input = page.getByRole("textbox", { name: "발췌 범위 선택", exact: true }); await input.click();
  await page.keyboard.press("Control+Home"); await page.keyboard.press("Control+Shift+End");
  await page.getByRole("combobox", { name: "발췌 역할", exact: true }).selectOption("parameters"); await persisted(page);
  expect((await draftRows(page))[0].value?.payload).toMatchObject({ role: "parameters", range: { textStart: 0, textEnd: text.length }, source: { rawText: text } });
  await page.reload(); await refresh(page); await open(page);
  await expect(recovery(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(1);
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0); expect(context.writes).toHaveLength(0);
  await restoreManual(page); await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText(text);
  expect(await page.getByLabel("선택한 발췌 미리보기").textContent()).toBe(text);
  await expect(page.getByRole("combobox", { name: "발췌 역할", exact: true })).toHaveValue("parameters"); expect(context.writes).toHaveLength(0);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-manual-fragments").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await manual(page).screenshot({ path: info.outputPath("manual-recovery-320.png"), scale: "css" });
  await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  await expect.poll(async () => (await draftRows(page)).length).toBe(0); expect(context.writes).toHaveLength(1);
});

test("manual recovery parks a range before explicit source selection and preserves even the new empty range", async ({ page }) => {
  const context = await harness(page), source = context.state.members[0];
  context.state = { ...context.state, members: [...context.state.members, { ...source, sourceItemId: "second-source", memberId: "second-member", memberKey: "second-key", sourceOrder: 3 }] };
  await refresh(page); await open(page); await select(page, "window light"); await persisted(page);
  await page.getByRole("combobox", { name: "발췌할 원문", exact: true }).selectOption("second-member");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0); await persisted(page);
  await expect.poll(async () => (await draftRows(page)).length).toBe(2);
  await page.reload(); await refresh(page); await open(page);
  await expect(recovery(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(2);
  await restoreManual(page); await expect(page.getByRole("combobox", { name: "발췌할 원문", exact: true })).toHaveValue("second-member");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0);
  // Restoring the original selection also parks this restored empty-range draft.
  await restoreManual(page, 1); await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light");
  expect(context.writes).toHaveLength(0);
});

test("manual recovery replays the original lost-response request after both document and snapshot advance", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  context.onPost(async (route, body) => { context.commit(body); await route.abort("failed"); });
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("요청 키는 유지");
  const original = structuredClone(context.writes[0]);
  await expect.poll(async () => (await draftRows(page))[0].value?.payload.pending).toEqual(original);
  context.onPost(null);
  const snapshot = { ...context.state.selectedSnapshot!, id: "snapshot-three", manifestHash: "c".repeat(64), version: 3 };
  context.state = { ...context.state, currentRevisionId: "revision-three", currentSnapshotId: snapshot.id, currentSnapshotVersion: 3, selectedSnapshot: snapshot,
    snapshotHistory: { ...context.state.snapshotHistory, items: [snapshot, ...context.state.snapshotHistory.items] } };
  await page.reload(); await refresh(page); await open(page); await restoreManual(page);
  expect(context.writes).toHaveLength(1); await expect(save(page)).toBeDisabled();
  await page.getByRole("button", { name: "이전 요청 결과 다시 확인", exact: true }).click();
  await expect(manual(page).getByRole("status")).toContainText("저장했습니다"); expect(context.writes).toEqual([original, original]); expect(context.items).toHaveLength(1);
  await expect.poll(async () => (await draftRows(page)).length).toBe(0);
  await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(0); // Do not mix an old receipt into the new snapshot list.
});

test("manual recovery permits pending replay while the selected matching snapshot is historical", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  context.onPost(async (route, body) => { context.commit(body); await route.abort("failed"); });
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("요청 키는 유지"); context.onPost(null);
  context.state = { ...context.state, currentSnapshotId: "snapshot-three", currentSnapshotVersion: 3, isHistorical: true,
    capabilities: { ...context.state.capabilities, canCreateSnapshot: false, canCreateManualFragment: false, reason: "link_history_read_only" } };
  await refresh(page); await expect(save(page)).toBeDisabled();
  await page.getByRole("button", { name: "이전 요청 결과 다시 확인", exact: true }).click();
  await expect(manual(page).getByRole("status")).toContainText("저장했습니다"); expect(context.writes[1]).toEqual(context.writes[0]); expect(context.items).toHaveLength(1);
});

test("manual recovery keeps pending on a malformed success and verifies fresh source before any retry POST", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  context.onPost(async (route, body) => {
    const item = context.commit(body); await context.json(route, { contract: "manual-link-fragment.v1", item: { ...item, fragment: { ...item.fragment, rawText: "wrong synthetic result" } }, replayed: false }, 201);
  });
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("발췌 저장 응답"); context.onPost(null);
  await persisted(page); await page.reload(); await open(page); await restoreManual(page);
  const original = context.state;
  context.state = { ...original, members: original.members.map((row, index) => index ? row : { ...row, rawText: "changed" }) };
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("원문·자료 버전을 다시 확인하지 못했습니다");
  expect(context.writes).toHaveLength(1); await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light");
  context.state = original; await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes[1]).toEqual(context.writes[0]); await expect.poll(async () => (await draftRows(page)).length).toBe(0);
});

test("manual recovery requires fresh sensitive consent after reload and stores only encrypted content", async ({ page }) => {
  const context = await harness(page); context.policy = { ownerId: "link-owner", recordId, currentVersion: 2, privacyLevel: "sensitive" };
  await open(page); const consent = recovery(page).getByRole("checkbox", { name: "민감 초안을 이 기기에 암호화하여 복구하는 데 동의", exact: true });
  await expect(consent).not.toBeChecked(); await select(page, "window light"); expect(await draftRows(page)).toHaveLength(0);
  await consent.check(); await persisted(page); const stored = await draftRows(page);
  expect(stored).toHaveLength(1); expect(stored[0].encrypted).toBe(true); expect(stored[0].value).toBeUndefined();
  await page.reload(); await open(page); await expect(consent).not.toBeChecked();
  await expect(recovery(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(0);
  await consent.check(); await restoreManual(page); await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light"); expect(context.writes).toHaveLength(0);
});

test("manual recovery privacy restriction purges the local row and closes all cached source", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light"); await persisted(page);
  context.policy = { ownerId: "link-owner", recordId, currentVersion: 2, privacyLevel: "restricted" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(manual(page)).toHaveCount(0); await expect.poll(async () => (await draftRows(page)).length).toBe(0);
  await expect(page.locator(".v2-record-link-analysis")).not.toContainText("window light"); expect(context.writes).toHaveLength(0);
});

test("manual recovery auth failure withholds stored input without auto-submitting it", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light"); await persisted(page);
  context.policyStatus = 401; await page.reload(); await page.getByRole("button", { name: "수동 발췌 열기", exact: true }).click();
  await expect(manual(page)).toHaveCount(0); expect(context.writes).toHaveLength(0); expect(await draftRows(page)).toHaveLength(1);
});

test("manual recovery policy outage blocks unprotected POST until the user explicitly disables local recovery", async ({ page }) => {
  const context = await harness(page); context.policyStatus = 503; await open(page); await select(page, "window light");
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("기기 복구 사본을 저장하지 못했습니다"); expect(context.writes).toHaveLength(0);
  await recovery(page).getByRole("checkbox", { name: "이 화면의 초안을 이 기기에 복구용으로 저장", exact: true }).uncheck();
  await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("저장했습니다"); expect(context.writes).toHaveLength(1);
});

test("manual recovery disabled storage blocks a source switch without discarding the current range", async ({ page }) => {
  const context = await harness(page), source = context.state.members[0];
  context.state = { ...context.state, members: [...context.state.members, { ...source, sourceItemId: "second-source", memberId: "second-member", memberKey: "second-key", sourceOrder: 3 }] };
  await refresh(page); await open(page); await select(page, "window light"); await persisted(page);
  await recovery(page).getByRole("checkbox", { name: "이 화면의 초안을 이 기기에 복구용으로 저장", exact: true }).uncheck();
  await page.getByRole("combobox", { name: "발췌할 원문", exact: true }).selectOption("second-member");
  await expect(manual(page).getByRole("alert")).toContainText("다른 초안으로 이동하지 않았습니다");
  await expect(page.getByRole("combobox", { name: "발췌할 원문", exact: true })).toHaveValue("member-prompt");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light"); expect(context.writes).toHaveLength(0);
});

test("manual recovery reopens hidden pending only after fresh authorization, including historical read-only selection", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  context.onPost(async (route, body) => { context.commit(body); await context.json(route, { error: { code: "record_access_denied" } }, 403); });
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("표시 내용을 닫았습니다");
  await expect(manual(page).locator("pre,[role=textbox]")).toHaveCount(0); expect(context.writes).toHaveLength(1);
  const original = context.writes[0]; context.onPost(null);
  context.state = { ...context.state, currentSnapshotId: "snapshot-three", isHistorical: true,
    capabilities: { ...context.state.capabilities, canCreateSnapshot: false, canCreateManualFragment: false, reason: "link_history_read_only" } };
  await refresh(page); await page.getByRole("button", { name: "권한 확인하고 발췌 불러오기", exact: true }).click();
  await expect(page.getByRole("button", { name: "이 화면의 숨긴 초안 다시 열기", exact: true })).toBeVisible();
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0); expect(context.writes).toHaveLength(1);
  context.policyStatus = 503;
  await page.getByRole("button", { name: "이 화면의 숨긴 초안 다시 열기", exact: true }).click();
  await expect(manual(page).getByRole("alert")).toContainText("서버 보호 정책을 확인하지 못했습니다");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0);
  context.policyStatus = 200;
  await page.getByRole("button", { name: "이 화면의 숨긴 초안 다시 열기", exact: true }).click();
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light"); expect(context.writes).toHaveLength(1);
  await page.getByRole("button", { name: "이전 요청 결과 다시 확인", exact: true }).click();
  await expect(manual(page).getByRole("status")).toContainText("저장했습니다"); expect(context.writes).toEqual([original, original]);
  await expect.poll(async () => (await draftRows(page)).length).toBe(0);
});

for (const privacy of ["opted_out", "restricted"] as const) test(`manual recovery explicitly reopens hidden in-memory input with ${privacy} storage without persisting it`, async ({ page }) => {
  const context = await harness(page); await open(page);
  await recovery(page).getByRole("checkbox", { name: "이 화면의 초안을 이 기기에 복구용으로 저장", exact: true }).uncheck();
  await select(page, "window light"); expect(await draftRows(page)).toHaveLength(0);
  context.onRead(async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fragments")) return false;
    await context.json(route, { error: { code: "record_access_denied" } }, 403); return true;
  });
  await page.getByRole("button", { name: "수동 발췌 목록 새로고침", exact: true }).click();
  await expect(manual(page).getByRole("alert")).toContainText("표시 내용을 닫았습니다"); context.onRead(null);
  if (privacy === "restricted") { context.policy = { ownerId: "link-owner", recordId, currentVersion: 2, privacyLevel: "restricted" }; context.policyReadable = true; }
  await page.getByRole("button", { name: "권한 확인하고 발췌 불러오기", exact: true }).click();
  await expect(page.getByRole("button", { name: "현재 버전으로 선택 다시 확인", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "이 화면의 숨긴 초안 다시 열기", exact: true }).click();
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light");
  await expect(recovery(page)).toContainText("기기 복구 꺼짐"); expect(await draftRows(page)).toHaveLength(0); expect(context.writes).toHaveLength(0);
});

test("manual selection saves exact CRLF offsets independently and copies only after a fresh authorized read", async ({ page }, testInfo) => {
  const context = await harness(page); expect(context.writes).toHaveLength(0); expect(context.reads).toHaveLength(0);
  await open(page); await select(page, "keep  double spaces\n  ");
  await page.getByRole("combobox", { name: "발췌 역할", exact: true }).selectOption("negative_prompt");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("keep  double spaces\r\n  ");
  const selectionColors = await page.getByRole("textbox", { name: "발췌 범위 선택", exact: true }).locator(".cm-line").nth(1).evaluate((line) => ({
    normal: getComputedStyle(line).color, selected: getComputedStyle(line, "::selection").color,
  }));
  expect(selectionColors.selected).toBe(selectionColors.normal);
  await manual(page).screenshot({ path: testInfo.outputPath("manual-fragments-selection.png"), scale: "css" });
  await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("수동 발췌를 저장");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0); await expect(save(page)).toBeDisabled();
  expect(context.writes).toHaveLength(1);
  const source = context.state.members[0].rawText!, start = source.indexOf("keep");
  expect(context.writes[0]).toEqual({ expectedRevisionId: "revision-one", expectedSnapshotId: "snapshot-two", expectedManifestHash: "a".repeat(64),
    memberId: "member-prompt", textStart: start, textEnd: source.length, role: "negative_prompt", idempotencyKey: expect.any(String) });
  const card = manual(page).locator("[data-manual-fragment]");
  await expect(card.getByRole("link", { name: "보관 원문으로 이동" })).toHaveAttribute("href", "#source-analysis-prompt");
  await expect(card.getByRole("link", { name: "https://example.com/synthetic-prompt", exact: true })).toHaveAttribute("href", "https://example.com/synthetic-prompt");
  await expect(page.locator("#source-analysis-prompt")).toHaveCount(1);
  await manual(page).getByRole("button", { name: "수동 발췌 원문 복사", exact: true }).click();
  await expect(manual(page).getByRole("status")).toContainText("그대로 복사");
  expect(context.reads.at(-1)).toContain("/fragments/manual-1?snapshotId=snapshot-two");
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe("keep  double spaces\r\n  ");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-manual-fragments").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await manual(page).screenshot({ path: testInfo.outputPath("manual-fragments-saved.png"), scale: "css" });
  await page.screenshot({ path: testInfo.outputPath("manual-fragments-record.png"), fullPage: true });
});
test("keyboard selection works and collapse/reopen preserves an unsaved range without posting", async ({ page }) => {
  const context = await harness(page); await open(page);
  const textarea = page.getByRole("textbox", { name: "발췌 범위 선택" }); await textarea.click(); await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift"); for (let index = 0; index < 8; index++) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText(context.state.members[0].rawText!.slice(0, 8));
  await page.getByRole("button", { name: "수동 발췌 접기" }).click(); await open(page);
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText(context.state.members[0].rawText!.slice(0, 8)); expect(context.writes).toHaveLength(0);
});

test("pointer selection and tab navigation work while typing cannot edit the source", async ({ page }) => {
  const context = await harness(page); await open(page);
  const input = page.getByRole("textbox", { name: "발췌 범위 선택", exact: true });
  await expect(input).toBeVisible(); // The selection surface is lazy-loaded.
  await page.getByRole("combobox", { name: "발췌 역할", exact: true }).focus(); await page.keyboard.press("Tab");
  await expect(input).toBeFocused(); await expect(input).toHaveAttribute("contenteditable", "false");
  await expect(input).toHaveAttribute("aria-readonly", "true");
  const line = input.locator(".cm-line").first(); await line.scrollIntoViewIfNeeded();
  const bounds = await line.evaluate((element) => {
    const range = document.createRange(); range.setStart(element.firstChild!, 2); range.setEnd(element.firstChild!, 14);
    const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(bounds.left + .5, bounds.y); await page.mouse.down();
  await page.mouse.move(bounds.right - .5, bounds.y, { steps: 6 }); await page.mouse.up();
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light");
  await page.keyboard.type("replacement"); await page.keyboard.press("Backspace"); await page.keyboard.press("Delete"); await page.keyboard.press("Enter");
  await page.keyboard.insertText("붙여 넣는 입력");
  // Synthetic events exercise the blocked input boundary, not a real device IME/clipboard.
  await input.evaluate((element) => {
    const transfer = new DataTransfer(); transfer.setData("text/plain", "injected");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "조합" }));
    element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertCompositionText", data: "조합" }));
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "조합" }));
  });
  expect((await input.locator(".cm-line").allTextContents()).join("\n")).toBe(context.state.members[0].rawText!.replace(/\r\n?/g, "\n"));
  await select(page, "window light"); await save(page).click();
  await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes[0].textStart).toBe(2); expect(context.writes[0].textEnd).toBe(14);
});
test("network retry retains selection and exact request key", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  context.onPost(async (route, request) => {
    if (context.writes.length === 1) return route.abort("failed");
    const item = context.result(request); context.items = [item]; return context.json(route, { contract: "manual-link-fragment.v1", item, replayed: true });
  });
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("요청 키는 유지");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light");
  await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("저장했습니다"); expect(context.writes[0]).toEqual(context.writes[1]);
});
test("409 preserves range and requires explicit confirmation against the refreshed document basis", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  context.onPost(async (route, request) => {
    if (context.writes.length === 1) {
      context.state = { ...context.state, currentRevisionId: "revision-two" };
      return context.json(route, { error: { message: "Conflict" } }, 409);
    }
    const item = context.result(request); context.items = [item]; return context.json(route, { contract: "manual-link-fragment.v1", item, replayed: false }, 201);
  });
  await save(page).click(); await expect(manual(page).getByRole("alert")).toContainText("선택 범위는 유지");
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await expect(save(page)).toBeDisabled();
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light");
  await page.getByRole("button", { name: "현재 버전으로 선택 다시 확인" }).click(); await save(page).click();
  await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes[1].expectedRevisionId).toBe("revision-two"); expect(context.writes[1].idempotencyKey).not.toBe(context.writes[0].idempotencyKey);
  expect(context.writes[1].textStart).toBe(context.writes[0].textStart);
});
test("late save response cannot clear a retained selection after the parent document changes", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  let release: () => void = () => {}; const held = new Promise<void>((resolve) => { release = resolve; });
  context.onPost(async (route, request) => { await held; await context.json(route, { contract: "manual-link-fragment.v1", item: context.result(request), replayed: false }, 201).catch(() => {}); });
  await save(page).click(); await expect.poll(() => context.writes.length).toBe(1);
  context.state = { ...context.state, currentRevisionId: "revision-later" };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.getByRole("button", { name: "현재 버전으로 선택 다시 확인" })).toBeVisible(); release();
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light");
  await expect(manual(page).getByRole("status")).not.toContainText("저장했습니다"); await expect(save(page)).toBeDisabled();
});
test("locked copy response hides cached source and never copies stale text", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light"); await save(page).click();
  await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(1);
  context.onRead(async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fragments/manual-1")) return false;
    await context.json(route, { error: { message: "Locked" } }, 423); return true;
  });
  await manual(page).getByRole("button", { name: "수동 발췌 원문 복사", exact: true }).click();
  await expect(manual(page).getByRole("alert")).toContainText("표시 내용을 닫았습니다");
  await expect(manual(page).locator("pre,[role=textbox]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBeUndefined();
});

for (const failure of [
  { name: "non-JSON authentication error", status: 401, code: null },
  { name: "forbidden response", status: 403, code: "record_access_denied" },
  { name: "missing record response", status: 404, code: "record_not_found" },
]) test(`${failure.name} clears the list and unsaved selection without copying`, async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light"); await save(page).click();
  await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(1); await select(page, "synthetic portrait");
  context.onRead(async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fragments/manual-1")) return false;
    if (failure.code) await context.json(route, { error: { code: failure.code, message: "Access changed" } }, failure.status);
    else await route.fulfill({ status: failure.status, contentType: "text/html", body: "<p>Sign in</p>" });
    return true;
  });
  await manual(page).getByRole("button", { name: "수동 발췌 원문 복사", exact: true }).click();
  await expect(manual(page).getByRole("alert")).toContainText("표시 내용을 닫았습니다");
  await expect(manual(page).locator("pre,[role=textbox],[data-manual-fragment]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBeUndefined(); expect(context.writes).toHaveLength(1);
});

test("a missing fragment removes only its card and preserves the unsaved selection", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light"); await save(page).click();
  await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(1); await select(page, "synthetic portrait");
  context.onRead(async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fragments/manual-1")) return false;
    await context.json(route, { error: { code: "manual_link_fragment_not_found", message: "Missing fragment" } }, 404); return true;
  });
  await manual(page).getByRole("button", { name: "수동 발췌 원문 복사", exact: true }).click();
  await expect(manual(page).getByRole("alert")).toContainText("목록에서 닫았습니다");
  await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(0);
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("synthetic portrait"); await expect(save(page)).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBeUndefined();
  await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes).toHaveLength(2);
});

test("current-snapshot manual selection stays writable when a past AI run is displayed", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light");
  await page.getByRole("combobox", { name: "분석 실행", exact: true }).selectOption("run-one");
  await expect(page.getByRole("button", { name: "다시 AI로 정리", exact: true })).toBeDisabled();
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("window light"); await expect(save(page)).toBeEnabled();
  await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes[0].expectedSnapshotId).toBe("snapshot-two"); expect(context.writes[0]).not.toHaveProperty("runId");
});

test("emoji keyboard selection uses exact UTF-16 offsets and malformed DOM selection cannot reuse a prior range", async ({ page }) => {
  const context = await harness(page), text = "safe 🙂 suffix\r\n";
  context.state = { ...context.state, members: context.state.members.map((member) => member.memberId === "member-prompt" ? { ...member, rawText: text, contentHash: digest(text) } : member) };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page);
  const input = page.getByRole("textbox", { name: "발췌 범위 선택", exact: true });
  await input.click(); await page.keyboard.press("Control+Home");
  for (let index = 0; index < 5; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("🙂"); await save(page).click();
  await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes[0].textStart).toBe(5); expect(context.writes[0].textEnd).toBe(7);
  await input.click(); await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift"); for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText("safe");
  await input.locator(".cm-line").first().evaluate((element) => {
    // Deliberately malformed browser selection. No React/CodeMirror internal state is invoked.
    const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 6);
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await expect(manual(page).getByRole("alert")).toContainText("이모지를 나누지 않도록");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0); await expect(save(page)).toBeDisabled();
  expect(context.writes).toHaveLength(1);
});

test("switching source members clears the selection even when their text is identical", async ({ page }) => {
  const context = await harness(page), first = context.state.members[0];
  context.state = { ...context.state, members: [...context.state.members, { ...first, memberId: "member-other", memberKey: "other",
    sourceItemId: "analysis-other", sourceOrder: 3 }] };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page); await select(page, "window light");
  await page.getByRole("combobox", { name: "발췌할 원문", exact: true }).selectOption("member-other");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveCount(0); await expect(save(page)).toBeDisabled();
  await select(page, "synthetic portrait"); await save(page).click();
  await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes).toHaveLength(1); expect(context.writes[0].memberId).toBe("member-other");
  await expect(manual(page).getByRole("link", { name: "보관 원문으로 이동" })).toHaveAttribute("href", "#source-analysis-other");
});

test("a long virtualized source selects the final Unicode line with exact original offsets", async ({ page }) => {
  const context = await harness(page), tail = "TAIL 👀 e\u0301  ";
  const text = Array.from({ length: 1000 }, (_, index) => `line ${index}: keep  spaces`).join("\r\n") + "\r\n" + tail;
  context.state = { ...context.state, members: context.state.members.map((member) => member.memberId === "member-prompt" ? { ...member, rawText: text, contentHash: digest(text) } : member) };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page);
  const input = page.getByRole("textbox", { name: "발췌 범위 선택", exact: true });
  await input.click(); await page.keyboard.press("Control+End"); await page.keyboard.press("Home"); await page.keyboard.press("Shift+End");
  await expect(page.getByLabel("선택한 발췌 미리보기")).toHaveText(tail);
  expect(await input.locator(".cm-line").count()).toBeLessThan(1000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await save(page).click(); await expect(manual(page).getByRole("status")).toContainText("저장했습니다");
  expect(context.writes[0].textStart).toBe(text.length - tail.length); expect(context.writes[0].textEnd).toBe(text.length);
});
test("clipboard failure has an authorized selection fallback", async ({ page }) => {
  const context = await harness(page); await open(page); await select(page, "window light"); await save(page).click();
  await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(1);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await manual(page).getByRole("button", { name: "수동 발췌 원문 복사", exact: true }).click();
  await page.getByRole("button", { name: "수동 발췌 원문 선택", exact: true }).click();
  await expect(manual(page).getByRole("status")).toContainText("기기의 복사 기능");
  expect(context.reads.filter((url) => url.includes("/fragments/manual-1?"))).toHaveLength(2);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("window light");
});
test("pages beyond 50 manual fragments and keeps past snapshot selection read-only", async ({ page }) => {
  const context = await harness(page);
  const request: CreateManualLinkFragmentRequest = { expectedRevisionId: "revision-one", expectedSnapshotId: "snapshot-two", expectedManifestHash: "a".repeat(64), memberId: "member-prompt", textStart: 2, textEnd: 14, role: "prompt", idempotencyKey: "fixture" };
  const item = context.result(request); context.items = Array.from({ length: 55 }, (_, index) => ({ ...item, id: `listed-${index}`, fragmentKey: `key-${index}` }));
  await open(page); await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(20);
  await page.getByRole("button", { name: "이전 수동 발췌 더 보기" }).click(); await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(40);
  await page.getByRole("button", { name: "이전 수동 발췌 더 보기" }).click(); await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(55);
  await page.getByRole("combobox", { name: "자료 버전", exact: true }).selectOption("snapshot-one");
  await expect(save(page)).toBeDisabled(); await expect(manual(page).locator("[data-manual-fragment]")).toHaveCount(0);
  expect(context.writes).toHaveLength(0);
});
