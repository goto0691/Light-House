import { expect, test, type Page } from "@playwright/test";

async function harness(page: Page) {
  let policyStatus = 200;
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/records/session-audit-record/recovery-policy", (route) => route.fulfill({ status: policyStatus,
    json: policyStatus === 200 ? { recoveryPolicy: { ownerId: "session-audit-owner", recordId: "session-audit-record", currentVersion: 1, privacyLevel: "normal" }, contentReadable: true } : { error: { code: "synthetic_auth_denied" } } }));
  await page.goto("/v2-lab?surface=link-draft-session");
  await expect(page.getByRole("status")).toContainText("기기 복구 준비됨");
  return { deny() { policyStatus = 401; } };
}
async function rows(page: Page) {
  return page.evaluate(() => new Promise<{ id: string; value: { scopeKey: string; payload: { text: string; pending: unknown } } }[]>((resolve, reject) => {
    const open = indexedDB.open("lighthouse_editor_working_copies_v1", 3);
    open.onerror = () => reject(new Error("Synthetic DB open failed"));
    open.onsuccess = () => { const db = open.result; const request = db.transaction("links").objectStore("links").getAll();
      request.onerror = () => { db.close(); reject(new Error("Synthetic DB read failed")); };
      request.onsuccess = () => { db.close(); resolve(request.result); };
    };
  }));
}
async function entered(page: Page, text: string) {
  await page.getByLabel("합성 초안", { exact: true }).fill(text);
  await expect(page.getByRole("status")).toContainText("이 기기에 초안 저장됨");
}
async function delayParkTail(page: Page) {
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const state = window as unknown as { parkTailBlocked?: boolean; releaseParkTail?: () => void };
    let calls = 0;
    crypto.subtle.digest = async (...args: Parameters<SubtleCrypto["digest"]>) => {
      const output = await original(...args);
      // Existing single normal draft: park put hashes once; the following list hashes again.
      if (++calls === 2) { state.parkTailBlocked = true; await new Promise<void>((resolve) => { state.releaseParkTail = resolve; }); }
      return output;
    };
  });
}
async function blocked(page: Page) { await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { parkTailBlocked?: boolean }).parkTailBlocked))).toBe(true); }
async function release(page: Page) { await page.evaluate(() => (window as unknown as { releaseParkTail: () => void }).releaseParkTail()); }

test("multiple parked scopes survive reload; an old completion removes only its fixed request", async ({ page }) => {
  await harness(page); await entered(page, "scope-one-pending");
  await page.getByRole("button", { name: "합성 저장 요청 고정", exact: true }).click();
  await expect(page.getByTestId("pending-tokens")).toHaveText("고정 요청 1개");
  await page.getByRole("button", { name: "보존하고 다음 범위", exact: true }).click();
  await expect(page.getByTestId("active-scope")).toHaveText("편집 범위 2"); await entered(page, "scope-two-pending");
  await page.getByRole("button", { name: "합성 저장 요청 고정", exact: true }).click();
  await expect(page.getByTestId("pending-tokens")).toHaveText("고정 요청 2개");
  await page.getByRole("button", { name: "보존하고 다음 범위", exact: true }).click();
  await expect(page.getByTestId("active-scope")).toHaveText("편집 범위 3"); await entered(page, "scope-three-unsent");
  await expect.poll(async () => (await rows(page)).length).toBe(3);
  await page.getByRole("button", { name: "가장 오래된 합성 완료 통지", exact: true }).click();
  await expect(page.getByTestId("pending-tokens")).toHaveText("고정 요청 1개");
  const remaining = await rows(page);
  expect(remaining.map((row) => row.value.payload.text).sort()).toEqual(["scope-three-unsent", "scope-two-pending"]);
  await expect(page.getByLabel("합성 초안", { exact: true })).toHaveValue("scope-three-unsent");
  await page.reload(); await expect(page.getByTestId("other-drafts")).toHaveText("다른 초안 2개");
  await expect(page.getByLabel("합성 초안", { exact: true })).toHaveValue("");
  expect(await rows(page)).toEqual(remaining);
  expect((await rows(page)).find((row) => row.value.payload.text === "scope-two-pending")?.value.payload.pending).not.toBeNull();
});

test("new input while park refreshes the recovery list blocks a later scope overwrite", async ({ page }) => {
  await harness(page); await entered(page, "parked-a"); await delayParkTail(page);
  await page.getByRole("button", { name: "보존하고 다음 범위", exact: true }).click(); await blocked(page);
  await page.getByLabel("합성 초안", { exact: true }).fill("new-input-during-list");
  await release(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("입력 또는 보호 설정이 변경");
  await expect(page.getByTestId("active-scope")).toHaveText("편집 범위 1");
  await expect(page.getByLabel("합성 초안", { exact: true })).toHaveValue("new-input-during-list");
  await expect.poll(async () => (await rows(page)).map((row) => row.value.payload.text).sort()).toEqual(["new-input-during-list", "parked-a"]);
});

test("authentication loss while park reads its tail cannot open the next scope", async ({ page }) => {
  const context = await harness(page); await entered(page, "auth-boundary-draft"); await delayParkTail(page);
  await page.getByRole("button", { name: "보존하고 다음 범위", exact: true }).click(); await blocked(page);
  context.deny(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("인증 거절 · 합성 내용 숨김", { exact: true })).toBeVisible(); await release(page);
  // Hiding the input alone could pass even if the old park continued to stage scope 2.
  await expect(page.getByRole("main").getByRole("alert")).toContainText("입력 또는 보호 설정이 변경");
  await expect(page.getByTestId("active-scope")).toHaveText("편집 범위 1");
  await expect(page.getByLabel("합성 초안", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  expect((await rows(page))[0].value.payload.text).toBe("auth-boundary-draft");
});
