"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { ZenEditor } from "@/components/shared/zen-editor";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

export function ZettelsClient() {
  const [isPending, startTransition] = useTransition();
  const zettels = useVaultStore((state) => state.zettels);
  const selectedZettelId = useVaultStore((state) => state.selectedZettelId);
  const selectZettel = useVaultStore((state) => state.selectZettel);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");

  const selected = zettels.find((item) => item.id === selectedZettelId) ?? zettels[0];

  useEffect(() => {
    if (!selected) return;
    setTitleDraft(selected.title);
    setContentDraft(selected.content);
  }, [selected]);

  if (!selected) return null;

  return (
    <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_280px]">
      <GlassCard className="min-h-[640px]">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Zettelkasten</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["Fleeting", "Literature", "Permanent", "MOC"].map((tab) => (
            <button className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground" key={tab} type="button">
              {tab}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {zettels.map((zettel) => (
            <div
              className={`rounded-3xl border p-4 transition ${selected.id === zettel.id ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5"}`}
              key={zettel.id}
            >
              <button
                className="block w-full text-left"
                onClick={() => selectZettel(zettel.id)}
                type="button"
              >
                <p className="text-sm font-medium text-foreground">{zettel.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{zettel.summary}</p>
              </button>
              <div className="mt-3 flex gap-2">
                <Link className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground" href={`/vault?detail=zettel:${zettel.id}`}>
                  Drawer
                </Link>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="space-y-4">
        <GlassCard>
          <p className="text-xs uppercase tracking-[0.24em] text-primary">{selected.type}</p>
          <input
            className="mt-3 w-full rounded-2xl border border-transparent bg-transparent px-0 text-3xl font-semibold text-foreground outline-none focus:border-white/10"
            onChange={(event) => setTitleDraft(event.target.value)}
            value={titleDraft}
          />
          <p className="mt-2 text-sm text-muted-foreground">{selected.category}</p>
          <div className="mt-4">
            <button
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/vault/zettels/${selected.id}/title`,
                      { title: titleDraft },
                      replaceSnapshot,
                    );
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/vault/zettels/${selected.id}/content`,
                      { content: contentDraft },
                      replaceSnapshot,
                    );
                    toast.success("Zettel 변경사항을 저장했습니다.");
                  } catch (error) {
                    toast.error("Zettel 저장에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              저장
            </button>
          </div>
        </GlassCard>

        <ZenEditor
          onChange={setContentDraft}
          serif
          value={contentDraft}
        />
      </div>

      <GlassCard className="min-h-[640px]">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Backlinks</p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground">이 메모를 참조하는 항목</p>
            <div className="mt-3 space-y-2">
              {selected.backlinks.map((item) => (
                <p className="text-sm text-muted-foreground" key={item}>
                  {item}
                </p>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">관련 제안</p>
            <div className="mt-3 space-y-2">
              {selected.related.map((item) => (
                <p className="text-sm text-muted-foreground" key={item}>
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
    </section>
  );
}
