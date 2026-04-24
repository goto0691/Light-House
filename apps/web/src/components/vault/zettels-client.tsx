"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { BacklinkPanel } from "@/components/vault/backlink-panel";
import { ZettelCard } from "@/components/vault/zettel-card";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { Tag } from "@/components/shared/tag";
import { ZenEditor } from "@/components/shared/zen-editor";
import type { SearchItem } from "@/lib/mock/search";
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
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<"fleeting" | "literature" | "permanent" | "moc">("fleeting");
  const [newCategory, setNewCategory] = useState("");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [semanticResults, setSemanticResults] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const selected = zettels.find((item) => item.id === selectedZettelId) ?? zettels[0];
  const linkCandidates = useMemo(() => zettels.filter((item) => item.id !== selected?.id), [selected?.id, zettels]);
  const visibleZettels = zettels.filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (query && !`${item.title} ${item.summary} ${item.category}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (!selected) return;
    setTitleDraft(selected.title);
    setContentDraft(selected.content);
    if (linkCandidates[0]?.id) {
      setLinkTargetId(linkCandidates[0].id);
    }
  }, [selected, linkCandidates]);

  useEffect(() => {
    let cancelled = false;

    async function loadSemanticResults() {
      if (!selected?.title.trim()) {
        setSemanticResults([]);
        return;
      }

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(selected.title)}&types=zettel&semantic=1`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { results: SearchItem[] };
        if (!cancelled) {
          setSemanticResults(payload.results.filter((item) => item.type === "zettel" && item.id !== selected.id).slice(0, 6));
        }
      } catch {
        if (!cancelled) {
          setSemanticResults([]);
        }
      }
    }

    void loadSemanticResults();

    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.title]);

  if (!selected) {
    return (
      <EmptyState
        cta={{ label: "첫 Zettel 쓰기", hotkey: "Cmd+N", onClick: () => {} }}
        description="생각은 쓰는 순간 연결을 얻습니다. 첫 메모를 만들어 Vault에 불을 켜보세요."
        illustration="zettel"
        title="첫 번째 원석을 던져보세요"
      />
    );
  }

  return (
    <PageLayout>
      <PageHeader
        eyebrow="Vault"
        title="Zettelkasten"
        description="메모 목록, 편집 캔버스, 링크 패널을 고정된 3영역으로 다룹니다."
        actions={
          <span className="rounded-md border border-white/10 bg-black/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {visibleZettels.length} notes
          </span>
        }
      />

      <PageToolbar>
        <FilterBar
          filters={[
            {
              kind: "select",
              key: "type",
              label: "Type",
              options: [
                { value: "fleeting", label: "Fleeting" },
                { value: "literature", label: "Literature" },
                { value: "permanent", label: "Permanent" },
                { value: "moc", label: "MOC" },
              ],
            },
          ]}
          onChange={(state) => {
            setQuery(state.q);
            setTypeFilter(typeof state.filters.type === "string" ? state.filters.type : "");
          }}
          searchPlaceholder="메모 제목, 요약, 카테고리 검색"
        />
      </PageToolbar>

      <PageBody
        aside={
          <div className="space-y-4">
            <GlassCard priority="secondary">
              <p className="text-xs uppercase tracking-[0.24em] text-primary">Link Composer</p>
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-sm font-medium text-foreground">이 메모에서 연결</p>
                <div className="mt-3 space-y-3">
                  <select className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setLinkTargetId(event.target.value)} value={linkTargetId}>
                    {linkCandidates.map((zettel) => (
                      <option key={zettel.id} value={zettel.id}>
                        {zettel.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                    disabled={isPending || !linkTargetId}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            "/api/vault/zettel-links",
                            { sourceId: selected.id, targetId: linkTargetId },
                            replaceSnapshot,
                          );
                          toast.success("메모 링크를 추가했습니다.");
                        } catch (error) {
                          toast.error("메모 링크 추가에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    링크 추가
                  </button>
                </div>
              </div>
            </GlassCard>

            <BacklinkPanel
              isPending={isPending}
              onRemoveLink={(linkId) => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/vault/zettel-links/${linkId}/delete`,
                      undefined,
                      replaceSnapshot,
                    );
                    toast.success("메모 링크를 제거했습니다.");
                  } catch (error) {
                    toast.error("메모 링크 제거에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              onSelectSemantic={(id) => selectZettel(id)}
              semanticResults={semanticResults}
              zettel={selected}
            />
          </div>
        }
        asidePosition="right"
        asideWidth="lg"
      >
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <GlassCard className="min-h-[640px]" priority="secondary">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Zettelkasten</p>

          <div className="mt-4 rounded-3xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">새 메모</p>
          <div className="mt-3 space-y-3">
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setNewTitle(event.target.value)} placeholder="메모 제목" value={newTitle} />
            <div className="grid gap-3 md:grid-cols-2">
              <select className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setNewType(event.target.value as "fleeting" | "literature" | "permanent" | "moc")} value={newType}>
                <option value="fleeting">Fleeting</option>
                <option value="literature">Literature</option>
                <option value="permanent">Permanent</option>
                <option value="moc">MOC</option>
              </select>
              <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setNewCategory(event.target.value)} placeholder="카테고리" value={newCategory} />
            </div>
            <button
              className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      "/api/vault/zettels",
                      { title: newTitle, type: newType, category: newCategory },
                      replaceSnapshot,
                    );
                    setNewTitle("");
                    setNewCategory("");
                    toast.success("새 Zettel을 만들었습니다.");
                  } catch (error) {
                    toast.error("메모 생성에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              메모 생성
            </button>
          </div>
          </div>

          <div className="mt-4 space-y-3">
            {visibleZettels.length ? visibleZettels.map((zettel) => (
              <ZettelCard
                actions={
                  <>
                    <Link className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" href={`/vault?detail=zettel:${zettel.id}`}>
                  Drawer
                    </Link>
                    <button
                      className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                              `/api/vault/zettels/${zettel.id}/delete`,
                              undefined,
                              replaceSnapshot,
                            );
                            toast.success("Zettel을 삭제했습니다.");
                          } catch (error) {
                            toast.error("메모 삭제에 실패했습니다.", {
                              description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                            });
                          }
                        });
                      }}
                      type="button"
                    >
                  삭제
                    </button>
                  </>
                }
                key={zettel.id}
                onSelect={() => selectZettel(zettel.id)}
                selected={selected.id === zettel.id}
                zettel={zettel}
              />
            )) : (
              <EmptyState description="검색어나 타입 필터를 바꾸면 다른 메모들이 다시 나타납니다." illustration="zettel" title="이 조건에 맞는 메모가 없습니다" />
            )}
          </div>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard priority="secondary">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-primary">{selected.type}</p>
                <input
                  className="mt-3 w-full rounded-2xl border border-transparent bg-transparent px-0 font-display text-4xl text-foreground outline-none focus:border-white/10"
                  onChange={(event) => setTitleDraft(event.target.value)}
                  value={titleDraft}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Tag value={selected.category} variant="custom" />
                  <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {selected.related.length} related
                  </span>
                </div>
              </div>
              <button
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
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

          <ZenEditor onChange={setContentDraft} serif value={contentDraft} />
        </div>
        </div>
      </PageBody>
    </PageLayout>
  );
}
