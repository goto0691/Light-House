import { describe, expect, test, vi } from "vitest";

import { V2ModelError, type V2StructuredModelGateway, type V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { GeminiProviderError } from "@/lib/v2/ai/gemini-role-gateways";
import { toGeminiResponseJsonSchema } from "@/lib/v2/ai/gemini-wire-schema";
import {
  buildVideoAnalysisRequest, resolveVideoAnalysis, VIDEO_ANALYSIS_CONTRACT, VideoAnalysisValidationError, videoAnalysisJsonSchema,
} from "@/lib/v2/ai/video-analysis-v1";
import { analyzeYouTubeVideo } from "@/lib/v2/collect/youtube-video-analysis";
import {
  formatTimecode, parseTimecode, parseYouTubeVideoUrl, readVideoAnalysisSource, renderVideoAnalysisText, youtubeTimecodeUrl,
  VIDEO_ANALYSIS_SOURCE_CONTRACT, type VideoAnalysisSourceV1,
} from "@/lib/v2/domain/video-analysis-source";

const video = { videoId: "jNQXAC9IVRw", videoUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw" };

function output(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: VIDEO_ANALYSIS_CONTRACT, summary: "합성 영상 요약입니다.",
    segments: [{ start_seconds: 65, end_seconds: 80, title: "소개", summary: "화면에 제목이 나온다." }],
    speech: [{ start_seconds: 66, end_seconds: 70, speaker: null, text: "Hello there" }],
    screen_text: [{ start_seconds: 70, end_seconds: 70, text: "--ar 3:2" }],
    observed_end_seconds: 90, limitations: ["음성이 일부 작다."], ...overrides,
  };
}

function note(overrides: Partial<VideoAnalysisSourceV1> = {}): VideoAnalysisSourceV1 {
  return {
    contract: VIDEO_ANALYSIS_SOURCE_CONTRACT, requestedSourceItemId: "source-1", requestedUrl: "https://youtu.be/jNQXAC9IVRw?si=abc",
    ...video, requestedStartSeconds: 60, requestedEndSeconds: 120, observedEndSeconds: 90, timecodeBasis: "absolute",
    analyzedAt: "2026-09-28T09:00:00.000Z", modelId: "gemini-3.6-flash", promptVersion: "youtube-video-analysis-timecoded.v1",
    method: "gemini_youtube_url", originalVideoStored: false, captionsAcquired: false, summary: "요약",
    segments: [{ startSeconds: 65, endSeconds: 80, title: "소개", summary: "내용" }],
    speech: [{ startSeconds: 66, endSeconds: 70, speaker: "진행자", text: "Hello" }],
    screenText: [{ startSeconds: 70, endSeconds: 70, text: "--ar 3:2" }], limitations: [], ...overrides,
  };
}

describe("YouTube URL and timecode helpers", () => {
  test.each([
    ["https://www.youtube.com/watch?v=jNQXAC9IVRw&t=30s", "jNQXAC9IVRw"],
    ["https://youtu.be/jNQXAC9IVRw?si=tracking", "jNQXAC9IVRw"],
    ["https://m.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://youtube.com/shorts/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://www.youtube.com/live/jNQXAC9IVRw", "jNQXAC9IVRw"],
  ])("accepts %s", (url, id) => {
    expect(parseYouTubeVideoUrl(url)).toEqual({ videoId: id, videoUrl: `https://www.youtube.com/watch?v=${id}` });
  });

  test.each([
    "http://www.youtube.com/watch?v=jNQXAC9IVRw", "https://user:pw@youtube.com/watch?v=jNQXAC9IVRw", "https://youtube.com:8443/watch?v=jNQXAC9IVRw",
    "https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/@channel", "https://evil.example/watch?v=jNQXAC9IVRw",
    "https://youtube.com.evil.example/watch?v=jNQXAC9IVRw", "https://www.youtube.com/watch?v=short", "not a url",
  ])("rejects %s", (url) => { expect(parseYouTubeVideoUrl(url)).toBeNull(); });

  test("formats and parses timecodes", () => {
    expect(formatTimecode(5)).toBe("0:05");
    expect(formatTimecode(3723)).toBe("1:02:03");
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("90")).toBe(90);
    expect(parseTimecode("1:30")).toBe(90);
    expect(parseTimecode("1:02:03")).toBe(3723);
    expect(parseTimecode("1:75")).toBeUndefined();
    expect(parseTimecode("-3")).toBeUndefined();
    expect(youtubeTimecodeUrl(video.videoId, 65.9)).toBe("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=65s");
  });
});

