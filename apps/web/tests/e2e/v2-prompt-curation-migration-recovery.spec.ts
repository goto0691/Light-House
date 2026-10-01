import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { PromptCurationMigrationPlan } from "../../src/lib/v2/domain/prompt-curation-migration";
import type { MigratePromptCurationRequest } from "../../src/lib/v2/domain/prompt-curation-request";
import { migrationHarness } from "./support/prompt-curation-migration-harness";

// Actual React/IndexedDB/Chromium. HTTP, authorization and migration receipts
// are synthetic; server atomicity and remote provider behavior are not asserted.
type MigrationHarness = Awaited<ReturnType<typeof migrationHarness>>;
type PersistedMigration = { contract: "prompt-curation-migration-draft.v1"; phase: "review" | "pending";
  plan: PromptCurationMigrationPlan; request: MigratePromptCurationRequest };
type StoredRow = { id: string; generation: number; encrypted: boolean; value?: { kind: string; payload: PersistedMigration } };
const workspace = (page: Page) => page.getByRole("region", { name: "내 프롬프트 정리본", exact: true });
const panel = (page: Page) => page.getByRole("region", { name: "현재 자료로 가져오기 확인", exact: true });
const recovery = (page: Page) => workspace(page).getByRole("complementary", { name: "이관 초안 기기 복구", exact: true });
const button = (page: Page, name: string) => workspace(page).getByRole("button", { name, exact: true });
const preview = (page: Page) => button(page, "현재 자료로 가져오기 미리보기").click();
const confirmation = (page: Page) => panel(page).getByRole("checkbox");
const firstSave = (page: Page) => panel(page).getByRole("button", { name: "확인한 내용으로 새 정리본 저장", exact: true });
const retrySave = (page: Page) => panel(page).getByRole("button", { name: "같은 이관 요청 다시 시도", exact: true });
const parkedRestore = (page: Page) => recovery(page).getByRole("button", { name: "이 초안 복구", exact: true });
async function persisted(page: Page) { await expect(recovery(page).getByTestId("link-draft-recovery-status")).toContainText("이 기기에 초안 저장됨"); }
async function rows(page: Page): Promise<StoredRow[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lighthouse_editor_working_copies_v1");
    request.onerror = () => reject(new Error("Synthetic migration IDB open failed"));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("links")) { db.close(); resolve([]); return; }
      const read = db.transaction("links").objectStore("links").getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(new Error("Synthetic migration IDB read failed")); db.close(); };
    };
  }));
}
async function migrationRows(page: Page) { return (await rows(page)).filter((row) => row.value?.kind === "migration"); }
async function reloadOpen(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await button(page, "정리본 열기").click();
  await expect(recovery(page)).toBeVisible();
}
async function restore(page: Page, index = 0) {
  await parkedRestore(page).nth(index).click();
  await expect(panel(page)).toBeVisible();
  await expect(confirmation(page)).toBeVisible();
  await expect(confirmation(page)).not.toBeChecked();
}
function advanceTarget(m: MigrationHarness) {
  const old = m.h.state;
  const next = { ...old.selectedSnapshot!, id: "snapshot-after-migration", snapshotVersion: 4,
    parentSnapshotId: old.currentSnapshotId, manifestHash: "e".repeat(64) };
  m.h.state = { ...old, currentRevisionId: "revision-after-migration", currentSnapshotId: next.id,
    currentSnapshotVersion: next.snapshotVersion, selectedSnapshot: next,
    members: old.members.map((member) => ({ ...member, memberId: `${member.memberId}-later` })),
    snapshotHistory: { ...old.snapshotHistory, items: [next, ...old.snapshotHistory.items] } };
}
async function lostCommit(page: Page, m: MigrationHarness) {
  m.onWrite(async (route, body) => {
    await m.commit(body); await route.abort("failed"); m.onWrite(null); return true;
  });
  await confirmation(page).check(); await firstSave(page).click();
  await expect(workspace(page).getByRole("alert")).toBeVisible(); await persisted(page);
  expect(m.writes).toHaveLength(1); expect(m.h.rows).toHaveLength(2);
}

