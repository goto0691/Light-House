import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import type { LinkPresentationV1, PresentedLinkSource } from "../../src/lib/v2/domain/link-presentation-v1";
import { linkSha256Hex } from "../../src/lib/v2/domain/link-snapshot-v1";
import { renderVideoAnalysisText } from "../../src/lib/v2/domain/video-analysis-source";
import { VIDEO_REVIEW_CONTRACT, videoReviewItems } from "../../src/lib/v2/domain/video-review-v1";
import { syntheticVideoNote } from "../../src/components/v2/lab/video-analysis-audit-fixture";

const endpoint = "**/api/v2/records/video-analysis-fixture/links";

async function open(page: import("@playwright/test").Page) {
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/records/video-analysis-fixture/recovery-policy", (route) => route.fulfill({ json: { recoveryPolicy: { ownerId: "link-owner", recordId: "video-analysis-fixture", currentVersion: 1, privacyLevel: "normal" }, contentReadable: true } }));
  const note = syntheticVideoNote(0, 600);
  const contentHash = `sha256:${await linkSha256Hex(renderVideoAnalysisText(note))}`;
  await page.route("**/api/v2/records/video-analysis-fixture/video-reviews/video-note", (route) => route.fulfill({ json: { reviews: {
    contract: VIDEO_REVIEW_CONTRACT, recordId: "video-analysis-fixture", sourceItemId: "video-note", contentHash,
    currentRevisionId: "revision-video", currentSnapshotId: "video-snapshot-1", currentSnapshotVersion: 1, canReview: true, items: videoReviewItems(note),
  } } }));
  await page.goto("/v2-lab?surface=video-analysis");
  return JSON.parse((await page.getByTestId("video-analysis-fixture-data").textContent())!) as LinkPresentationV1;
}

async function withNote(state: LinkPresentationV1, start: number, end: number): Promise<LinkPresentationV1> {
  const note = syntheticVideoNote(start, end), text = renderVideoAnalysisText(note), version = state.currentSnapshotVersion + 1;
  const member: PresentedLinkSource = { sourceItemId: `video-note-${start}`, memberId: `member-note-${start}`, memberKey: `note-${start}`, sourceOrder: state.members.length,
    kind: "transcript", rawText: text, contentHash: await linkSha256Hex(text), manualLink: null, videoAnalysis: note, attachments: [] };
  const snapshot = { ...state.selectedSnapshot!, id: `video-snapshot-${version}`, parentSnapshotId: state.currentSnapshotId, snapshotVersion: version,
    acquisitionMethod: "api" as const, adapterVersion: "gemini-youtube-video.v1", captureState: "partial" as const, coverage: { status: "partial" as const }, sourceCount: state.members.length + 1 };
  return { ...state, currentSnapshotId: snapshot.id, currentSnapshotVersion: version, selectedSnapshot: snapshot,
    members: [...state.members, member], availableSources: [...state.availableSources, member], snapshotHistory: { items: [snapshot, ...state.snapshotHistory.items], nextCursor: null } };
}

test("explicit clip analysis shows quota waits, then keeps timecoded notes and offers to continue", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  let state = await open(page);
  await page.route(`${endpoint}/video-analysis`, async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(input);
    if (requests.length === 1) return route.fulfill({ status: 429, json: { error: { code: "video_quota_exhausted", message: "AI 사용량 한도에 도달했습니다. 한도가 초기화된 뒤 다시 시도해 주세요. 영상 링크와 메모는 그대로 있습니다.", retryAt: "2026-09-29T07:05:00.000Z" } } });
    const start = typeof input.startSeconds === "number" ? input.startSeconds : 0;
    state = await withNote(state, start, typeof input.endSeconds === "number" ? input.endSeconds : start + 600);
    return route.fulfill({ status: 201, json: { links: state } });
  });
  await page.route(endpoint, (route) => route.fulfill({ status: 200, json: { links: state } }));

  await expect(page.getByText("공개 YouTube 영상만 AI로 분석합니다.", { exact: false })).toBeVisible();
  const analyze = page.getByRole("button", { name: "영상 1 AI 분석" });
  await analyze.click();
  await expect(page.getByRole("alert").filter({ hasText: "AI 사용량 한도에 도달했습니다" })).toContainText("다시 시도 가능");
  await expect(analyze).toBeEnabled();

  await page.getByLabel("시작", { exact: true }).fill("1:30");
  await page.getByLabel("끝", { exact: true }).fill("0:10");
  await analyze.click();
  await expect(page.getByRole("alert").filter({ hasText: "끝 시각은 시작보다 뒤" })).toBeVisible();
  expect(requests).toHaveLength(1);

  await page.getByLabel("끝", { exact: true }).fill("");
  await page.getByLabel("시작", { exact: true }).fill("");
  await analyze.click();
  await expect(page.getByRole("status").filter({ hasText: "AI 영상 분석 노트를 새 자료 버전으로 보관했습니다" })).toContainText("0:00–10:00 구간");
  await expect(page.getByText("분석한 구간: 0:00–10:00")).toBeVisible();
  await expect(page.getByText("AI 영상 분석 노트 1개(텍스트 정리 대상 아님)", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "이어서 10:00부터 분석" }).click();
  await expect(page.getByText("분석한 구간: 0:00–10:00, 10:00–20:00")).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(requests[0]).toMatchObject({ sourceItemId: "video-url", expectedRevisionId: "revision-video", expectedSnapshotId: "video-snapshot-1", expectedSnapshotVersion: 1, startSeconds: null, endSeconds: null });
  expect(requests[1]).toMatchObject({ startSeconds: null, endSeconds: null, expectedSnapshotVersion: 1 });
  expect(requests[2]).toMatchObject({ startSeconds: 600, endSeconds: 1200, expectedSnapshotId: "video-snapshot-2", expectedSnapshotVersion: 2 });
  // A retried gesture after a rejection reuses its idempotency key; a new clip uses a new one.
  expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey);
  expect(requests[2].idempotencyKey).not.toBe(requests[1].idempotencyKey);
});

test("a stored note is labelled as AI analysis with timecode links, no horizontal overflow and no axe violations", async ({ page }) => {
  const state = await open(page);
  await page.route(endpoint, (route) => route.fulfill({ status: 200, json: { links: state } }));
  const note = page.locator('[data-source-class="ai_video_note"]');
  await expect(note.getByRole("heading", { name: "AI 영상 분석 노트" })).toBeVisible();
  await expect(note.getByText("원본 영상은 보관하지 않았고 공식 자막을 읽은 것도 아닙니다", { exact: false })).toBeVisible();
  await expect(note.getByRole("heading", { name: /들린 발화/ })).toContainText("AI 전사 · 공식 자막 아님");
  const segmentLink = note.getByRole("link", { name: "0:01–0:12 시점 영상 열기 (새 창)" });
  await expect(segmentLink).toHaveAttribute("href", "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1s");
  await expect(segmentLink).toHaveAttribute("rel", "noreferrer");
  await expect(note.getByRole("link", { name: "영상 링크로" })).toHaveAttribute("href", "#source-video-url");
  await note.getByText("노트 전체 텍스트").click();
  await expect(note.getByLabel("AI 영상 분석 노트 2")).toContainText("[AI 영상 분석 · 원본 영상·공식 자막 아님] 0:00–10:00 구간");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).include(".v2-record-materials").include(".v2-video-requests").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
