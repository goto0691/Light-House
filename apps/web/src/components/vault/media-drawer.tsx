"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { MediaMock } from "@/lib/mock/vault";
import { MEDIA_PROPERTY_DEFINITIONS, MEDIA_PROPERTY_GROUPS } from "@/lib/properties/media";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

type MediaFormState = {
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

const MEDIA_SOURCE_TARGETS: Array<SourcePropertyTarget<MediaFormState> & { value: MediaSourcePropertyTarget }> = [
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
  { value: "relationNote", label: "관계/연결 메모", apply: ({ value }) => ({ relationNote: value.trim() }) },
  { value: "playTime", label: "플레이타임/분", apply: ({ form, value }) => ({ playTime: normalizeNumberText(value) ?? form.playTime }) },
  { value: "pages", label: "페이지", apply: ({ form, value }) => ({ pages: normalizeNumberText(value) ?? form.pages }) },
  { value: "loggedAt", label: "기록일", apply: ({ form, value }) => ({ loggedAt: normalizeDate(value) ?? form.loggedAt }) },
  { value: "startedAt", label: "시작일", apply: ({ form, value }) => ({ startedAt: normalizeDate(value) ?? form.startedAt }) },
  { value: "completedAt", label: "완료일", apply: ({ form, value }) => ({ completedAt: normalizeDate(value) ?? form.completedAt }) },
];

function buildFormState(media: MediaMock): MediaFormState {
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

export function MediaDrawer({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const media = useVaultStore((state) => state.media.find((item) => item.id === id));
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [form, setForm] = useState<MediaFormState | null>(media ? buildFormState(media) : null);

  useEffect(() => {
    setForm(media ? buildFormState(media) : null);
  }, [media]);

  if (!media) {
    return <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">미디어를 찾지 못했습니다.</div>;
  }

  const saveDetails = () => {
    if (!form) return;
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/vault/media/${id}/details`,
          {
            ...form,
            releaseYear: optionalNumber(form.releaseYear),
            rating: optionalNumber(form.rating),
            playTime: optionalNumber(form.playTime),
            pages: optionalNumber(form.pages),
          },
          replaceSnapshot,
        );
        toast.success("미디어 속성을 저장했습니다.");
      } catch (error) {
        toast.error("미디어 속성 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <ContextBundlePanel
      density="drawer"
      enableAttach
      entityId={id}
      entityType="media"
      mainSlot={() => (
        <div className="space-y-4">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary">{media.mediaType}</p>
                <h3 className="mt-2 text-2xl font-semibold text-foreground">{media.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{[media.creator, media.platformOrPublisher, media.genre].filter(Boolean).join(" · ")}</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">{media.status}</span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Detail label="평점" value={media.rating ? `${media.rating}/5` : null} />
              <Detail label="기록일" value={media.loggedAt?.slice(0, 10) ?? null} />
              <Detail label="시작일" value={media.startedAt?.slice(0, 10) ?? null} />
              <Detail label="완료일" value={media.completedAt?.slice(0, 10) ?? null} />
              <Detail label="원제" value={media.originalTitle} />
              <Detail label="세부 타입" value={media.subtype ?? media.screenKind} />
              <Detail label="스튜디오" value={media.studio} />
              <Detail label="출시" value={media.releaseYear ? String(media.releaseYear) : null} />
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs tracking-[0.08em] text-primary">감상</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{media.review}</p>
            {media.evaluation ? <p className="mt-3 text-sm text-muted-foreground">평가: {media.evaluation}</p> : null}
            {media.relationNote ? <p className="mt-2 text-sm text-muted-foreground">연결 메모: {media.relationNote}</p> : null}
          </section>

          {form ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                <div>
                  <p className="text-xs tracking-[0.08em] text-primary">Canonical 속성</p>
                  <h4 className="mt-2 text-lg font-semibold text-foreground">미디어 속성 정리</h4>
                </div>
                <button
                  className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                  disabled={isPending}
                  onClick={saveDetails}
                  type="button"
                >
                  저장
                </button>
              </div>
              <PropertyPanel
                definitions={MEDIA_PROPERTY_DEFINITIONS}
                form={form}
                groups={MEDIA_PROPERTY_GROUPS}
                onChange={(patch) => setForm({ ...form, ...patch })}
              />
            </div>
          ) : null}

          {form ? (
            <SourcePropertyInspector
              canonicalEntityType="media"
              definitions={MEDIA_PROPERTY_DEFINITIONS}
              form={form}
              onChange={(patch) => setForm({ ...form, ...patch })}
              sourceDocument={media.sourceDocument}
              targets={MEDIA_SOURCE_TARGETS}
            />
          ) : null}
        </div>
      )}
      railDefaultLens="source"
    />
  );
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
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