test("review reload keeps only the original plan and request, fetches exact evidence, and never uploads", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await confirmation(page).check(); await persisted(page);
  const before = (await migrationRows(page))[0].value!.payload;
  expect(Object.keys(before).sort()).toEqual(["contract", "phase", "plan", "request"]);
  expect(before.contract).toBe("prompt-curation-migration-draft.v1"); expect(before.phase).toBe("review");
  expect(before.request.expectedPlanHash).toBe(before.plan.planHash);
  const readCount = m.h.reads.length;
  await reloadOpen(page); await expect(panel(page)).toHaveCount(0);
  await expect(workspace(page).getByRole("article", { name: "정리본 상세", exact: true })).toHaveCount(0);
  await restore(page); await expect(firstSave(page)).toBeDisabled();
  expect(m.writes).toHaveLength(0); expect(m.reads).toBe(1);
  const exactReads = m.h.reads.slice(readCount).map((value) => new URL(value));
  expect(exactReads.some((url) => url.pathname.endsWith(`/curations/${m.source.groupKey}`) && url.searchParams.get("revisionId") === m.source.id)).toBe(true);
  expect(exactReads.some((url) => url.pathname.endsWith("/links") && url.searchParams.get("snapshotId") === before.plan.expectedSnapshotId)).toBe(true);
  expect(await panel(page).getByLabel("프롬프트 이관 원문 1", { exact: true }).textContent()).toBe(m.source.items[0].fragment.rawText);
  await persisted(page);
  expect((await migrationRows(page)).every((row) => JSON.stringify(row.value!.payload) === JSON.stringify(before))).toBe(true);
  await confirmation(page).check(); await firstSave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes[0]).toEqual(before.request); expect(m.h.rows).toHaveLength(2);
  await expect.poll(async () => (await migrationRows(page)).length).toBe(0);
});

test("a committed lost receipt survives reload and later snapshot/document without a new group or rewritten request", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await lostCommit(page, m);
  const pending = (await migrationRows(page))[0].value!.payload;
  expect(pending.phase).toBe("pending"); expect(pending.request).toEqual(m.writes[0]);
  const originalReceipt = structuredClone(m.h.rows[1].stored);
  advanceTarget(m); await reloadOpen(page); await restore(page);
  await expect(page.getByRole("combobox", { name: "자료 버전", exact: true })).toHaveValue("snapshot-after-migration");
  await expect(retrySave(page)).toBeDisabled(); expect(m.writes).toHaveLength(1);
  await confirmation(page).check(); await retrySave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes).toHaveLength(2); expect(m.writes[1]).toEqual(pending.request); expect(m.h.rows).toHaveLength(2);
  expect(m.h.rows[1].stored).toEqual(originalReceipt); expect(m.h.rows[0].stored).toEqual(m.source);
  await expect(button(page, `정리본 보기 · ${m.source.title}`)).toHaveCount(0);
  await expect.poll(async () => (await migrationRows(page)).length).toBe(0);
  await panel(page).getByRole("button", { name: "저장된 자료 버전 열기", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "자료 버전", exact: true })).toHaveValue(pending.plan.expectedSnapshotId);
});

