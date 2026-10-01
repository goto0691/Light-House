import "fake-indexeddb/auto";

import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";

import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import {
  BrowserCaptureSyncTransport,
  syncDraft,
  type CaptureSyncTransport,
  type OfflineCommitReceipt,
} from "@/lib/v2/offline/capture-sync";
import { IndexedDbCaptureStore } from "@/lib/v2/offline/indexeddb-capture-store";
import { LOCAL_CAPTURE_DB_VERSION, type LocalDraftCheckpoint, type LocalSourceItem } from "@/lib/v2/offline/local-capture";
import { serializeLocalSourceItems } from "@/lib/v2/offline/serialize-source-items";

const stores: IndexedDbCaptureStore[] = [];
const originalText = "  빛을 옆에서 비추기\r\nsoft light, 🖼️\n\n--ar 3:2  ";
const metadata = makeManualLinkMetadata({
  url: "https://www.threads.com/@example/post/synthetic?xmt=tracking",
  purpose: "prompt",
  role: "prompt",
  completeness: "partial",
  publisher: "@example",
  partNumber: 2,
  totalParts: 3,
});

function makeStore() {
  const name = `lighthouse-manual-link-${crypto.randomUUID()}`;
  const store = new IndexedDbCaptureStore(name);
  stores.push(store);
  return { store, name };
}

function source(overrides: Partial<LocalSourceItem> = {}): LocalSourceItem {
  return { sourceId: "local-link-1", order: 2, kind: "url", value: originalText, metadata, ...overrides };
}

function checkpoint(draftId: string, privacyLevel: LocalDraftCheckpoint["privacyLevel"] = "normal"): LocalDraftCheckpoint {
  return {
    draftId,
    bodyMarkdown: "내가 다시 써보고 싶은 프롬프트",
    aiEnabled: false,
    captureChannel: "web",
    privacyLevel,
    sourceItems: [source()],
    clientTimezone: "Asia/Seoul",
    localVersion: 1,
    createdAt: "2026-09-08T01:00:00.000Z",
  };
}

function receipt(draftId: string): OfflineCommitReceipt {
  return {
    captureId: `capture-${draftId}`,
    recordId: `record-${draftId}`,
    revisionId: `revision-${draftId}`,
    attachmentCount: 1,
    committedAt: "2026-09-08T01:01:00.000Z",
    aiProcessing: "disabled",
    processingStatusUrl: `/api/v2/captures/capture-${draftId}/receipt`,
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(stores.splice(0).map((store) => store.destroyForTest()));
});

