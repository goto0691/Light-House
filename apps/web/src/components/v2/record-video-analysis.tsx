"use client";

import { Clapperboard, ExternalLink } from "lucide-react";
import { useId, useState } from "react";

import { ExactSourceText } from "@/components/v2/record-source-materials";
import {
  formatTimecode, parseTimecode, VIDEO_ANALYSIS_LIMITS, youtubeTimecodeUrl, type VideoAnalysisSourceV1,
} from "@/lib/v2/domain/video-analysis-source";

function clipLabel(note: Pick<VideoAnalysisSourceV1, "requestedStartSeconds" | "requestedEndSeconds">) {
  return `${formatTimecode(note.requestedStartSeconds)}–${formatTimecode(note.requestedEndSeconds)}`;
}

function TimeLink({ note, start, end }: { note: VideoAnalysisSourceV1; start: number; end: number }) {
  const label = start === end ? formatTimecode(start) : `${formatTimecode(start)}–${formatTimecode(end)}`;
  return <a aria-label={`${label} 시점 영상 열기 (새 창)`} className="v2-video-time" href={youtubeTimecodeUrl(note.videoId, start)} rel="noreferrer" target="_blank">{label}</a>;
}

/** An AI note shown apart from originals: every item keeps its evidence time. */
export function VideoAnalysisNoteView({ note, rawText, label }: { note: VideoAnalysisSourceV1; rawText: string; label: string }) {
  const coverage = note.observedEndSeconds !== null && note.observedEndSeconds < note.requestedEndSeconds - 5
    ? `요청 구간 ${clipLabel(note)} · 영상이 ${formatTimecode(note.observedEndSeconds)} 무렵 끝난 것으로 보고됨`
    : `분석 구간 ${clipLabel(note)}`;
  return <div className="v2-video-note">
    <p className="v2-source-provenance">AI가 공개 영상의 일부 장면과 소리를 샘플링해 만든 노트입니다. 원본 영상은 보관하지 않았고 공식 자막을 읽은 것도 아닙니다. 빠른 장면이나 작은 글자는 놓쳤을 수 있습니다.</p>
    <p className="v2-video-meta">{coverage} · 분석 시각 {note.analyzedAt.slice(0, 16).replace("T", " ")} · 모델 {note.modelId}{note.timecodeBasis === "clip_relative_shifted" ? " · 모델이 구간 기준 시각으로 답해 전체 영상 기준으로 보정함" : ""}</p>
    <p className="v2-video-summary"><strong>요약</strong> {note.summary}</p>
    {note.segments.length ? <section aria-label="구간별 내용"><h4>구간별 내용</h4><ol className="v2-video-list">{note.segments.map((item, index) => <li key={`segment-${index}`}>
      <TimeLink end={item.endSeconds} note={note} start={item.startSeconds} /><div><strong>{item.title}</strong><p>{item.summary}</p></div>
    </li>)}</ol></section> : null}
    {note.speech.length ? <section aria-label="들린 발화"><h4>들린 발화 <small>AI 전사 · 공식 자막 아님</small></h4><ol className="v2-video-list">{note.speech.map((item, index) => <li key={`speech-${index}`}>
      <TimeLink end={item.endSeconds} note={note} start={item.startSeconds} /><p>{item.speaker ? <strong>{item.speaker}: </strong> : null}{item.text}</p>
    </li>)}</ol></section> : null}
    {note.screenText.length ? <section aria-label="화면 속 텍스트"><h4>화면 속 텍스트 <small>AI 판독 · 정확도 미검증</small></h4><ol className="v2-video-list">{note.screenText.map((item, index) => <li key={`screen-${index}`}>
      <TimeLink end={item.endSeconds} note={note} start={item.startSeconds} /><p className="v2-video-screen-text">{item.text}</p>
    </li>)}</ol></section> : null}
    {note.limitations.length ? <section aria-label="분석 한계"><h4>분석 한계</h4><ul>{note.limitations.map((item, index) => <li key={`limit-${index}`}>{item}</li>)}</ul></section> : null}
    <details className="v2-video-raw"><summary>노트 전체 텍스트</summary>
      <ExactSourceText copiedMessage="AI 영상 분석 노트만 복사했습니다. 원본 자막이 아닙니다." copyLabel="AI 영상 분석 복사" label={label} selectionLabel="노트 선택" text={rawText} />
    </details>
  </div>;
}

