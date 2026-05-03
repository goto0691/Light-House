"use client";

import { useMemo, useState } from "react";
import { RotateCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { Tag } from "@/components/shared/tag";
import {
  buildZettelForm,
  getZettelOptionLabel,
  type ZettelFormState,
  zettelFormPayload,
  ZETTEL_REVIEW_CADENCE_OPTIONS,
  ZETTEL_SOURCE_RELIABILITY_OPTIONS,
  ZETTEL_STATUS_OPTIONS,
  ZETTEL_TYPE_OPTIONS,
} from "@/components/vault/zettel-form";
import { ZettelPropertiesPanel } from "@/components/vault/zettel-properties-panel";
import { ZettelRelationsPanel } from "@/components/vault/zettel-relations-panel";
import { ZettelSourcePropertiesPanel } from "@/components/vault/zettel-source-properties-panel";
import type { ZettelMock } from "@/lib/mock/vault";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { getZettelDocumentKindLabel } from "@/lib/vault/zettel-properties";
import { useVaultStore } from "@/stores/use-vault-store";

type ZettelReaderPaneProps = {
  zettel?: ZettelMock | null;
  categoryOptions?: string[];
  isPending?: boolean;
  mode?: "existing" | "new";
  contextRefreshKey?: number | string;
  onCancelNew?: () => void;
  onDelete?: () => void;
  onRelationsChanged?: () => void;
  onSaved?: (zettelId: string) => void;
};

export function ZettelReaderPane({
  zettel,
  categoryOptions,
  isPending,
  mode = "existing",
  contextRefreshKey,
  onCancelNew,
  onDelete,
  onRelationsChanged,
  onSaved,
}: ZettelReaderPaneProps) {
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const initialForm = useMemo(() => buildZettelForm(mode === "new" ? null : zettel), [mode, zettel]);
  const draftKey = `${mode}:${zettel?.id ?? "new"}`;
  const initialDraft = useMemo(
    () => ({
      form: initialForm,
      key: draftKey,
      savedSignature: JSON.stringify(initialForm),
    }),
    [draftKey, initialForm],
  );
  const [draft, setDraft] = useState(initialDraft);
  const [isSaving, setIsSaving] = useState(false);
  const activeDraft = draft.key === draftKey ? draft : initialDraft;
  const form = activeDraft.form;
  const signature = JSON.stringify(form);
  const dirty = signature !== activeDraft.savedSignature;
  const documentKindLabel = getZettelDocumentKindLabel(form.documentKind);
  const statusLabel = getZettelOptionLabel(ZETTEL_STATUS_OPTIONS, form.status, form.status);
  const typeLabel = getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, form.type, form.type);

  function patchForm(patch: Partial<ZettelFormState>) {
    setDraft((current) => {
      const base = current.key === draftKey ? current : initialDraft;
      return {
        ...base,
        form: { ...base.form, ...patch },
      };
    });
  }

  function resetDraft() {
    setDraft(initialDraft);
  }

  async function save() {
    if (!form.title.trim()) {
      toast.error("제목은 비워둘 수 없습니다.");
      return;
    }
    if (mode === "existing" && !zettel) return;

    setIsSaving(true);
    try {
      const payload = await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
        mode === "new" ? "/api/vault/zettels" : `/api/vault/zettels/${zettel?.id}/details`,
        zettelFormPayload(form),
        replaceSnapshot,
      );
      const savedId = mode === "new" ? payload.snapshot.selectedZettelId : zettel?.id;
      setDraft((current) => ({
        ...(current.key === draftKey ? current : initialDraft),
        savedSignature: JSON.stringify(form),
      }));
      toast.success(mode === "new" ? "새 Zettel을 만들었습니다." : "Zettel을 저장했습니다.");
      if (savedId) onSaved?.(savedId);
    } catch (error) {
      toast.error("Zettel 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <GlassCard priority="secondary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Tag value={typeLabel} variant="neutral" />
              {documentKindLabel ? <Tag value={documentKindLabel} variant="neutral" /> : null}
              {form.status ? <Tag value={statusLabel} variant="status" /> : null}
              <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {dirty ? "unsaved" : mode === "new" ? "new" : "saved"}
              </span>
            </div>
            <input
              className="mt-4 w-full border-0 bg-transparent font-display text-3xl leading-tight text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => patchForm({ title: event.target.value })}
              placeholder="메모 제목"
              value={form.title}
            />
            <ZettelRecallStrip form={form} zettel={zettel} />
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === "new" && onCancelNew ? (
              <button
                className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8"
                onClick={onCancelNew}
                type="button"
              >
                <X className="h-4 w-4" />
                취소
              </button>
            ) : null}
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!dirty || isSaving}
              onClick={resetDraft}
              type="button"
            >
              <RotateCcw className="h-4 w-4" />
              되돌리기
            </button>
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving || isPending || (!dirty && mode !== "new")}
              onClick={() => void save()}
              type="button"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "저장 중" : "저장"}
            </button>
            {onDelete && mode !== "new" ? (
              <button
                className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending || isSaving}
                onClick={onDelete}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                삭제
              </button>
            ) : null}
          </div>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-muted-foreground">Summary</span>
          <textarea
            className="input-base min-h-32 resize-y leading-6"
            onChange={(event) => patchForm({ summary: event.target.value })}
            placeholder="짧은 요약"
            style={{ minHeight: "8rem" }}
            value={form.summary}
          />
        </label>
      </GlassCard>

      <MarkdownEditor onChange={(content) => patchForm({ content })} value={form.content} />

      <ZettelPropertiesPanel categoryOptions={categoryOptions} form={form} onChange={patchForm} />

      {mode === "existing" && zettel ? <ZettelSourcePropertiesPanel form={form} onChange={patchForm} sourceDocument={zettel.sourceDocument} /> : null}

      {mode === "existing" && zettel ? <ZettelRelationsPanel onChanged={onRelationsChanged} refreshKey={contextRefreshKey} zettelId={zettel.id} /> : null}
    </div>
  );
}

