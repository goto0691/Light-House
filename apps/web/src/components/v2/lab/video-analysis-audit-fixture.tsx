import { RecordLinkAnalysis } from "@/components/v2/record-link-analysis";
import { RecordSourceMaterials } from "@/components/v2/record-source-materials";
import type { LinkPresentationV1, PresentedLinkSnapshot } from "@/lib/v2/domain/link-presentation-v1";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { renderVideoAnalysisText, VIDEO_ANALYSIS_SOURCE_CONTRACT, type VideoAnalysisSourceV1 } from "@/lib/v2/domain/video-analysis-source";

export const VIDEO_FIXTURE_URL = "https://youtu.be/jNQXAC9IVRw?si=synthetic";

/** Synthetic note; no provider produced it. */
export function syntheticVideoNote(start: number, end: number): VideoAnalysisSourceV1 {
  return {
    contract: VIDEO_ANALYSIS_SOURCE_CONTRACT, requestedSourceItemId: "video-url", requestedUrl: VIDEO_FIXTURE_URL,
    videoId: "jNQXAC9IVRw", videoUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    requestedStartSeconds: start, requestedEndSeconds: end, observedEndSeconds: Math.min(end, start + 19), timecodeBasis: "absolute",
    analyzedAt: "2026-09-28T09:00:00.000Z", modelId: "synthetic-video-model", promptVersion: "youtube-video-analysis-timecoded.v1",
    method: "gemini_youtube_url", originalVideoStored: false, captionsAcquired: false,
    summary: "합성 영상 노트: 동물원 우리 앞에서 한 사람이 코끼리를 소개합니다.",
    segments: [{ startSeconds: start + 1, endSeconds: start + 12, title: "코끼리 앞 소개", summary: "화면 중앙의 인물이 뒤쪽 코끼리를 가리킨다." }],
    speech: [{ startSeconds: start + 2, endSeconds: start + 6, speaker: "화자 1", text: "the cool thing about these guys" }],
    screenText: [{ startSeconds: start + 8, endSeconds: start + 8, text: "--ar 16:9 synthetic overlay" }],
    limitations: ["배경 소음 때문에 일부 발화가 불분명합니다."],
  };
}

async function fixture(): Promise<{ links: LinkPresentationV1; noteText: string; note: VideoAnalysisSourceV1 }> {
  const note = syntheticVideoNote(0, 600);
  const noteText = renderVideoAnalysisText(note);
  const snapshot: PresentedLinkSnapshot = { id: "video-snapshot-1", parentSnapshotId: null, snapshotVersion: 1, manifestVersion: "link-source-manifest.v1",
    manifestHash: "d".repeat(64), acquisitionMethod: "user_paste", adapterVersion: "manual-link-snapshot.v1", captureState: "link_only", createdAt: "2026-09-28T08:00:00.000Z", sourceCount: 1 };
  const members: LinkPresentationV1["members"] = [{ sourceItemId: "video-url", memberId: "member-video-url", memberKey: "video", sourceOrder: 0, kind: "url", rawText: "",
    contentHash: await linkSha256Hex(""), manualLink: makeManualLinkMetadata({ url: VIDEO_FIXTURE_URL, purpose: "video_note" }).manualLinkV1, attachments: [] }];
  return { note, noteText, links: {
    contract: "link-presentation.v1", schemaAvailable: true, recordId: "video-analysis-fixture", currentRevisionId: "revision-video", currentSnapshotId: snapshot.id, currentSnapshotVersion: 1,
    selectedSnapshot: snapshot, members, availableSources: members, snapshotHistory: { items: [snapshot], nextCursor: null },
    selectedRun: null, publishedRun: null, runHistory: { items: [], nextCursor: null }, latestAttempt: null, fragments: [], isHistorical: false,
    capabilities: { canCreateSnapshot: true, canAnalyze: true, canReview: true, reason: null },
  } };
}

/** Real React UI with synthetic data. Tests replace only local API responses; no video is fetched. */
export async function VideoAnalysisAuditFixture() {
  const { links, note, noteText } = await fixture();
  return <main className="v2-product-shell"><article className="v2-product-card"><h1>영상 분석 · 실제 컴포넌트 검증</h1><p>합성 자료입니다. 실제 영상·AI 호출·운영 저장을 검증한 화면이 아닙니다.</p>
    <pre data-testid="video-analysis-fixture-data" hidden>{JSON.stringify(links)}</pre>
    <RecordLinkAnalysis initial={links} recordId={links.recordId} recoveryIdentity={{ ownerId: "link-owner", recordId: links.recordId, currentVersion: 1, privacyLevel: "normal" }} />
    <RecordSourceMaterials sources={[
      { id: "video-url", kind: "url", displayOrder: 0, rawText: "", contentHash: links.members[0].contentHash, manualLink: links.members[0].manualLink, attachmentId: null, filename: null, mimeType: null, sizeBytes: null },
      { id: "video-note", kind: "transcript", displayOrder: 1, rawText: noteText, contentHash: await linkSha256Hex(noteText), manualLink: null, attachmentId: null, filename: null, mimeType: null, sizeBytes: null, videoAnalysis: note },
    ]} />
  </article></main>;
}