test("an uncommitted stale pending stays recoverable after 409 and explicit new preview parks its old key", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page);
  m.onWrite(async (route) => { await m.h.error(route, 503, "synthetic_unavailable"); m.onWrite(null); return true; });
  await confirmation(page).check(); await firstSave(page).click();
  await expect(workspace(page).getByRole("alert")).toBeVisible(); await persisted(page);
  const pending = (await migrationRows(page))[0].value!.payload;
  m.h.state = { ...m.h.state, currentRevisionId: "revision-after-uncommitted" };
  await reloadOpen(page); await restore(page); await confirmation(page).check(); await retrySave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("자동으로 재이관하지 않습니다");
  await expect(confirmation(page)).not.toBeChecked();
  expect(m.writes).toHaveLength(2); expect(m.writes[1]).toEqual(pending.request); expect(m.h.rows).toHaveLength(1);
  await panel(page).getByRole("button", { name: "이관 미리보기 다시 확인", exact: true }).click();
  await expect(confirmation(page)).toBeEnabled(); await expect(confirmation(page)).not.toBeChecked();
  await persisted(page); expect(m.writes).toHaveLength(2);
  const payloads = (await migrationRows(page)).map((row) => row.value!.payload);
  expect(payloads.some((value) => value.phase === "pending" && JSON.stringify(value.request) === JSON.stringify(pending.request))).toBe(true);
  const review = payloads.find((value) => value.phase === "review")!;
  expect(review.request.idempotencyKey).not.toBe(pending.request.idempotencyKey);
  expect(review.request.groupKey).not.toBe(pending.request.groupKey);
  expect(review.request.expectedRevisionId).toBe("revision-after-uncommitted");
  await confirmation(page).check(); await firstSave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes[2]).toEqual(review.request); expect(m.h.rows).toHaveLength(2);
  await expect.poll(async () => [...new Set((await migrationRows(page)).map((row) => row.value!.payload.request.idempotencyKey))]).toEqual([pending.request.idempotencyKey]);
});

for (const denied of [401, 403, 423, 404]) test(`fresh source access denial ${denied} hides a restored migration before any POST`, async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page); await reloadOpen(page);
  m.h.onRead(async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith(`/curations/${m.source.groupKey}`) || url.searchParams.get("revisionId") !== m.source.id) return false;
    await m.h.error(route, denied, denied === 404 ? "link_record_not_found" : "record_access_denied"); return true;
  });
  await parkedRestore(page).first().click();
  await expect(workspace(page).getByRole("alert")).toContainText("접근 권한");
  await expect(panel(page)).toHaveCount(0); await expect(workspace(page).locator("pre")).toHaveCount(0);
  expect(m.writes).toHaveLength(0); expect(m.h.rows).toHaveLength(1);
});

for (const damage of ["missing_source", "source_raw", "target_manifest", "target_raw"] as const) test(`unavailable or tampered ${damage} evidence cannot enable save and can be explicitly checked again`, async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page); await reloadOpen(page);
  const original = m.h.rows[0].stored;
  if (damage === "source_raw") m.h.rows[0].stored = { ...original, items: original.items.map((item, index) => index ? item : { ...item, fragment: { ...item.fragment, rawText: "altered original" } }) };
  else m.h.onRead(async (route) => {
    const url = new URL(route.request().url());
    if (damage === "missing_source") {
      if (!url.pathname.endsWith(`/curations/${m.source.groupKey}`) || url.searchParams.get("revisionId") !== m.source.id) return false;
      await m.h.error(route, 404, "prompt_curation_not_found"); return true;
    }
    if (!url.pathname.endsWith("/links") || url.searchParams.get("snapshotId") !== "snapshot-three") return false;
    await m.h.json(route, { links: { ...m.h.state,
      ...(damage === "target_manifest" ? { selectedSnapshot: { ...m.h.state.selectedSnapshot!, manifestHash: "0".repeat(64) } }
        : { members: m.h.state.members.map((member, index) => index ? member : { ...member, rawText: `tampered${member.rawText}` }) }),
    } }); return true;
  });
  await parkedRestore(page).first().click();
  await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(firstSave(page)).toHaveCount(0); expect(m.writes).toHaveLength(0);
  await expect.poll(async () => (await migrationRows(page)).length).toBeGreaterThan(0);
  m.h.rows[0].stored = original; m.h.onRead(null);
  await button(page, "복구한 이관 원문 다시 확인").click();
  await expect(confirmation(page)).toBeVisible(); await expect(confirmation(page)).not.toBeChecked();
  expect(m.writes).toHaveLength(0);
});