describe("video analysis provenance", () => {
  test("reads a valid note and renders every item with its time and kind", () => {
    const value = note();
    expect(readVideoAnalysisSource({ videoAnalysisV1: value })).toEqual(value);
    const text = renderVideoAnalysisText(value);
    expect(text).toContain("[AI 영상 분석 · 원본 영상·공식 자막 아님] 1:00–2:00 구간");
    expect(text).toContain("[1:05–1:20] 소개 — 내용");
    expect(text).toContain("들린 발화 (AI 전사 · 공식 자막 아님)\n[1:06–1:10] 진행자: Hello");
    expect(text).toContain("화면 속 텍스트 (AI 판독 · 정확도 미검증)\n[1:10] --ar 3:2");
  });

  test.each([
    ["claims the original video is stored", { originalVideoStored: true }],
    ["claims captions", { captionsAcquired: true }],
    ["places an item outside the clip", { segments: [{ startSeconds: 10, endSeconds: 20, title: "t", summary: "s" }] }],
    ["mismatches video id and URL", { videoId: "AAAAAAAAAAA" }],
    ["uses a non-canonical video URL", { videoUrl: "https://youtu.be/jNQXAC9IVRw" }],
    ["exceeds the window", { requestedEndSeconds: 60 + 1_201 }],
    ["adds an unknown item key", { speech: [{ startSeconds: 66, endSeconds: 70, speaker: null, text: "x", extra: 1 }] }],
    ["has an empty summary", { summary: "  " }],
  ])("rejects a note that %s", (_name, overrides) => {
    expect(readVideoAnalysisSource({ videoAnalysisV1: note(overrides as Partial<VideoAnalysisSourceV1>) })).toBeNull();
  });
});

