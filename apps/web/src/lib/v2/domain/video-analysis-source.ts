/** Provenance for an AI video-analysis note produced from a public YouTube URL.
 * The note is an AI interpretation of sampled frames and audio. It is never the
 * original video, an official caption track, or the user's own words. */
export const VIDEO_ANALYSIS_SOURCE_CONTRACT = "video-analysis-source.v1" as const;
export const VIDEO_ANALYSIS_ADAPTER_VERSION = "gemini-youtube-video.v1" as const;
export const VIDEO_ANALYSIS_LIMITS = {
  defaultWindowSeconds: 600,
  maxWindowSeconds: 1_200,
  maxStartSeconds: 604_800,
  segments: 40,
  speech: 120,
  screenText: 60,
  limitations: 8,
  summaryChars: 4_000,
  titleChars: 200,
  itemChars: 1_500,
  limitationChars: 300,
  speakerChars: 80,
  textBytes: 64_000,
} as const;

export type VideoTimecodeBasis = "absolute" | "clip_relative_shifted";
export type VideoAnalysisSegmentV1 = Readonly<{ startSeconds: number; endSeconds: number; title: string; summary: string }>;
export type VideoAnalysisSpeechV1 = Readonly<{ startSeconds: number; endSeconds: number; speaker: string | null; text: string }>;
export type VideoAnalysisScreenTextV1 = Readonly<{ startSeconds: number; endSeconds: number; text: string }>;
export type VideoAnalysisSourceV1 = Readonly<{
  contract: typeof VIDEO_ANALYSIS_SOURCE_CONTRACT;
  requestedSourceItemId: string;
  requestedUrl: string;
  videoId: string;
  videoUrl: string;
  requestedStartSeconds: number;
  requestedEndSeconds: number;
  observedEndSeconds: number | null;
  timecodeBasis: VideoTimecodeBasis;
  analyzedAt: string;
  modelId: string;
  promptVersion: string;
  method: "gemini_youtube_url";
  originalVideoStored: false;
  captionsAcquired: false;
  summary: string;
  segments: readonly VideoAnalysisSegmentV1[];
  speech: readonly VideoAnalysisSpeechV1[];
  screenText: readonly VideoAnalysisScreenTextV1[];
  limitations: readonly string[];
}>;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com"]);

/** Accepts only public YouTube video URL shapes and returns the canonical watch URL. */
export function parseYouTubeVideoUrl(value: string): Readonly<{ videoId: string; videoUrl: string }> | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = segments.length === 1 ? segments[0] : null;
  else if (YOUTUBE_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === "watch") id = url.searchParams.get("v");
    else if (segments.length === 2 && ["shorts", "live", "embed"].includes(segments[0])) id = segments[1];
  }
  if (!id || !VIDEO_ID.test(id)) return null;
  return { videoId: id, videoUrl: `https://www.youtube.com/watch?v=${id}` };
}

