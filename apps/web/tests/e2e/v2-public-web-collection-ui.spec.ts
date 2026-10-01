import { expect, test } from "@playwright/test";

import type { LinkPresentationV1, PresentedLinkSource } from "../../src/lib/v2/domain/link-presentation-v1";
import { linkSha256Hex } from "../../src/lib/v2/domain/link-snapshot-v1";

const endpoint = "**/api/v2/records/link-analysis-fixture/links";

test("a blocked public page keeps its URL and can be retried into an explicitly partial source", async ({ page }) => {
  let state: LinkPresentationV1;
  const requests: Record<string, unknown>[] = [];
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/records/link-analysis-fixture/recovery-policy", (route) => route.fulfill({ json: { recoveryPolicy: { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 1, privacyLevel: "normal" }, contentReadable: true } }));
  await page.route(`${endpoint}/collect`, async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(input);
    const previous = state.selectedSnapshot!;
    const version = previous.snapshotVersion + 1;
    const blocked = requests.length === 1;
    const fetchedText = "  공개 페이지의 합성 본문\r\n두 칸  유지  ";
    const fetched: PresentedLinkSource = {
      ...state.availableSources.find((source) => source.sourceItemId === "analysis-url")!,
      sourceItemId: `fetched-web-source-${version}`, memberId: `fetched-web-member-${version}`, memberKey: `fetched-web-${version}`, sourceOrder: state.members.length,
      rawText: fetchedText, contentHash: await linkSha256Hex(fetchedText),
      publicFetch: { contract: "public-fetch-source.v1", requestedSourceItemId: "analysis-url", requestedUrl: "https://example.com/synthetic-video", finalUrl: "https://example.com/synthetic-video", fetchedAt: "2026-09-23T00:00:00.000Z", contentType: "text/html", extractionVersion: "html_visible_text_v1" },
    };
    state = {
      ...state, currentSnapshotId: `web-snapshot-${version}`, currentSnapshotVersion: version,
      selectedSnapshot: { ...previous, id: `web-snapshot-${version}`, snapshotVersion: version, parentSnapshotId: previous.id,
        acquisitionMethod: "public_fetch", captureState: blocked ? "needs_input" : "partial", coverage: { status: blocked ? "needs_input" : "partial", reason: blocked ? "forbidden" : "html_visible_text_only" },
        sourceCount: blocked ? state.members.length : state.members.length + 1 },
      members: blocked ? state.members : [...state.members, fetched],
      availableSources: blocked ? state.availableSources : [...state.availableSources, fetched],
      selectedRun: null, publishedRun: null, latestAttempt: null, fragments: [],
    };
    await route.fulfill({ status: 200, json: { links: state } });
  });
  await page.route(endpoint, (route) => route.fulfill({ status: 200, json: { links: state } }));
  await page.goto("/v2-lab?surface=link-analysis");
  state = JSON.parse((await page.getByTestId("link-analysis-fixture-data").textContent())!) as LinkPresentationV1;
  const collect = page.getByRole("button", { name: "공개 웹 텍스트 1 수집" });
  await expect(collect).toBeEnabled();
  await collect.click();
  await expect(page.getByText("사이트가 공개 접근을 거부했습니다.", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("URL과 기존 원문은 유지됩니다.", { exact: false }).first()).toBeVisible();
  await expect(collect).toBeEnabled();
  await collect.click();
  await expect(page.getByText("표시 가능한 HTML 텍스트만 확보했습니다.", { exact: false }).first()).toBeVisible();
  const recollect = page.getByRole("button", { name: "공개 웹 텍스트 1 다시 수집" });
  await expect(recollect).toBeEnabled();
  await recollect.click();
  await expect(page.getByText("표시 가능한 HTML 텍스트만 확보했습니다.", { exact: false }).first()).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(requests[0]).toMatchObject({ sourceItemId: "analysis-url", expectedRevisionId: "revision-one", expectedSnapshotId: "snapshot-two", expectedSnapshotVersion: 2, idempotencyKey: expect.any(String) });
  expect(requests[1]).toMatchObject({ sourceItemId: "analysis-url", expectedRevisionId: "revision-one", expectedSnapshotId: "web-snapshot-3", expectedSnapshotVersion: 3, idempotencyKey: expect.any(String) });
  expect(requests[2]).toMatchObject({ sourceItemId: "analysis-url", expectedRevisionId: "revision-one", expectedSnapshotId: "web-snapshot-4", expectedSnapshotVersion: 4, idempotencyKey: expect.any(String) });
  expect(requests[0]!.idempotencyKey).not.toBe(requests[1]!.idempotencyKey);
  expect(requests[1]!.idempotencyKey).not.toBe(requests[2]!.idempotencyKey);
});

test("social links are kept for manual supplementation without an automatic collection action", async ({ page }) => {
  let state: LinkPresentationV1;
  const mutations: string[] = [];
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/records/link-analysis-fixture/recovery-policy", (route) => route.fulfill({ json: { recoveryPolicy: { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 1, privacyLevel: "normal" }, contentReadable: true } }));
  await page.route(`${endpoint}/collect`, (route) => { mutations.push(route.request().url()); return route.fulfill({ status: 500, body: "unexpected collection" }); });
  await page.route(endpoint, (route) => route.fulfill({ status: 200, json: { links: state } }));
  await page.goto("/v2-lab?surface=link-analysis");
  state = JSON.parse((await page.getByTestId("link-analysis-fixture-data").textContent())!) as LinkPresentationV1;
  const source = state.availableSources.find((item) => item.sourceItemId === "analysis-url")!;
  const social = { ...source, manualLink: { ...source.manualLink!, url: "https://www.threads.com/@fixture/post/one", canonicalUrl: "https://www.threads.com/@fixture/post/one", provider: "threads" as const } };
  state = { ...state, availableSources: state.availableSources.map((item) => item.sourceItemId === source.sourceItemId ? social : item),
    members: state.members.map((item) => item.sourceItemId === source.sourceItemId ? social : item) };
  await page.getByRole("button", { name: "상태 새로고침" }).click();
  await expect(page.getByText("Threads·Instagram은 현재 자동 수집을 지원하지 않습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /공개 웹 텍스트 .* 수집/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "자료 추가·선택 변경" })).toBeEnabled();
  expect(mutations).toHaveLength(0);
});