function ZettelRecallStrip({ form, zettel }: { form: ZettelFormState; zettel?: ZettelMock | null }) {
  const reliabilityLabel =
    form.sourceReliability && form.sourceReliability !== "unknown"
      ? getZettelOptionLabel(ZETTEL_SOURCE_RELIABILITY_OPTIONS, form.sourceReliability, form.sourceReliability)
      : "";
  const cadenceLabel =
    form.reviewCadence && form.reviewCadence !== "none" ? getZettelOptionLabel(ZETTEL_REVIEW_CADENCE_OPTIONS, form.reviewCadence, form.reviewCadence) : "";
  const pills = [
    { label: "카테고리", value: form.category },
    { label: "출처", value: form.source },
    { label: "신뢰도", value: reliabilityLabel },
    { label: "주기", value: cadenceLabel },
    { label: "다음 검토", value: formatDateForDisplay(form.reviewDueAt) },
    { label: "원본일", value: formatDateForDisplay(form.originalCreatedAt) },
    { label: "Backlinks", value: zettel?.backlinks.length ? String(zettel.backlinks.length) : "" },
    { label: "Outgoing", value: zettel?.outgoingLinks.length ? String(zettel.outgoingLinks.length) : "" },
  ].filter((pill) => pill.value);
  const tags = form.tags.filter(Boolean).slice(0, 6);
  const aliases = form.aliases.filter(Boolean).slice(0, 4);

  if (!pills.length && !tags.length && !aliases.length) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {pills.map((pill) => (
        <RecallPill key={`${pill.label}:${pill.value}`} label={pill.label} value={pill.value} />
      ))}
      {tags.map((tag) => (
        <RecallPill key={`tag:${tag}`} label="#" value={tag} />
      ))}
      {aliases.map((alias) => (
        <RecallPill key={`alias:${alias}`} label="별칭" value={alias} />
      ))}
    </div>
  );
}

function RecallPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span className="shrink-0 uppercase tracking-[0.12em] text-muted-foreground/80">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </span>
  );
}

function formatDateForDisplay(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}
