import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "vitest";

import { IndexedDbCaptureStore } from "@/lib/v2/offline/indexeddb-capture-store";
import { parseShareTargetFormData } from "@/lib/v2/offline/share-target";

const stores: IndexedDbCaptureStore[] = [];

function makeStore() {
  const store = new IndexedDbCaptureStore(`lighthouse-test-${crypto.randomUUID()}`);
  stores.push(store);
  return store;
}

function checkpointInput(draftId: string, privacyLevel: "normal" | "sensitive" | "restricted" = "normal") {
  return {
    draftId,
    bodyMarkdown: "오프라인에서 남긴 운동 메모",
    captureChannel: "web" as const,
    privacyLevel,
    clientTimezone: "Asia/Seoul",
    localVersion: 1,
    attachments: [0, 1, 2].map((index) => ({
      localAttachmentId: `${draftId}:image:${index}`,
      blob: new Blob([`synthetic-image-${index}`], { type: "image/png" }),
      filename: `운동-${index + 1}.png`,
      sourceOrder: index + 1,
    })),
  };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.destroyForTest()));
});

describe("IndexedDB capture and share target", () => {
  test("recovers Korean text and three image Blobs after the database connection restarts", async () => {
    const store = makeStore();
    const input = checkpointInput("draft-restart");
    await expect(store.checkpoint(input)).resolves.toMatchObject({ persisted: true });
    store.close();

    expect(await store.getDraft("draft-restart")).toMatchObject({
      bodyMarkdown: "오프라인에서 남긴 운동 메모",
      attachmentIds: ["draft-restart:image:0", "draft-restart:image:1", "draft-restart:image:2"],
      state: "local_saved",
    });
    const attachments = await store.getDraftAttachments("draft-restart");
    expect(attachments).toHaveLength(3);
    expect(await attachments[1].blob.text()).toBe("synthetic-image-1");
  });

  test("keeps one current outbox operation when the same draft is checkpointed repeatedly", async () => {
    const store = makeStore();
    await store.checkpoint(checkpointInput("draft-idempotent"));
    await store.checkpoint({ ...checkpointInput("draft-idempotent"), bodyMarkdown: "두 번째 버전", localVersion: 2 });

    const outbox = await store.getOutboxForDraft("draft-idempotent");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ operationId: "commit:draft-idempotent:2", attempt: 0, serverReceipt: null });
  });

  test("purges all persistent payload when a draft becomes restricted", async () => {
    const store = makeStore();
    await store.checkpoint(checkpointInput("draft-private"));
    await expect(store.checkpoint(checkpointInput("draft-private", "restricted"))).resolves.toEqual({
      persisted: false,
      reason: "restricted",
    });

    expect(await store.getDraft("draft-private")).toBeUndefined();
    expect(await store.getDraftAttachments("draft-private")).toEqual([]);
    expect(await store.getOutboxForDraft("draft-private")).toEqual([]);
  });

  test("does not persist a sensitive draft without explicit device opt-in", async () => {
    const store = makeStore();
    await expect(store.checkpoint(checkpointInput("draft-sensitive", "sensitive"))).resolves.toEqual({
      persisted: false,
      reason: "sensitive_opt_in_required",
    });
    expect(await store.getDraft("draft-sensitive")).toBeUndefined();
  });

  test("purges source payload transactionally while retaining a content-free receipt", async () => {
    const store = makeStore();
    await store.checkpoint(checkpointInput("draft-committed"));
    const operation = (await store.getOutboxForDraft("draft-committed"))[0];
    await store.commitReceipt({
      draftId: "draft-committed",
      captureId: "capture-01",
      committedAt: "2026-08-12T08:00:00.000Z",
      processingStatusUrl: "/api/v2/captures/capture-01/status",
      attachmentVerification: "verified",
    }, operation);

    expect(await store.getDraft("draft-committed")).toBeUndefined();
    expect(await store.getDraftAttachments("draft-committed")).toEqual([]);
    expect(await store.getOutboxForDraft("draft-committed")).toEqual([]);
    expect(await store.getReceipt("draft-committed")).toMatchObject({ captureId: "capture-01" });
    expect(JSON.stringify(await store.getReceipt("draft-committed"))).not.toContain("운동 메모");
  });

  test("never evicts an unsent draft automatically and refuses a fifty-first local draft", async () => {
    const store = makeStore();
    for (let index = 0; index < 50; index += 1) {
      await store.checkpoint({ ...checkpointInput(`draft-limit-${index}`), attachments: [] });
    }
    await expect(store.checkpoint({ ...checkpointInput("draft-limit-50"), attachments: [] })).resolves.toEqual({ persisted: false, reason: "draft_limit" });
    await expect(store.listDrafts()).resolves.toHaveLength(50);
    await expect(store.getDraft("draft-limit-0")).resolves.toBeDefined();
  });

  test("converts a Web Share Target payload into deterministic title, text, URL, then file sources", () => {
    const formData = new FormData();
    formData.set("title", "인상 깊은 문장");
    formData.set("text", "이 문장을 나중에 다시 보고 싶다.");
    formData.set("url", "https://example.com/essay");
    formData.append("files", new File(["page-one"], "책-한줄.png", { type: "image/png" }));
    const checkpoint = parseShareTargetFormData(formData, {
      draftId: "shared-01",
      now: "2026-08-12T09:00:00.000Z",
      timezone: "Asia/Seoul",
    });

    expect(checkpoint.bodyMarkdown).toBe(
      "# 인상 깊은 문장\n\n이 문장을 나중에 다시 보고 싶다.\n\n<https://example.com/essay>",
    );
    expect(checkpoint.sourceItems?.map(({ kind, order }) => ({ kind, order }))).toEqual([
      { kind: "title", order: 0 },
      { kind: "text", order: 1 },
      { kind: "url", order: 2 },
      { kind: "attachment", order: 3 },
    ]);
    expect(checkpoint.attachments?.[0]).toMatchObject({ filename: "책-한줄.png", sourceOrder: 3 });
  });
});