describe("provider request and output validation", () => {
  test("sends only the public video part, clip offsets and a data-only focus hint", async () => {
    const request = await buildVideoAnalysisRequest({ ...video, range: { startSeconds: 60, endSeconds: 120 }, purpose: "prompt" });
    expect(request).toMatchObject({ role: "main_analyzer", schemaId: VIDEO_ANALYSIS_CONTRACT, deadlineMs: 110_000 });
    expect(request.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(request.parts?.[0]).toEqual({ fileData: { fileUri: video.videoUrl }, videoMetadata: { startOffset: "60s", endOffset: "120s" } });
    expect(JSON.parse((request.parts?.[1] as { text: string }).text)).toMatchObject({ clip: { start_seconds: 60, end_seconds: 120 } });
    expect(JSON.stringify(toGeminiResponseJsonSchema(videoAnalysisJsonSchema))).not.toMatch(/"(?:maxItems|maxLength|minLength)":/);
    await expect(buildVideoAnalysisRequest({ ...video, range: { startSeconds: 0, endSeconds: 1_201 }, purpose: "reference" })).rejects.toThrow(RangeError);
  });

  test("keeps absolute timecodes and sorts them inside the clip", () => {
    const resolved = resolveVideoAnalysis(output({ segments: [
      { start_seconds: 100, end_seconds: 110, title: "뒤", summary: "b" }, { start_seconds: 61, end_seconds: 70.4, title: "앞", summary: "a" },
    ] }), { startSeconds: 60, endSeconds: 120 });
    expect(resolved.timecodeBasis).toBe("absolute");
    expect(resolved.segments.map((item) => [item.startSeconds, item.endSeconds, item.title])).toEqual([[61, 71, "앞"], [100, 110, "뒤"]]);
    expect(resolved.observedEndSeconds).toBe(90);
  });

  test("shifts clip-relative timecodes when every time precedes the clip start", () => {
    const resolved = resolveVideoAnalysis(output({
      segments: [{ start_seconds: 5, end_seconds: 20, title: "소개", summary: "x" }],
      speech: [{ start_seconds: 6, end_seconds: 10, speaker: null, text: "Hello" }], screen_text: [], observed_end_seconds: 30,
    }), { startSeconds: 60, endSeconds: 120 });
    expect(resolved.timecodeBasis).toBe("clip_relative_shifted");
    expect(resolved.segments[0]).toMatchObject({ startSeconds: 65, endSeconds: 80 });
    expect(resolved.observedEndSeconds).toBe(90);
  });

  test("clamps small overshoot but rejects times far outside the clip or out of contract", () => {
    expect(resolveVideoAnalysis(output({ observed_end_seconds: 121.5 }), { startSeconds: 60, endSeconds: 120 }).observedEndSeconds).toBe(120);
    expect(() => resolveVideoAnalysis(output({ segments: [{ start_seconds: 65, end_seconds: 400, title: "t", summary: "s" }] }), { startSeconds: 60, endSeconds: 120 }))
      .toThrow(VideoAnalysisValidationError);
    expect(() => resolveVideoAnalysis(output({ summary: "" }), { startSeconds: 60, endSeconds: 120 })).toThrow(VideoAnalysisValidationError);
    expect(() => resolveVideoAnalysis(output({ contract_version: "other" }), { startSeconds: 60, endSeconds: 120 })).toThrow(VideoAnalysisValidationError);
    expect(() => resolveVideoAnalysis(output({ segments: Array.from({ length: 41 }, () => ({ start_seconds: 65, end_seconds: 66, title: "t", summary: "s" })) }),
      { startSeconds: 60, endSeconds: 120 })).toThrow(VideoAnalysisValidationError);
  });
});

describe("explicit video analysis runtime", () => {
  function governor(allowed = true, state = "healthy") {
    return {
      tryAcquire: vi.fn(async () => allowed ? { allowed: true as const, state: "healthy" as const, retryAt: null }
        : { allowed: false as const, state: state as "quota_exhausted", retryAt: "2026-09-29T07:05:00.000Z" }),
      release: vi.fn(async () => undefined), recordSuccess: vi.fn(async () => undefined), recordFailure: vi.fn(async () => undefined),
    };
  }
  function gateway(result: (request: V2StructuredModelRequest) => unknown): V2StructuredModelGateway & { calls: number } {
    return { calls: 0, async generate<T>(request: V2StructuredModelRequest) {
      this.calls += 1;
      const data = result(request);
      if (data instanceof Error) throw data;
      return { data: data as T, role: "main_analyzer", modelId: "fake:video", inputHash: request.inputHash, outputHash: "out", latencyMs: 5 };
    } };
  }
  const input = { ...video, range: { startSeconds: 60, endSeconds: 120 }, purpose: "video_note" as const };

  test("a paused governor refuses before any provider call", async () => {
    const paused = governor(false, "quota_exhausted"), fake = gateway(() => output());
    await expect(analyzeYouTubeVideo({ gateway: fake, governor: paused, video: input, workerId: "test" }))
      .resolves.toEqual({ status: "rejected", code: "video_quota_exhausted", retryAt: "2026-09-29T07:05:00.000Z" });
    expect(fake.calls).toBe(0);
    expect(paused.release).not.toHaveBeenCalled();
  });

  test("success records governor success and returns placed timecodes", async () => {
    const permit = governor(), fake = gateway(() => output());
    const outcome = await analyzeYouTubeVideo({ gateway: fake, governor: permit, video: input, workerId: "test" });
    expect(outcome).toMatchObject({ status: "analyzed", modelId: "fake:video", result: { summary: "합성 영상 요약입니다." } });
    expect(permit.recordSuccess).toHaveBeenCalledTimes(1);
    expect(permit.release).toHaveBeenCalledTimes(1);
  });

  test("a daily quota failure forwards the provider delay to the governor", async () => {
    const permit = governor();
    const quota = new GeminiProviderError({ status: 429, category: "quota_or_rate_limit", code: "quota_exhausted", retryable: true, quotaWindow: "daily", retryAfterMs: 3_600_000 });
    const outcome = await analyzeYouTubeVideo({ gateway: gateway(() => quota), governor: permit, video: input, workerId: "test", now: () => new Date("2026-09-28T09:00:00.000Z") });
    expect(outcome).toEqual({ status: "rejected", code: "video_quota_exhausted", retryAt: "2026-09-28T10:00:00.000Z" });
    expect(permit.recordFailure).toHaveBeenCalledWith("main_analyzer", expect.any(String), "quota_exhausted", expect.any(Date), 3_600_000);
    expect(permit.release).toHaveBeenCalledTimes(1);
  });

  test.each([
    [new GeminiProviderError({ status: 400, category: "invalid_request", code: "provider_unavailable", retryable: false }), "video_not_accessible"],
    [new GeminiProviderError({ status: 403, category: "permission_or_model_access", code: "provider_unavailable", retryable: false }), "video_not_accessible"],
    [new GeminiProviderError({ status: 503, category: "provider_server", code: "provider_unavailable", retryable: true }), "video_provider_busy"],
    [new V2ModelError("timeout", "slow", true), "video_timeout"],
  ])("maps a provider failure to %s", async (error, code) => {
    await expect(analyzeYouTubeVideo({ gateway: gateway(() => error), governor: governor(), video: input, workerId: "test" }))
      .resolves.toMatchObject({ status: "rejected", code });
  });

  test("an invalid provider output is not saved and still counts as a provider success for pacing", async () => {
    const permit = governor();
    await expect(analyzeYouTubeVideo({ gateway: gateway(() => output({ segments: [{ start_seconds: 5_000, end_seconds: 5_001, title: "t", summary: "s" }] })), governor: permit, video: input, workerId: "test" }))
      .resolves.toMatchObject({ status: "rejected", code: "video_analysis_invalid" });
    expect(permit.recordSuccess).toHaveBeenCalledTimes(1);
    expect(permit.recordFailure).not.toHaveBeenCalled();
  });
});
