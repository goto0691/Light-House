import type { PresentedLinkFragment, PresentedLinkRun } from "./link-presentation-v1";

export const LINK_FRAGMENT_EVIDENCE_CONTRACT = "link-fragment-evidence.v1" as const;

/** Authenticated, exact-ID evidence. A stored draft is not authority for this response. */
export type LinkFragmentEvidenceV1 = Readonly<{
  contract: typeof LINK_FRAGMENT_EVIDENCE_CONTRACT;
  recordId: string;
  snapshotId: string;
  snapshotManifestHash: string;
  run: PresentedLinkRun;
  fragment: PresentedLinkFragment;
}>;
