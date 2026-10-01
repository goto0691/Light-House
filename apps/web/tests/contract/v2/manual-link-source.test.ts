import { describe, expect, test } from "vitest";

import { prepareCaptureCommit, type CaptureCommitRequest } from "@/lib/v2/domain/capture-source";
import { hasManualLinkSource, makeManualLinkMetadata, normalizeManualLinkSource, readManualLinkSource } from "@/lib/v2/domain/manual-link-source";

const original = "  portrait,  film grain\r\n--ar 3:2\n한글 원문 👀  ";
async function source(rawText = original, input: Record<string, unknown> = {}) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawText));
  return {
    kind: "url" as const, rawText,
    contentHash: `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    metadata: { manualLinkV1: { url: "https://www.threads.com/@maker/post/one?xmt=tracking", purpose: "prompt", role: "prompt", completeness: "partial", ...input } },
  };
}
function request(sources: CaptureCommitRequest["sources"]): CaptureCommitRequest {
  return { draftId: "manual-link-test", channel: "web", bodyMarkdown: "내 메모", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-09-08T00:00:00Z", sources };
}

describe("manual link source contract", () => {
  test("preserves exact prose and original URL while recomputing untrusted derived values", async () => {
    const item = await source(original, { provider: "youtube", canonicalUrl: "https://evil.invalid", fetched: true, publisherVerified: true });
    const prepared = await prepareCaptureCommit(request([item]), "one");
    const stored = prepared.sources[1];
    expect(stored.rawText).toBe(original);
    expect(stored.contentHash).toBe(item.contentHash);
    expect(JSON.parse(stored.metadataJson!)).toEqual(makeManualLinkMetadata({
      url: item.metadata.manualLinkV1.url, purpose: "prompt", role: "prompt", completeness: "partial",
    }));
    expect(readManualLinkSource(JSON.parse(stored.metadataJson!))).toMatchObject({
      provider: "threads", canonicalUrl: "https://www.threads.com/@maker/post/one", url: item.metadata.manualLinkV1.url,
    });
    expect(prepared.outboxId).toBeNull();
    expect(prepared.aiEnabled).toBe(false);
  });
  test.each([
    ["https://instagram.com/p/one?igsh=abc", "instagram"],
    ["https://youtu.be/abc?t=31&si=abc", "youtube"],
    ["https://m.youtube.com/watch?v=abc", "youtube"],
    ["https://threads.com.attacker.invalid/one", "web"],
  ])("identifies provider by exact host %s", (url, provider) => {
    expect(normalizeManualLinkSource({ url }).provider).toBe(provider);
  });
  test("retains media timestamp and non-tracking identity query", () => {
    expect(normalizeManualLinkSource({ url: "https://youtube.com/watch?v=abc&t=45&si=x&utm_source=y#part" }).canonicalUrl)
      .toBe("https://youtube.com/watch?v=abc&t=45#part");
  });
  test.each(["javascript:alert(1)", "data:text/html,test", "http://example.invalid/a", "https://user:secret@example.invalid/a", "no url", "https://example.invalid/" + "a".repeat(2048)])("rejects unsafe or invalid URL %s", (url) => {
    expect(() => normalizeManualLinkSource({ url })).toThrow();
  });
  test.each([
    { purpose: "execute" }, { role: "instruction" }, { completeness: "verified" },
    { contract: "manual-link-source.v9" }, { partNumber: 0 }, { totalParts: 1.5 },
    { partNumber: 3, totalParts: 2 }, { endSeconds: 5 }, { startSeconds: 5, endSeconds: 5 },
    { startSeconds: -1 }, { publisher: "x".repeat(201) },
  ])("rejects invalid metadata %j", (input) => {
    expect(() => normalizeManualLinkSource({ url: "https://example.invalid", ...input })).toThrow();
  });
  test("unknown metadata is not projected and malformed namespace is still recognized", () => {
    expect(readManualLinkSource({ arbitrary: "private" })).toBeNull();
    expect(readManualLinkSource({ manualLinkV1: null })).toBeNull();
    expect(hasManualLinkSource({ manualLinkV1: null })).toBe(true);
    expect(hasManualLinkSource([])).toBe(false);
  });
  test("does not send external author's content to the generic AI path", async () => {
    await expect(prepareCaptureCommit({ ...request([await source()]), aiEnabled: true }, "ai"))
      .rejects.toMatchObject({ code: "capture_source_invalid" });
  });
  test("rejects tampered original hash", async () => {
    const item = await source();
    await expect(prepareCaptureCommit(request([{ ...item, rawText: `${original} edited` }]), "hash"))
      .rejects.toMatchObject({ code: "capture_source_invalid" });
  });
  test("keeps link-only capture but never claims its contents were captured", async () => {
    const item = await source("", { completeness: "unknown" });
    const prepared = await prepareCaptureCommit({ ...request([item]), bodyMarkdown: "" }, "empty");
    expect(prepared.sources).toHaveLength(1);
    expect(prepared.sources[0].rawText).toBe("");
    await expect(prepareCaptureCommit(request([await source("", { completeness: "complete" })]), "false-complete"))
      .rejects.toMatchObject({ code: "capture_source_invalid" });
  });
  test("rejects metadata on an attachment or memo source", async () => {
    const item = await source();
    for (const bad of [{ ...item, kind: "text" as const }, { ...item, attachmentId: "image-id" }]) {
      await expect(prepareCaptureCommit(request([bad]), "bad-kind")).rejects.toMatchObject({ code: "capture_source_invalid" });
    }
  });
  test("enforces source count and UTF-8 text budget", async () => {
    const item = await source();
    await expect(prepareCaptureCommit(request(Array.from({ length: 21 }, () => item)), "count"))
      .rejects.toMatchObject({ code: "capture_source_invalid" });
    await expect(prepareCaptureCommit(request([await source("한".repeat(33334))]), "bytes"))
      .rejects.toMatchObject({ code: "capture_source_invalid" });
  });
  test("payload identity includes source URL, purpose, role, and exact whitespace", async () => {
    const baseline = await prepareCaptureCommit(request([await source()]), "id");
    for (const item of [await source(original, { url: "https://threads.com/@maker/post/two" }), await source(original, { purpose: "insight" }), await source(original, { role: "source" }), await source(original.trim())]) {
      const changed = await prepareCaptureCommit(request([item]), "id");
      expect(changed.payloadHash).not.toBe(baseline.payloadHash);
    }
    expect((await prepareCaptureCommit(request([await source()]), "id")).payloadHash).toBe(baseline.payloadHash);
  });
});