export type VideoAnalysisTarget = Readonly<{ sourceItemId: string; url: string; savedStartSeconds: number | null; clips: readonly VideoAnalysisSourceV1[] }>;

/** Explicit per-link request. Blank start uses the saved start time; blank end uses the default window. */
export function VideoAnalysisRequest({ target, index, disabled, running, onAnalyze }: {
  target: VideoAnalysisTarget; index: number; disabled: boolean; running: boolean;
  onAnalyze: (range: { startSeconds: number | null; endSeconds: number | null }) => void;
}) {
  const id = useId();
  const latestEnd = target.clips.reduce((max, clip) => Math.max(max, clip.requestedEndSeconds), 0);
  const [start, setStart] = useState(target.savedStartSeconds !== null ? formatTimecode(target.savedStartSeconds) : "");
  const [end, setEnd] = useState("");
  const [invalid, setInvalid] = useState("");
  const maxMinutes = VIDEO_ANALYSIS_LIMITS.maxWindowSeconds / 60, defaultMinutes = VIDEO_ANALYSIS_LIMITS.defaultWindowSeconds / 60;

  function submit(override?: { startSeconds: number; endSeconds: number }) {
    if (override) { setInvalid(""); onAnalyze(override); return; }
    const startSeconds = parseTimecode(start), endSeconds = parseTimecode(end);
    if (startSeconds === undefined || endSeconds === undefined) { setInvalid("시각은 1:30 또는 1:02:03처럼 입력해 주세요."); return; }
    if (endSeconds !== null && startSeconds === null) { setInvalid("끝 시각을 정하려면 시작 시각도 입력해 주세요."); return; }
    if (startSeconds !== null && endSeconds !== null && (endSeconds <= startSeconds || endSeconds - startSeconds > VIDEO_ANALYSIS_LIMITS.maxWindowSeconds)) {
      setInvalid(`끝 시각은 시작보다 뒤이고, 한 번에 최대 ${maxMinutes}분까지 분석할 수 있습니다.`); return;
    }
    setInvalid("");
    onAnalyze({ startSeconds, endSeconds });
  }

  return <div className="v2-video-request">
    <p className="v2-source-url"><Clapperboard aria-hidden="true" size={15} /> {target.url}</p>
    {target.clips.length ? <p className="v2-link-muted">분석한 구간: {target.clips.map(clipLabel).join(", ")}</p> : null}
    <div className="v2-video-range">
      <label htmlFor={`${id}-start`}>시작<input autoComplete="off" disabled={disabled} id={`${id}-start`} inputMode="numeric" onChange={(event) => setStart(event.target.value)} placeholder="0:00" value={start} /></label>
      <label htmlFor={`${id}-end`}>끝<input autoComplete="off" disabled={disabled} id={`${id}-end`} inputMode="numeric" onChange={(event) => setEnd(event.target.value)} placeholder={`시작 + ${defaultMinutes}분`} value={end} /></label>
    </div>
    {invalid ? <p className="v2-product-error" role="alert">{invalid}</p> : null}
    <div className="v2-link-toolbar">
      <button className="v2-link-primary" disabled={disabled} onClick={() => submit()} type="button">{running ? `영상 ${index + 1} 분석 중 · 최대 2분` : `영상 ${index + 1} AI 분석`}</button>
      {latestEnd > 0 ? <button disabled={disabled} onClick={() => submit({ startSeconds: latestEnd, endSeconds: latestEnd + VIDEO_ANALYSIS_LIMITS.defaultWindowSeconds })} type="button">이어서 {formatTimecode(latestEnd)}부터 분석</button> : null}
      <a className="v2-record-original" href={target.url} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" size={14} /> 영상 열기</a>
    </div>
  </div>;
}
