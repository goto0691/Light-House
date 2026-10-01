import type { LinkPresentationV1 } from "../../../src/lib/v2/domain/link-presentation-v1";
import { createLinkSourceFingerprint, hashLinkSourceManifest, linkSha256Hex, type LinkSnapshotMemberV1 } from "../../../src/lib/v2/domain/link-snapshot-v1";
import { normalizeManualLinkSource } from "../../../src/lib/v2/domain/manual-link-source";
import type { SnapshotRequest } from "../../../src/lib/v2/editor/link-snapshot-draft";

/** Synthetic HTTP receipt with real hashes, not evidence of a remote commit. */
export async function snapshotReceiptFixture(request: SnapshotRequest, available: LinkPresentationV1["availableSources"], replayed = false) {
  const snapshotId = `saved-${request.idempotencyKey}`;
  const originals = request.sourceItemIds.map((id) => {
    const source = available.find((item) => item.sourceItemId === id);
    if (!source) throw new Error("Synthetic receipt source missing");
    return { sourceItemId: id, kind: source.kind, rawText: source.rawText, metadata: source.manualLink ? { manualLinkV1: source.manualLink } : null, manualLink: source.manualLink, attachments: source.attachments };
  });
  const added = request.newManualSources.map((source, index) => {
    const manualLink = normalizeManualLinkSource(source.link);
    return { sourceItemId: `${snapshotId}-source-${index}`, kind: "url", rawText: source.rawText, metadata: { manualLinkV1: manualLink }, manualLink, attachments: [] };
  });
  const members: LinkSnapshotMemberV1[] = await Promise.all([...originals, ...added].map(async (source, index) => {
    const contentHash = source.rawText === null ? source.attachments[0].sha256 : `sha256:${await linkSha256Hex(source.rawText)}`;
    return { ...source, contentHash, sourceFingerprint: await createLinkSourceFingerprint({ ...source, contentHash }),
      id: `${snapshotId}-member-${index}`, snapshotId, memberKey: `member_${index}`, sourceOrder: index };
  }));
  return { snapshot: { documentRevisionId: request.expectedRevisionId, replayed, members,
    snapshot: { id: snapshotId, userId: "link-owner", documentId: "link-analysis-fixture", captureId: "synthetic-capture",
      parentSnapshotId: request.expectedSnapshotId, snapshotVersion: request.expectedSnapshotVersion + 1,
      manifestVersion: "link-source-manifest.v1", manifestHash: await hashLinkSourceManifest({ members }), acquisitionMethod: "user_paste", adapterVersion: "manual-link-snapshot.v1",
      captureState: members.some((member) => member.rawText?.trim() || member.attachments.length) ? "partial" : "link_only",
      coverage: { scope: "user_selected", selectedSources: members.length, pastedTexts: members.filter((member) => member.rawText?.trim()).length,
        attachmentSources: members.filter((member) => member.attachments.length).length, fullExternalScope: "unverified", analysis: "not_started" },
      createdAt: "2026-09-08T01:00:00.000Z" },
  } };
}