test("a late fresh target response cannot reopen a migration after selecting a different snapshot", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page); await reloadOpen(page);
  let release!: () => void, finish!: () => void, held = false;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const delivered = new Promise<void>((resolve) => { finish = resolve; });
  m.h.onRead(async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/links") || url.searchParams.get("snapshotId") !== "snapshot-three") return false;
    held = true; await hold; await m.h.json(route, { links: m.h.state }).catch(() => {}); finish(); return true;
  });
  try {
    await parkedRestore(page).first().click(); await expect.poll(() => held).toBe(true);
    await page.getByRole("combobox", { name: "자료 버전", exact: true }).selectOption(m.source.snapshotId);
    await expect(page.getByRole("combobox", { name: "자료 버전", exact: true })).toHaveValue(m.source.snapshotId);
    release(); await delivered;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(panel(page)).toHaveCount(0); expect(m.writes).toHaveLength(0);
    expect((await migrationRows(page)).length).toBeGreaterThan(0);
  } finally { release(); }
});

for (const mode of ["after_unavailable", "before_hung_sibling"] as const) test(`migration evidence authorization is decisive ${mode}`, async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page); await reloadOpen(page);
  let release!: () => void, targetStarted!: () => void, sourceWaiting = false, targetWaiting = false, deny = false;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const targetReached = new Promise<void>((resolve) => { targetStarted = resolve; });
  m.h.onRead(async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/curations/${m.source.groupKey}`) && url.searchParams.get("revisionId") === m.source.id) {
      sourceWaiting = true;
      if (mode === "after_unavailable") await hold;
      else await targetReached;
      deny = true; await m.h.error(route, 423, "restricted_record_locked").catch(() => {}); return true;
    }
    if (!url.pathname.endsWith("/links") || url.searchParams.get("snapshotId") !== "snapshot-three") return false;
    targetWaiting = true; targetStarted();
    if (mode === "before_hung_sibling") await hold;
    await m.h.error(route, 503, "synthetic_unavailable").catch(() => {}); return true;
  });
  try {
    await parkedRestore(page).first().click();
    if (mode === "after_unavailable") {
      await expect.poll(() => sourceWaiting && targetWaiting).toBe(true);
      // The ordinary failure must not finish recovery while its sibling can
      // still revoke authorization. The original source stays hidden.
      await expect(panel(page)).toHaveCount(0); release();
    }
    await expect.poll(() => deny).toBe(true);
    await expect(workspace(page).getByRole("alert")).toContainText("접근 권한");
    await expect(panel(page)).toHaveCount(0); await expect(workspace(page).locator("pre")).toHaveCount(0);
    expect(m.writes).toHaveLength(0);
  } finally { release(); }
});

for (const sourceState of ["unavailable", "held"] as const) test(`redacted target immediately revokes migration access when exact source is ${sourceState}`, async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page); await reloadOpen(page);
  let release!: () => void, sourceReached = false, targetDelivered = false;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  m.h.onRead(async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/curations/${m.source.groupKey}`) && url.searchParams.get("revisionId") === m.source.id) {
      sourceReached = true;
      if (sourceState === "held") await hold;
      await m.h.error(route, 503, "synthetic_unavailable").catch(() => {}); return true;
    }
    if (!url.pathname.endsWith("/links") || url.searchParams.get("snapshotId") !== "snapshot-three") return false;
    await m.h.json(route, { links: { ...m.h.state, currentRevisionId: null, selectedSnapshot: null,
      members: [], fragments: [], availableSources: [], unavailableReason: "restricted_record_locked",
      capabilities: { ...m.h.state.capabilities, canCreateSnapshot: false, canCreateManualFragment: false,
        canAnalyze: false, canReview: false, reason: "restricted_record_locked" } } });
    targetDelivered = true; return true;
  });
  try {
    await parkedRestore(page).first().click(); await expect.poll(() => sourceReached && targetDelivered).toBe(true);
    // A successful HTTP response may carry a deliberately redacted body. That
    // body is authorization denial, not a normal result deferred behind 503/hang.
    await expect(workspace(page).getByRole("alert")).toContainText("접근 권한");
    await expect(panel(page)).toHaveCount(0); await expect(workspace(page).locator("pre")).toHaveCount(0);
    expect(m.writes).toHaveLength(0); expect(m.h.rows).toHaveLength(1);
  } finally { release(); }
});

