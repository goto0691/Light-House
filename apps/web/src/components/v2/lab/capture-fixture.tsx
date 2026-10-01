"use client";

import {
  Archive,
  Check,
  ChevronDown,
  CirclePause,
  Compass,
  ListPlus,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IndexedDbCaptureStore } from "@/lib/v2/offline/indexeddb-capture-store";
import type { LocalAttachmentInput } from "@/lib/v2/offline/local-capture";

type CaptureState = "editing" | "assist" | "committed";

export function CaptureFixture({
  initialDraftId,
  offlineEnabled,
}: {
  initialDraftId?: string;
  offlineEnabled: boolean;
}) {
  const [state, setState] = useState<CaptureState>("editing");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [note, setNote] = useState("아침에 가볍게 뛰었다. 페이스가 안정적이어서 기분이 좋았다.");
  const [localAttachments, setLocalAttachments] = useState<LocalAttachmentInput[]>([]);
  const [localStatus, setLocalStatus] = useState<"loading" | "ready" | "saving" | "saved" | "error">("loading");
  const draftId = initialDraftId ?? "v2-lab-offline-spike";
  const storeRef = useRef<IndexedDbCaptureStore | null>(null);
  const localVersionRef = useRef(1);

  if (!storeRef.current) storeRef.current = new IndexedDbCaptureStore();

  useEffect(() => {
    const store = storeRef.current;
    if (!offlineEnabled || !store) {
      setLocalStatus("ready");
      return;
    }
    let active = true;
    void Promise.all([store.getDraft(draftId), store.getDraftAttachments(draftId)])
      .then(([draft, attachments]) => {
        if (!active) return;
        if (draft) {
          setNote(draft.bodyMarkdown);
          localVersionRef.current = draft.localVersion + 1;
          setLocalAttachments(
            attachments.map((attachment) => ({
              localAttachmentId: attachment.localAttachmentId,
              blob: attachment.blob,
              filename: attachment.filename,
              sourceOrder: attachment.sourceOrder,
            })),
          );
          setLocalStatus("saved");
        } else {
          setLocalStatus("ready");
        }
      })
      .catch(() => {
        if (active) setLocalStatus("error");
      });
    return () => {
      active = false;
      store.close();
    };
  }, [draftId, offlineEnabled]);

  useEffect(() => {
    const store = storeRef.current;
    if (!offlineEnabled || !store || localStatus === "loading") return;
    const timeout = window.setTimeout(() => {
      setLocalStatus("saving");
      void store
        .checkpoint({
          draftId,
          bodyMarkdown: note,
          captureChannel: initialDraftId ? "mobile_share" : "web",
          privacyLevel: "normal",
          attachments: localAttachments,
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          localVersion: localVersionRef.current,
        })
        .then(() => {
          localVersionRef.current += 1;
          setLocalStatus("saved");
        })
        .catch(() => setLocalStatus("error"));
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [draftId, initialDraftId, localAttachments, localStatus === "loading", note, offlineEnabled]);

  function addLocalFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files).slice(0, 3);
    setLocalAttachments(
      selected.map((file, index) => ({
        localAttachmentId: `${draftId}:attachment:${index}`,
        blob: file,
        filename: file.name,
        sourceOrder: index + 1,
      })),
    );
  }

  if (state === "committed") {
    return (
      <section aria-label="모바일 저장 완료 fixture" className="v2-capture-stage">
        <div className="v2-phone-frame">
          <main className="v2-receipt-screen">
            <div className="v2-receipt-copy">
              <span className="v2-receipt-check"><Check aria-hidden="true" size={28} /></span>
              <h1>기록을 저장했습니다.</h1>
              <p>원본과 첨부를 안전하게 저장했습니다.</p>
            </div>
            {aiEnabled ? (
              <div className="v2-processing-card">
                <LoaderCircle aria-hidden="true" className="v2-spinner" size={28} />
                <span><strong>AI가 구조와 검색 정보를 정리하고 있습니다.</strong><small>앱을 닫아도 계속됩니다.</small></span>
              </div>
            ) : (
              <div className="v2-processing-card is-paused">
                <CirclePause aria-hidden="true" size={26} />
                <span><strong>AI 정리 없이 원본만 저장했습니다.</strong><small>기록에서 나중에 정리할 수 있습니다.</small></span>
              </div>
            )}
            <div className="v2-capture-result-card">
              <span className="v2-runner-icon" aria-hidden="true">↗</span>
              <span><strong>운동 기록</strong><small>오늘 · 5.02 km · 28:41</small><em>이미지에서 읽음</em></span>
            </div>
            <button className="v2-receipt-primary" type="button">기록 열기</button>
            <button className="v2-receipt-secondary" onClick={() => setState("editing")} type="button">새 기록 계속</button>
            <p className="v2-receipt-state">원본 저장 완료 · {aiEnabled ? "AI 정리 중" : "AI 정리 꺼짐"}</p>
          </main>
          <MobileBottomNav />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="모바일 Capture fixture" className="v2-capture-stage">
      <div className="v2-phone-frame">
        <header className="v2-capture-header">
          <button onClick={() => setState("editing")} type="button">취소</button>
          <h1>새 기록</h1>
          <button className="is-save" onClick={() => setState("committed")} type="button">저장</button>
        </header>
        <div className="v2-capture-options">
          <button type="button">일반 <ChevronDown aria-hidden="true" size={14} /></button>
          <button aria-pressed={aiEnabled} onClick={() => setAiEnabled((current) => !current)} type="button">
            AI 정리 {aiEnabled ? "켜짐" : "꺼짐"} <ChevronDown aria-hidden="true" size={14} />
          </button>
        </div>
        {offlineEnabled ? (
          <p aria-live="polite" className="v2-offline-banner" data-local-save-state={localStatus}>
            {localStatus === "saved"
              ? `이 기기에 임시 저장됨${localAttachments.length ? ` · 이미지 ${localAttachments.length}장` : ""}`
              : localStatus === "saving"
                ? "이 기기에 저장하는 중…"
                : localStatus === "error"
                  ? "로컬 저장 실패 · 저장 공간을 확인하세요"
                  : initialDraftId
                    ? "공유한 내용을 이 기기에서 복구했습니다"
                    : "오프라인 준비됨 · 연결이 끊기면 이 기기에 임시 저장합니다"}
          </p>
        ) : null}
        <main className="v2-capture-body">
          <label className="v2-capture-note">
            <span className="sr-only">기록 내용</span>
            <textarea
              disabled={localStatus === "loading"}
              onChange={(event) => setNote(event.target.value)}
              placeholder="무엇이든 적거나 이미지를 붙여넣으세요."
              value={note}
            />
          </label>
          <div className="v2-workout-shot" role="img" aria-label="5.02km 운동 앱 캡처 fixture">
            <div className="v2-shot-top"><span>‹</span><span>⌁</span></div>
            <div className="v2-shot-distance"><strong>5.02</strong><span>km</span></div>
            <div className="v2-shot-metrics"><span><strong>28:41</strong><small>시간</small></span><span><strong>5′43″</strong><small>평균 페이스 /km</small></span></div>
            <div className="v2-map-fixture"><span className="v2-route-line" /></div>
          </div>
          <p className="v2-upload-state"><Check aria-hidden="true" size={15} /> 이미지 1장 · 업로드 완료</p>

          <div className="v2-capture-spacer" />
          <div className="v2-capture-actions">
            <button onClick={() => setState("assist")} type="button"><ListPlus aria-hidden="true" size={18} /> 도움받아 쓰기</button>
            <label className="v2-capture-file-action">
              <Paperclip aria-hidden="true" size={18} /> 첨부
              <input
                accept="image/*,text/plain,application/pdf"
                aria-label="로컬 첨부 파일 선택"
                multiple
                onChange={(event) => addLocalFiles(event.target.files)}
                type="file"
              />
            </label>
          </div>
        </main>

        {state === "assist" ? (
          <div aria-modal="true" className="v2-assist-sheet" role="dialog">
            <span className="v2-sheet-handle" />
            <button aria-label="도움받아 쓰기 닫기" className="v2-sheet-close" onClick={() => setState("editing")} type="button"><X aria-hidden="true" size={18} /></button>
            <h2>운동 기록 도움</h2>
            <p>최근 운동 기록에서 자주 남긴 항목</p>
            <dl>
              <div><dt>운동일</dt><dd><strong>오늘</strong></dd></div>
              <div><dt>거리</dt><dd><strong>5.02 km</strong><small>이미지에서 읽음</small></dd></div>
              <div><dt>시간</dt><dd><strong>28:41</strong><small>이미지에서 읽음</small></dd></div>
              <div><dt>메모</dt><dd><span>비워둬도 저장할 수 있습니다</span></dd></div>
            </dl>
            <div className="v2-assist-actions">
              <button onClick={() => setState("editing")} type="button">이번 기록에만 사용</button>
              <button onClick={() => setState("editing")} type="button">이 템플릿 유지</button>
            </div>
          </div>
        ) : null}
        <MobileBottomNav />
      </div>
    </section>
  );
}

function MobileBottomNav() {
  return (
    <nav aria-label="모바일 주 탐색" className="v2-capture-bottom-nav">
      <button aria-current="page" type="button"><Archive aria-hidden="true" size={19} /><span>보관함</span></button>
      <button type="button"><Search aria-hidden="true" size={19} /><span>검색</span></button>
      <button className="is-create" type="button"><Plus aria-hidden="true" size={23} /><span className="sr-only">새 기록</span></button>
      <button type="button"><Compass aria-hidden="true" size={19} /><span>탐색</span></button>
      <button type="button"><MoreHorizontal aria-hidden="true" size={19} /><span>더보기</span></button>
    </nav>
  );
}
