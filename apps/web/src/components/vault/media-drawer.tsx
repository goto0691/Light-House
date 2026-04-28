"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { SourceDocumentPanel } from "@/components/shared/source-document-panel";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import type { MediaMock } from "@/lib/mock/vault";
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
              <Detail label="Rating" value={media.rating ? `${media.rating}/5` : null} />
              <Detail label="Logged" value={media.loggedAt?.slice(0, 10) ?? null} />
              <Detail label="Started" value={media.startedAt?.slice(0, 10) ?? null} />
              <Detail label="Completed" value={media.completedAt?.slice(0, 10) ?? null} />
              <Detail label="Original Title" value={media.originalTitle} />
              <Detail label="Subtype" value={media.subtype ?? media.screenKind} />
              <Detail label="Studio" value={media.studio} />
              <Detail label="Release" value={media.releaseYear ? String(media.releaseYear) : null} />
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Review</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{media.review}</p>
            {media.evaluation ? <p className="mt-3 text-sm text-muted-foreground">평가: {media.evaluation}</p> : null}
            {media.relationNote ? <p className="mt-2 text-sm text-muted-foreground">연결 메모: {media.relationNote}</p> : null}
          </section>

          {form ? (
            <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-primary">Edit Canonical Fields</p>
                  <h4 className="mt-2 text-lg font-semibold text-foreground">미디어 속성 정리</h4>
                </div>
                <button
                  className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  disabled={isPending}
                  onClick={saveDetails}
                  type="button"
                >
                  저장
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="제목" value={form.title} onChange={(title) => setForm({ ...form, title })} />
                <Field label="원제" value={form.originalTitle} onChange={(originalTitle) => setForm({ ...form, originalTitle })} />
                <SelectField
                  label="타입"
                  onChange={(mediaType) => setForm({ ...form, mediaType: mediaType as MediaMock["mediaType"] })}
                  options={["game", "book", "screen"]}
                  value={form.mediaType}
                />
                <SelectField
                  label="상태"
                  onChange={(status) => setForm({ ...form, status: status as MediaMock["status"] })}
                  options={["backlog", "consuming", "completed", "dropped"]}
                  value={form.status}
                />
                <Field label="창작자" value={form.creator} onChange={(creator) => setForm({ ...form, creator })} />
                <Field label="저자" value={form.author} onChange={(author) => setForm({ ...form, author })} />
                <Field label="스튜디오" value={form.studio} onChange={(studio) => setForm({ ...form, studio })} />
                <Field label="플랫폼/출판사" value={form.platformOrPublisher} onChange={(platformOrPublisher) => setForm({ ...form, platformOrPublisher })} />
                <Field label="장르" value={form.genre} onChange={(genre) => setForm({ ...form, genre })} />
                <Field label="세부 타입" value={form.subtype} onChange={(subtype) => setForm({ ...form, subtype })} />
                <Field label="출시연도" value={form.releaseYear} onChange={(releaseYear) => setForm({ ...form, releaseYear })} />
                <Field label="평점" value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
                <Field label="플레이타임/분" value={form.playTime} onChange={(playTime) => setForm({ ...form, playTime })} />
                <Field label="페이지" value={form.pages} onChange={(pages) => setForm({ ...form, pages })} />
                <Field label="기록일" type="date" value={form.loggedAt} onChange={(loggedAt) => setForm({ ...form, loggedAt })} />
                <Field label="완료일" type="date" value={form.completedAt} onChange={(completedAt) => setForm({ ...form, completedAt })} />
              </div>
              <div className="mt-3 grid gap-3">
                <TextArea label="감상" value={form.review} onChange={(review) => setForm({ ...form, review })} />
                <TextArea label="내용 메모" value={form.content} onChange={(content) => setForm({ ...form, content })} />
                <TextArea label="관계/연결 메모" value={form.relationNote} onChange={(relationNote) => setForm({ ...form, relationNote })} />
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <input checked={form.rewatchValue} onChange={(event) => setForm({ ...form, rewatchValue: event.target.checked })} type="checkbox" />
                다시 볼 가치 있음
              </label>
            </section>
          ) : null}

          <SourceDocumentPanel sourceDocument={media.sourceDocument} />
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
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function Field({ label, onChange, type = "text", value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return (
    <label className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
      {label}
      <input
        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function SelectField({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <label className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
      {label}
      <select
        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextArea({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
      {label}
      <textarea
        className="mt-2 min-h-[96px] w-full resize-y rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case leading-6 tracking-normal text-foreground outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}
