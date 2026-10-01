"use client";

import { Copy, ExternalLink, FileText, Link2, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import { analysisExtractionLabel } from "@/lib/v2/domain/analysis-extraction-source";
import { VideoAnalysisNoteView } from "@/components/v2/record-video-analysis";
import { formatTimecode, youtubeTimecodeUrl } from "@/lib/v2/domain/video-analysis-source";
import type { V2RecordProjection } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import "@/app/v2/link-capture.css";

const roleNames: Record<ManualLinkSourceV1["role"], string> = { source: "원문·인용", prompt: "프롬프트", negative_prompt: "네거티브 프롬프트", parameters: "설정값", caption: "캡션·설명란", transcript: "사용자 제공 자막·전사" };
const purposeNames: Record<ManualLinkSourceV1["purpose"], string> = { reference: "일반 자료", prompt: "프롬프트 재사용", insight: "인사이트 기억", visual_tip: "이미지·구도 팁", video_note: "영상 메모" };
const coverageNames: Record<ManualLinkSourceV1["completeness"], string> = { unknown: "전체 범위 미확인", complete: "사용자가 선택한 원문 범위 확보", partial: "일부만 확보", ocr_unverified: "OCR 미확인" };

function safeSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function ExactSourceText({ text, label, copyLabel = "원문 복사", copiedMessage = "원문만 복사했습니다.", selectionLabel = "원문 선택" }: { text: string; label: string; copyLabel?: string; copiedMessage?: string; selectionLabel?: string }) {
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [copying, setCopying] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);

  function selectText() {
    if (!textRef.current) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textRef.current);
    selection?.removeAllRanges();
    selection?.addRange(range);
    textRef.current.focus();
  }

  async function copy() {
    setStatus("");
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setStatus(copiedMessage);
    } catch {
      setFailed(true);
      setStatus("자동 복사를 사용할 수 없습니다. 표시된 텍스트를 선택한 뒤 기기의 복사 기능을 사용하세요.");
    } finally { setCopying(false); }
  }

  return <div className="v2-source-exact">
    <div className="v2-source-copy-actions"><button disabled={copying} onClick={() => void copy()} type="button"><Copy aria-hidden="true" size={16} />{copying ? "복사 중" : copyLabel}</button>{failed ? <button onClick={selectText} type="button">{selectionLabel}</button> : null}</div>
    <pre aria-label={label} ref={textRef} tabIndex={0}>{text}</pre>
    <p aria-live="polite" className="v2-source-copy-status" role="status">{status}</p>
  </div>;
}