export function formatTimecode(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** A player link at the evidence time. It opens the remote video, which may have changed or been removed. */
export function youtubeTimecodeUrl(videoId: string, seconds: number) {
  if (!VIDEO_ID.test(videoId)) throw new Error("A YouTube video ID is required.");
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function wellFormed(value: string) { return !/[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, "")); }
function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || Boolean(value.trim())) && !value.includes("\u0000") && wellFormed(value);
}
function second(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    && value <= VIDEO_ANALYSIS_LIMITS.maxStartSeconds + VIDEO_ANALYSIS_LIMITS.maxWindowSeconds;
}
function span(item: Record<string, unknown>, start: number, end: number) {
  return second(item.startSeconds) && second(item.endSeconds) && item.startSeconds <= item.endSeconds
    && item.startSeconds >= start && item.endSeconds <= end;
}
function exactKeys(item: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(item).sort(), expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Reads the provenance namespace only. Callers must still prove that a server
 * adapter snapshot introduced the source before labelling it as AI analysis. */
export function readVideoAnalysisSource(metadata: unknown): VideoAnalysisSourceV1 | null {
  if (!record(metadata) || !record(metadata.videoAnalysisV1)) return null;
  const value = metadata.videoAnalysisV1;
  const limits = VIDEO_ANALYSIS_LIMITS;
  if (value.contract !== VIDEO_ANALYSIS_SOURCE_CONTRACT || value.method !== "gemini_youtube_url"
    || value.originalVideoStored !== false || value.captionsAcquired !== false
    || (value.timecodeBasis !== "absolute" && value.timecodeBasis !== "clip_relative_shifted")
    || !text(value.requestedSourceItemId, 200) || !text(value.requestedUrl, 2048) || !text(value.modelId, 120) || !text(value.promptVersion, 120)
    || typeof value.analyzedAt !== "string" || !Number.isFinite(Date.parse(value.analyzedAt))
    || !second(value.requestedStartSeconds) || !second(value.requestedEndSeconds)
    || value.requestedEndSeconds <= value.requestedStartSeconds
    || value.requestedEndSeconds - value.requestedStartSeconds > limits.maxWindowSeconds
    || !(value.observedEndSeconds === null || (second(value.observedEndSeconds)
      && value.observedEndSeconds >= value.requestedStartSeconds && value.observedEndSeconds <= value.requestedEndSeconds))
    || !text(value.summary, limits.summaryChars)) return null;
  const parsed = typeof value.videoUrl === "string" ? parseYouTubeVideoUrl(value.videoUrl) : null;
  if (!parsed || parsed.videoUrl !== value.videoUrl || parsed.videoId !== value.videoId) return null;
  const start = value.requestedStartSeconds, end = value.requestedEndSeconds;
  const list = (items: unknown, max: number) => Array.isArray(items) && items.length <= max && items.every(record);
  if (!list(value.segments, limits.segments) || !list(value.speech, limits.speech) || !list(value.screenText, limits.screenText)
    || !Array.isArray(value.limitations) || value.limitations.length > limits.limitations
    || !value.limitations.every((item) => text(item, limits.limitationChars))) return null;
  const segments = value.segments as Record<string, unknown>[];
  const speech = value.speech as Record<string, unknown>[];
  const screenText = value.screenText as Record<string, unknown>[];
  if (!segments.every((item) => exactKeys(item, ["startSeconds", "endSeconds", "title", "summary"]) && span(item, start, end)
      && text(item.title, limits.titleChars) && text(item.summary, limits.itemChars))
    || !speech.every((item) => exactKeys(item, ["startSeconds", "endSeconds", "speaker", "text"]) && span(item, start, end)
      && (item.speaker === null || text(item.speaker, limits.speakerChars)) && text(item.text, limits.itemChars))
    || !screenText.every((item) => exactKeys(item, ["startSeconds", "endSeconds", "text"]) && span(item, start, end)
      && text(item.text, limits.itemChars))) return null;
  return value as unknown as VideoAnalysisSourceV1;
}

/** The searchable and copyable note. Every line states its evidence time and kind. */
export function renderVideoAnalysisText(value: VideoAnalysisSourceV1) {
  const range = (item: { startSeconds: number; endSeconds: number }) => item.startSeconds === item.endSeconds
    ? formatTimecode(item.startSeconds) : `${formatTimecode(item.startSeconds)}–${formatTimecode(item.endSeconds)}`;
  const lines = [
    `[AI 영상 분석 · 원본 영상·공식 자막 아님] ${formatTimecode(value.requestedStartSeconds)}–${formatTimecode(value.requestedEndSeconds)} 구간`,
    value.videoUrl,
    "",
    `요약: ${value.summary.trim()}`,
  ];
  if (value.segments.length) {
    lines.push("", "구간별 내용");
    for (const item of value.segments) lines.push(`[${range(item)}] ${item.title.trim()} — ${item.summary.trim()}`);
  }
  if (value.speech.length) {
    lines.push("", "들린 발화 (AI 전사 · 공식 자막 아님)");
    for (const item of value.speech) lines.push(`[${range(item)}] ${item.speaker ? `${item.speaker.trim()}: ` : ""}${item.text.trim()}`);
  }
  if (value.screenText.length) {
    lines.push("", "화면 속 텍스트 (AI 판독 · 정확도 미검증)");
    for (const item of value.screenText) lines.push(`[${range(item)}] ${item.text.trim()}`);
  }
  if (value.limitations.length) {
    lines.push("", "분석 한계");
    for (const item of value.limitations) lines.push(`- ${item.trim()}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Parses "90", "1:30" or "1:02:03" into whole seconds; blank means "not set". */
export function parseTimecode(value: string): number | null | undefined {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{1,6}(?::\d{1,2}){0,2}$/.test(text)) return undefined;
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some((part) => part > 59)) return undefined;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isSafeInteger(seconds) && seconds <= VIDEO_ANALYSIS_LIMITS.maxStartSeconds + VIDEO_ANALYSIS_LIMITS.maxWindowSeconds ? seconds : undefined;
}