for (const damage of ["group", "based_on", "raw", "image"] as const) test(`a damaged ${damage} replay receipt retains the original pending until an exact successful retry`, async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await lostCommit(page, m);
  const original = (await migrationRows(page))[0].value!.payload;
  advanceTarget(m); await reloadOpen(page); await restore(page);
  m.onWrite(async (route, body) => {
    const receipt = structuredClone(await m.commit(body));
    if (damage === "group") Object.assign(receipt.item, { groupKey: "foreign-migration-group" });
    else if (damage === "based_on") Object.assign(receipt.item, { basedOnRevisionId: "different-original-revision" });
    else if (damage === "raw") Object.assign(receipt.item.items[0].fragment, { rawText: "altered receipt text" });
    else Object.assign(receipt.item.examples[0], { sha256: "0".repeat(64) });
    await m.h.json(route, receipt); return true;
  });
  await confirmation(page).check(); await retrySave(page).click();
  await expect(workspace(page).getByRole("alert")).toBeVisible(); await persisted(page);
  await expect(panel(page).getByRole("button", { name: "저장된 자료 버전 열기", exact: true })).toHaveCount(0);
  const retained = await migrationRows(page); expect(retained.length).toBeGreaterThan(0);
  expect(retained.every((row) => JSON.stringify(row.value!.payload) === JSON.stringify(original))).toBe(true);
  expect(m.writes).toHaveLength(2); expect(m.writes[1]).toEqual(original.request); expect(m.h.rows).toHaveLength(2);
  m.onWrite(null); await confirmation(page).check(); await retrySave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes[2]).toEqual(original.request); expect(m.h.rows).toHaveLength(2);
  await expect.poll(async () => (await migrationRows(page)).length).toBe(0);
});

test("policy-only generation advancement while a receipt is held still cleans the exact confirmed migration", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  m.onWrite(async (route, body) => { const receipt = await m.commit(body); await hold; await m.h.json(route, receipt).catch(() => {}); return true; });
  try {
    await confirmation(page).check(); await firstSave(page).click(); await expect.poll(() => m.writes.length).toBe(1); await persisted(page);
    const before = (await migrationRows(page))[0];
    m.h.policy = { ...m.h.policy, currentVersion: 2 };
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await persisted(page);
    await expect.poll(async () => (await migrationRows(page))[0].generation).toBeGreaterThan(before.generation);
    release(); await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
    await expect.poll(async () => (await migrationRows(page)).length).toBe(0);
    await reloadOpen(page); await expect(parkedRestore(page)).toHaveCount(0); expect(m.writes).toHaveLength(1);
  } finally { release(); }
});

test("authorization revocation with device recovery disabled keeps migration hidden until explicit authenticated resume", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page);
  await recovery(page).getByRole("checkbox").uncheck(); await expect.poll(async () => (await rows(page)).length).toBe(0);
  m.h.onRead(async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/curations")) return false;
    await m.h.error(route, 423, "restricted_record_locked"); return true;
  });
  await button(page, "정리본 목록 새로고침").click();
  await expect(workspace(page).getByRole("alert")).toContainText("접근 권한"); await expect(panel(page)).toHaveCount(0);
  m.h.onRead(null); await button(page, "권한 확인하고 정리본 불러오기").click();
  await expect(button(page, "숨겨 둔 이관 초안 다시 열기")).toBeEnabled(); await expect(panel(page)).toHaveCount(0);
  await button(page, "숨겨 둔 이관 초안 다시 열기").click();
  await expect(confirmation(page)).toBeVisible(); await expect(confirmation(page)).not.toBeChecked();
  expect(m.writes).toHaveLength(0); expect(await rows(page)).toHaveLength(0);
});

