import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordKnowledge } from "@/components/v2/record-knowledge";
import { requireSession } from "@/lib/auth/session";
import { getActiveRestrictedGrant, hasUnexpiredRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1ReviewRepository } from "@/lib/v2/infrastructure/d1/review-repository";
import "../v2-product.css";

export const metadata = { title: "확인할 내용 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession();
  const db = getV2CloudflareBindings().db;
  const grant = await getActiveRestrictedGrant(db, { userId: session.userId, sessionId: session.sessionId });
  const repository = new D1ReviewRepository(db, session.userId);
  const initialRecords = (await repository.listOpenRecords(hasUnexpiredRestrictedGrant(grant)))
    .filter((record) => record.privacyLevel !== "restricted" || hasUnexpiredRestrictedGrant(grant));
  const query = await searchParams;
  const requested = typeof query.record === "string" ? query.record : null;
  const selectedIndex = Math.max(0, initialRecords.findIndex((record) => record.recordId === requested));
  const initialSelected = initialRecords[selectedIndex] ?? null;
  let presentation = initialSelected ? await new D1PresentationRepository(db, session.userId).project(initialSelected.recordId, false, { restrictedUnlocked: hasUnexpiredRestrictedGrant(grant) }) : null;
  // Re-read the entire index after projection. Every title and count on the
  // page must come from the current owner/privacy snapshot, including items
  // that were not selected when projection began.
  const records = (await repository.listOpenRecords(hasUnexpiredRestrictedGrant(grant)))
    .filter((record) => record.privacyLevel !== "restricted" || hasUnexpiredRestrictedGrant(grant));
  let selected: (typeof records)[number] | null = initialSelected
    ? records.find((record) => record.recordId === initialSelected.recordId
      && record.privacyLevel === initialSelected.privacyLevel
      && record.currentRevisionId === initialSelected.currentRevisionId) ?? null
    : null;
  if (!selected || (selected.privacyLevel === "restricted" && !hasUnexpiredRestrictedGrant(grant))) {
    selected = null;
    presentation = null;
  }
  const visibleIndex = selected ? records.findIndex((record) => record.recordId === selected.recordId) : -1;
  const previous = visibleIndex > 0 ? records[visibleIndex - 1] : null;
  const next = visibleIndex >= 0 ? records[visibleIndex + 1] ?? null : null;

  return (
    <main className="v2-review-page">
      <aside className="v2-review-index">
        <header><Link href="/v2/library"><ArrowLeft aria-hidden="true" size={16} /> 보관함</Link><p>판단이 필요한 항목만 모았습니다</p><h1>확인할 내용</h1><span>{records.reduce((sum, record) => sum + record.openCount, 0)}개</span></header>
        {records.length ? <nav aria-label="확인할 기록">{records.map((record) => <Link aria-current={selected?.recordId === record.recordId ? "page" : undefined} href={`/v2/review?record=${encodeURIComponent(record.recordId)}`} key={record.recordId}><Sparkles aria-hidden="true" size={17} /><span><strong>{record.title}</strong><small>{record.privacyLevel === "restricted" ? "재인증된 보호 기록" : `${record.openCount}개 확인 필요`}</small></span><b>{record.openCount}</b></Link>)}</nav>
          : <div className="v2-review-empty"><CheckCircle2 aria-hidden="true" size={32} /><h2>지금 확인할 내용이 없습니다.</h2><p>원본은 검토 여부와 관계없이 계속 읽고 찾을 수 있습니다.</p><Link href="/v2/library">보관함으로 돌아가기</Link></div>}
      </aside>
      {selected && presentation ? <section aria-labelledby="selected-review-heading" className="v2-review-detail">
        <header><div><p>{selected.privacyLevel} · {selected.openCount}개</p><h2 id="selected-review-heading">{selected.title}</h2></div><Link href={`/v2/records/${selected.recordId}`}>기록 전체 열기</Link></header>
        <p className="v2-review-principle">AI 제안은 원본과 분리되어 있습니다. 확인·수정·거절해도 원문과 이전 값 이력은 남습니다.</p>
        <RecordKnowledge presentationJson={JSON.stringify({ ...presentation, highlights: [], sections: [], connections: [], modules: [] })} sourceRecordId={selected.recordId} />
        <nav aria-label="다른 확인 항목" className="v2-review-pager">
          {previous ? <Link href={`/v2/review?record=${encodeURIComponent(previous.recordId)}`}><ArrowLeft aria-hidden="true" size={15} /> 이전 기록</Link> : <span />}
          {next ? <Link href={`/v2/review?record=${encodeURIComponent(next.recordId)}`}>다음 기록 <ArrowRight aria-hidden="true" size={15} /></Link> : null}
        </nav>
      </section> : null}
    </main>
  );
}
