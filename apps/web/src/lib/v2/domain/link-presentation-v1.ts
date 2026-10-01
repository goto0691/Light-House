import type { LinkSnapshotAttachmentV1, LinkSnapshotV1 } from "@/lib/v2/domain/link-snapshot-v1";
import type { ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import type { PublicFetchSourceV1 } from "@/lib/v2/domain/public-fetch-source";
import type { VideoAnalysisSourceV1 } from "@/lib/v2/domain/video-analysis-source";

export const LINK_PRESENTATION_CONTRACT = "link-presentation.v1" as const;
export const LINK_HISTORY_PAGE_SIZE = 20;

export type PresentedLinkSource = Readonly<{
  sourceItemId: string; memberId: string | null; memberKey: string | null; sourceOrder: number;
  kind: string; rawText: string | null; contentHash: string; manualLink: ManualLinkSourceV1 | null;
  publicFetch?: PublicFetchSourceV1 | null;
  /** Present only when a server video-analysis snapshot introduced this source. */
  videoAnalysis?: VideoAnalysisSourceV1 | null;
  attachments: readonly LinkSnapshotAttachmentV1[];
}>;
export type PresentedLinkSnapshot = Readonly<Pick<LinkSnapshotV1,
  "id" | "parentSnapshotId" | "snapshotVersion" | "manifestVersion" | "manifestHash" | "acquisitionMethod" | "adapterVersion" | "captureState" | "createdAt"
> & { sourceCount: number; coverage?: Readonly<{ status: LinkSnapshotV1["captureState"]; reason?: string }> }>;
export type PresentedLinkRun = Readonly<{
  id: string; jobId: string; snapshotId: string; documentRevisionId: string; status: string;
  createdAt: string; finishedAt: string | null; isPublished: boolean;
}>;
export type PresentedLinkAttempt = Readonly<{
  id: string; snapshotId: string; documentRevisionId: string; status: string; attempt: number;
  nextAttemptAt: string; lastErrorCode: string | null; createdAt: string; finishedAt: string | null; isCurrent: boolean;
}>;
export type PresentedLinkEvidence = Readonly<{
  id: string; memberId: string; memberKey: string; sourceItemId: string; relationKind: string; evidenceMethod: string;
  textStart: number | null; textEnd: number | null; quote: string | null; displayOrder: number;
}>;
export type LinkFragmentReviewStatus = "proposed" | "confirmed" | "rejected" | "superseded";
export type PresentedLinkFragment = Readonly<{
  id: string; fragmentKey: string; snapshotId: string; runId: string | null;
  role: "prompt" | "negative_prompt" | "parameters" | "quote" | "insight" | "visual_tip" | "transcript" | "caption";
  sourceClass: "source_extract" | "ai_interpretation" | "user_assertion";
  rawText: string | null; rawTextHash: string | null; derivedText: string | null;
  completeness: string; reviewStatus: LinkFragmentReviewStatus; lockedByUser: boolean; stateVersion: number;
  displayOrder: number; primaryMemberId: string; evidence: readonly PresentedLinkEvidence[];
}>;
export type LinkPresentationV1 = Readonly<{
  contract: typeof LINK_PRESENTATION_CONTRACT; schemaAvailable: boolean; recordId: string;
  unavailableReason?: string;
  currentRevisionId: string | null; currentSnapshotId: string | null; currentSnapshotVersion: number;
  selectedSnapshot: PresentedLinkSnapshot | null; members: readonly PresentedLinkSource[];
  availableSources: readonly PresentedLinkSource[];
  snapshotHistory: Readonly<{ items: readonly PresentedLinkSnapshot[]; nextCursor: string | null }>;
  selectedRun: PresentedLinkRun | null; publishedRun: PresentedLinkRun | null;
  runHistory: Readonly<{ items: readonly PresentedLinkRun[]; nextCursor: string | null }>;
  latestAttempt: PresentedLinkAttempt | null; fragments: readonly PresentedLinkFragment[]; isHistorical: boolean;
  capabilities: Readonly<{ canCreateSnapshot: boolean; canAnalyze: boolean; canReview: boolean; canCreateManualFragment?: boolean; reason: string | null }>;
}>;
export type LinkProjectionOptions = Readonly<{
  snapshotId?: string; runId?: string; snapshotCursor?: string; runCursor?: string;
  restrictedUnlocked?: boolean; writeEnabled?: boolean; aiEnabled?: boolean;
}>;
export type LinkFragmentReviewRequest = Readonly<{
  action: "confirm" | "reject"; expectedRevisionId: string; expectedSnapshotId: string; expectedRunId: string;
  expectedStateVersion: number; idempotencyKey: string;
}>;
export type LinkFragmentReviewReceipt = Readonly<{
  fragmentId: string; reviewStatus: LinkFragmentReviewStatus; stateVersion: number; replayed: boolean;
}>;

/** A derived-panel boundary failure must not remove the separately preserved original. */
export function unavailableLinkPresentation(recordId: string, reason: string, options: { schemaAvailable?: boolean } = {}): LinkPresentationV1 {
  return { contract: LINK_PRESENTATION_CONTRACT, recordId, schemaAvailable: options.schemaAvailable ?? true, unavailableReason: reason,
    currentRevisionId: null, currentSnapshotId: null, currentSnapshotVersion: 0, selectedSnapshot: null, members: [], availableSources: [],
    snapshotHistory: { items: [], nextCursor: null }, selectedRun: null, publishedRun: null, runHistory: { items: [], nextCursor: null },
    latestAttempt: null, fragments: [], isHistorical: false,
    capabilities: { canCreateSnapshot: false, canAnalyze: false, canReview: false, reason } };
}
