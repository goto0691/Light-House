import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { curationHarness } from "./support/prompt-curation-harness";

const workspace = (page: Page) => page.getByRole("region", { name: "내 프롬프트 정리본", exact: true });
const button = (page: Page, name: string) => workspace(page).getByRole("button", { name, exact: true });
const title = (page: Page) => workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true });
const paths = ["AI save", "manual save", "list refresh", "latest manual"] as const;

for (const path of paths) for (const order of ["late denial", "denial before hung sibling"] as const) {
  test(`${path}: ${order} closes plaintext without POST`, async ({ page }) => {
    const h = await curationHarness(page), ai = h.state.fragments.find((row) => row.id === "prompt-one")!;
    h.state = { ...h.state, fragments: [
      { ...ai, rawTextHash: createHash("sha256").update(ai.rawText!).digest("hex") },
      { ...ai, id: "prompt-two", fragmentKey: "prompt-two", displayOrder: 1, rawTextHash: createHash("sha256").update(ai.rawText!).digest("hex") },
    ] };
    await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await button(page, "정리본 열기").click();
    await button(page, "새 정리본 만들기").click(); await title(page).fill("닫혀야 하는 입력");
    const ids = path === "AI save" ? ["prompt-one", "prompt-two"] : ["manual-1", "manual-2"];
    for (const id of ids) {
      await workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true }).selectOption(id); await button(page, "조각 추가").click();
    }
    if (path === "latest manual") {
      h.state = { ...h.state, currentRevisionId: "new-revision" }; h.manuals = [];
      await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await expect(button(page, "최신 상태 확인")).toBeVisible();
    }
    const routeIndex = (url: string) => {
      const pathname = new URL(url).pathname;
      if (path === "list refresh") return pathname.endsWith("/curations") ? 0 : pathname.endsWith("/fragments") ? 1 : -1;
      return ids.findIndex((id) => pathname.endsWith(`/fragments/${id}${path === "AI save" ? "/evidence" : ""}`));
    };
    let release!: () => void, calls = 0, firstDone = false;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    h.onRead(async (route) => {
      const index = routeIndex(route.request().url()); if (index < 0) return false; calls++;
      if (index === 0) {
        await h.error(route, order === "late denial" ? 503 : 423, order === "late denial" ? "link_snapshot_schema_unavailable" : "restricted_record_locked"); firstDone = true;
      } else {
        await hold; await h.error(route, 423, "restricted_record_locked").catch(() => {});
      }
      return true;
    });
    try {
      await button(page, path === "list refresh" ? "정리본 목록 새로고침" : path === "latest manual" ? "최신 상태 확인" : "정리본 저장").click();
      await expect.poll(() => firstDone && calls === 2).toBe(true);
      if (order === "late denial") release();
      await expect(workspace(page).getByRole("alert")).toContainText("접근 권한");
      await expect(title(page)).toHaveCount(0); await expect(workspace(page).locator("pre")).toHaveCount(0); expect(h.writes).toHaveLength(0);
    } finally { release(); }
  });
}
