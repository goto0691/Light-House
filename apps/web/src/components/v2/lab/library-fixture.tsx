"use client";

import {
  Archive,
  Bookmark,
  ChevronDown,
  CircleDashed,
  Compass,
  FilePlus2,
  Inbox,
  Library,
  ListFilter,
  Menu,
  MoreHorizontal,
  Plus,
  Rows3,
  Search,
  Settings,
  SquareCheckBig,
  Star,
  X,
} from "lucide-react";
import { useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";

import { labRecords, type LabRecord } from "@/components/v2/lab/lab-fixtures";
import { SemanticIcon } from "@/components/v2/semantic-icon";

export function LibraryFixture({
  selectedRecord,
  setSelectedRecord,
  onOpenRecord,
}: {
  selectedRecord: LabRecord;
  setSelectedRecord: Dispatch<SetStateAction<LabRecord>>;
  onOpenRecord: (record: LabRecord) => void;
}) {
  const [peekOpen, setPeekOpen] = useState(true);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleRowKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (index + delta + labRecords.length) % labRecords.length;
      setSelectedRecord(labRecords[nextIndex]);
      rowRefs.current[nextIndex]?.focus();
      setPeekOpen(true);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onOpenRecord(labRecords[index]);
    }

    if (event.key === " ") {
      event.preventDefault();
      setPeekOpen((current) => !current);
    }

    if (event.key === "Escape") setPeekOpen(false);
  }

  const previewBlocked = selectedRecord.privacyLevel !== "normal";

  return (
    <section aria-label="보관함 fixture" className="v2-library-shell">
      <aside className="v2-library-sidebar">
        <div className="v2-brand">
          <span aria-hidden="true" className="v2-brand__mark">L</span>
          <span>Light House</span>
        </div>

        <button className="v2-primary-action" type="button">
          <Plus aria-hidden="true" size={20} />
          새 기록
        </button>

        <nav aria-label="보관함 탐색" className="v2-sidebar-nav">
          <p className="v2-sidebar-heading">보관함</p>
          <button aria-current="page" className="v2-sidebar-item is-active" type="button">
            <Rows3 aria-hidden="true" size={19} />
            <span>모든 기록</span>
          </button>
          <button className="v2-sidebar-item" type="button">
            <Inbox aria-hidden="true" size={19} />
            <span>수집함</span>
          </button>
          <button className="v2-sidebar-item" type="button">
            <Bookmark aria-hidden="true" size={19} />
            <span>내 목록</span>
          </button>
          <div className="v2-sidebar-subitems">
            <button type="button">별점 높은 리뷰</button>
            <button type="button">방문한 장소</button>
            <button type="button">독후감</button>
          </div>
          <div className="v2-sidebar-divider" />
          <button className="v2-sidebar-item" type="button">
            <Compass aria-hidden="true" size={19} />
            <span>탐색</span>
          </button>
          <button className="v2-sidebar-item" type="button">
            <SquareCheckBig aria-hidden="true" size={19} />
            <span>확인할 내용</span>
          </button>
          <button className="v2-sidebar-item" type="button">
            <FilePlus2 aria-hidden="true" size={19} />
            <span>템플릿</span>
          </button>
        </nav>

        <button className="v2-sidebar-item v2-sidebar-settings" type="button">
          <Settings aria-hidden="true" size={19} />
          <span>설정</span>
        </button>
      </aside>

      <div className="v2-library-main">
        <header className="v2-library-topbar">
          <button aria-label="모바일 메뉴 열기" className="v2-mobile-menu" type="button">
            <Menu aria-hidden="true" size={20} />
          </button>
          <div className="v2-breadcrumb">
            <Library aria-hidden="true" size={18} />
            <span>보관함</span>
            <span aria-hidden="true">/</span>
            <strong>모든 기록</strong>
          </div>
          <label className="v2-searchbox">
            <Search aria-hidden="true" size={19} />
            <span className="sr-only">기록 검색</span>
            <input placeholder="기록, 사람, 장소, 목록 검색" type="search" />
            <kbd>Ctrl K</kbd>
          </label>
          <CircleDashed aria-label="동기화 상태 정상" className="v2-sync-indicator" size={22} />
        </header>

        <div className="v2-collection-toolbar">
          <div className="v2-collection-title">
            <h1>모든 기록</h1>
            <span>128</span>
          </div>
          <div className="v2-toolbar-actions">
            <button type="button">
              <ListFilter aria-hidden="true" size={18} />
              필터
              <ChevronDown aria-hidden="true" size={14} />
            </button>
            <button type="button">
              <Rows3 aria-hidden="true" size={18} />
              보기
              <ChevronDown aria-hidden="true" size={14} />
            </button>
            <button className="v2-outline-action" type="button">현재 보기를 저장</button>
          </div>
        </div>

        <div className="v2-table-head" role="presentation">
          <span>제목</span>
          <span>유형</span>
          <span>날짜 ↓</span>
          <span>메모</span>
        </div>

        <div aria-label="기록 목록" className="v2-record-list" role="listbox">
          {labRecords.map((record, index) => {
            const isSelected = record.id === selectedRecord.id;
            const isPreviewPrivate = record.privacyLevel !== "normal";
            return (
              <button
                aria-selected={isSelected}
                className="v2-record-row"
                key={record.id}
                onClick={() => {
                  setSelectedRecord(record);
                  setPeekOpen(true);
                }}
                onDoubleClick={() => onOpenRecord(record)}
                onKeyDown={(event) => handleRowKeyDown(event, index)}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                role="option"
                type="button"
              >
                <span className="v2-row-main">
                  <span className="v2-row-icon"><SemanticIcon context="type" iconKey={record.iconKey} /></span>
                  <span className="v2-row-copy">
                    <strong>{record.title}</strong>
                    <span>{isPreviewPrivate ? "민감 기록 · 미리보기 숨김" : record.snippet}</span>
                    {!isPreviewPrivate && record.secondarySnippet ? <span>{record.secondarySnippet}</span> : null}
                  </span>
                </span>
                <span className="v2-row-type">{record.typeLabel}</span>
                <time className="v2-row-date">{record.date}</time>
                <span className="v2-row-meta">
                  {record.rating ? <span className="v2-rating"><Star aria-hidden="true" fill="currentColor" size={17} /> {record.rating.toFixed(1)}</span> : <span>—</span>}
                  <span className="v2-row-tags">
                    {record.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {peekOpen ? (
        <aside aria-label="선택한 기록 미리보기" className="v2-peek-pane">
          <header>
            <span>미리보기</span>
            <button aria-label="미리보기 닫기" onClick={() => setPeekOpen(false)} type="button">
              <X aria-hidden="true" size={20} />
            </button>
          </header>
          {previewBlocked ? (
            <div className="v2-private-preview">
              <SemanticIcon context="type" iconKey={selectedRecord.iconKey} size={26} />
              <h2>{selectedRecord.title}</h2>
              <p>민감 기록의 본문 미리보기는 기본적으로 숨겨집니다.</p>
              <button onClick={() => onOpenRecord(selectedRecord)} type="button">기록 열기</button>
            </div>
          ) : (
            <div className="v2-peek-content">
              <div className="v2-peek-title">
                <span className="v2-row-icon"><SemanticIcon context="type" iconKey={selectedRecord.iconKey} size={20} /></span>
                <div>
                  <h2>{selectedRecord.title}</h2>
                  <p>{selectedRecord.typeLabel} · {selectedRecord.writtenDate}</p>
                </div>
              </div>
              {selectedRecord.rating ? <div className="v2-peek-rating"><Star aria-hidden="true" fill="currentColor" /> <strong>{selectedRecord.rating.toFixed(1)}</strong></div> : null}
              <p className="v2-peek-excerpt">{selectedRecord.snippet}<br />{selectedRecord.secondarySnippet}</p>
              <div className="v2-row-tags">
                {selectedRecord.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              <dl className="v2-peek-fields">
                <div>
                  <dt>내 기록</dt>
                  <dd><span>평점</span><strong>{selectedRecord.rating?.toFixed(1) ?? "—"}</strong><small>원문에서 추출</small></dd>
                </div>
                <div>
                  <dt>장소 정보</dt>
                  <dd><span>주소</span><strong>서울 마포구 연남동</strong><small>외부 출처</small></dd>
                </div>
              </dl>
              <button className="v2-peek-open" onClick={() => onOpenRecord(selectedRecord)} type="button">전체 기록 열기</button>
            </div>
          )}
          <footer>
            <span>↑↓ 이동</span>
            <span>Enter 열기</span>
            <span>Space 미리보기</span>
            <span>Esc 닫기</span>
          </footer>
        </aside>
      ) : (
        <button aria-label="미리보기 다시 열기" className="v2-peek-reopen" onClick={() => setPeekOpen(true)} type="button">
          <MoreHorizontal aria-hidden="true" size={20} />
        </button>
      )}

      <nav aria-label="모바일 주 탐색" className="v2-mobile-bottom-nav">
        <button aria-current="page" type="button"><Archive aria-hidden="true" size={19} /><span>보관함</span></button>
        <button type="button"><Search aria-hidden="true" size={19} /><span>검색</span></button>
        <button className="is-create" type="button"><Plus aria-hidden="true" size={23} /><span className="sr-only">새 기록</span></button>
        <button type="button"><Compass aria-hidden="true" size={19} /><span>탐색</span></button>
        <button type="button"><MoreHorizontal aria-hidden="true" size={19} /><span>더보기</span></button>
      </nav>
    </section>
  );
}
