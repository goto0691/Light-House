import "fake-indexeddb/auto";
import { expect, test } from "vitest";

import { EditorWorkingCopyStore, type EditorWorkingCopy } from "@/lib/v2/editor/editor-working-copy";

/**
 * Originally reproduced RED: two store instances represent independent tabs.
 * No timers are needed: the stale write deliberately arrives after the other
 * instance has completed the authoritative restricted-record purge.
 */
test("a stale normal tab cannot resurrect plaintext after another tab purges the restricted record", async () => {
  const databaseName = `editor-cross-tab-privacy-red-${crypto.randomUUID()}`;
  const staleTab = new EditorWorkingCopyStore(databaseName);
  const privacyTab = new EditorWorkingCopyStore(databaseName);
  const normal: EditorWorkingCopy = {
    id: "synthetic-stale-tab", ownerId: "synthetic-owner", recordId: "synthetic-record",
    generation: 1, baseRevisionId: "synthetic-revision-1", baseVersion: 1,
    title: "Synthetic title", bodyMarkdown: "Synthetic original before privacy change",
    writtenAt: "2026-09-08T16:00", documentStatus: "draft", privacyLevel: "normal",
    updatedAt: "2026-09-08T07:00:00.000Z",
  };
  try {
    expect(await staleTab.put(normal)).toBe(true);
    await privacyTab.observeServerPolicy({ ownerId: normal.ownerId, recordId: normal.recordId, currentVersion: 2, privacyLevel: "restricted" });
    expect(await privacyTab.put({
      ...normal, id: "synthetic-privacy-tab", generation: 1,
      baseRevisionId: "synthetic-revision-2", baseVersion: 2, privacyLevel: "restricted",
      updatedAt: "2026-09-08T07:01:00.000Z",
    })).toBe(false);
    expect(await privacyTab.list(normal.ownerId, normal.recordId, true)).toEqual([]);

    // This tab still knows revision 1/normal, despite its newer local generation.
    const accepted = await staleTab.put({
      ...normal, generation: 2, bodyMarkdown: "Synthetic late plaintext after restricted purge",
      updatedAt: "2026-09-08T07:02:00.000Z",
    });
    const recovered = await privacyTab.list(normal.ownerId, normal.recordId, true);

    expect({ accepted, recovered }).toEqual({ accepted: false, recovered: [] });
  } finally {
    // Both connections must close before either deletion can finish.
    await Promise.all([staleTab.destroyForTest(), privacyTab.destroyForTest()]);
  }
});
