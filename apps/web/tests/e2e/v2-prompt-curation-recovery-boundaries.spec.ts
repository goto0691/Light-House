import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { curationHarness } from "./support/prompt-curation-harness";

const workspace = (page: Page) => page.getByRole("region", { name: "내 프롬프트 정리본", exact: true });
const button = (page: Page, name: string) => workspace(page).getByRole("button", { name, exact: true });
const title = (page: Page) => workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true });
const recovery = (page: Page) => workspace(page).getByRole("complementary", { name: "정리본 초안 기기 복구", exact: true });
async function open(page: Page) { await button(page, "정리본 열기").click(); await expect(button(page, "새 정리본 만들기")).toBeEnabled(); }
async function draft(page: Page, label = "원래 요청", fragmentId = "manual-1") {
  await button(page, "새 정리본 만들기").click(); await title(page).fill(label);
  await workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true }).selectOption(fragmentId); await button(page, "조각 추가").click();
}
async function persisted(page: Page) { await expect(recovery(page).getByTestId("link-draft-recovery-status")).toContainText("이 기기에 초안 저장됨"); }
async function restore(page: Page) { await recovery(page).getByRole("button", { name: "이 초안 복구", exact: true }).first().click(); await expect(workspace(page).getByRole("status")).toContainText("초안을 복구했습니다"); }
async function storedGenerations(page: Page): Promise<{ id: string; generation: number }[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lighthouse_editor_working_copies_v1"); request.onerror = () => reject(new Error("Synthetic IDB read failed"));
    request.onsuccess = () => { const db = request.result; const read = db.transaction("links").objectStore("links").getAll();
      read.onsuccess = () => { resolve(read.result.map((row) => ({ id: row.id, generation: row.generation }))); db.close(); };
      read.onerror = () => { reject(new Error("Synthetic IDB rows failed")); db.close(); }; };
  }));
}

for (const status of [423, 200]) test(`parent access revocation cancels debounce and unverified plaintext flush: ${status}`, async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "이미 저장한 사본"); await persisted(page);
  const before = await storedGenerations(page);
  // Hold only the draft debounce, not network/UI scheduling. This makes the
  // unmount cleanup write deterministic and independent of machine speed.
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => original(handler, timeout === 300 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });
  await title(page).fill("아직 기기에 쓰지 않은 입력");
  h.onRead(async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/links")) return false;
    if (status === 423) await h.error(route, 423, "restricted_record_locked");
    else await h.json(route, { links: { ...h.state, currentRevisionId: null, selectedSnapshot: null, members: [], fragments: [], availableSources: [],
      unavailableReason: "restricted_record_locked", capabilities: { ...h.state.capabilities, canCreateSnapshot: false, canCreateManualFragment: false, reason: "restricted_record_locked" } } });
    return true;
  });
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await expect(workspace(page)).toHaveCount(0);
  // Drain microtasks and IDB operations after the synchronous revocation. No
  // new policy GET is allowed to explain away an old-policy cleanup write.
  await expect.poll(() => storedGenerations(page)).toEqual(before);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await storedGenerations(page)).toEqual(before); expect(h.writes).toHaveLength(0);
});

test("a policy-only generation increase while a receipt is held does not resurrect a confirmed pending", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; });
  h.onWrite(async (route, request) => { const item = await h.commit(request); await hold; await h.json(route, { contract: "stored-prompt-curation.v1", item, replayed: false }).catch(() => {}); return true; });
  try {
    await button(page, "정리본 저장").click(); await expect.poll(() => h.writes.length).toBe(1); await persisted(page);
    const before = await storedGenerations(page); h.policy = { ...h.policy, currentVersion: 2 };
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await persisted(page);
    await expect.poll(async () => (await storedGenerations(page))[0].generation).toBeGreaterThan(before[0].generation);
    release(); await expect(title(page)).toHaveCount(0); await expect.poll(async () => (await storedGenerations(page)).length).toBe(0);
    await page.reload(); await open(page); await expect(recovery(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(0); expect(h.writes).toHaveLength(1);
  } finally { release(); }
});

test("missing-record link GET hides the pending source before any POST", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page); await persisted(page);
  h.onRead(async (route) => { if (!new URL(route.request().url()).pathname.endsWith("/links")) return false; await h.error(route, 404, "link_record_not_found"); return true; });
  await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toContainText("접근 권한");
  await expect(title(page)).toHaveCount(0); await expect(workspace(page).locator("pre")).toHaveCount(0); expect(h.writes).toHaveLength(0);
});

