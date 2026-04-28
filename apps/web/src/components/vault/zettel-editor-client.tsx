"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { PageBody, PageHeader, PageLayout } from "@/components/shared/page-layout";
import { ZettelLinkComposer } from "@/components/vault/zettel-link-composer";
import { buildZettelForm, type ZettelFormState, zettelFormPayload } from "@/components/vault/zettel-form";
import { ZettelPropertiesPanel } from "@/components/vault/zettel-properties-panel";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

type ZettelEditorClientProps = {
  mode: "new" | "edit";
  zettelId?: string;
};

export function ZettelEditorClient({ mode, zettelId }: ZettelEditorClientProps) {
  const router = useRouter();
  const zettels = useVaultStore((state) => state.zettels);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const zettel = zettels.find((item) => item.id === zettelId);
  const initialForm = useMemo(() => buildZettelForm(mode === "edit" ? zettel : null), [mode, zettel]);
  const formKey = `${mode}:${zettel?.id ?? "new"}`;
  const initialDraft = useMemo(
    () => ({
      form: initialForm,
      key: formKey,
      savedSignature: JSON.stringify(initialForm),
    }),
    [formKey, initialForm],
  );
  const [draft, setDraft] = useState(initialDraft);
  const activeDraft = draft.key === formKey ? draft : initialDraft;
  const form = activeDraft.form;
  const savedSignature = activeDraft.savedSignature;
  const [isSaving, setIsSaving] = useState(false);
  const signature = JSON.stringify(form);
  const dirty = signature !== savedSignature;
  const canLink = mode === "edit" && Boolean(zettel);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (mode === "edit" && !zettel) {
    return (
      <EmptyState
        cta={{ label: "Zettels로 돌아가기", onClick: () => router.push("/vault/zettels") }}
        description="편집하려는 메모를 현재 Vault 스냅샷에서 찾지 못했습니다."
        illustration="zettel"
        title="메모를 찾지 못했습니다"
      />
    );
  }

  function patchForm(patch: Partial<ZettelFormState>) {
    setDraft((current) => {
      const base = current.key === formKey ? current : initialDraft;
      return {
        ...base,
        form: { ...base.form, ...patch },
      };
    });
  }

  async function save() {
    setIsSaving(true);
    try {
      if (mode === "new") {
        const payload = await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          "/api/vault/zettels",
          zettelFormPayload(form),
          replaceSnapshot,
        );
        const nextId = payload.snapshot?.selectedZettelId;
        setDraft((current) => ({ ...(current.key === formKey ? current : initialDraft), savedSignature: JSON.stringify(form) }));
        toast.success("새 Zettel을 만들었습니다.");
        if (nextId) router.replace(`/vault/zettels/${nextId}/edit`);
        return nextId ?? null;
      }

      if (!zettelId) return null;
      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
        `/api/vault/zettels/${zettelId}/details`,
        zettelFormPayload(form),
        replaceSnapshot,
      );
      setDraft((current) => ({ ...(current.key === formKey ? current : initialDraft), savedSignature: JSON.stringify(form) }));
      toast.success("Zettel 변경사항을 저장했습니다.");
      return zettelId;
    } catch (error) {
      toast.error("Zettel 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAndRead() {
    const id = await save();
    if (id) router.push(`/vault/zettels/${id}`);
  }

  function addLink(targetId: string) {
    if (!zettelId) return;
    setIsSaving(true);
    void postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
      "/api/vault/zettel-links",
      { sourceId: zettelId, targetId },
      replaceSnapshot,
    )
      .then(() => toast.success("메모 링크를 추가했습니다."))
      .catch((error: unknown) => {
        toast.error("메모 링크 추가에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      })
      .finally(() => setIsSaving(false));
  }

  return (
    <PageLayout>
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8"
              href={mode === "edit" && zettelId ? `/vault/zettels/${zettelId}` : "/vault/zettels"}
              onClick={(event) => {
                if (!dirty) return;
                if (!window.confirm("저장하지 않은 변경사항이 있습니다. 읽기 모드로 나갈까요?")) event.preventDefault();
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              읽기 모드
            </Link>
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={() => void saveAndRead()}
              type="button"
            >
              <BookOpen className="h-4 w-4" />
              저장 후 읽기
            </button>
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={() => void save()}
              type="button"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "저장 중" : dirty ? "저장" : "저장됨"}
            </button>
          </div>
        }
        description="입력 모드는 작성과 속성 편집에만 집중합니다. 링크와 컨텍스트는 오른쪽 패널에서 함께 정리합니다."
        eyebrow={mode === "new" ? "New Zettel" : "Edit Zettel"}
        title={mode === "new" ? "새 메모 작성" : "메모 편집"}
      />

      <PageBody
        aside={
          <div className="space-y-4">
            <ZettelPropertiesPanel form={form} onChange={patchForm} />
            {canLink ? (
              <ZettelLinkComposer candidates={zettels} currentZettelId={zettelId} disabled={isSaving} onAddLink={addLink} />
            ) : (
              <GlassCard priority="secondary">
                <p className="text-xs uppercase tracking-[0.2em] text-primary">Links</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">새 메모는 한 번 저장한 뒤 링크를 연결할 수 있습니다.</p>
              </GlassCard>
            )}
            {canLink && zettelId ? (
              <ContextBundlePanel
                density="drawer"
                enableAttach
                entityId={zettelId}
                entityType="zettel"
                mainSlot={(bundle) => <ContextMapMini bundle={bundle} />}
                railDefaultLens="zettels"
                refreshKey={zettelId}
              />
            ) : null}
          </div>
        }
        asidePosition="right"
        asideWidth="lg"
      >
        <div className="space-y-4">
          <GlassCard priority="secondary">
            <label className="block">
              <span className="mb-3 block text-xs uppercase tracking-[0.2em] text-primary">Title</span>
              <input
                autoFocus
                className="w-full rounded-md border border-white/10 bg-black/10 px-4 py-4 font-display text-3xl leading-tight text-foreground outline-none transition focus:border-primary/35"
                onChange={(event) => patchForm({ title: event.target.value })}
                placeholder="메모 제목"
                value={form.title}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5">{form.type}</span>
              <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5">{form.category || "미분류"}</span>
              <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5">{dirty ? "저장 필요" : "저장됨"}</span>
            </div>
          </GlassCard>

          <MarkdownEditor onChange={(content) => patchForm({ content })} value={form.content} />
        </div>
      </PageBody>
    </PageLayout>
  );
}
