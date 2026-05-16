"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { MediaMock } from "@/lib/mock/vault";
import { MEDIA_PROPERTY_DEFINITIONS, MEDIA_PROPERTY_GROUPS } from "@/lib/properties/media";
import { postJsonMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

type MediaPropertyForm = {
  title: string;
  mediaType: MediaMock["mediaType"];
  originalTitle: string;
  subtype: string;
  platformOrPublisher: string;
  creator: string;
  studio: string;
  genre: string;
  releaseYear: string;
  status: MediaMock["status"];
  rating: string;
  evaluation: string;
  review: string;
  content: string;
  relationNote: string;
  playTime: string;
  author: string;
  pages: string;
  screenKind: string;
  rewatchValue: boolean;
  loggedAt: string;
  startedAt: string;
  completedAt: string;
};

type MediaPropertyMode = "summary" | "detail" | "edit" | "source";

type MediaSourcePropertyTarget =
  | "skip"
  | "title"
  | "originalTitle"
  | "mediaType"
  | "status"
  | "creator"
  | "author"
  | "studio"
  | "platformOrPublisher"
  | "genre"
  | "subtype"
  | "screenKind"
  | "releaseYear"
  | "rating"
  | "review"
  | "content"
  | "relationNote"
  | "playTime"
  | "pages"
  | "loggedAt"
  | "startedAt"
  | "completedAt";

const MEDIA_SOURCE_TARGETS: Array<SourcePropertyTarget<MediaPropertyForm> & { value: MediaSourcePropertyTarget }> = [
  { value: "skip", label: "원본 유지" },
  { value: "title", label: "제목", apply: ({ value }) => ({ title: compactSingleLine(value, 120) }) },
  { value: "originalTitle", label: "원제", apply: ({ value }) => ({ originalTitle: compactSingleLine(value, 160) }) },
  { value: "mediaType", label: "미디어 타입", apply: ({ form, value }) => ({ mediaType: normalizeMediaType(value) ?? form.mediaType }) },
  { value: "status", label: "상태", apply: ({ form, value }) => ({ status: normalizeMediaStatus(value) ?? form.status }) },
  { value: "creator", label: "창작자", apply: ({ value }) => ({ creator: compactSingleLine(value, 120) }) },
  { value: "author", label: "저자", apply: ({ value }) => ({ author: compactSingleLine(value, 120) }) },
  { value: "studio", label: "스튜디오", apply: ({ value }) => ({ studio: compactSingleLine(value, 120) }) },
  { value: "platformOrPublisher", label: "플랫폼/출판사", apply: ({ value }) => ({ platformOrPublisher: compactSingleLine(value, 120) }) },
  { value: "genre", label: "장르", apply: ({ value }) => ({ genre: compactSingleLine(value, 120) }) },
  { value: "subtype", label: "세부 타입", apply: ({ value }) => ({ subtype: compactSingleLine(value, 80) }) },
  { value: "screenKind", label: "영상 종류", apply: ({ value }) => ({ screenKind: compactSingleLine(value, 80) }) },
  { value: "releaseYear", label: "출시연도", apply: ({ form, value }) => ({ releaseYear: normalizeYear(value) ?? form.releaseYear }) },
  { value: "rating", label: "평점", apply: ({ form, value }) => ({ rating: normalizeNumberText(value) ?? form.rating }) },
  { value: "review", label: "감상", apply: ({ value }) => ({ review: value.trim() }) },
  { value: "content", label: "내용 메모", apply: ({ value }) => ({ content: value.trim() }) },
  { value: "relationNote", label: "관계/연결 설명", apply: ({ value }) => ({ relationNote: value.trim() }) },
  { value: "playTime", label: "플레이타임/분", apply: ({ form, value }) => ({ playTime: normalizeNumberText(value) ?? form.playTime }) },
  { value: "pages", label: "페이지", apply: ({ form, value }) => ({ pages: normalizeNumberText(value) ?? form.pages }) },
  { value: "loggedAt", label: "기록일", apply: ({ form, value }) => ({ loggedAt: normalizeDate(value) ?? form.loggedAt }) },
  { value: "startedAt", label: "시작일", apply: ({ form, value }) => ({ startedAt: normalizeDate(value) ?? form.startedAt }) },
  { value: "completedAt", label: "완료일", apply: ({ form, value }) => ({ completedAt: normalizeDate(value) ?? form.completedAt }) },
];

export function MediaPropertiesPanel({ media }: { media: MediaMock }) {
  const [isPending, startTransition] = useTransition();
  const upsertMedia = useVaultStore((state) => state.upsertMedia);
  const [activeMedia, setActiveMedia] = useState(media);
  const [form, setForm] = useState<MediaPropertyForm>(() => buildMediaPropertyForm(activeMedia));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedMediaId, setSyncedMediaId] = useState(activeMedia.id);
  const [mode, setMode] = useState<MediaPropertyMode>("summary");

  useEffect(() => {
    setActiveMedia(media);
  }, [media]);

  useEffect(() => {
    if (isDirty && activeMedia.id === syncedMediaId) return;
    setForm(buildMediaPropertyForm(activeMedia));
    setSyncedMediaId(activeMedia.id);
    setIsDirty(false);
    setMode("summary");
  }, [activeMedia, isDirty, syncedMediaId]);

  function saveProperties() {
    startTransition(async () => {
      try {
        const payload = await postJsonMutation<{ media: MediaMock }>(`/api/vault/media/${activeMedia.id}/details`, {
          ...form,
          releaseYear: optionalNumber(form.releaseYear),
          rating: optionalNumber(form.rating),
          playTime: optionalNumber(form.playTime),
          pages: optionalNumber(form.pages),
        });
        if (payload.media) {
          setActiveMedia(payload.media);
          upsertMedia(payload.media);
        }
        setIsDirty(false);
        setMode("summary");
        toast.success("미디어 속성을 저장했습니다.");
      } catch (error) {
        toast.error("미디어 속성 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">미디어 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">요약으로 먼저 보고, 필요할 때만 자세히 보거나 편집합니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["summary", "요약"],
              ["detail", "상세"],
              ["edit", "편집"],
              ["source", "원본"],
            ] as const).map(([key, label]) => (
              <button
                aria-pressed={mode === key}
                className={`focus-ring min-h-9 rounded-md border px-3 py-1.5 text-xs ${
                  mode === key ? "border-primary/25 bg-primary/10 text-primary" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground"
                }`}
                key={key}
                onClick={() => setMode(key)}
                type="button"
              >
                {label}
              </button>
            ))}
            {mode === "edit" || mode === "source" ? (
              <button className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={isPending || !form.title.trim()} onClick={saveProperties} type="button">
                {isPending ? "저장 중..." : "속성 저장"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {mode === "summary" || mode === "detail" ? (
        <section className="rounded-lg border border-white/10 bg-white/5 p-4">
          <PropertySummary
            definitions={MEDIA_PROPERTY_DEFINITIONS}
            groups={MEDIA_PROPERTY_GROUPS}
            mode={mode === "summary" ? "list" : "all"}
            record={activeMedia}
            title={mode === "summary" ? "핵심 속성" : "전체 속성"}
          />
        </section>
      ) : null}

      {mode === "edit" ? (
        <PropertyPanel
          definitions={MEDIA_PROPERTY_DEFINITIONS}
          form={form}
          groups={MEDIA_PROPERTY_GROUPS}
          onChange={(patch) => {
            setIsDirty(true);
            setForm((current) => ({ ...current, ...patch }));
          }}
        />
      ) : null}

      {mode === "source" ? (
        <SourcePropertyInspector
          canonicalEntityType="media"
          definitions={MEDIA_PROPERTY_DEFINITIONS}
          form={form}
          onChange={(patch) => {
            setIsDirty(true);
            setForm((current) => ({ ...current, ...patch }));
          }}
          sourceDocument={activeMedia.sourceDocument}
          targets={MEDIA_SOURCE_TARGETS}
        />
      ) : null}
    </div>
  );
}

function buildMediaPropertyForm(media: MediaMock): MediaPropertyForm {
  return {
    title: media.title,
    mediaType: media.mediaType,
    originalTitle: media.originalTitle ?? "",
    subtype: media.subtype ?? "",
    platformOrPublisher: media.platformOrPublisher ?? "",
    creator: media.creator === "Unknown" ? "" : media.creator,
    studio: media.studio ?? "",
    genre: media.genre ?? "",
    releaseYear: media.releaseYear ? String(media.releaseYear) : "",
    status: media.status,
    rating: media.rating ? String(media.rating) : "",
    evaluation: media.evaluation ?? "",
    review: media.review === "감상이 아직 없습니다." ? "" : media.review,
    content: media.content ?? "",
    relationNote: media.relationNote ?? "",
    playTime: media.playTime ? String(media.playTime) : "",
    author: media.author ?? "",
    pages: media.pages ? String(media.pages) : "",
    screenKind: media.screenKind ?? "",
    rewatchValue: Boolean(media.rewatchValue),
    loggedAt: media.loggedAt?.slice(0, 10) ?? "",
    startedAt: media.startedAt?.slice(0, 10) ?? "",
    completedAt: media.completedAt?.slice(0, 10) ?? "",
  };
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

function compactSingleLine(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeMediaType(value: string): MediaMock["mediaType"] | null {
  const text = normalize(value);
  if (text.includes("game") || text.includes("게임")) return "game";
  if (text.includes("book") || text.includes("책") || text.includes("도서")) return "book";
  if (text.includes("screen") || text.includes("movie") || text.includes("film") || text.includes("video") || text.includes("영상") || text.includes("영화")) return "screen";
  return null;
}

function normalizeMediaStatus(value: string): MediaMock["status"] | null {
  const text = normalize(value);
  if (text.includes("backlog") || text.includes("대기") || text.includes("예정")) return "backlog";
  if (text.includes("consuming") || text.includes("watching") || text.includes("reading") || text.includes("진행") || text.includes("보는 중") || text.includes("읽는 중")) return "consuming";
  if (text.includes("completed") || text.includes("done") || text.includes("완료") || text.includes("끝")) return "completed";
  if (text.includes("dropped") || text.includes("중단") || text.includes("포기")) return "dropped";
  return null;
}

function normalizeNumberText(value: string) {
  const match = value.replaceAll(",", "").match(/-?\d+(\.\d+)?/);
  return match ? match[0] : null;
}

function normalizeYear(value: string) {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

function normalizeDate(value: string) {
  const direct = value.match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (direct) return `${direct[1]}-${direct[2].padStart(2, "0")}-${direct[3].padStart(2, "0")}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
