"use client";

import { Activity, Archive, Compass, DatabaseBackup, FileText, LockKeyhole, NotebookTabs, Plus, Search, Settings, Shield, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { V2LibraryRecord } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { SemanticIcon } from "@/components/v2/semantic-icon";
import { V2MobileNavigation } from "@/components/v2/mobile-navigation";

function rowTitle(record: V2LibraryRecord) {
  return record.locked ? "잠긴 기록" : record.title || "제목 없는 기록";
}

type PinnedView = Readonly<{ id: string; name: string; iconKey: string }>;

export function LibraryView({ records, pinnedViews = [], totalCount = records.length, nextCursor = null, hasPrevious = false }: { records: readonly V2LibraryRecord[]; pinnedViews?: readonly PinnedView[]; totalCount?: number; nextCursor?: string | null; hasPrevious?: boolean }) {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [peekOpen, setPeekOpen] = useState(true);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = records[selectedIndex] ?? null;

  function move(next: number) {
    if (!records.length) return;
    const index = (next + records.length) % records.length;
    setSelectedIndex(index);
    rowRefs.current[index]?.focus();
  }

  return (
    <main className="v2-library-product">
      <aside className="v2-library-product__sidebar">
        <Link className="v2-library-brand" href="/v2/library"><span>LH</span><strong>Light House</strong></Link>
        <Link className="v2-library-new" href="/v2/capture"><Plus aria-hidden="true" size={18} /> 새 기록</Link>
        <nav aria-label="주요 탐색">
          <Link aria-current="page" href="/v2/library"><Archive aria-hidden="true" size={17} /> 보관함</Link>
          <Link href="/v2/explore"><Compass aria-hidden="true" size={17} /> 탐색</Link>
          <Link href="/v2/review"><Sparkles aria-hidden="true" size={17} /> 확인할 내용</Link>
        </nav>
        {pinnedViews.length ? <nav aria-label="고정한 내 목록" className="v2-library-pinned"><strong>내 목록</strong>{pinnedViews.map((view) => <Link href={`/v2/library/views/${view.id}`} key={view.id}><SemanticIcon context="saved_view" iconKey={view.iconKey} size={15} /> {view.name}</Link>)}<Link href="/v2/library/views">모든 내 목록</Link></nav> : <Link className="v2-library-views-link" href="/v2/library/views">내 목록</Link>}
        <Link className="v2-library-views-link" href="/v2/library/templates"><NotebookTabs aria-hidden="true" size={15} /> 입력 템플릿</Link>
        <Link className="v2-library-views-link" href="/v2/processing"><Activity aria-hidden="true" size={15} /> 처리 상태</Link>
        <Link className="v2-library-views-link" href="/v2/settings/data"><DatabaseBackup aria-hidden="true" size={15} /> 데이터 이동</Link>
        <Link className="v2-library-settings" href="/settings"><Settings aria-hidden="true" size={17} /> 설정</Link>
      </aside>

      <section className="v2-library-product__content">
        <header className="v2-library-product__topbar">
          <div><p>보관함</p><h1>모든 기록</h1></div>
          <Link className="v2-library-search" href="/v2/search"><Search aria-hidden="true" size={17} /><span>기록 검색</span><kbd>⌘ K</kbd></Link>
          <Link href="/v2/capture"><Plus aria-hidden="true" size={18} /><span>새 기록</span></Link>
        </header>
        <div className="v2-library-product__summary"><strong>{totalCount.toLocaleString("ko-KR")}</strong>개의 원본 기록 · 현재 {records.length}개 표시</div>
        {records.length ? (
          <div aria-label="모든 기록" className="v2-library-records" role="listbox">
            {records.map((record, index) => (
              <button
                aria-label={`${rowTitle(record)} · ${record.privacyLevel}`}
                aria-selected={index === selectedIndex}
                className="v2-library-record"
                key={record.recordId}
                onClick={() => { if (window.matchMedia("(max-width: 900px)").matches) router.push(`/v2/records/${record.recordId}`); else { setSelectedIndex(index); setPeekOpen(true); } }}
                onDoubleClick={() => router.push(`/v2/records/${record.recordId}`)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); move(index + 1); }
                  if (event.key === "ArrowUp") { event.preventDefault(); move(index - 1); }
                  if (event.key === "Enter") router.push(`/v2/records/${record.recordId}`);
                  if (event.key === " ") { event.preventDefault(); setPeekOpen((current) => !current); }
                  if (event.key === "Escape") setPeekOpen(false);
                }}
                ref={(node) => { rowRefs.current[index] = node; }}
                role="option"
                type="button"
              >
                <span className={`v2-library-record__icon is-${record.privacyLevel}`}>
                  {record.locked ? <LockKeyhole aria-hidden="true" size={18} /> : record.privacyLevel === "sensitive" ? <Shield aria-hidden="true" size={18} /> : <FileText aria-hidden="true" size={18} />}
                </span>
                <span className="v2-library-record__copy"><strong>{rowTitle(record)}</strong><small>{record.excerpt ?? (record.locked ? "최근 재인증 전에는 내용이 표시되지 않습니다." : "민감 기록의 미리보기는 숨겼습니다.")}</small></span>
                <span>{record.documentStatus}</span>
                <time dateTime={record.updatedAt}>{new Date(record.updatedAt).toLocaleDateString("ko-KR")}</time>
              </button>
            ))}
          </div>
        ) : (
          <section className="v2-library-empty"><FileText aria-hidden="true" size={28} /><h2>아직 기록이 없습니다.</h2><p>분류를 정하지 않아도 됩니다. 먼저 한 문장이나 이미지를 남겨두세요.</p><Link className="v2-product-primary" href="/v2/capture">첫 기록 남기기</Link></section>
        )}
        {hasPrevious || nextCursor ? <nav className="v2-pagination" aria-label="보관함 페이지">{hasPrevious ? <Link href="/v2/library">최신 기록으로</Link> : <span />}{nextCursor ? <Link href={`/v2/library?cursor=${encodeURIComponent(nextCursor)}`}>다음 기록 보기</Link> : <span>마지막 기록입니다</span>}</nav> : null}
      </section>

      {peekOpen && selected ? (
        <aside aria-label="기록 미리보기" className="v2-library-peek">
          <header><span>미리보기</span><button aria-label="미리보기 닫기" onClick={() => setPeekOpen(false)} type="button">×</button></header>
          <div className="v2-library-peek__body">
            {selected.locked ? <><LockKeyhole aria-hidden="true" size={27} /><h2>잠긴 기록</h2><p>제목과 내용은 기록 화면에서 재인증한 뒤 서버가 전송합니다.</p></> : <><p>{selected.privacyLevel === "sensitive" ? "민감 기록" : "원본 기록"}</p><h2>{selected.title}</h2><div>{selected.excerpt ?? "미리보기는 숨겨져 있습니다."}</div><dl><div><dt>상태</dt><dd>{selected.documentStatus}</dd></div><div><dt>버전</dt><dd>{selected.currentVersion ?? "잠김"}</dd></div></dl></>}
          </div>
          <Link href={`/v2/records/${selected.recordId}`}>기록 전체 열기</Link>
        </aside>
      ) : null}

      <V2MobileNavigation active="library" />
    </main>
  );
}
