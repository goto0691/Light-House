import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { unavailableLinkPresentation, type LinkPresentationV1 } from "../../src/lib/v2/domain/link-presentation-v1";
import { curationHarness, recordId } from "./support/prompt-curation-harness";

type Harness = Awaited<ReturnType<typeof curationHarness>>;
type Operation = "snapshot" | "run" | "analyze" | "review";
type StoredGeneration = { id: string; generation: number; digest: string };
const endpoint = `/api/v2/records/${recordId}/links`;
const parent = (page: Page) => page.getByRole("region", { name: "링크 정리", exact: true });
const workspace = (page: Page) => parent(page).getByRole("region", { name: "내 프롬프트 정리본", exact: true });
const title = (page: Page) => workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true });
const recovery = (page: Page) => workspace(page).getByRole("complementary", { name: "정리본 초안 기기 복구", exact: true });
const historyButton = (page: Page, kind: "snapshot" | "run") => parent(page).getByRole("button", { name: kind === "snapshot" ? "이전 자료 버전 더 보기" : "이전 분석 실행 더 보기", exact: true });

/** Use actual page-size and scoped cursor shapes, not a cursor on a two-row page. */
function withHistory(state: LinkPresentationV1): LinkPresentationV1 {
  const snapshot = { ...state.selectedSnapshot!, snapshotVersion: 22, parentSnapshotId: "snapshot-history-21" };
  const snapshots = Array.from({ length: 20 }, (_, index) => index === 0 ? snapshot : {
    ...snapshot, id: `snapshot-history-${22 - index}`, snapshotVersion: 22 - index,
    parentSnapshotId: `snapshot-history-${21 - index}`, createdAt: new Date(Date.UTC(2026, 8, 8, 0, 0, 22 - index)).toISOString(),
  });
  const runs = Array.from({ length: 20 }, (_, index) => index === 0 ? state.selectedRun! : {
    ...state.selectedRun!, id: `run-history-${20 - index}`, jobId: `job-history-${20 - index}`, isPublished: false,
    createdAt: new Date(Date.parse(state.selectedRun!.createdAt) - index * 60_000).toISOString(),
    finishedAt: new Date(Date.parse(state.selectedRun!.createdAt) - index * 60_000 + 30_000).toISOString(),
  });
  return { ...state, currentSnapshotVersion: 22, selectedSnapshot: snapshot,
    snapshotHistory: { items: snapshots, nextCursor: encodeURIComponent(JSON.stringify(["snapshots", recordId, 3])) },
    runHistory: { items: runs, nextCursor: encodeURIComponent(JSON.stringify(["runs", snapshot.id, runs.at(-1)!.createdAt, runs.at(-1)!.id])) } };
}

function historyPage(state: LinkPresentationV1, kind: "snapshot" | "run"): LinkPresentationV1 {
  if (kind === "snapshot") return { ...state, snapshotHistory: { items: [2, 1].map((version) => ({ ...state.selectedSnapshot!,
    id: `snapshot-history-${version}`, snapshotVersion: version, parentSnapshotId: version === 1 ? null : "snapshot-history-1",
    createdAt: new Date(Date.UTC(2026, 8, 8, 0, 0, version)).toISOString() })), nextCursor: null } };
  return { ...state, runHistory: { items: [{ ...state.selectedRun!, id: "run-history-0", jobId: "job-history-0", isPublished: false,
    createdAt: new Date(Date.parse(state.selectedRun!.createdAt) - 20 * 60_000).toISOString(),
    finishedAt: new Date(Date.parse(state.selectedRun!.createdAt) - 20 * 60_000 + 30_000).toISOString() }], nextCursor: null } };
}

async function generations(page: Page): Promise<StoredGeneration[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lighthouse_editor_working_copies_v1");
    request.onerror = () => reject(new Error("Synthetic IndexedDB read failed"));
    request.onsuccess = () => { const db = request.result; const read = db.transaction("links").objectStore("links").getAll();
      read.onsuccess = () => { resolve(read.result.map((row) => ({ id: row.id, generation: row.generation, digest: row.digest })).sort((a, b) => a.id.localeCompare(b.id))); db.close(); };
      read.onerror = () => { reject(new Error("Synthetic link rows failed")); db.close(); }; };
  }));
}

