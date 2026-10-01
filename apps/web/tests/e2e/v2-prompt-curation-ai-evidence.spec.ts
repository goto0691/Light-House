import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { curationHarness } from "./support/prompt-curation-harness";

const workspace = (page: Page) => page.getByRole("region", { name: "내 프롬프트 정리본", exact: true });
const button = (page: Page, name: string) => workspace(page).getByRole("button", { name, exact: true });
const title = (page: Page) => workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true });
const recovery = (page: Page) => workspace(page).getByRole("complementary", { name: "정리본 초안 기기 복구", exact: true });
async function open(page: Page) { await button(page, "정리본 열기").click(); await expect(button(page, "새 정리본 만들기")).toBeEnabled(); }
async function setup(page: Page) {
  const h = await curationHarness(page);
  h.state = { ...h.state, fragments: h.state.fragments.map((row) => row.rawText === null ? row : { ...row, rawTextHash: createHash("sha256").update(row.rawText).digest("hex") }) };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page);
  await button(page, "새 정리본 만들기").click(); await title(page).fill("원래 AI 근거");
  await workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true }).selectOption("prompt-one"); await button(page, "조각 추가").click();
  return h;
}
const isEvidence = (url: string) => new URL(url).pathname.endsWith("/evidence");

for (const [status, code] of [[401, "unauthorized"], [403, "forbidden"], [423, "restricted_record_locked"], [404, "link_record_not_found"]] as const) {
  test(`exact AI evidence access denial closes plaintext and sends no POST: ${status}`, async ({ page }) => {
    const h = await setup(page);
    h.onRead(async (route) => { if (!isEvidence(route.request().url())) return false; await h.error(route, status, code); return true; });
    await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toContainText("접근 권한");
    await expect(title(page)).toHaveCount(0); await expect(workspace(page).locator("pre")).toHaveCount(0); expect(h.writes).toHaveLength(0);
  });
}

for (const failure of ["missing", "unavailable", "wrong-owner", "wrong-run", "wrong-range", "hash", "quote", "empty"] as const) {
  test(`exact AI evidence failure preserves pending before POST: ${failure}`, async ({ page }) => {
    const h = await setup(page);
    h.onRead(async (route) => {
      if (!isEvidence(route.request().url())) return false;
      if (failure === "missing" || failure === "unavailable") await h.error(route, failure === "missing" ? 404 : 503, failure === "missing" ? "link_fragment_not_found" : "link_snapshot_schema_unavailable");
      else {
        const value = structuredClone(h.aiEvidence.get("prompt-one")!);
        if (failure === "wrong-owner") await h.json(route, { ...value, recordId: "foreign" });
        if (failure === "wrong-run") await h.json(route, { ...value, run: { ...value.run, id: "foreign-run" } });
        if (failure === "wrong-range") await h.json(route, { ...value, fragment: { ...value.fragment, evidence: [{ ...value.fragment.evidence[0], textEnd: 999_999 }] } });
        if (failure === "hash") await h.json(route, { ...value, fragment: { ...value.fragment, rawTextHash: "0".repeat(64) } });
        if (failure === "quote") await h.json(route, { ...value, fragment: { ...value.fragment, evidence: [{ ...value.fragment.evidence[0], quote: "invented" }] } });
        if (failure === "empty") await h.json(route, {});
      }
      return true;
    });
    await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toBeVisible();
    await expect(title(page)).toHaveValue("원래 AI 근거"); await expect(button(page, "같은 요청 다시 시도")).toBeEnabled(); expect(h.writes).toHaveLength(0);
    // Explicit retry, after the endpoint is healthy, retains the original
    // pending request and is the only action that can issue the POST.
    h.onRead(null); await button(page, "같은 요청 다시 시도").click(); await expect(title(page)).toHaveCount(0);
    expect(h.writes).toHaveLength(1); expect(h.rows).toHaveLength(1);
  });
}

test("missing historical proof after lost commit stays pending and never guesses from matching text", async ({ page }) => {
  const h = await setup(page);
  h.onWrite(async (route, request) => { await h.commit(request); await route.abort("failed"); return true; });
  await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(recovery(page).getByTestId("link-draft-recovery-status")).toContainText("이 기기에 초안 저장됨");
  h.state = { ...h.state, fragments: [], selectedRun: { ...h.state.selectedRun!, id: "latest-analysis" } }; h.aiEvidence.delete("prompt-one");
  await page.reload(); await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page);
  await recovery(page).getByRole("button", { name: "이 초안 복구", exact: true }).click(); await expect(title(page)).toHaveValue("원래 AI 근거");
  expect(h.writes).toHaveLength(1); // Restore never sends automatically.
  await button(page, "같은 요청 다시 시도").click(); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(title(page)).toHaveValue("원래 AI 근거"); await expect(button(page, "같은 요청 다시 시도")).toBeEnabled(); expect(h.writes).toHaveLength(1); expect(h.rows).toHaveLength(1);
});

test("held old evidence cannot send a POST after document scope changes", async ({ page }) => {
  const h = await setup(page);
  let release!: () => void, arrived!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; }), entered = new Promise<void>((resolve) => { arrived = resolve; });
  h.onRead(async (route) => {
    if (!isEvidence(route.request().url())) return false;
    const value = structuredClone(h.aiEvidence.get("prompt-one")!); arrived(); await hold; await h.json(route, value).catch(() => {}); return true;
  });
  try {
    await button(page, "정리본 저장").click(); await entered;
    h.state = { ...h.state, currentRevisionId: "later-document-revision" };
    await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
    await expect(button(page, "초안 보존하고 편집 닫기")).toBeEnabled();
    await button(page, "초안 보존하고 편집 닫기").click(); await button(page, "새 정리본 만들기").click(); await title(page).fill("새 문서 입력");
    release(); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(title(page)).toHaveValue("새 문서 입력"); expect(h.writes).toHaveLength(0);
    await expect(recovery(page)).toContainText("저장 결과 미확인");
  } finally { release(); }
});

test("selected exact evidence is deduplicated and fetched in batches of at most four", async ({ page }) => {
  const h = await setup(page), original = h.state.fragments.find((row) => row.id === "prompt-one")!;
  const added = Array.from({ length: 4 }, (_, index) => ({ ...original, id: `prompt-extra-${index}`, fragmentKey: `extra-${index}`, displayOrder: index + 2 }));
  h.state = { ...h.state, fragments: [...h.state.fragments, ...added] };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  for (const id of ["prompt-one", ...added.map((row) => row.id)]) {
    await workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true }).selectOption(id); await button(page, "조각 추가").click();
  }
  let active = 0, peak = 0, calls = 0, release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  h.onRead(async (route) => {
    if (!isEvidence(route.request().url())) return false;
    calls++; peak = Math.max(peak, ++active); await hold;
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-2)!);
    await h.json(route, h.aiEvidence.get(id)); active--; return true;
  });
  try {
    await button(page, "정리본 저장").click(); await expect.poll(() => calls).toBe(4); expect(h.writes).toHaveLength(0);
    release(); await expect(title(page)).toHaveCount(0);
    expect(calls).toBe(5); expect(peak).toBe(4); expect(h.writes).toHaveLength(1);
    expect(h.rows[0].stored.content.items).toHaveLength(6);
  } finally { release(); }
});
