import { ArrowLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordLifecycleActions } from "@/components/v2/record-lifecycle-actions";
import { RecordKnowledge, RecordTypeBadge } from "@/components/v2/record-knowledge";
import { RecordSourceMaterials } from "@/components/v2/record-source-materials";
import { RecordLinkAnalysis } from "@/components/v2/record-link-analysis";
import { RecordSearchLocation } from "@/components/v2/record-search-location";
import { RestrictedUnlock } from "@/components/v2/restricted-unlock";
import { EditorRecoveryPolicy } from "@/components/v2/editor/editor-recovery-policy";
import { getSession } from "@/lib/auth/session";
import { getActiveRestrictedGrant, hasUnexpiredRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { unavailableLinkPresentation, type LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import { LinkSnapshotError } from "@/lib/v2/domain/link-snapshot-v1";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { parseRecordLocationParam, type V2RecordLocationV1 } from "@/lib/v2/retrieval/record-location-v1";
import "../../v2-product.css";

export const dynamic = "force-dynamic";

export default async function V2RecordPage({ params, searchParams }: PageProps<"/v2/records/[recordId]">) {
  const flags = getV2ServerFeatureFlags();
  if (!flags.routes) notFound();
  const session = await getSession();
  if (!session) notFound();
  const { recordId } = await params;
  const query = await searchParams;
  let searchLocation: V2RecordLocationV1 | null = null;
  let invalidSearchLocation = false;
  try { searchLocation = parseRecordLocationParam(query.loc); }
  catch { invalidSearchLocation = true; }
  const db = getV2CloudflareBindings().db;
  const grant = await getActiveRestrictedGrant(db, { userId: session.userId, sessionId: session.sessionId });
  const record = await new D1SourceFoundationRepository(db, session.userId).getRecord(recordId, Boolean(grant));
  if (!record) notFound();
  const presentation = await new D1PresentationRepository(db, session.userId).project(recordId, record.locked, { restrictedUnlocked: Boolean(grant) });
  let links: LinkPresentationV1 | null = null;
  if (!record.locked) {
    try { links = await new D1LinkPresentationRepository(db, session.userId).project(recordId, { restrictedUnlocked: Boolean(grant), writeEnabled: flags.write, aiEnabled: flags.ai }); }
    catch (error) { if (!(error instanceof LinkSnapshotError)) throw error; links = unavailableLinkPresentation(recordId, error.code); }
  }
  const showLinks = Boolean(links && (links.unavailableReason || links.selectedSnapshot || links.availableSources.some((source) => source.manualLink)));
  const sourceFieldTargets = new Map<string, string>();
  for (const field of [...presentation.sections.flatMap((section) => section.fields), ...presentation.reviewItems.flatMap((item) => item.field ? [item.field] : [])]) {
    for (const evidence of field.evidence) if (evidence.sourceItemId && !sourceFieldTargets.has(evidence.sourceItemId)) sourceFieldTargets.set(evidence.sourceItemId, field.propertyId);
  }
  const recoveryPolicy = await new D1SourceFoundationRepository(db, session.userId).getRecoveryPolicy(recordId);
  if (!recoveryPolicy || recoveryPolicy.privacyLevel !== record.privacyLevel
    || (!record.locked && recoveryPolicy.currentVersion !== record.currentVersion)) notFound();
  if (!record.locked && recoveryPolicy.privacyLevel === "restricted" && !hasUnexpiredRestrictedGrant(grant)) notFound();

  return (
    <main className="v2-product-shell">
      <EditorRecoveryPolicy ownerId={session.userId} {...recoveryPolicy} />
      <nav className="v2-product-nav" aria-label="V2 탐색"><Link href="/v2/library"><strong>Light House</strong></Link><Link href="/v2/capture">새 기록</Link></nav>
      <article className="v2-product-card v2-record-page">
        <div className="v2-record-toolbar">
          <Link className="v2-record-back" href="/v2/library"><ArrowLeft aria-hidden="true" size={16} /> 보관함으로</Link>
          <div className="v2-record-toolbar__actions">
            {!record.locked ? <Link className="v2-record-edit" href={`/v2/records/${record.recordId}/edit`}><Pencil aria-hidden="true" size={15} /> 편집</Link> : null}
            <RecordLifecycleActions deleted={record.lifecycleStatus === "deleted"} recordId={record.recordId} />
          </div>
        </div>
        {record.lifecycleStatus === "deleted" ? <p className="v2-record-deleted">이 기록은 휴지통에 있습니다. 원본과 수정 이력은 삭제되지 않았습니다.</p> : null}
        {record.locked ? (
          <RestrictedUnlock />
        ) : (
          <>
            <header className="v2-record-heading"><RecordTypeBadge presentation={{ displayType: presentation.displayType }} /><p>{new Date(record.capturedAt).toLocaleString("ko-KR")}</p><h1>{record.title}</h1><span className="v2-record-privacy">{record.privacyLevel}</span></header>
            <RecordSearchLocation ownerId={session.userId} recordId={record.recordId} location={searchLocation} invalid={invalidSearchLocation} />
            <pre className="v2-record-markdown">{record.bodyMarkdown}</pre>
            <RecordKnowledge presentationJson={JSON.stringify(presentation)} />
            {showLinks && links ? <RecordLinkAnalysis key={`${session.userId}:${record.recordId}`} initial={links} recordId={record.recordId} recoveryIdentity={{ ownerId: session.userId, ...recoveryPolicy }} /> : null}
            <RecordSourceMaterials analysisSummary={showLinks ? "외부 텍스트 분석과 공개 웹 텍스트 수집은 위 링크 정리 패널에서 별도 요청 · 자동 OCR·영상 분석 안 함" : undefined} fieldTargets={Object.fromEntries(sourceFieldTargets)} sources={record.sources} />
          </>
        )}
      </article>
    </main>
  );
}