async function prepare(page: Page) {
  const policyRequests: Request[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith(`/${recordId}/recovery-policy`)) policyRequests.push(request); });
  const h = await curationHarness(page); h.state = withHistory(h.state);
  await parent(page).getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(historyButton(page, "snapshot")).toBeEnabled(); await expect(historyButton(page, "run")).toBeEnabled();
  await workspace(page).getByRole("button", { name: "정리본 열기", exact: true }).click();
  await workspace(page).getByRole("button", { name: "새 정리본 만들기", exact: true }).click();
  await title(page).fill("기존에 보존한 제목");
  await workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true }).selectOption("manual-1");
  await workspace(page).getByRole("button", { name: "조각 추가", exact: true }).click();
  await expect(recovery(page).getByTestId("link-draft-recovery-status")).toContainText("이 기기에 초안 저장됨");
  const before = await generations(page); expect(before).toHaveLength(1);
  // Only debounce is held. Network, React effects, crypto and IDB remain real.
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => original(handler, delay === 300 ? 60_000 : delay, ...args)) as typeof window.setTimeout;
  });
  await title(page).fill("아직 기기에 저장하면 안 되는 새 제목");
  await expect(recovery(page).getByTestId("link-draft-recovery-status")).toContainText("기기 초안 저장 대기");
  return { h, before, policyRequests, policyCount: policyRequests.length };
}

function assertParentRequest(request: Request, operation: Operation, state: LinkPresentationV1) {
  const url = new URL(request.url());
  if (operation === "snapshot" || operation === "run") {
    expect(request.method()).toBe("GET"); expect(url.pathname).toBe(endpoint);
    expect([...url.searchParams.keys()].sort()).toEqual([`${operation}Cursor`, "snapshotId"].sort());
    expect(url.searchParams.get("snapshotId")).toBe(state.selectedSnapshot!.id);
    expect(url.searchParams.get(`${operation}Cursor`)).toBe(operation === "snapshot" ? state.snapshotHistory.nextCursor : state.runHistory.nextCursor);
  } else {
    expect(request.method()).toBe(operation === "analyze" ? "POST" : "PATCH");
    expect(url.pathname).toBe(operation === "analyze" ? `${endpoint}/analyze` : `${endpoint}/fragments/prompt-one`);
    const body = request.postDataJSON();
    expect(body).toMatchObject({ expectedRevisionId: state.currentRevisionId, expectedSnapshotId: state.selectedSnapshot!.id });
    expect(body.idempotencyKey).toEqual(expect.any(String)); expect(body.idempotencyKey.length).toBeGreaterThan(0);
    if (operation === "analyze") expect(body.expectedManifestHash).toBe(state.selectedSnapshot!.manifestHash);
    else expect(body).toMatchObject({ action: "confirm", expectedRunId: state.selectedRun!.id, expectedStateVersion: 1 });
  }
}

async function intercept(page: Page, h: Harness, operation: Operation, reply: (route: Route) => Promise<void>) {
  const requests: Request[] = [];
  const handle = async (route: Route) => { assertParentRequest(route.request(), operation, h.state); requests.push(route.request()); await reply(route); };
  if (operation === "snapshot" || operation === "run") h.onRead(async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== endpoint || !url.searchParams.has(`${operation}Cursor`)) return false;
    await handle(route); return true;
  });
  else await page.route(operation === "analyze" ? `**${endpoint}/analyze` : `**${endpoint}/fragments/prompt-one`, handle);
  return requests;
}

async function trigger(page: Page, operation: Operation) {
  if (operation === "snapshot" || operation === "run") await historyButton(page, operation).click();
  else if (operation === "analyze") await parent(page).getByRole("button", { name: "다시 AI로 정리", exact: true }).click();
  else await parent(page).locator("#link-fragment-prompt-one").getByRole("button", { name: "발췌 확인", exact: true }).click();
}

async function unchangedAfterEffects(page: Page, before: StoredGeneration[]) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await generations(page)).toEqual(before);
}
async function concealed(page: Page) {
  // RecordSourceMaterials below this parent is a separate static lab fixture;
  // these assertions cover all source/editor data owned by the actual parent.
  await expect(workspace(page)).toHaveCount(0);
  await expect(parent(page).locator(".v2-link-fragment")).toHaveCount(0);
  await expect(parent(page).locator("pre, textarea")).toHaveCount(0);
  await expect(parent(page).getByRole("combobox", { name: "자료 버전", exact: true })).toBeDisabled();
  await expect(parent(page).getByRole("combobox", { name: "분석 실행", exact: true })).toBeDisabled();
  await expect(parent(page).getByRole("button", { name: "자료 추가·선택 변경", exact: true })).toBeDisabled();
  await expect(parent(page).getByRole("alert")).toBeVisible();
}

