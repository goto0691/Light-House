import { describe, expect, test } from "vitest";
import { syntheticVideoNote } from "@/components/v2/lab/video-analysis-audit-fixture";
import { parseVideoReviewRequest, renderReviewedVideoNote, videoReviewItems, videoReviewNoteFingerprint } from "@/lib/v2/domain/video-review-v1";

describe("stable user decisions on AI video notes", () => {
  test("identity survives source-ID remapping and property ordering but not text, timecode or analysis changes", async () => {
    const note = syntheticVideoNote(0, 600), hash = `sha256:${"a".repeat(64)}`;
    const expected = await videoReviewNoteFingerprint(note, hash);
    expect(await videoReviewNoteFingerprint({ ...note, requestedSourceItemId: "remapped" }, hash)).toBe(expected);
    expect(await videoReviewNoteFingerprint(Object.fromEntries(Object.entries(note).reverse()) as unknown as typeof note, hash)).toBe(expected);
    for (const changed of [{ ...note, analyzedAt: "2026-10-03T00:00:00.000Z" }, { ...note, summary: "changed" },
      { ...note, segments: [{ ...note.segments[0], startSeconds: 2 }] }, { ...note, speech: [{ ...note.speech[0], text: "changed" }] }]) {
      expect(await videoReviewNoteFingerprint(changed, hash)).not.toBe(expected);
    }
  });
  test("judgement-aware copy labels rejected and unreviewed items while preserving raw note verbatim", () => {
    const items = videoReviewItems(syntheticVideoNote(0, 600)).map((item) => item.kind === "speech" ? { ...item, status: "rejected" as const, stateVersion: 1 } : item);
    const raw = "  original AI note\r\nkept spacing  \n";
    const copied = renderReviewedVideoNote(raw, items);
    expect(copied).toContain("발화 1: 사용자 거절"); expect(copied).toContain("요약 1: 사용자 미확인");
    expect(copied).toContain("AI 정확성이나 외부 사실의 확정이 아닙니다"); expect(copied.endsWith(raw)).toBe(true);
  });
  test.each([{ restrictedUnlocked: true }, { correctedText: "altered" }, { expectedStateVersion: -1 }, { index: .5 }, { contentHash: "unverified" }, { kind: "raw_source" }])("rejects malformed or unsupported fields %j", (patch) => {
    expect(() => parseVideoReviewRequest({ kind: "summary", index: 0, action: "confirm", expectedStateVersion: 0,
      expectedRevisionId: "revision", expectedSnapshotId: "snapshot", expectedSnapshotVersion: 1, contentHash: `sha256:${"b".repeat(64)}`, idempotencyKey: "request", ...patch })).toThrow();
  });
});
