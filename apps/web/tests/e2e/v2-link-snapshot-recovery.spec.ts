import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { LinkPresentationV1 } from "../../src/lib/v2/domain/link-presentation-v1";
import type { SnapshotRequest } from "../../src/lib/v2/editor/link-snapshot-draft";
import { snapshotReceiptFixture } from "./support/link-snapshot-receipt-fixture";

type Policy = { ownerId: string; recordId: string; currentVersion: number; privacyLevel: "normal" | "sensitive" | "restricted" };
async function harness(page: Page) {
  let state: LinkPresentationV1;
  let policy: Policy = { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 1, privacyLevel: "normal" };
  let policyStatus = 200;
  const mutations: Record<string, unknown>[] = [];
  let mutationHandler: ((route: Route) => Promise<void>) | null = null;
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/attachments/**", (route) => route.fulfill({ status: 404, body: "Synthetic missing image" }));
  await page.route("**/api/v2/records/link-analysis-fixture/recovery-policy", (route) => route.fulfill({ status: policyStatus,
    json: policyStatus === 200 ? { recoveryPolicy: policy, contentReadable: policy.privacyLevel !== "restricted" } : { error: { code: "synthetic_failure" } } }));
  await page.route("**/api/v2/records/link-analysis-fixture/links**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/snapshots")) {
      mutations.push(request.postDataJSON() as Record<string, unknown>);
      if (mutationHandler) return mutationHandler(route);
      return route.fulfill({ status: 201, json: await snapshotReceiptFixture(request.postDataJSON() as SnapshotRequest, state.availableSources) });
    }
    if (request.method() === "GET" && path.endsWith("/links")) return route.fulfill({ json: { links: state } });
    return route.fulfill({ status: 404, json: { error: { code: "synthetic_fixture_not_found" } } });
  });
  await page.goto("/v2-lab?surface=link-analysis");
  state = JSON.parse((await page.getByTestId("link-analysis-fixture-data").textContent())!) as LinkPresentationV1;
  return { mutations, get state() { return state; }, set state(value: LinkPresentationV1) { state = value; },
    set policy(value: Policy) { policy = value; }, set policyStatus(value: number) { policyStatus = value; },
    receipt(replayed = false) { return snapshotReceiptFixture(mutations.at(-1) as SnapshotRequest, state.availableSources, replayed); },
    onMutation(value: typeof mutationHandler) { mutationHandler = value; } };
}
function editor(page: Page) { return page.getByRole("region", { name: "자료 버전 편집", exact: true }); }
async function open(page: Page) {
  await page.getByRole("button", { name: "자료 추가·선택 변경", exact: true }).click();
  await expect(editor(page)).toBeVisible();
}
async function add(page: Page, text: string, url = "https://example.com/recovery") {
  await editor(page).getByRole("button", { name: "링크 자료 추가", exact: true }).click();
  await editor(page).getByLabel("출처 URL 1", { exact: true }).fill(url);
  await editor(page).getByLabel(/^출처 원문 1/).fill(text);
}
async function rows(page: Page): Promise<{ id: string; encrypted: boolean; value?: { payload: { additions: { value: string }[] } } }[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lighthouse_editor_working_copies_v1");
    request.onerror = () => reject(new Error("Synthetic test database read failed"));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("links")) { db.close(); resolve([]); return; }
      const read = db.transaction("links").objectStore("links").getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(new Error("Synthetic test rows read failed")); db.close(); };
    };
  }));
}
async function reload(page: Page) { await page.reload(); await open(page); }
async function restored(page: Page) {
  await editor(page).getByRole("button", { name: "이 초안 복구", exact: true }).first().click();
  await expect(editor(page).getByLabel(/^출처 원문 1/)).toBeVisible();
}

