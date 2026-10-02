import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { syntheticVideoNote } from "../../src/components/v2/lab/video-analysis-audit-fixture";
import { linkSha256Hex } from "../../src/lib/v2/domain/link-snapshot-v1";
import { renderVideoAnalysisText } from "../../src/lib/v2/domain/video-analysis-source";
import { VIDEO_REVIEW_CONTRACT, videoReviewItems, type VideoReviewProjection, type VideoReviewRequest } from "../../src/lib/v2/domain/video-review-v1";

const endpoint = "**/api/v2/records/video-analysis-fixture/video-reviews/video-note";

async function state(): Promise<VideoReviewProjection> {
  const note = syntheticVideoNote(0, 600);
  return { contract: VIDEO_REVIEW_CONTRACT, recordId: "video-analysis-fixture", sourceItemId: "video-note", contentHash: `sha256:${await linkSha256Hex(renderVideoAnalysisText(note))}`,
    currentRevisionId: "revision-video", currentSnapshotId: "video-snapshot-1", currentSnapshotVersion: 1, canReview: true, items: videoReviewItems(note) };
}
async function open(page: Page) {
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.fallback() : route.abort());
  await page.route("**/api/v2/records/video-analysis-fixture/recovery-policy", (route) => route.fulfill({ json: { recoveryPolicy: { ownerId: "link-owner", recordId: "video-analysis-fixture", currentVersion: 1, privacyLevel: "normal" }, contentReadable: true } }));
  await page.goto("/v2-lab?surface=video-analysis");
}

test("confirm and reject retain AI attribution, survive reload, and copy their user judgement with the raw note", async ({ page }, testInfo) => {
  let reviews = await state(); const requests: VideoReviewRequest[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { reviews } });
    const input = route.request().postDataJSON() as VideoReviewRequest; requests.push(input);
    const reviewedAt = "2026-10-03T00:00:00.000Z", itemKey = `${input.kind}:${input.index}`, status = input.action === "confirm" ? "confirmed" as const : "rejected" as const;
    reviews = { ...reviews, items: reviews.items.map((item) => item.itemKey === itemKey ? { ...item, status, stateVersion: input.expectedStateVersion + 1, reviewedAt } : item) };
    return route.fulfill({ status: 201, json: { receipt: { itemKey, status, stateVersion: input.expectedStateVersion + 1, reviewedAt, replayed: false }, reviews } });
  });
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } } }); });
  await open(page);
  const segment = page.getByRole("group", { name: "구간 1 사용자 판단" });
  await expect(segment).toContainText("사용자 미확인");
  await segment.getByRole("button", { name: "확인", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(segment).toContainText("사용자 확인");
  await segment.getByRole("button", { name: "거절", exact: true }).click();
  await expect(segment).toContainText("사용자 거절");
  expect(requests).toHaveLength(2); expect(requests[1].expectedStateVersion).toBe(1); expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
  await page.reload(); await expect(segment).toContainText("사용자 거절");
  const note = page.locator('[data-source-class="ai_video_note"]');
  await expect(note).toContainText("원본 영상은 보관하지 않았고 공식 자막을");
  await note.getByText("사용자 판단을 포함한 노트 복사", { exact: true }).click();
  await note.getByRole("button", { name: "사용자 판단 포함 복사", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain("구간 1: 사용자 거절");
  await note.getByText("노트 전체 텍스트", { exact: true }).click();
  await note.getByRole("button", { name: "원 AI 영상 분석 복사", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(renderVideoAnalysisText(syntheticVideoNote(0, 600)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page }).include(".v2-record-materials").analyze()).violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: `test-results/v2-video-review-${testInfo.project.name}.png`, fullPage: true });
});

test("lost response retries the same request, and CAS conflict requires a fresh read before another decision", async ({ page }) => {
  let reviews = await state(); const requests: VideoReviewRequest[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { reviews } });
    const input = route.request().postDataJSON() as VideoReviewRequest; requests.push(input);
    if (requests.length === 1) return route.abort("failed");
    if (requests.length === 3) { reviews = { ...reviews, items: reviews.items.map((item) => item.kind === "summary" ? { ...item, status: "rejected", stateVersion: 2, reviewedAt: "2026-10-03T00:00:01.000Z" } : item) }; return route.fulfill({ status: 409, json: { error: { code: "video_review_conflict" } } }); }
    const reviewedAt = "2026-10-03T00:00:00.000Z", itemKey = `${input.kind}:${input.index}`;
    reviews = { ...reviews, items: reviews.items.map((item) => item.itemKey === itemKey ? { ...item, status: "confirmed", stateVersion: 1, reviewedAt } : item) };
    return route.fulfill({ status: 200, json: { receipt: { itemKey, status: "confirmed", stateVersion: 1, reviewedAt, replayed: true }, reviews } });
  });
  await open(page);
  const summary = page.getByRole("group", { name: "요약 1 사용자 판단" });
  await summary.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장 결과를 확인하지 못했습니다" })).toBeVisible();
  await expect(summary.getByRole("button", { name: "거절", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "같은 판단 요청 재시도" }).click(); await expect(summary).toContainText("사용자 확인");
  expect(requests[1]).toEqual(requests[0]);
  await summary.getByRole("button", { name: "거절", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "다른 화면에서 기록이나 판단이 바뀌었습니다" })).toBeVisible();
  await expect(summary.getByRole("button", { name: "확인", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "최신 판단 다시 불러오기" }).click(); await expect(summary).toContainText("사용자 거절");
  await expect(summary.getByRole("button", { name: "확인", exact: true })).toBeEnabled();
});

test("a permission rejection hides note text and copy controls while retaining the generic access message", async ({ page }) => {
  const reviews = await state();
  await page.route(endpoint, (route) => route.request().method() === "GET" ? route.fulfill({ json: { reviews } }) : route.fulfill({ status: 423, json: { error: { code: "restricted_record_locked" } } }));
  await open(page);
  await page.getByRole("group", { name: "발화 1 사용자 판단" }).getByRole("button", { name: "확인", exact: true }).click();
  const note = page.locator('[data-source-class="ai_video_note"]');
  await expect(note.getByRole("status")).toContainText("다시 접근하려면 기록을 새로 열어 주세요");
  await expect(note.getByText("the cool thing about these guys", { exact: false })).toHaveCount(0);
  await expect(note.getByRole("button", { name: "원 AI 영상 분석 복사", exact: true })).toHaveCount(0);
});
