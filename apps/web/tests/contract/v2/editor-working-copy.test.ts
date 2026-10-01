import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import { EditorWorkingCopyStore, type EditorWorkingCopy } from "@/lib/v2/editor/editor-working-copy";

const stores: EditorWorkingCopyStore[] = [];
function makeStore() { const result = new EditorWorkingCopyStore(`editor-test-${crypto.randomUUID()}`); stores.push(result); return result; }
function copy(overrides: Partial<EditorWorkingCopy> = {}): EditorWorkingCopy {
  return { id: "tab-a", ownerId: "user-a", recordId: "record-a", generation: 1, baseRevisionId: "revision-1", baseVersion: 1, title: "제목", bodyMarkdown: "저장 전 편집 내용", writtenAt: "2026-09-08T14:00", documentStatus: "draft", privacyLevel: "normal", updatedAt: new Date().toISOString(), ...overrides };
}
afterEach(async () => { await Promise.all(stores.splice(0).map((store) => store.destroyForTest())); });
describe("editor working copy durability and privacy", () => {
  test("recovers the working body and base revision only for its owner and record", async () => {
    const store = makeStore();
    expect(await store.put(copy())).toBe(true);
    expect(await store.list("user-a", "record-a")).toMatchObject([{ bodyMarkdown: "저장 전 편집 내용", baseRevisionId: "revision-1" }]);
    expect(await store.list("user-b", "record-a")).toEqual([]);
    expect(await store.list("user-a", "record-b")).toEqual([]);
  });
  test("a late server acknowledgement cannot remove a newer local generation", async () => {
    const store = makeStore();
    await store.put(copy({ generation: 2, bodyMarkdown: "최신 변경" }));
    await store.put(copy({ generation: 1, bodyMarkdown: "늦은 이전 변경" }));
    await store.remove("tab-a", 1);
    expect((await store.list("user-a", "record-a"))[0].bodyMarkdown).toBe("최신 변경");
    await store.remove("tab-a", 2);
    expect(await store.list("user-a", "record-a")).toEqual([]);
  });
  test("sensitive working copies require opt-in and are hidden until opted-in recovery", async () => {
    const store = makeStore();
    expect(await store.put(copy({ privacyLevel: "sensitive" }))).toBe(false);
    expect(await store.put(copy({ privacyLevel: "sensitive" }), true)).toBe(true);
    expect(await store.list("user-a", "record-a")).toEqual([]);
    expect((await store.list("user-a", "record-a", true))[0].bodyMarkdown).toBe("저장 전 편집 내용");
    await store.removeUnprotected("user-a", "record-a");
    expect(await store.list("user-a", "record-a", true)).toHaveLength(1);
  });
  test("switching to restricted purges all earlier tab copies and never persists the restricted body", async () => {
    const store = makeStore();
    await store.put(copy());
    await store.put(copy({ id: "tab-b", privacyLevel: "sensitive" }), true);
    expect(await store.put(copy({ privacyLevel: "restricted" }), true)).toBe(false);
    expect(await store.list("user-a", "record-a", true)).toEqual([]);
  });
});
