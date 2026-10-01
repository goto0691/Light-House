import { RecordLinkAnalysis } from "@/components/v2/record-link-analysis";
import { RecordSourceMaterials } from "@/components/v2/record-source-materials";
import type { LinkPresentationV1, PresentedLinkSnapshot } from "@/lib/v2/domain/link-presentation-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";

async function fixture(): Promise<LinkPresentationV1> {
  const text = "  window light, synthetic portrait\r\nkeep  double spaces\r\n  ";
  const snapshot: PresentedLinkSnapshot = { id: "snapshot-two", parentSnapshotId: "snapshot-one", snapshotVersion: 2, manifestVersion: "link-source-manifest.v1", manifestHash: "a".repeat(64), acquisitionMethod: "user_paste", adapterVersion: "synthetic.v1", captureState: "partial", createdAt: "2026-09-08T01:00:00.000Z", sourceCount: 3 };
  const members: LinkPresentationV1["members"] = [
    { sourceItemId: "analysis-prompt", memberId: "member-prompt", memberKey: "prompt", sourceOrder: 0, kind: "url", rawText: text, contentHash: await linkSha256Hex(text), manualLink: makeManualLinkMetadata({ url: "https://example.com/synthetic-prompt", purpose: "prompt", role: "prompt", completeness: "partial" }).manualLinkV1, attachments: [] },
    { sourceItemId: "analysis-url", memberId: "member-url", memberKey: "url", sourceOrder: 1, kind: "url", rawText: "", contentHash: await linkSha256Hex(""), manualLink: makeManualLinkMetadata({ url: "https://example.com/synthetic-video", purpose: "video_note" }).manualLinkV1, attachments: [] },
    { sourceItemId: "analysis-image", memberId: "member-image", memberKey: "image", sourceOrder: 2, kind: "image", rawText: null, contentHash: "synthetic-not-verified", manualLink: null, attachments: [{ id: "analysis-image-file", filename: "synthetic-reference.png", mimeType: "image/png", sizeBytes: 1, sha256: "b".repeat(64) }] },
  ];
  const run = { id: "run-two", jobId: "job-two", snapshotId: snapshot.id, documentRevisionId: "revision-one", status: "partial", createdAt: "2026-09-08T01:01:00.000Z", finishedAt: "2026-09-08T01:01:30.000Z", isPublished: true };
  const evidence = [{ id: "evidence-one", memberId: "member-prompt", memberKey: "prompt", sourceItemId: "analysis-prompt", relationKind: "supports", evidenceMethod: "ai_proposed", textStart: 0, textEnd: text.length, quote: text, displayOrder: 0 }];
  return {
    contract: "link-presentation.v1", schemaAvailable: true, recordId: "link-analysis-fixture", currentRevisionId: "revision-one", currentSnapshotId: snapshot.id, currentSnapshotVersion: 2,
    selectedSnapshot: snapshot, members, availableSources: members, snapshotHistory: { items: [snapshot, { ...snapshot, id: "snapshot-one", snapshotVersion: 1, parentSnapshotId: null }], nextCursor: null },
    selectedRun: run, publishedRun: run, runHistory: { items: [run, { ...run, id: "run-one", jobId: "job-one", isPublished: false }], nextCursor: null },
    latestAttempt: { id: "job-two", snapshotId: snapshot.id, documentRevisionId: "revision-one", status: "succeeded", attempt: 1, nextAttemptAt: "2026-09-08T01:00:00.000Z", lastErrorCode: null, createdAt: run.createdAt, finishedAt: run.finishedAt, isCurrent: true },
    isHistorical: false, capabilities: { canCreateSnapshot: true, canAnalyze: true, canReview: true, reason: null },
    fragments: [
      { id: "prompt-one", fragmentKey: "prompt-one", snapshotId: snapshot.id, runId: run.id, role: "prompt", sourceClass: "source_extract", rawText: text, rawTextHash: "c".repeat(64), derivedText: null, completeness: "truncated", reviewStatus: "proposed", lockedByUser: false, stateVersion: 1, displayOrder: 0, primaryMemberId: "member-prompt", evidence },
      { id: "insight-one", fragmentKey: "insight-one", snapshotId: snapshot.id, runId: run.id, role: "insight", sourceClass: "ai_interpretation", rawText: null, rawTextHash: null, derivedText: "합성 AI 해석: 창가의 부드러운 빛을 활용한 외부 글의 스타일.", completeness: "selection_unverified", reviewStatus: "proposed", lockedByUser: false, stateVersion: 1, displayOrder: 1, primaryMemberId: "member-prompt", evidence: [{ ...evidence[0], id: "evidence-two" }] },
    ],
  };
}

/** Real React UI with synthetic data. Tests replace only local API responses. */
export async function LinkAnalysisAuditFixture() {
  const initial = await fixture();
  return <main className="v2-product-shell"><article className="v2-product-card"><h1>링크 정리 · 실제 컴포넌트 검증</h1><p>합성 자료입니다. 외부 수집·실제 AI 호출·운영 저장을 검증한 화면이 아닙니다.</p>
    <pre data-testid="link-analysis-fixture-data" hidden>{JSON.stringify(initial)}</pre>
    <RecordLinkAnalysis initial={initial} recordId={initial.recordId} recoveryIdentity={{ ownerId: "link-owner", recordId: initial.recordId, currentVersion: 1, privacyLevel: "normal" }} />
    <RecordSourceMaterials analysisSummary="합성 외부 텍스트 정리 결과 · 첨부·영상은 미처리" sources={initial.members.map((member) => ({ id: member.sourceItemId, kind: member.kind, displayOrder: member.sourceOrder, rawText: member.rawText, contentHash: member.contentHash, manualLink: member.manualLink, attachmentId: member.attachments[0]?.id ?? null, filename: member.attachments[0]?.filename ?? null, mimeType: member.attachments[0]?.mimeType ?? null, sizeBytes: member.attachments[0]?.sizeBytes ?? null }))} />
  </article></main>;
}