test("two independently parked migrations retain distinct keys and saving one removes only its exact recovery copies", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page);
  const first = (await migrationRows(page))[0].value!.payload;
  await button(page, "이관 초안 보존하고 닫기").click(); await expect(panel(page)).toHaveCount(0);
  m.h.state = { ...m.h.state, currentRevisionId: "revision-next-plan" };
  await preview(page); await persisted(page);
  await button(page, "이관 초안 보존하고 닫기").click();
  await expect(parkedRestore(page)).toHaveCount(2);
  const requests = (await migrationRows(page)).map((row) => row.value!.payload.request);
  expect(new Set(requests.map((request) => request.idempotencyKey)).size).toBe(2);
  await reloadOpen(page); await expect(parkedRestore(page)).toHaveCount(2); await restore(page);
  // The most recently parked plan is the only current-CAS plan.
  await confirmation(page).check(); await firstSave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes).toHaveLength(1); expect(m.writes[0].expectedRevisionId).toBe("revision-next-plan");
  expect(m.writes[0].idempotencyKey).not.toBe(first.request.idempotencyKey);
  await expect.poll(async () => (await migrationRows(page)).map((row) => row.value!.payload.request.idempotencyKey)).toEqual([first.request.idempotencyKey]);
  await expect(parkedRestore(page)).toHaveCount(1);
});

test("opt-out keeps the visible plan in memory, rejects unsafe parking, and permits explicit server save", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await persisted(page);
  await recovery(page).getByRole("checkbox").uncheck(); await expect.poll(async () => (await rows(page)).length).toBe(0);
  await button(page, "이관 초안 보존하고 닫기").click();
  await expect(workspace(page).getByRole("alert")).toContainText("보존하지 못했습니다");
  await expect(panel(page)).toBeVisible(); expect(m.writes).toHaveLength(0);
  await confirmation(page).check(); await firstSave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes).toHaveLength(1); expect(await rows(page)).toHaveLength(0);
});

for (const privacy of ["sensitive", "restricted"] as const) test(`${privacy} migration recovery never stores plaintext or silently inherits consent`, async ({ page }) => {
  const m = await migrationHarness(page); m.h.policy = { ...m.h.policy, currentVersion: 2, privacyLevel: privacy };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(recovery(page)).toContainText(privacy === "sensitive" ? "민감 초안을 이 기기에 암호화" : "제한된 기록은 기기에 저장하지 않습니다");
  await preview(page); expect(await rows(page)).toHaveLength(0);
  if (privacy === "sensitive") {
    await expect(recovery(page).getByRole("checkbox")).not.toBeChecked();
    await recovery(page).getByRole("checkbox").check(); await persisted(page);
    const encrypted = await rows(page); expect(encrypted).toHaveLength(1); expect(encrypted[0].encrypted).toBe(true); expect(encrypted[0].value).toBeUndefined();
    await reloadOpen(page); await expect(parkedRestore(page)).toHaveCount(0);
    await recovery(page).getByRole("checkbox").check(); await restore(page);
  } else { await expect(recovery(page).getByRole("checkbox")).toHaveCount(0); }
  await confirmation(page).check(); await firstSave(page).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes).toHaveLength(1); expect(await rows(page)).toHaveLength(0);
});

test("a recovered migration at 320px supports keyboard confirmation, exact text and accessible layout", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const m = await migrationHarness(page); await preview(page); await persisted(page); await reloadOpen(page);
  await parkedRestore(page).first().focus(); await page.keyboard.press("Enter");
  await expect(confirmation(page)).not.toBeChecked(); await confirmation(page).focus(); await page.keyboard.press("Space");
  await expect(confirmation(page)).toBeChecked(); await page.keyboard.press("Tab"); await expect(firstSave(page)).toBeFocused();
  expect(await panel(page).getByLabel("프롬프트 이관 원문 1", { exact: true }).textContent()).toBe(m.source.items[0].fragment.rawText);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-prompt-curations").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await workspace(page).screenshot({ path: info.outputPath("migration-recovery-320.png"), scale: "css" });
  expect(m.writes).toHaveLength(0);
});
