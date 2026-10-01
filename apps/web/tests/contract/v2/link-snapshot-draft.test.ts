import { expect, test } from "vitest";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { parseSnapshotDraft, snapshotRequest, snapshotScope, type SnapshotDraft } from "@/lib/v2/editor/link-snapshot-draft";

function draft(): SnapshotDraft {
  return { contract: "link-snapshot-draft.v1", basis: { expectedRevisionId: "revision-a", expectedSnapshotId: "snapshot-a", expectedSnapshotVersion: 2 },
    selected: ["old-one", "image-two"], additions: [{ sourceId: "manual-one", order: 0, kind: "url", value: "  emoji 🧭\r\nkeep  spaces\r\n  ", metadata: makeManualLinkMetadata({ url: "https://example.com/source?utm_campaign=x", purpose: "prompt" }) }], pending: null };
}
test("lossless JSON roundtrip preserves exact original text, IDs, ordering and frozen basis", () => {
  const value = draft(); expect(parseSnapshotDraft(JSON.parse(JSON.stringify(value)))).toEqual(value);
  expect(snapshotScope(value.basis)).toBe('["revision-a","snapshot-a",2]');
});
test("unfinished URL, author whitespace and invalid numeric drafts are not normalized during recovery", () => {
  const value = draft(), item = value.additions[0];
  const unfinished = { ...value, additions: [{ ...item, metadata: { manualLinkV1: { ...(item.metadata!.manualLinkV1 as object), url: "https://unfinished ", publisher: "  author  ", partNumber: "-", endSeconds: "later" } } }] };
  expect(parseSnapshotDraft(unfinished)).toEqual(unfinished);
  expect(() => snapshotRequest(unfinished, "key")).toThrow();
});
test("pending is a complete request and is roundtripped without using a newer server basis", () => {
  const value = draft(), pending = snapshotRequest(value, "stable-retry-key");
  expect(parseSnapshotDraft(JSON.parse(JSON.stringify({ ...value, pending }))).pending).toEqual(pending);
  expect(pending).toMatchObject({ ...value.basis, idempotencyKey: "stable-retry-key", newManualSources: [{ rawText: value.additions[0].value }] });
});
test.each(["expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion", "sourceItemIds", "newManualSources"])("rejects a pending request retargeted independently of draft: %s", (field) => {
  const value = draft(), pending = { ...snapshotRequest(value, "key"), [field]: field === "expectedSnapshotVersion" ? 4 : field.endsWith("Ids") || field === "newManualSources" ? [] : "new-target" };
  expect(() => parseSnapshotDraft({ ...value, pending })).toThrow();
});
test.each(["other", "undefined", "array", "attachment", "huge", "duplicate", "wrong_contract", "negative_version"])("rejects unsafe or unsupported recovery payload: %s", (kind) => {
  const value = draft();
  const invalid = kind === "other" ? { ...value, execute: "ignored?" }
    : kind === "undefined" ? { ...value, pending: undefined }
      : kind === "array" ? [] : kind === "huge" ? { ...value, additions: [{ ...value.additions[0], value: "x".repeat(500_001) }] }
        : kind === "duplicate" ? { ...value, selected: ["same", "same"] }
          : kind === "wrong_contract" ? { ...value, contract: "capture-outbox.v1" }
            : kind === "negative_version" ? { ...value, basis: { ...value.basis, expectedSnapshotVersion: -1 } }
              : { ...value, additions: [{ ...value.additions[0], kind: "attachment" }] };
  expect(() => parseSnapshotDraft(invalid)).toThrow();
});
test("oversized server input can still be recovered without silent trimming", () => {
  const value = draft(), larger = { ...value, additions: [{ ...value.additions[0], value: "한".repeat(40_000) }] };
  expect(parseSnapshotDraft(larger).additions[0].value).toBe(larger.additions[0].value);
});
