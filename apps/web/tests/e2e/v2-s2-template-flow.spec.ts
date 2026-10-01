import { expect, test } from "@playwright/test";

const versionId = "synthetic-generated-workout-v1";
const chosenTemplate = {
  id: "synthetic-generated-workout", name: "합성 운동 입력", description: "반복 구조에서 만든 선택적 입력 도움",
  iconKey: "type.template", status: "trial", currentVersionId: versionId, pinned: false,
  definition: {
    contractVersion: 1, name: "합성 운동 입력", expectedTypeIds: ["workout_log"],
    objectRoles: [{ role: "primary_document", optional: false }],
    sections: [{ key: "workout", label: "운동 구조", items: [
      { key: "distance_km", kind: "field", prompt: "거리는 몇 km였나요?", prominence: "suggested",
        binding: { ownerRole: "primary_document", fieldKey: "distance_km" }, inputKind: "number", allowedAiOperations: ["extract_from_capture"] },
      { key: "duration_min", kind: "field", prompt: "운동 시간은 몇 분이었나요?", prominence: "suggested",
        binding: { ownerRole: "primary_document", fieldKey: "duration_min" }, inputKind: "number", allowedAiOperations: ["extract_from_capture"] },
      { key: "user_rating", kind: "field", prompt: "지금 남아 있는 평점은 몇 점인가요?", prominence: "optional",
        binding: { ownerRole: "primary_document", fieldKey: "user_rating" }, inputKind: "rating", allowedAiOperations: ["none"] },
    ] }],
  },
};

test("a chosen generated template guides a new Capture on desktop and mobile without prefilled private values", async ({ page }) => {
  test.skip(process.env.FLAG_V2_WRITE !== "1", "Requires the explicitly writable local Capture harness.");
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v2/templates**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      templates: query.get("version") === versionId ? [chosenTemplate] : [],
    }) });
  });
  await page.route("**/api/v2/captures/commit", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      captureId: "synthetic-new-capture", recordId: "synthetic-new-record", revisionId: "synthetic-new-revision",
      attachmentCount: 0, committedAt: new Date().toISOString(), aiProcessing: "disabled", processingStatusUrl: "/unused",
    }) });
  });

  await page.goto("/v2/capture");
  const body = page.getByRole("textbox", { name: "기록 본문" });
  await expect(body).toBeFocused();
  await expect(body).toBeEmpty();
  await page.getByRole("button", { name: "도움받아 쓰기" }).click();
  await expect(page.getByText("사용할 수 있는 템플릿이 없습니다.")).toBeVisible();
  await expect(page.getByText("거리는 몇 km였나요?", { exact: true })).toHaveCount(0);

  await page.goto(`/v2/capture?template=${versionId}`);
  await expect(page.getByRole("heading", { name: "합성 운동 입력" })).toBeVisible();
  await expect(page.getByText("이번 기록에서 시험 사용 중")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "기록 본문" })).toBeEmpty();
  await expect(page.getByLabel("거리는 몇 km였나요?", { exact: true })).toBeEmpty();
  await expect(page.getByText(/PERSONAL_ORIGINAL_|합성 운동 1: 거리/)).toHaveCount(0);
  await page.getByLabel("거리는 몇 km였나요?", { exact: true }).fill("7");
  await page.getByRole("textbox", { name: "기록 본문" }).fill("새 기록에서 사용자가 직접 쓴 합성 본문");
  await page.getByRole("button", { name: "도움 패널 닫기" }).click();
  await page.getByRole("button", { name: "원본 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "원본 저장 완료" })).toBeVisible();
  expect(submitted).toEqual(expect.objectContaining({
    bodyMarkdown: "새 기록에서 사용자가 직접 쓴 합성 본문",
    template: expect.objectContaining({ templateVersionId: versionId,
      inputs: expect.arrayContaining([{ itemKey: "distance_km", valueKind: "number", value: 7, blankState: "answered",
        inputOrder: 0, clientTimestamp: expect.any(String) }]) }),
  }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
