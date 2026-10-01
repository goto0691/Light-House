"use client";

import { Link2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { MANUAL_LINK_LIMITS, type ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import type { LocalSourceItem } from "@/lib/v2/offline/local-capture";
import { convertSharedLink, legacySharedUrls, sharedTextCandidates, undoSharedLinkConversion } from "@/lib/v2/offline/manual-share-conversion";
import "@/app/v2/link-capture.css";

type ManualLinkDraft = Omit<ManualLinkSourceV1, "partNumber" | "totalParts" | "startSeconds" | "endSeconds"> & {
  partNumber: number | string | null;
  totalParts: number | string | null;
  startSeconds: number | string | null;
  endSeconds: number | string | null;
};

function draftMetadata(source: LocalSourceItem): ManualLinkDraft | null {
  const value = source.metadata?.manualLinkV1;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ManualLinkDraft;
}

function emptyMetadata(url = ""): ManualLinkDraft {
  return {
    contract: "manual-link-source.v1", url, canonicalUrl: "", provider: "web",
    purpose: "reference", role: "source", completeness: "unknown", publisher: null,
    partNumber: null, totalParts: null, startSeconds: null, endSeconds: null,
  };
}

function numberDraft(value: string) {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

export function LinkCapturePanel({ items, onChange, nextOrder, disabled, context = "capture" }: {
  items: readonly LocalSourceItem[];
  onChange: (items: readonly LocalSourceItem[]) => void;
  nextOrder: number;
  disabled: boolean;
  context?: "capture" | "snapshot";
}) {
  const sources = items.filter((source) => draftMetadata(source));
  const [inputWarning, setInputWarning] = useState<string | null>(null);
  const [shareChoices, setShareChoices] = useState<Record<string, "keep_memo" | "copy_source_text">>({});
  const [selectedSharedTexts, setSelectedSharedTexts] = useState<Record<string, string>>({});
  const textBytes = sources.reduce((total, source) => total + new TextEncoder().encode(source.value).byteLength, 0);
  const legacyLinks = legacySharedUrls(items);
  const sharedTexts = sharedTextCandidates(items);

  function convert(urlSourceId: string) {
    const choice = shareChoices[urlSourceId] ?? "keep_memo";
    try {
      const textSourceId = selectedSharedTexts[urlSourceId] ?? (sharedTexts.length === 1 ? sharedTexts[0]!.sourceId : null);
      onChange(convertSharedLink({ items, urlSourceId, choice, textSourceId, nextOrder }));
      setInputWarning(null);
    } catch (caught) { setInputWarning(caught instanceof Error ? caught.message : "공유 링크를 전환하지 못했습니다."); }
  }

  function undo(convertedSourceId: string) {
    try {
      onChange(undoSharedLinkConversion(items, convertedSourceId));
      setInputWarning(null);
    } catch (caught) { setInputWarning(caught instanceof Error ? caught.message : "전환을 되돌리지 못했습니다."); }
  }

  function addSource(url = "") {
    if (sources.length >= MANUAL_LINK_LIMITS.sources) return;
    setInputWarning(null);
    onChange([...items, { sourceId: `manual-link-${crypto.randomUUID()}`, order: nextOrder, kind: "url", value: "", metadata: { manualLinkV1: emptyMetadata(url) } }]);
  }

  function update(source: LocalSourceItem, patch: Partial<ManualLinkDraft>) {
    onChange(items.map((item) => item.sourceId === source.sourceId ? { ...item, metadata: { ...item.metadata, manualLinkV1: { ...draftMetadata(item), ...patch } } } : item));
  }

  function pasteUrls(event: React.ClipboardEvent<HTMLInputElement>, source: LocalSourceItem) {
    const urls = event.clipboardData.getData("text/plain").split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
    if (urls.length < 2) return;
    event.preventDefault();
    if (sources.length + urls.length - 1 > MANUAL_LINK_LIMITS.sources) {
      setInputWarning(`한 기록에 링크 자료는 ${MANUAL_LINK_LIMITS.sources}개까지 보관합니다. 이번 붙여넣기는 반영하지 않았습니다. 링크를 나누어 넣어 주세요.`);
      return;
    }
    setInputWarning(null);
    const updated = items.map((item) => item.sourceId === source.sourceId ? { ...item, metadata: { ...item.metadata, manualLinkV1: { ...draftMetadata(item), url: urls[0] } } } : item);
    onChange([...updated, ...urls.slice(1).map((url, index): LocalSourceItem => ({ sourceId: `manual-link-${crypto.randomUUID()}`, order: nextOrder + index, kind: "url", value: "", metadata: { manualLinkV1: emptyMetadata(url) } }))]);
  }

  return <section className="v2-link-capture" aria-labelledby="link-capture-heading">
    <header><div><h2 id="link-capture-heading"><Link2 aria-hidden="true" size={18} /> 링크와 원문 보관</h2><p>내 메모와 출처의 글을 따로 남깁니다. 링크 여러 줄을 URL 칸에 붙여넣으면 각각 나뉩니다.</p></div><button disabled={disabled || sources.length >= MANUAL_LINK_LIMITS.sources} onClick={() => addSource()} type="button"><Plus aria-hidden="true" size={16} /> 링크 자료 추가</button></header>
    {inputWarning ? <p className="v2-link-note" role="alert">{inputWarning}</p> : null}
    {legacyLinks.length ? <section aria-labelledby="legacy-shared-links-heading" className="v2-link-inputs">
      <h3 id="legacy-shared-links-heading">받아 둔 링크를 수동 자료로 정리</h3>
      <p>공유 텍스트는 글쓴이의 원문일 수도, 내가 덧붙인 메모일 수도 있습니다. 확인 전에는 원문으로 옮기지 않습니다. 아래 전환은 원래 링크·텍스트·본문을 그대로 두고 자료 카드를 추가합니다.</p>
      {legacyLinks.map((entry, index) => {
        const choice = shareChoices[entry.source.sourceId] ?? "keep_memo";
        const textSourceId = selectedSharedTexts[entry.source.sourceId] ?? (sharedTexts.length === 1 ? sharedTexts[0]!.sourceId : "");
        const selectedText = sharedTexts.find((text) => text.sourceId === textSourceId);
        return <fieldset className="v2-link-input-card" disabled={disabled} key={entry.source.sourceId}>
          <legend>받은 링크 {index + 1}</legend>
          <p className="v2-source-url">{entry.source.value}</p>
          {entry.convertedSourceId ? <>
            <p>수동 자료 카드로 전환됨 · 받은 원래 자료는 유지됨</p>
            <button disabled={!entry.canUndo} onClick={() => undo(entry.convertedSourceId!)} type="button">전환 되돌리기 {index + 1}</button>
            {!entry.canUndo ? <p>전환 후 자료를 수정했습니다. 변경을 잃지 않도록 되돌리기는 잠겨 있습니다. 내용을 확인한 뒤 해당 자료 카드를 직접 제거할 수 있습니다.</p> : null}
          </> : <>
            <label style={{ minHeight: 44, alignItems: "center" }}><span><input checked={choice === "keep_memo"} name={`share-choice-${entry.source.sourceId}`} onChange={() => setShareChoices((current) => ({ ...current, [entry.source.sourceId]: "keep_memo" }))} style={{ width: 20, minHeight: 20, verticalAlign: "middle", marginRight: 8, colorScheme: "light", accentColor: "#475b50" }} type="radio" />공유 텍스트는 내 메모로 유지 {index + 1}</span></label>
            <label style={{ minHeight: 44, alignItems: "center" }}><span><input checked={choice === "copy_source_text"} disabled={sharedTexts.length === 0} name={`share-choice-${entry.source.sourceId}`} onChange={() => setShareChoices((current) => ({ ...current, [entry.source.sourceId]: "copy_source_text" }))} style={{ width: 20, minHeight: 20, verticalAlign: "middle", marginRight: 8, colorScheme: "light", accentColor: "#475b50" }} type="radio" />공유 텍스트를 출처 원문으로 복사 {index + 1}</span></label>
            {choice === "copy_source_text" ? <>
              {sharedTexts.length > 1 ? <label><span>공유 텍스트 선택 {index + 1}</span><select onChange={(event) => setSelectedSharedTexts((current) => ({ ...current, [entry.source.sourceId]: event.target.value }))} value={textSourceId}><option value="">직접 선택해 주세요</option>{sharedTexts.map((text) => <option key={text.sourceId} value={text.sourceId}>입력 순서 {text.order + 1} · {text.value.slice(0, 60)}</option>)}</select></label> : null}
              {selectedText ? <div className="v2-source-exact"><pre aria-label={`출처 원문으로 복사할 공유 텍스트 ${index + 1}`} tabIndex={0}>{selectedText.value}</pre></div> : null}
              <p>선택한 텍스트가 이 링크의 원문인지 직접 확인하세요. 제목을 작성자로 사용하지 않으며, 본문에서 자동 삭제하지 않습니다.</p>
            </> : <p>링크만 수동 자료로 추가합니다. 공유 텍스트는 출처 원문으로 지정하지 않습니다.</p>}
            {entry.error ? <p className="v2-link-note">{entry.error} 원래 링크는 그대로 남아 있습니다.</p> : null}
            <button disabled={Boolean(entry.error) || sources.length >= MANUAL_LINK_LIMITS.sources || (choice === "copy_source_text" && !textSourceId)} onClick={() => convert(entry.source.sourceId)} type="button">수동 자료로 전환 {index + 1}</button>
          </>}
        </fieldset>;
      })}
    </section> : null}
    {sources.length ? <>
      <p className="v2-link-note">{context === "snapshot" ? "이곳에서는 원문만 저장합니다. AI 정리는 저장 후 별도 버튼으로 요청하며 외부 사이트 수집, 자동 OCR, 영상 분석은 실행하지 않습니다." : "현재는 수동 보관 단계입니다. 외부 사이트 수집, 자동 OCR, 영상 분석, AI 정리를 실행하지 않습니다."}</p>
      <p className={textBytes > MANUAL_LINK_LIMITS.textBytes ? "v2-link-note" : "v2-link-budget"}>자료 {sources.length}/{MANUAL_LINK_LIMITS.sources}개 · 원문 합계 {textBytes.toLocaleString()} / {MANUAL_LINK_LIMITS.textBytes.toLocaleString()} UTF-8 bytes{textBytes > MANUAL_LINK_LIMITS.textBytes ? " · 저장 한도를 넘었습니다. 원문을 잘라 버리지 않고 입력을 유지합니다. 별도 기록으로 나누어 저장해 주세요." : ""}</p>
      <div className="v2-link-inputs">{sources.map((source, index) => {
        const metadata = draftMetadata(source)!;
        return <fieldset className="v2-link-input-card" disabled={disabled} key={source.sourceId}>
          <legend>자료 {index + 1}</legend>
          <div className="v2-link-input-card__heading"><span>입력 순서 {index + 1} · 조각 연결은 아직 확인하지 않음</span><button aria-label={`자료 ${index + 1} 제거`} onClick={() => onChange(items.filter((item) => item.sourceId !== source.sourceId))} type="button"><Trash2 aria-hidden="true" size={16} /> 제거</button></div>
          <label><span>출처 URL {index + 1}</span><input autoComplete="off" inputMode="url" onChange={(event) => update(source, { url: event.target.value })} onPaste={(event) => pasteUrls(event, source)} placeholder="https://…" type="text" value={metadata.url ?? ""} /></label>
          <div className="v2-link-input-grid">
            <label><span>보관 목적 {index + 1}</span><select onChange={(event) => update(source, { purpose: event.target.value as ManualLinkSourceV1["purpose"] })} value={metadata.purpose}><option value="reference">일반 자료</option><option value="prompt">프롬프트 재사용</option><option value="insight">인사이트 기억</option><option value="visual_tip">이미지·구도 팁</option><option value="video_note">영상 메모</option></select></label>
            <label><span>붙여넣은 글의 역할 {index + 1}</span><select onChange={(event) => update(source, { role: event.target.value as ManualLinkSourceV1["role"] })} value={metadata.role}><option value="source">원문·인용</option><option value="prompt">프롬프트</option><option value="negative_prompt">네거티브 프롬프트</option><option value="parameters">설정값</option><option value="caption">캡션·설명란</option><option value="transcript">사용자 제공 자막·전사</option></select></label>
          </div>
          <label><span>출처 원문 {index + 1} <small>선택 · 내 메모가 아닙니다</small></span><textarea onChange={(event) => onChange(items.map((item) => item.sourceId === source.sourceId ? { ...item, value: event.target.value } : item))} placeholder="확보한 원문을 그대로 붙여넣으세요. 비워두면 링크만 보관합니다." rows={5} value={source.value} /></label>
          <label><span>원문 확보 상태 {index + 1}</span><select onChange={(event) => update(source, { completeness: event.target.value as ManualLinkSourceV1["completeness"] })} value={metadata.completeness}><option value="unknown">전체 범위 미확인</option><option value="partial">일부만 확보</option><option value="ocr_unverified">OCR 결과 · 미확인</option><option value="complete">내가 선택한 원문 범위를 모두 확보</option></select></label>
          <details className="v2-link-extra"><summary>작성자 · 조각 번호 · 시간 범위 <small>선택</small></summary>
            <label><span>명시된 작성자 {index + 1}</span><input onChange={(event) => update(source, { publisher: event.target.value || null })} value={metadata.publisher ?? ""} /></label>
            <div className="v2-link-input-grid"><label><span>조각 번호 {index + 1}</span><input inputMode="numeric" onChange={(event) => update(source, { partNumber: numberDraft(event.target.value) })} value={metadata.partNumber ?? ""} /></label><label><span>명시된 전체 조각 수 {index + 1}</span><input inputMode="numeric" onChange={(event) => update(source, { totalParts: numberDraft(event.target.value) })} value={metadata.totalParts ?? ""} /></label></div>
            <div className="v2-link-input-grid"><label><span>시작 시각 {index + 1} · 초</span><input inputMode="numeric" onChange={(event) => update(source, { startSeconds: numberDraft(event.target.value) })} value={metadata.startSeconds ?? ""} /></label><label><span>끝 시각 {index + 1} · 초</span><input inputMode="numeric" onChange={(event) => update(source, { endSeconds: numberDraft(event.target.value) })} value={metadata.endSeconds ?? ""} /></label></div>
            <p>원문에 적힌 값이나 직접 확인한 범위만 입력하세요. 번호가 있어도 여러 게시물을 자동으로 이어 붙이지 않습니다.</p>
          </details>
        </fieldset>;
      })}</div>
      <p className="v2-link-note">{context === "snapshot" ? "이미지·캡처는 새 기록에서 첨부해 보관할 수 있습니다. 이곳에서는 위 목록의 기존 첨부를 선택하며, 이미지와 특정 글의 대응 관계는 자동 확정하지 않습니다." : "이미지·캡처는 아래 첨부로 함께 저장할 수 있습니다. 이미지와 특정 글의 대응 관계는 자동 확정하지 않습니다."}</p>
    </> : null}
  </section>;
}