test("reload requires explicit restore and preserves unfinished URL/numbers, text and selection", async ({ page }, info) => {
  const context = await harness(page); await open(page);
  await editor(page).locator("fieldset").getByRole("checkbox").first().uncheck();
  await add(page, "  새 초안 🧭\n공백  보존  ", "https://unfinished ");
  await editor(page).getByText("작성자 · 조각 번호 · 시간 범위", { exact: false }).click();
  await editor(page).getByLabel("조각 번호 1", { exact: true }).fill("-");
  await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  await reload(page);
  await expect(editor(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(1);
  await expect(editor(page).getByLabel(/^출처 원문 1/)).toHaveCount(0);
  expect(context.mutations).toHaveLength(0);
  await restored(page);
  await expect(editor(page).getByLabel("출처 URL 1", { exact: true })).toHaveValue("https://unfinished ");
  await expect(editor(page).getByLabel(/^출처 원문 1/)).toHaveValue("  새 초안 🧭\n공백  보존  ");
  await expect(editor(page).locator("fieldset").getByRole("checkbox").first()).not.toBeChecked();
  await editor(page).getByText("작성자 · 조각 번호 · 시간 범위", { exact: false }).click();
  await expect(editor(page).getByLabel("조각 번호 1", { exact: true })).toHaveValue("-");
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toBeVisible(); expect(context.mutations).toHaveLength(0);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-link-snapshot-editor").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("snapshot-recovery-320.png"), fullPage: true });
  await editor(page).getByRole("complementary", { name: "자료 초안 기기 복구", exact: true }).screenshot({ path: info.outputPath("recovery-controls-320.png") });
});

test("lost response replays the exact persisted request against its original basis after reload", async ({ page }) => {
  const context = await harness(page); await open(page); await add(page, "  retained request\n  ");
  context.onMutation(async (route) => {
    if (context.mutations.length === 1) {
      const newer = { ...context.state.selectedSnapshot!, id: "snapshot-new", snapshotVersion: 3 };
      context.state = { ...context.state, currentSnapshotId: newer.id, currentSnapshotVersion: 3, selectedSnapshot: newer, snapshotHistory: { items: [newer, ...context.state.snapshotHistory.items], nextCursor: null } };
      return route.abort("failed");
    }
    return route.fulfill({ status: 200, json: await context.receipt(true) });
  });
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toBeVisible();
  await expect(editor(page).getByLabel(/^출처 원문 1/)).toBeDisabled();
  await page.reload(); await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page); await restored(page);
  expect(context.mutations).toHaveLength(1);
  await expect(editor(page)).toContainText("초안 기준 v2 · 서버 현재 v3");
  await expect(editor(page).getByRole("button", { name: "현재 자료 버전을 기준으로 편집 계속", exact: true })).toBeDisabled();
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(page.locator(".v2-link-message")).toContainText("새 자료 버전을 저장");
  expect(context.mutations).toHaveLength(2); expect(context.mutations[1]).toEqual(context.mutations[0]);
  await expect.poll(async () => (await rows(page)).length).toBe(0);
});

test("two tabs keep independent copies and saving one does not delete the other", async ({ page, context: browser }) => {
  await harness(page); await open(page); await add(page, "first tab"); await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  const second = await browser.newPage(); await harness(second); await open(second); await add(second, "second tab");
  await expect(editor(second)).toContainText("이 기기에 초안 저장됨");
  expect(await rows(second)).toHaveLength(2);
  await editor(second).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(second.locator(".v2-link-message")).toContainText("새 자료 버전을 저장");
  await expect.poll(async () => (await rows(second)).length).toBe(1);
  expect((await rows(second))[0].value?.payload.additions[0].value).toBe("first tab");
  await second.close();
});

test("sensitive drafts require per-screen consent and persist only encrypted data across reload", async ({ page }) => {
  const context = await harness(page); context.policy = { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 2, privacyLevel: "sensitive" };
  await open(page); await expect(editor(page)).toContainText("기기 복구 꺼짐"); await add(page, "sensitive synthetic only");
  expect(await rows(page)).toHaveLength(0);
  await editor(page).getByRole("checkbox", { name: "민감 초안을 이 기기에 암호화하여 복구하는 데 동의", exact: true }).check();
  await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  const stored = await rows(page); expect(stored).toHaveLength(1); expect(stored[0].encrypted).toBe(true); expect(stored[0].value).toBeUndefined();
  await reload(page); await expect(editor(page)).toContainText("기기 복구 꺼짐");
  await expect(editor(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(0);
  await editor(page).getByRole("checkbox", { name: "민감 초안을 이 기기에 암호화하여 복구하는 데 동의", exact: true }).check();
  await restored(page); await expect(editor(page).getByLabel(/^출처 원문 1/)).toHaveValue("sensitive synthetic only");
  expect(context.mutations).toHaveLength(0);
});

test("normal to restricted policy clears local draft and closes cached editing content", async ({ page }) => {
  const context = await harness(page); await open(page); await add(page, "must purge"); await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  context.policy = { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 2, privacyLevel: "restricted" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator(".v2-record-link-analysis")).toContainText("접근 권한이나 잠금 상태가 변경");
  expect(await rows(page)).toHaveLength(0); expect(context.mutations).toHaveLength(0);
});

test("an unauthenticated recovery check does not reveal or auto-submit existing drafts", async ({ page }) => {
  const context = await harness(page); await open(page); await add(page, "private old owner"); await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  context.policyStatus = 401; await page.reload(); await page.getByRole("button", { name: "자료 추가·선택 변경", exact: true }).click();
  await expect(editor(page)).toHaveCount(0); await expect(page.locator(".v2-record-link-analysis")).not.toContainText("private old owner");
  expect(context.mutations).toHaveLength(0); expect(await rows(page)).toHaveLength(1);
});

test("policy outage withholds recovery and preserves server-save choice without pretending local success", async ({ page }) => {
  const context = await harness(page); context.policyStatus = 503; await open(page); await add(page, "explicit fallback");
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("기기 복구 사본을 저장하지 못했습니다"); expect(context.mutations).toHaveLength(0);
  await editor(page).getByRole("checkbox", { name: "이 화면의 초안을 이 기기에 복구용으로 저장", exact: true }).uncheck();
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(page.locator(".v2-link-message")).toContainText("새 자료 버전을 저장"); expect(context.mutations).toHaveLength(1);
});

test("a privacy increase purges plaintext and new sensitive consent survives the old tombstone", async ({ page }) => {
  const context = await harness(page); await open(page); await add(page, "privacy transition draft"); await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  context.policy = { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 2, privacyLevel: "sensitive" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const consent = editor(page).getByRole("checkbox", { name: "민감 초안을 이 기기에 암호화하여 복구하는 데 동의", exact: true });
  await expect(consent).not.toBeChecked(); await expect.poll(async () => (await rows(page)).length).toBe(0);
  await consent.check(); await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  expect((await rows(page))[0].encrypted).toBe(true);
  await reload(page); await consent.check(); await restored(page);
  await expect(editor(page).getByLabel(/^출처 원문 1/)).toHaveValue("privacy transition draft");
});

test("revoking sensitive consent fences a late focus-triggered decryption result", async ({ page }) => {
  const context = await harness(page); context.policy = { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 2, privacyLevel: "sensitive" };
  await open(page); await add(page, "decryption race synthetic");
  const consent = editor(page).getByRole("checkbox", { name: "민감 초안을 이 기기에 암호화하여 복구하는 데 동의", exact: true });
  await consent.check(); await expect(editor(page)).toContainText("이 기기에 초안 저장됨"); await reload(page); await consent.check();
  await expect(editor(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(1);
  await page.evaluate(() => {
    const target = window as unknown as { decryptStarted: boolean; releaseDecrypt?: () => void };
    const original = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args: Parameters<SubtleCrypto["decrypt"]>) => {
      const result = await original(...args); target.decryptStarted = true;
      await new Promise<void>((resolve) => { target.releaseDecrypt = resolve; });
      return result;
    };
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { decryptStarted?: boolean }).decryptStarted)).toBe(true);
  await consent.uncheck(); await expect(editor(page)).toContainText("기기 복구 꺼짐");
  await page.evaluate(() => (window as unknown as { releaseDecrypt: () => void }).releaseDecrypt());
  await page.waitForTimeout(150);
  await expect(editor(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(0);
  expect(await rows(page)).toHaveLength(1); expect(context.mutations).toHaveLength(0);
});

test("opening a recovered copy preserves the different draft already entered on this screen", async ({ page }) => {
  await harness(page); await open(page); await add(page, "earlier recoverable draft"); await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  await reload(page); await add(page, "new screen draft"); await expect(editor(page)).toContainText("이 기기에 초안 저장됨");
  await restored(page); await expect(editor(page).getByLabel(/^출처 원문 1/)).toHaveValue("earlier recoverable draft");
  await expect.poll(async () => (await rows(page)).length).toBe(3);
  expect((await rows(page)).map((row) => row.value?.payload.additions[0].value)).toContain("new screen draft");
});

test("a malformed success response preserves pending and can only be retried with its original body", async ({ page }) => {
  const context = await harness(page); await open(page); await add(page, "never lose this draft");
  context.onMutation(async (route) => route.fulfill({ status: 200, json: context.mutations.length === 1 ? {} : await context.receipt(true) }));
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toBeVisible(); expect(await rows(page)).toHaveLength(1);
  await reload(page); await restored(page);
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(page.locator(".v2-link-message")).toContainText("새 자료 버전을 저장");
  expect(context.mutations).toHaveLength(2); expect(context.mutations[1]).toEqual(context.mutations[0]);
});

test("access loss while snapshot POST is pending cannot reopen content or announce late success", async ({ page }) => {
  const context = await harness(page); await open(page); await add(page, "pending access boundary");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  context.onMutation(async (route) => { await waiting; return route.fulfill({ status: 201, json: await context.receipt() }); });
  await editor(page).getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect.poll(() => context.mutations.length).toBe(1);
  context.policyStatus = 401; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor(page)).toHaveCount(0); release();
  await expect(page.locator(".v2-record-link-analysis")).toContainText("접근 권한이나 잠금 상태가 변경");
  await page.waitForTimeout(150);
  await expect(page.locator(".v2-link-message")).not.toContainText("새 자료 버전을 저장");
  expect(await rows(page)).toHaveLength(1);
});