test("a held old response cannot clean an independently parked pending or a new group's input", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  let release!: () => void, finish!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; }), delivered = new Promise<void>((resolve) => { finish = resolve; });
  h.onWrite(async (route, request) => { const item = await h.commit(request); await hold; await h.json(route, { contract: "stored-prompt-curation.v1", item, replayed: false }).catch(() => {}); finish(); return true; });
  try {
    await button(page, "정리본 저장").click(); await expect.poll(() => h.writes.length).toBe(1); await persisted(page);
    h.state = { ...h.state, currentRevisionId: "revision-after-held" };
    await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await expect(button(page, "초안 보존하고 편집 닫기")).toBeEnabled();
    await button(page, "초안 보존하고 편집 닫기").click(); await draft(page, "새 그룹 입력"); await persisted(page);
    release(); await delivered;
    await expect(title(page)).toHaveValue("새 그룹 입력"); await expect(recovery(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(1);
    await expect(recovery(page)).toContainText("저장 결과 미확인"); expect(h.writes).toHaveLength(1);
  } finally { release(); }
});

test("a historical snapshot pending replay never inserts an old group into the current list", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  h.onWrite(async (route, request) => { if (h.writes.length !== 1) return false; await h.commit(request); await route.abort("failed"); return true; });
  await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toBeVisible(); await persisted(page);
  const next = { ...h.state.selectedSnapshot!, id: "snapshot-after-lost", snapshotVersion: 3, parentSnapshotId: h.state.currentSnapshotId, manifestHash: "d".repeat(64) };
  h.state = { ...h.state, currentRevisionId: "revision-after-snapshot", currentSnapshotId: next.id, currentSnapshotVersion: 3, selectedSnapshot: next,
    snapshotHistory: { ...h.state.snapshotHistory, items: [next, ...h.state.snapshotHistory.items] } };
  await page.reload(); await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page); await restore(page);
  await button(page, "같은 요청 다시 시도").click(); await expect(workspace(page).getByRole("status")).toContainText("이전 요청");
  await expect(title(page)).toHaveCount(0); await expect(button(page, "정리본 보기 · 원래 요청")).toHaveCount(0);
  expect(h.writes[1]).toEqual(h.writes[0]); expect(h.rows).toHaveLength(1);
});

test("replay of a prior successful revision loads the real latest head rather than presenting the old receipt as latest", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  h.onWrite(async (route, request) => { if (h.writes.length !== 1) return false; await h.commit(request); await route.abort("failed"); return true; });
  await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toBeVisible();
  const original = h.rows[0].stored;
  await h.commit({ expectedRevisionId: h.state.currentRevisionId!, expectedSnapshotId: original.snapshotId, expectedManifestHash: h.state.selectedSnapshot!.manifestHash,
    expectedCurationRevisionId: original.id, expectedCurationRevisionNumber: 1, action: "edit", idempotencyKey: "another-tab-edit", content: { ...original.content, title: "다른 창의 최신 버전" } }, original.groupKey);
  await button(page, "같은 요청 다시 시도").click(); await expect(button(page, "정리본 수정")).toBeEnabled(); await expect(title(page)).toHaveCount(0);
  await expect(workspace(page).getByRole("article", { name: "정리본 상세" })).toContainText("다른 창의 최신 버전");
  await button(page, "정리본 수정").click(); await title(page).fill("최신 head 뒤 편집"); await button(page, "새 버전으로 저장").click();
  await expect(button(page, "정리본 수정")).toBeEnabled(); expect(h.writes.at(-1)).toMatchObject({ expectedCurationRevisionId: h.rows[1].stored.id, expectedCurationRevisionNumber: 2 });
  expect(h.rows).toHaveLength(3);
});

for (const changed of [false, true]) test(`AI-selected source recovery resolves exact historical evidence after latest run changes: changed=${changed}`, async ({ page }) => {
  const h = await curationHarness(page);
  // The broad display fixture deliberately used a placeholder hash. This write
  // test supplies the real synthetic source hash; no validator is relaxed.
  h.state = { ...h.state, fragments: h.state.fragments.map((row) => row.rawText === null ? row : { ...row, rawTextHash: createHash("sha256").update(row.rawText).digest("hex") }) };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page); await draft(page, "AI 선택 원문", "prompt-one");
  h.onWrite(async (route, request) => { if (h.writes.length !== 1) return false; await h.commit(request); await route.abort("failed"); return true; });
  await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toBeVisible(); await persisted(page);
  if (changed) h.state = { ...h.state, fragments: [], selectedRun: { ...h.state.selectedRun!, id: "new-analysis-run" } };
  await page.reload(); await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page); await restore(page);
  await button(page, "같은 요청 다시 시도").click();
  await expect(button(page, "정리본 수정")).toBeEnabled(); await expect(title(page)).toHaveCount(0);
  const evidenceReads = h.reads.filter((value) => new URL(value).pathname.endsWith("/prompt-one/evidence")); expect(evidenceReads).toHaveLength(2);
  for (const value of evidenceReads) expect([...new URL(value).searchParams.entries()]).toEqual([
    ["snapshotId", h.writes[0].expectedSnapshotId], ["manifestHash", h.writes[0].expectedManifestHash],
  ]);
  expect(h.writes[1]).toEqual(h.writes[0]); expect(h.rows).toHaveLength(1);
});
