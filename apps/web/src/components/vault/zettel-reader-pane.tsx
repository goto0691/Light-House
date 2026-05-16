"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, PencilLine, RotateCcw, Save, Settings2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { MarkdownView } from "@/components/shared/markdown-view";
import { PropertySummary } from "@/components/shared/properties/property-summary";
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
import { ZETTEL_PROPERTY_DEFINITIONS, ZETTEL_PROPERTY_GROUPS } from "@/lib/properties/zettel";
import { getZettelDocumentKindLabel } from "@/lib/vault/zettel-properties";
import { cn } from "@/lib/utils/cn";

type ZettelReaderPaneProps = {
  zettel?: ZettelMock | null;
  categoryOptions?: string[];
  isPending?: boolean;
  mode?: "existing" | "new";
  contextRefreshKey?: number | string;
  onBackToList?: () => void;
  onCancelNew?: () => void;
  onDelete?: () => void;
  onRelationsChanged?: () => void;
  onSaved?: (zettelId: string) => void;
  onZettelChange?: (zettel: ZettelMock) => void;
  onZettelsChange?: (zettels: ZettelMock[]) => void;
};

export function ZettelReaderPane({
  zettel,
  categoryOptions,
  isPending,
  mode = "existing",
  contextRefreshKey,
  onBackToList,
  onCancelNew,
  onDelete,
  onRelationsChanged,
  onSaved,
  onZettelChange,
  onZettelsChange,
}: ZettelReaderPaneProps) {
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
  const [editingContent, setEditingContent] = useState(mode === "new");
  const [propertyMode, setPropertyMode] = useState<"summary" | "detail" | "edit">("summary");
  const activeDraft = draft.key === draftKey ? draft : initialDraft;
  const form = activeDraft.form;
  const signature = JSON.stringify(form);
  const dirty = signature !== activeDraft.savedSignature;
  const documentKindLabel = getZettelDocumentKindLabel(form.documentKind);
  const statusLabel = getZettelOptionLabel(ZETTEL_STATUS_OPTIONS, form.status, form.status);
  const typeLabel = getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, form.type, form.type);
  const isEditingContent = mode === "new" || editingContent;
  const effectivePropertyMode = mode === "new" ? "edit" : propertyMode;
  const isEditingProperties = effectivePropertyMode === "edit";
  const showEditControls = isEditingContent || isEditingProperties || dirty;
  const containerClassName = cn(
    "mx-auto space-y-4",
    isEditingContent || effectivePropertyMode !== "summary" ? "max-w-6xl" : "max-w-4xl",
  );

  useEffect(() => {
    setEditingContent(mode === "new");
    setPropertyMode("summary");
  }, [draftKey, mode]);

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
      const response = await fetch(mode === "new" ? "/api/vault/zettels" : `/api/vault/zettels/${zettel?.id}/details`, {
        body: JSON.stringify(zettelFormPayload(form)),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as { zettel?: ZettelMock | null; selectedZettelId?: string; error?: string } | null;
      if (!response.ok || !payload?.zettel) throw new Error(payload?.error ?? "지식 저장에 실패했습니다.");
      onZettelChange?.(payload.zettel);
      const savedId = mode === "new" ? payload.selectedZettelId ?? payload.zettel.id : payload.zettel.id ?? zettel?.id;
      setDraft((current) => ({
        ...(current.key === draftKey ? current : initialDraft),
        savedSignature: JSON.stringify(form),
      }));
      toast.success(mode === "new" ? "새 지식을 만들었습니다." : "지식을 저장했습니다.");
      if (mode === "existing") {
        setEditingContent(false);
        setPropertyMode("summary");
      }
      if (savedId) onSaved?.(savedId);
    } catch (error) {
      toast.error("지식 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  const titleSummaryCard = (
    <GlassCard priority="secondary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tag value={typeLabel} variant="neutral" />
            {documentKindLabel ? <Tag value={documentKindLabel} variant="neutral" /> : null}
            {form.status ? <Tag value={statusLabel} variant="status" /> : null}
            <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] tracking-[0.08em] text-muted-foreground">
              {dirty ? "저장 전" : mode === "new" ? "새 지식" : "저장됨"}
            </span>
          </div>
          {isEditingContent ? (
            <input
              className="mt-4 w-full border-0 bg-transparent font-display text-3xl leading-tight text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => patchForm({ title: event.target.value })}
              placeholder="지식 제목"
              value={form.title}
            />
          ) : (
            <h1 className="mt-4 font-display text-3xl leading-tight text-foreground">{form.title}</h1>
          )}
          <ZettelRecallStrip form={form} zettel={zettel} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {onBackToList && mode !== "new" ? (
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground hover:bg-white/8"
              onClick={onBackToList}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              목록
            </button>
          ) : null}
          {mode !== "new" ? (
            <>
              <div className="flex rounded-md border border-white/10 bg-black/10 p-1">
                {([
                  ["summary", "요약", Eye],
                  ["detail", "자세히", Settings2],
                  ["edit", "속성 수정", PencilLine],
                ] as const).map(([key, label, Icon]) => (
                  <button
                    aria-pressed={effectivePropertyMode === key}
                    className={cn(
                      "focus-ring inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-xs",
                      effectivePropertyMode === key ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/8 hover:text-foreground",
                    )}
                    key={key}
                    onClick={() => setPropertyMode(key)}
                    type="button"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <button
                aria-pressed={isEditingContent}
                className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground hover:bg-white/8"
                onClick={() => setEditingContent((value) => !value)}
                type="button"
              >
                {isEditingContent ? <Eye className="h-4 w-4" /> : <PencilLine className="h-4 w-4" />}
                {isEditingContent ? "읽기" : "본문 편집"}
              </button>
            </>
          ) : null}
          {mode === "new" && onCancelNew ? (
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground hover:bg-white/8"
              onClick={onCancelNew}
              type="button"
            >
              <X className="h-4 w-4" />
              취소
            </button>
          ) : null}
          {showEditControls ? (
            <>
              <button
                className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!dirty || isSaving}
                onClick={resetDraft}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
                되돌리기
              </button>
              <button
                className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving || isPending || (!dirty && mode !== "new")}
                onClick={() => void save()}
                type="button"
              >
                <Save className="h-4 w-4" />
                {isSaving ? "저장 중" : "저장"}
              </button>
            </>
          ) : null}
          {onDelete && mode !== "new" ? (
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
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

      {isEditingContent ? (
        <label className="mt-5 block">
          <span className="mb-2 block text-xs tracking-[0.08em] text-muted-foreground">요약</span>
          <textarea
            className="input-base min-h-32 resize-y leading-6"
            onChange={(event) => patchForm({ summary: event.target.value })}
            placeholder="짧은 요약"
            style={{ minHeight: "8rem" }}
            value={form.summary}
          />
        </label>
      ) : form.summary ? (
        <p className="mt-5 rounded-md border border-white/10 bg-black/10 p-4 text-sm leading-7 text-foreground">{form.summary}</p>
      ) : null}
    </GlassCard>
  );

  const propertySurface =
    effectivePropertyMode === "detail" ? (
      <GlassCard priority="secondary">
        <PropertySummary
          definitions={ZETTEL_PROPERTY_DEFINITIONS}
          groups={ZETTEL_PROPERTY_GROUPS}
          mode="all"
          record={form}
          title="속성 자세히"
        />
      </GlassCard>
    ) : effectivePropertyMode === "edit" ? (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <ZettelPropertiesPanel categoryOptions={categoryOptions} form={form} onChange={patchForm} />
        {mode === "existing" && zettel ? <ZettelSourcePropertiesPanel compact form={form} onChange={patchForm} sourceDocument={zettel.sourceDocument} /> : null}
      </div>
    ) : null;
  const relationsPanel = mode === "existing" && zettel ? <ZettelRelationsPanel onChanged={onRelationsChanged} onZettelsChange={onZettelsChange} refreshKey={contextRefreshKey} zettelId={zettel.id} /> : null;

  return (
    <div className={containerClassName}>
      {titleSummaryCard}
      {propertySurface}

      {isEditingContent ? (
        <MarkdownEditor onChange={(content) => patchForm({ content })} value={form.content} />
      ) : (
        <GlassCard className="px-5 py-6 md:px-8 md:py-8" priority="secondary">
          <MarkdownView value={form.content} />
        </GlassCard>
      )}
      {relationsPanel}
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
    { label: "역링크", value: zettel?.backlinks.length ? String(zettel.backlinks.length) : "" },
    { label: "연결", value: zettel?.outgoingLinks.length ? String(zettel.outgoingLinks.length) : "" },
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