for (const operation of ["snapshot", "run"] as const) for (const status of [200, 401, 403, 423]) {
  test(`${operation} history ${status} closes every parent-owned source/editor without advancing device copies`, async ({ page }) => {
    const { h, before, policyRequests, policyCount } = await prepare(page);
    const requests = await intercept(page, h, operation, async (route) => {
      if (status === 200) await h.json(route, { links: unavailableLinkPresentation(recordId, "restricted_record_locked") });
      else await h.error(route, status, "restricted_record_locked");
    });
    await trigger(page, operation); await concealed(page); expect(requests).toHaveLength(1);
    await unchangedAfterEffects(page, before); expect(policyRequests).toHaveLength(policyCount);
    expect(h.writes).toHaveLength(0); expect(h.manualWrites).toHaveLength(0);
  });
}

for (const operation of ["analyze", "review"] as const) for (const status of [401, 403, 423]) {
  test(`${operation} parent mutation ${status} cancels draft persistence and conceals cached sources`, async ({ page }) => {
    const { h, before, policyRequests, policyCount } = await prepare(page);
    const requests = await intercept(page, h, operation, (route) => h.error(route, status, "restricted_record_locked"));
    await trigger(page, operation); await concealed(page); expect(requests).toHaveLength(1);
    await unchangedAfterEffects(page, before); expect(policyRequests).toHaveLength(policyCount);
    expect(h.writes).toHaveLength(0); expect(h.manualWrites).toHaveLength(0);
  });
}

for (const operation of ["snapshot", "run", "analyze", "review"] as const) test(`authorized ${operation} preserves the independent unfinished curation`, async ({ page }) => {
  const { h, before } = await prepare(page);
  const requests = await intercept(page, h, operation, async (route) => {
    if (operation === "snapshot" || operation === "run") await h.json(route, { links: historyPage(h.state, operation) });
    else if (operation === "analyze") {
      h.state = { ...h.state, latestAttempt: { ...h.state.latestAttempt!, id: "authorized-analysis-job", status: "queued", finishedAt: null } };
      await h.json(route, { jobId: "authorized-analysis-job", status: "queued", replayed: false }, 202);
    } else {
      h.state = { ...h.state, fragments: h.state.fragments.map((row) => row.id === "prompt-one" ? { ...row, reviewStatus: "confirmed", stateVersion: 2 } : row) };
      await h.json(route, { fragmentId: "prompt-one", reviewStatus: "confirmed", stateVersion: 2, replayed: false });
    }
  });
  await trigger(page, operation); await expect.poll(() => requests.length).toBe(1);
  await expect(parent(page).getByRole("button", { name: "상태 새로고침", exact: true })).toBeEnabled();
  await expect(title(page)).toHaveValue("아직 기기에 저장하면 안 되는 새 제목");
  await expect(parent(page).locator("#link-fragment-prompt-one")).toBeVisible();
  if (operation === "snapshot" || operation === "run") await expect(historyButton(page, operation)).toHaveCount(0);
  else if (operation === "analyze") {
    await expect(parent(page).locator(".v2-link-status")).toContainText("예약 처리 대기");
    await expect(parent(page).locator(".v2-link-message")).toContainText("텍스트 정리를 요청했습니다");
  }
  else await expect(parent(page).locator("#link-fragment-prompt-one")).toContainText("사용자 확인됨");
  await unchangedAfterEffects(page, before); expect(h.writes).toHaveLength(0);
});

for (const kind of ["snapshot", "run"] as const) test(`late ${kind} history cannot repopulate controls after a child policy denial`, async ({ page }) => {
  const { h, before } = await prepare(page), oldPage = historyPage(h.state, kind);
  let release!: () => void, delivered!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; }), done = new Promise<void>((resolve) => { delivered = resolve; });
  const requests = await intercept(page, h, kind, async (route) => { await hold; await h.json(route, { links: oldPage }).catch(() => {}); delivered(); });
  let deniedPolicyRequests = 0;
  await page.route(`**/api/v2/records/${recordId}/recovery-policy`, async (route) => { deniedPolicyRequests += 1; await h.error(route, 401, "authentication_required"); });
  try {
    await trigger(page, kind); await expect.poll(() => requests.length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => deniedPolicyRequests).toBeGreaterThan(0); await concealed(page);
    release(); await done;
    await expect(parent(page).getByRole("button", { name: "상태 새로고침", exact: true })).toBeEnabled();
    await concealed(page);
    await expect(parent(page).getByRole("combobox", { name: "자료 버전", exact: true }).locator("option")).toHaveCount(1);
    await expect(parent(page).getByRole("combobox", { name: "분석 실행", exact: true }).locator("option")).toHaveCount(1);
    await unchangedAfterEffects(page, before); expect(h.writes).toHaveLength(0); expect(requests).toHaveLength(1);
  } finally { release(); }
});