describe("manual link offline originals", () => {
  test("hashes exact original bytes and preserves typed metadata without local IDs", async () => {
    const result = await serializeLocalSourceItems([source()]);
    expect(result).toEqual([{
      kind: "url",
      rawText: originalText,
      contentHash: createHash("sha256").update(originalText, "utf8").digest("hex"),
      metadata,
    }]);
    expect(result[0]).not.toHaveProperty("sourceId");
    expect(result[0]).not.toHaveProperty("order");
    expect(result[0]).not.toHaveProperty("sourceOrder");
  });

  test("keeps link-only empty text distinct from the source URL", async () => {
    const [result] = await serializeLocalSourceItems([source({ value: "" })]);
    expect(result.rawText).toBe("");
    expect(result.contentHash).toBe(createHash("sha256").update("").digest("hex"));
    expect(result.metadata).toEqual(metadata);
  });

  test("preserves legacy shared URLs with no metadata", async () => {
    const value = "https://example.test/a?key=value#original";
    expect(await serializeLocalSourceItems([source({ value, metadata: undefined })])).toEqual([{
      kind: "url", rawText: value, contentHash: createHash("sha256").update(value).digest("hex"),
    }]);
  });

  test("merges originals and verified attachments in capture order without duplicating body sources", async () => {
    const result = await serializeLocalSourceItems([
      source({ sourceId: "last", order: 7, value: "last" }),
      source({ sourceId: "first", order: 1, value: "first" }),
      { sourceId: "body", order: 0, kind: "text", value: "body already in markdown" },
      { sourceId: "title", order: 0, kind: "title", value: "title already in markdown" },
      { sourceId: "file", order: 3, kind: "attachment", value: "local-file-id" },
    ], [{ sourceOrder: 3, kind: "image", contentHash: "a".repeat(64), attachmentId: "verified-file-id" }]);
    expect(result.map((item) => item.kind)).toEqual(["url", "image", "url"]);
    expect(result.map((item) => item.rawText ?? item.attachmentId)).toEqual(["first", "verified-file-id", "last"]);
    expect(result.every((item) => !Object.hasOwn(item, "sourceOrder"))).toBe(true);
  });

  test.each(["normal", "sensitive"] as const)("recovers exact %s original and metadata after database reopen", async (privacyLevel) => {
    const { store } = makeStore();
    const input = checkpoint(`reload-${privacyLevel}`, privacyLevel);
    await expect(store.checkpoint(input, { sensitiveOptIn: true })).resolves.toMatchObject({ persisted: true });
    store.close();
    expect(await store.getDraft(input.draftId)).toMatchObject({ sourceItems: [source()], aiEnabled: false });
    const snapshot = await store.getSyncSnapshot(input.draftId);
    expect(snapshot?.draft.sourceItems[0].value).toBe(originalText);
    expect(snapshot?.draft.sourceItems[0].metadata).toEqual(metadata);
  });

  test("sensitive source URL, author, and original text are only stored in the encrypted draft envelope", async () => {
    const { store, name } = makeStore();
    const input = checkpoint("encrypted-link", "sensitive");
    await store.checkpoint(input, { sensitiveOptIn: true });
    const request = indexedDB.open(name, LOCAL_CAPTURE_DB_VERSION);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(["drafts", "sensitive_drafts", "outbox"], "readonly");
      const read = (storeName: string) => new Promise<unknown[]>((resolve, reject) => {
        const result = transaction.objectStore(storeName).getAll();
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      });
      const [normal, encrypted, outbox] = await Promise.all([read("drafts"), read("sensitive_drafts"), read("outbox")]);
      expect(normal).toEqual([]);
      expect(encrypted).toHaveLength(1);
      const stored = JSON.stringify({ normal, encrypted, outbox });
      expect(stored).not.toContain("빛을 옆에서 비추기");
      expect(stored).not.toContain("threads.com");
      expect(stored).not.toContain("@example");
    } finally {
      database.close();
    }
  });

  test("metadata changes invalidate the local payload hash and idempotency key", async () => {
    const { store } = makeStore();
    const input = checkpoint("changed-link");
    await store.checkpoint(input);
    const [initial] = await store.getOutboxForDraft(input.draftId);
    await store.checkpoint({ ...input, localVersion: 2 });
    const [unchanged] = await store.getOutboxForDraft(input.draftId);
    expect(unchanged.payloadHash).toBe(initial.payloadHash);
    await store.checkpoint({ ...input, localVersion: 3, sourceItems: [source({ metadata: makeManualLinkMetadata({ ...metadata.manualLinkV1, completeness: "complete" }) })] });
    const [changed] = await store.getOutboxForDraft(input.draftId);
    expect(changed.payloadHash).not.toBe(initial.payloadHash);
    expect(changed.idempotencyKey).not.toBe(initial.idempotencyKey);
  });

  test("never persists restricted manual sources or sensitive sources without opt-in", async () => {
    const { store } = makeStore();
    for (const privacyLevel of ["restricted", "sensitive"] as const) {
      const input = checkpoint(`unpersisted-${privacyLevel}`, privacyLevel);
      expect(await store.checkpoint(input)).toMatchObject({ persisted: false });
      expect(await store.getDraft(input.draftId)).toBeUndefined();
      expect(await store.getOutboxForDraft(input.draftId)).toEqual([]);
    }
  });

  test("sync sends originals, metadata, and verified images in order and purges only after receipt", async () => {
    const { store } = makeStore();
    const input = { ...checkpoint("sync-link"), sourceItems: [source({ order: 0 }), source({ sourceId: "link-2", order: 2, value: "next part" })], attachments: [{
      localAttachmentId: "local-image", blob: new Blob(["image"], { type: "image/png" }), filename: "sample.png", sourceOrder: 1,
    }] };
    await store.checkpoint(input);
    const commits: Array<readonly Record<string, unknown>[]> = [];
    const transport: CaptureSyncTransport = {
      reserve: async () => ({ reservation: { id: "verified-image", expiresAt: "2026-09-08T02:00:00Z" }, upload: { url: "https://upload.invalid/image", method: "PUT", requiredHeaders: {} } }),
      upload: async () => {},
      verify: async () => {},
      commit: async (draft, sources) => {
        expect(draft.aiEnabled).toBe(false);
        expect(await store.getDraft(draft.draftId)).toBeDefined();
        commits.push(sources);
        return receipt(draft.draftId);
      },
    };
    expect(await syncDraft({ store, transport, draftId: input.draftId })).toMatchObject({ outcome: "committed", localChangesRetained: false });
    expect(commits).toHaveLength(1);
    expect(commits[0].map((item) => item.kind)).toEqual(["url", "image", "url"]);
    expect(commits[0][0]).toMatchObject({ rawText: originalText, metadata });
    expect(commits[0][1]).toMatchObject({ attachmentId: "verified-image" });
    expect(commits[0][2]).toMatchObject({ rawText: "next part", metadata });
    expect(await store.getDraft(input.draftId)).toBeUndefined();
    expect(JSON.stringify(await store.getReceipt(input.draftId))).not.toContain("manualLinkV1");
  });

  test("a metadata edit during commit keeps the newer local original for explicit resubmission", async () => {
    const { store } = makeStore();
    const input = checkpoint("link-cas");
    await store.checkpoint(input);
    const nextMetadata = makeManualLinkMetadata({ ...metadata.manualLinkV1, role: "negative_prompt" });
    const transport: CaptureSyncTransport = {
      reserve: async () => { throw new Error("No attachment expected."); },
      upload: async () => {},
      verify: async () => {},
      commit: async (draft, sources) => {
        expect(sources[0]).toMatchObject({ metadata });
        await store.checkpoint({ ...input, localVersion: 2, sourceItems: [source({ metadata: nextMetadata })] });
        return receipt(draft.draftId);
      },
    };
    expect(await syncDraft({ store, transport, draftId: input.draftId })).toMatchObject({ outcome: "committed", localChangesRetained: true });
    expect((await store.getDraft(input.draftId))?.sourceItems[0].metadata).toEqual(nextMetadata);
    expect(await store.listDueOutbox()).toEqual([]);
  });

  test("browser request body carries exact original metadata and manual AI-disabled state", async () => {
    const { store } = makeStore();
    await store.checkpoint(checkpoint("browser-link"));
    const snapshot = await store.getSyncSnapshot("browser-link");
    if (!snapshot) throw new Error("Missing draft snapshot.");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(receipt("browser-link")), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const sources = await serializeLocalSourceItems(snapshot.draft.sourceItems);
    await new BrowserCaptureSyncTransport().commit(snapshot.draft, sources, snapshot.operation.idempotencyKey);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v2/captures/commit");
    const body = JSON.parse(String(init.body));
    expect(body.aiEnabled).toBe(false);
    expect(body.sources[0]).toEqual({ kind: "url", rawText: originalText, contentHash: createHash("sha256").update(originalText).digest("hex"), metadata });
    expect(init.headers).toMatchObject({ "Idempotency-Key": snapshot.operation.idempotencyKey });
  });
});
