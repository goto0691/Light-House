"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Focus,
  Image as ImageIcon,
  Link2,
  MapPin,
  MoreVertical,
  Pin,
  Quote,
  RotateCcw,
  Star,
  Tag,
  X,
} from "lucide-react";
import { useState } from "react";

import type { LabRecord } from "@/components/v2/lab/lab-fixtures";
import { SemanticIcon } from "@/components/v2/semantic-icon";

type EvidenceKey = "rating" | "image" | "external";

export function RecordFixture({ record, onBack }: { record: LabRecord; onBack: () => void }) {
  const [evidence, setEvidence] = useState<EvidenceKey>("rating");
  const [mode, setMode] = useState<"document" | "source" | "read">("document");
  const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);

  const isPrivate = record.privacyLevel !== "normal";

  return (
    <section aria-label="기록 상세 fixture" className="v2-record-shell">
      <header className="v2-record-topbar">
        <button aria-label="보관함으로 돌아가기" className="v2-record-back" onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" size={20} />
        </button>
        <div className="v2-record-path">
          <button onClick={onBack} type="button">모든 기록</button>
          <span aria-hidden="true">/</span>
          <strong>{record.title}</strong>
        </div>
        <span className="v2-save-state"><Check aria-hidden="true" size={16} /> 저장됨</span>
        <div aria-label="문서 보기 방식" className="v2-mode-switcher" role="group">
          {(["document", "source", "read"] as const).map((item) => (
            <button aria-pressed={mode === item} key={item} onClick={() => setMode(item)} type="button">
              {item === "document" ? "문서" : item === "source" ? "소스" : "읽기"}
            </button>
          ))}
        </div>
        <button className="v2-topbar-button" type="button"><Focus aria-hidden="true" size={18} /> 집중 모드</button>
        <button
          aria-expanded={mobileEvidenceOpen}
          aria-label="근거와 정보 열기"
          className="v2-mobile-evidence-toggle"
          onClick={() => setMobileEvidenceOpen(true)}
          type="button"
        >
          <Quote aria-hidden="true" size={18} />
        </button>
        <button aria-label="기록 메뉴" className="v2-record-menu" type="button"><MoreVertical aria-hidden="true" size={20} /></button>
      </header>

      <aside className="v2-evidence-panel">
        <header><h2>근거</h2><Pin aria-hidden="true" size={16} /></header>
        <button aria-pressed={evidence === "rating"} className="v2-evidence-card" onClick={() => setEvidence("rating")} type="button">
          <span className="v2-evidence-icon"><FileText aria-hidden="true" size={18} /></span>
          <span><strong>원문 3번째 문단</strong><small>“별점은 4개 반.”</small></span>
        </button>
        <button aria-pressed={evidence === "image"} className="v2-evidence-card" onClick={() => setEvidence("image")} type="button">
          <span className="v2-evidence-icon"><ImageIcon aria-hidden="true" size={18} /></span>
          <span><strong>이미지에서 읽음</strong><small>업로드한 음식 사진의 메뉴 후보</small></span>
        </button>
        <button aria-pressed={evidence === "external"} className="v2-evidence-card" onClick={() => setEvidence("external")} type="button">
          <span className="v2-evidence-icon"><Link2 aria-hidden="true" size={18} /></span>
          <span><strong>외부 출처</strong><small>장소 정보 · 2026. 08. 12 확인</small></span>
        </button>
        <button className="v2-evidence-close" type="button">근거 닫기</button>
      </aside>

      <article className="v2-document-surface">
        {isPrivate ? (
          <div className="v2-private-record-notice">
            <SemanticIcon context="type" iconKey={record.iconKey} size={30} />
            <h1>{record.title}</h1>
            <p>민감 기록 fixture입니다. 실제 구현에서는 privacy projection에 따라 목록과 미리보기가 제한됩니다.</p>
          </div>
        ) : (
          <div className="v2-document-measure">
            <p className="v2-record-eyebrow">{record.typeLabel} · {record.writtenDate}</p>
            <h1>{record.title}</h1>
            <div className="v2-document-tags">
              {record.rating ? <span><Star aria-hidden="true" size={16} /> {record.rating.toFixed(1)}</span> : null}
              {record.tags.map((tag) => <span key={tag}><Tag aria-hidden="true" size={15} /> {tag}</span>)}
            </div>

            {mode === "source" ? (
              <pre className="v2-source-view">{`# ${record.title}\n\n오랜만에 연남동을 걷다가 모모식당에 들렀다.\n\n가지튀김이 특히 맛있었다. 겉은 바삭하고 안은 부드러웠다. 별점은 4개 반.\n\n대화하기 좋은 조용한 분위기라 데이트하러 오면 좋을 것 같다.`}</pre>
            ) : (
              <div className={mode === "read" ? "v2-prose is-reading" : "v2-prose"}>
                <p>오랜만에 연남동을 걷다가 모모식당에 들렀다.</p>
                <p>가지튀김이 특히 맛있었다. 겉은 바삭하고 안은 부드러웠다. <mark className={evidence === "rating" ? "is-evidence-active" : undefined}>별점은 4개 반.</mark></p>
                <p>대화하기 좋은 조용한 분위기라 데이트하러 오면 좋을 것 같다.</p>
                <figure className={evidence === "image" ? "v2-food-figure is-evidence-active" : "v2-food-figure"}>
                  <div className="v2-food-placeholder" role="img" aria-label="가지튀김 사진을 나타내는 fixture placeholder">
                    <span className="v2-food-plate"><span /><span /><span /><span /></span>
                  </div>
                  <figcaption>가지튀김 · 원본 이미지 fixture</figcaption>
                </figure>
                {mode === "document" ? <p className="v2-editor-placeholder">‘/’를 입력해 블록 또는 기록 연결</p> : null}
              </div>
            )}
          </div>
        )}
      </article>

      <aside className="v2-inspector-panel">
        <section>
          <header><h2>정보</h2><ChevronDown aria-hidden="true" size={16} /></header>
          <h3>내 기록</h3>
          <dl>
            <div className={evidence === "rating" ? "is-active" : undefined}>
              <dt>평점</dt>
              <dd><strong>{record.rating?.toFixed(1) ?? "—"}</strong><small>원문에서 추출</small></dd>
            </div>
            <div><dt>추천 상황</dt><dd><strong>데이트</strong></dd></div>
            <div><dt>방문일</dt><dd><strong>2026. 08. 10</strong></dd></div>
          </dl>
        </section>
        <section className={evidence === "external" ? "is-source-active" : undefined}>
          <h3>장소 정보</h3>
          <dl>
            <div><dt>주소</dt><dd><strong>서울 마포구 연남동</strong><small>외부 출처</small></dd></div>
            <div><dt>메뉴</dt><dd><strong>가지튀김</strong></dd></div>
          </dl>
          <button className="v2-source-link" onClick={() => setEvidence("external")} type="button"><ExternalLink aria-hidden="true" size={15} /> 출처 확인</button>
        </section>
        <section>
          <h3>주제와 색인</h3>
          <div className="v2-inspector-tags"><span>조용한 분위기</span><span>연남동</span><small>AI 해석</small></div>
        </section>
        <section>
          <h3>연결</h3>
          <button className="v2-context-card" type="button">
            <FileText aria-hidden="true" size={18} />
            <span><strong>연남동 산책 기록에서 언급됨</strong><small>“연남동을 걷다 발견한 작은 식당...”</small></span>
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </section>
        <button className="v2-history-link" type="button"><RotateCcw aria-hidden="true" size={17} /> 수정 기록 보기 <ChevronRight aria-hidden="true" size={17} /></button>
      </aside>

      <div aria-live="polite" className="v2-evidence-live">
        {evidence === "rating" ? <><Quote aria-hidden="true" size={15} /> 평점 필드와 원문 문장을 연결했습니다.</> : null}
        {evidence === "image" ? <><ImageIcon aria-hidden="true" size={15} /> 이미지 영역을 선택했습니다.</> : null}
        {evidence === "external" ? <><MapPin aria-hidden="true" size={15} /> 외부 장소 출처를 선택했습니다.</> : null}
        <Clock3 aria-hidden="true" size={14} />
      </div>

      {mobileEvidenceOpen ? (
        <div aria-labelledby="v2-mobile-evidence-title" aria-modal="true" className="v2-mobile-evidence-sheet" role="dialog">
          <span className="v2-sheet-handle" />
          <header>
            <div>
              <h2 id="v2-mobile-evidence-title">근거와 정보</h2>
              <p>필드가 어디에서 왔는지 확인합니다.</p>
            </div>
            <button aria-label="근거와 정보 닫기" onClick={() => setMobileEvidenceOpen(false)} type="button"><X aria-hidden="true" size={18} /></button>
          </header>
          <div className="v2-mobile-evidence-list">
            <button aria-pressed={evidence === "rating"} onClick={() => setEvidence("rating")} type="button">
              <FileText aria-hidden="true" size={17} />
              <span><strong>평점 {record.rating?.toFixed(1) ?? "—"}</strong><small>원문 “별점은 4개 반.”에서 추출</small></span>
            </button>
            <button aria-pressed={evidence === "image"} onClick={() => setEvidence("image")} type="button">
              <ImageIcon aria-hidden="true" size={17} />
              <span><strong>메뉴 · 가지튀김</strong><small>업로드한 이미지에서 읽음</small></span>
            </button>
            <button aria-pressed={evidence === "external"} onClick={() => setEvidence("external")} type="button">
              <MapPin aria-hidden="true" size={17} />
              <span><strong>서울 마포구 연남동</strong><small>외부 장소 출처 · 2026. 08. 12 확인</small></span>
            </button>
          </div>
          <button className="v2-mobile-sheet-done" onClick={() => setMobileEvidenceOpen(false)} type="button">문서로 돌아가기</button>
        </div>
      ) : null}
    </section>
  );
}