function StoredImage({ attachmentId, filename }: { attachmentId: string; filename: string | null }) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const src = `/api/v2/attachments/${encodeURIComponent(attachmentId)}`;
  useEffect(() => {
    let active = true;
    // A fast 401/404 may finish before hydration attaches the error listener.
    if (imageRef.current?.complete && imageRef.current.naturalWidth === 0) {
      queueMicrotask(() => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [attachmentId]);
  return <div className="v2-source-image">{failed ? <p>이미지 미리보기를 불러오지 못했습니다. 원본 열기로 확인하세요.</p> : <a aria-label={`${filename || "첨부 이미지"} 원본 확대`} href={src} rel="noreferrer" target="_blank">
    {/* Private authenticated attachments must not enter the public Next image optimizer cache. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img alt={filename || "보관한 첨부 이미지"} loading="lazy" onError={() => setFailed(true)} ref={imageRef} src={src} />
  </a>}<small>보관한 첨부 · 특정 글과의 대응은 미확인</small></div>;
}

export function RecordSourceMaterials({ sources, fieldTargets = {}, analysisSummary }: { sources: V2RecordProjection["sources"]; fieldTargets?: Readonly<Record<string, string>>; analysisSummary?: string }) {
  const manualSources = sources.filter((source) => source.manualLink);
  const fetchedTextCount = manualSources.filter((source) => source.publicFetch && source.rawText?.trim().length).length;
  const providedTextCount = manualSources.filter((source) => !source.publicFetch && source.rawText?.trim().length).length;
  const attachmentCount = sources.filter((source) => source.attachmentId).length;
  const videoNoteCount = sources.filter((source) => source.videoAnalysis).length;
  return <section className="v2-record-materials" aria-labelledby="source-heading">
    <h2 id="source-heading">원본과 첨부</h2>
    {manualSources.length ? <div className="v2-source-coverage" aria-label="자료 보관 상태">
      <p><strong>원문 확보</strong><span>링크 자료 {manualSources.length}개 · 직접 제공한 원문 {providedTextCount}개 · 공개 웹 텍스트 {fetchedTextCount}개 · 전체 연결 범위 미확인</span></p>
      <p><strong>분석</strong><span>{analysisSummary ?? "수동 보관 · 외부 수집·자동 OCR·AI 텍스트 분석 안 함"}{videoNoteCount ? ` · AI 영상 분석 노트 ${videoNoteCount}개(시각 근거 포함)` : " · 영상 분석 안 함"}</span></p>
      <p><strong>첨부 보관</strong><span>{attachmentCount ? `첨부 ${attachmentCount}개 보관` : "첨부 원본 없음"} · 링크만으로 외부 이미지·영상은 보관되지 않음</span></p>
    </div> : null}
    <div className="v2-record-materials__list">{sources.map((source) => {
      const manual = source.manualLink;
      const extraction = source.analysisExtraction;
      const video = source.videoAnalysis;
      if (video) return <article className="v2-record-material" data-source-class="ai_video_note" id={`source-${source.id}`} key={source.id}>
        <header><div className="v2-record-material__title"><FileText aria-hidden="true" size={17} /><div><h3>AI 영상 분석 노트</h3><p>{formatTimecode(video.requestedStartSeconds)}–{formatTimecode(video.requestedEndSeconds)} 구간 · 원본 영상 미보관 · 공식 자막 아님</p></div></div>
          <div className="v2-record-source-actions">{sources.some((item) => item.id === video.requestedSourceItemId) ? <a className="v2-record-original" href={`#source-${video.requestedSourceItemId}`}>영상 링크로</a> : null}<a className="v2-record-original" href={youtubeTimecodeUrl(video.videoId, video.requestedStartSeconds)} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" size={14} /> 구간 시작에서 열기</a></div></header>
        {source.rawText ? <VideoAnalysisNoteView label={`AI 영상 분석 노트 ${source.displayOrder + 1}`} note={video} rawText={source.rawText} /> : null}
        <details className="v2-source-hash"><summary>보존 정보</summary><code>{source.contentHash}</code></details>
      </article>;
      const url = safeSourceUrl(manual?.url ?? (source.kind === "url" ? source.rawText : null));
      return <article className="v2-record-material" id={`source-${source.id}`} key={source.id}>
        <header><div className="v2-record-material__title">{source.attachmentId ? <Paperclip aria-hidden="true" size={17} /> : manual || source.kind === "url" ? <Link2 aria-hidden="true" size={17} /> : <FileText aria-hidden="true" size={17} />}<div><h3>{extraction ? analysisExtractionLabel(extraction.kind) : manual ? roleNames[manual.role] : source.filename ?? `${source.kind} 원본`}</h3><p>{extraction ? "첨부의 파생 텍스트" : `입력 순서 ${source.displayOrder + 1}${manual ? ` · ${purposeNames[manual.purpose]}` : ""}`}</p></div></div><div className="v2-record-source-actions">{fieldTargets[source.id] ? <a className="v2-record-original" href={`#field-${fieldTargets[source.id]}`}>관련 필드로</a> : null}{extraction && sources.some((item) => item.id === extraction.originalSourceItemId) ? <a className="v2-record-original" href={`#source-${extraction.originalSourceItemId}`}>첨부 원본으로</a> : null}{url ? <a className="v2-record-original" href={url} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" size={14} /> 출처 열기</a> : null}{source.attachmentId ? <a className="v2-record-original" href={`/api/v2/attachments/${encodeURIComponent(source.attachmentId)}`} rel="noreferrer" target="_blank">원본 열기</a> : null}</div></header>
        {extraction ? <p className="v2-source-provenance">AI가 첨부에서 읽은 내용입니다. 사용자 원문이나 확인된 인용으로 취급하지 마세요.</p> : null}
        {manual ? <div className="v2-source-provenance"><p className="v2-source-url">{manual.url}</p><p>{source.publicFetch ? "공개 웹에서 읽을 수 있었던 텍스트 · 페이지 전체·댓글·이미지 범위 미확인" : `${source.rawText?.trim().length ? coverageNames[manual.completeness] : "링크만 보관 · 원문 미확보"} · 사용자가 직접 제공한 자료`}</p>{source.publicFetch ? <p className="v2-source-url">확보 시각 {source.publicFetch.fetchedAt} · 요청 URL {source.publicFetch.requestedUrl} · 최종 URL {source.publicFetch.finalUrl}</p> : null}{manual.publisher ? <p>{source.publicFetch ? "자료에 기재된 작성자" : "사용자가 기재한 작성자"}: {manual.publisher} · {source.publicFetch ? "신원 및 기재 근거 미확인" : "제작자 확인 아님"}</p> : null}{manual.partNumber !== null || manual.totalParts !== null ? <p>기재한 조각 번호 {manual.partNumber ?? "미확인"} / 전체 {manual.totalParts ?? "미확인"} · 연결·이어 복사 미확정</p> : null}{manual.startSeconds !== null || manual.endSeconds !== null ? <p>사용자 지정 범위 {manual.startSeconds !== null ? timeLabel(manual.startSeconds) : "시작 미확인"}–{manual.endSeconds !== null ? timeLabel(manual.endSeconds) : "끝 미확인"} · 영상 분석 범위 아님</p> : null}</div> : null}
        {source.attachmentId && source.mimeType?.startsWith("image/") ? <StoredImage attachmentId={source.attachmentId} filename={source.filename} /> : null}
        {source.rawText?.length ? <ExactSourceText copyLabel={extraction ? "AI 추출 텍스트 복사" : undefined} copiedMessage={extraction ? "AI 추출 텍스트만 복사했습니다." : undefined} label={`${extraction ? "AI 추출 텍스트" : "원문"} ${source.displayOrder + 1}`} selectionLabel={extraction ? "AI 추출 텍스트 선택" : undefined} text={source.rawText} /> : extraction ? <p>읽힌 텍스트가 없습니다.</p> : null}
        <details className="v2-source-hash"><summary>보존 정보</summary><code>{source.contentHash}</code></details>
      </article>;
    })}</div>
  </section>;
}
