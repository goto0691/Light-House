"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Workflow } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { BacklinkPanel } from "@/components/vault/backlink-panel";
import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import { ZettelCard } from "@/components/vault/zettel-card";
import { ZettelLinkComposer } from "@/components/vault/zettel-link-composer";
import { ZettelReaderPane } from "@/components/vault/zettel-reader-pane";
import { DOCUMENT_KIND_OPTIONS, ZETTEL_STATUS_OPTIONS, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
import type { SearchItem } from "@/lib/mock/search";
import type { ZettelMock } from "@/lib/mock/vault";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import type { SavedView } from "@/lib/server/ui-state";
import { useVaultStore } from "@/stores/use-vault-store";

type ZettelsClientProps = {
  savedViews: SavedView[];
  selectedZettelId?: string;
};

const LIST_PAGE_SIZE = 40;

export function ZettelsClient({ savedViews, selectedZettelId }: ZettelsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const zettels = useVaultStore((state) => state.zettels);
  const storeSelectedZettelId = useVaultStore((state) => state.selectedZettelId);
  const selectZettel = useVaultStore((state) => state.selectZettel);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [documentKindFilter, setDocumentKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryTags, setCategoryTags] = useState<string[]>([]);
  const [semanticResults, setSemanticResults] = useState<SearchItem[]>([]);
  const activeViewKey = searchParams.get("view") ?? savedViews.find((view) => view.isDefault)?.viewKey ?? savedViews[0]?.viewKey ?? "all";
  const activeView = savedViews.find((view) => view.viewKey === activeViewKey) ?? savedViews.find((view) => view.isDefault) ?? savedViews[0];
  const resolvedSelectedId = selectedZettelId ?? storeSelectedZettelId;
  const filterKey = [activeViewKey, query, typeFilter, documentKindFilter, statusFilter, categoryTags.join("|")].join("\u0000");
  const [visiblePage, setVisiblePage] = useState({ key: filterKey, limit: LIST_PAGE_SIZE });
  const visibleLimit = visiblePage.key === filterKey ? visiblePage.limit : LIST_PAGE_SIZE;

  const documentKindOptions = useMemo(() => {
    const values = new Set(DOCUMENT_KIND_OPTIONS.map((option) => option.value));
    zettels.forEach((zettel) => {
      if (zettel.documentKind) values.add(zettel.documentKind);
    });
    return Array.from(values).map((value) => ({
      value,
      label: DOCUMENT_KIND_OPTIONS.find((option) => option.value === value)?.label ?? value,
    }));
  }, [zettels]);

  const viewZettels = activeView ? zettels.filter((item) => zettelMatchesSavedView(item, activeView)) : zettels;
  const visibleZettels = viewZettels.filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (documentKindFilter && item.documentKind !== documentKindFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (categoryTags.length && !categoryTags.some((tag) => item.category.toLowerCase().includes(tag.toLowerCase()))) return false;
    if (query && !`${item.title} ${item.summary} ${item.category} ${item.documentKind ?? ""} ${item.source ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const selected = zettels.find((item) => item.id === resolvedSelectedId) ?? visibleZettels[0] ?? zettels[0];
  const listedZettels = visibleZettels.slice(0, visibleLimit);
  const linkCandidates = zettels.filter((item) => item.id !== selected?.id);

  useEffect(() => {
    if (!selected?.id) return;
    if (storeSelectedZettelId !== selected.id) selectZettel(selected.id);
  }, [selectZettel, selected?.id, storeSelectedZettelId]);

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
          setSemanticResults(payload.results.filter((item) => item.type === "zettel" && item.id !== selected.id).slice(0, 8));
        }
      } catch {
        if (!cancelled) setSemanticResults([]);
      }
    }

    void loadSemanticResults();

    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.title]);

  function openZettel(id: string) {
    selectZettel(id);
    router.push(`/vault/zettels/${id}`);
  }

  function addLink(targetId: string) {
    if (!selected) return;
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          "/api/vault/zettel-links",
          { sourceId: selected.id, targetId },
          replaceSnapshot,
        );
        toast.success("메모 링크를 추가했습니다.");
      } catch (error) {
        toast.error("메모 링크 추가에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function removeLink(linkId: string) {
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
  }

  function deleteSelected() {
    if (!selected || !window.confirm(`"${selected.title}" 메모를 삭제할까요?`)) return;
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/vault/zettels/${selected.id}/delete`,
          undefined,
          replaceSnapshot,
        );
        toast.success("Zettel을 삭제했습니다.");
        router.push("/vault/zettels");
      } catch (error) {
        toast.error("메모 삭제에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  if (!zettels.length) {
    return (
      <EmptyState
        cta={{ label: "첫 Zettel 쓰기", hotkey: "Cmd+N", onClick: () => router.push("/vault/zettels/new") }}
        description="생각은 쓰는 순간 연결을 얻습니다. 첫 메모를 만들어 Vault에 불을 켜보세요."
        illustration="zettel"
        title="첫 번째 원석을 던져보세요"
      />
    );
  }

  return (
    <PageLayout>
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" href="/vault/zettels/new">
              <Plus className="h-4 w-4" />
              새 메모
            </Link>
            <Link className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8" href="/vault/zettels/graph">
              <Workflow className="h-4 w-4" />
              Graph
            </Link>
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {visibleZettels.length} notes
            </span>
          </div>
        }
        description="읽기 모드에서는 탐색, 독서, 연결 확인만 다룹니다. 작성과 속성 편집은 별도 입력 모드에서 이어집니다."
        eyebrow="Vault"
        title="Zettelkasten"
      />

      <PageToolbar>
        <SavedViewTabs activeViewKey={activeView?.viewKey ?? activeViewKey} basePath="/vault/zettels" views={savedViews} />
        <FilterBar
          filters={[
            { kind: "select", key: "type", label: "Type", options: ZETTEL_TYPE_OPTIONS },
            { kind: "select", key: "documentKind", label: "Kind", options: documentKindOptions },
            { kind: "select", key: "status", label: "Status", options: ZETTEL_STATUS_OPTIONS },
            { kind: "tag", key: "category", label: "Category tag" },
          ]}
          onChange={(state) => {
            setQuery(state.q);
            setTypeFilter(typeof state.filters.type === "string" ? state.filters.type : "");
            setDocumentKindFilter(typeof state.filters.documentKind === "string" ? state.filters.documentKind : "");
            setStatusFilter(typeof state.filters.status === "string" ? state.filters.status : "");
            setCategoryTags(Array.isArray(state.filters.category) ? state.filters.category : []);
          }}
          searchPlaceholder="메모 제목, 요약, 카테고리 검색"
        />
      </PageToolbar>

      <PageBody
        aside={
          selected ? (
            <div className="space-y-4">
              <ZettelLinkComposer candidates={linkCandidates} currentZettelId={selected.id} disabled={isPending} onAddLink={addLink} semanticResults={semanticResults} />
              <BacklinkPanel
                isPending={isPending}
                onRemoveLink={removeLink}
                onSelectSemantic={openZettel}
                semanticResults={semanticResults}
                zettel={selected}
              />
              <ContextBundlePanel
                density="drawer"
                enableAttach
                entityId={selected.id}
                entityType="zettel"
                mainSlot={(bundle) => <ContextMapMini bundle={bundle} />}
                railDefaultLens="zettels"
                refreshKey={selected.id}
              />
            </div>
          ) : null
        }
        asidePosition="right"
        asideWidth="lg"
        className="zettels-read-body"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
          <GlassCard className="max-h-none xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto" priority="secondary">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary">Notes</p>
                <p className="mt-1 text-xs text-muted-foreground">목록은 읽기와 선택만 담당합니다.</p>
              </div>
              <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {listedZettels.length}/{visibleZettels.length}
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {listedZettels.length ? (
                listedZettels.map((zettel) => (
                  <ZettelCard key={zettel.id} onSelect={() => openZettel(zettel.id)} selected={selected?.id === zettel.id} zettel={zettel} />
                ))
              ) : (
                <EmptyState description="검색어나 필터를 바꾸면 다른 메모들이 다시 나타납니다." illustration="zettel" title="이 조건에 맞는 메모가 없습니다" />
              )}
            </div>
            {visibleLimit < visibleZettels.length ? (
              <button
                className="focus-ring mt-4 w-full rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground transition hover:bg-white/8"
                onClick={() =>
                  setVisiblePage((current) => ({
                    key: filterKey,
                    limit: (current.key === filterKey ? current.limit : LIST_PAGE_SIZE) + LIST_PAGE_SIZE,
                  }))
                }
                type="button"
              >
                더 보기
              </button>
            ) : null}
          </GlassCard>

          {selected ? (
            <ZettelReaderPane isPending={isPending} onDelete={deleteSelected} zettel={selected} />
          ) : (
            <EmptyState description="왼쪽 목록에서 메모를 선택해 읽기 화면을 엽니다." illustration="zettel" title="읽을 메모를 선택해 주세요" />
          )}
        </div>
      </PageBody>
    </PageLayout>
  );
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function normalizeFilterValue(value: string) {
  return value.toLowerCase().replaceAll("_", " ").trim();
}

function zettelMatchesSavedView(item: ZettelMock, view: SavedView) {
  const kinds = asStringArray(view.filterState.kind).map(normalizeFilterValue);
  const statuses = asStringArray(view.filterState.status).map(normalizeFilterValue);
  const itemKind = normalizeFilterValue(item.documentKind ?? "");
  const itemStatus = normalizeFilterValue(item.status ?? "");
  const haystack = normalizeFilterValue(`${item.documentKind ?? ""} ${item.category} ${item.title} ${item.summary}`);

  if (kinds.length && !kinds.some((kind) => itemKind === kind || haystack.includes(kind))) return false;
  if (statuses.length && !statuses.includes(itemStatus)) return false;
  return true;
}
