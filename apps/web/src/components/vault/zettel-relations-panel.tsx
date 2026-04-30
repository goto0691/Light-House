"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Clapperboard, FileText, Link2, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import type { ContextBundle, ContextEdge, ContextNode, ContextSearchResult, EntityType } from "@/lib/context/types";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { cn } from "@/lib/utils/cn";
import { useVaultStore } from "@/stores/use-vault-store";

type AttachTargetType = Extract<EntityType, "person" | "media" | "zettel" | "task">;

type ZettelRelationsPanelProps = {
  zettelId: string;
  onChanged?: () => void;
  refreshKey?: number | string;
};

type BundleState = {
  bundle: ContextBundle;
  zettelId: string;
};

type ErrorState = {
  message: string;
  zettelId: string;
};

type SearchState = {
  key: string;
  results: ContextSearchResult[];
};

const ATTACH_TARGETS: Array<{ value: AttachTargetType; label: string }> = [
  { value: "person", label: "사람" },
  { value: "media", label: "미디어" },
  { value: "zettel", label: "메모" },
  { value: "task", label: "작업" },
];

const RELATION_LABELS = [
  { value: "related", label: "관련" },
  { value: "mentions", label: "언급" },
  { value: "evidence", label: "근거" },
  { value: "source", label: "출처" },
  { value: "follow_up", label: "후속" },
];

const TYPE_LABELS: Record<AttachTargetType, string> = {
  media: "미디어",
  person: "사람",
  task: "작업",
  zettel: "메모",
};

export function ZettelRelationsPanel({ zettelId, onChanged, refreshKey }: ZettelRelationsPanelProps) {
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [bundleState, setBundleState] = useState<BundleState | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [targetType, setTargetType] = useState<AttachTargetType>("person");
  const [relationLabel, setRelationLabel] = useState(RELATION_LABELS[0].value);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const trimmedQuery = query.trim();
  const searchKey = `${targetType}:${trimmedQuery}`;
  const bundle = bundleState?.zettelId === zettelId ? bundleState.bundle : null;
  const error = errorState?.zettelId === zettelId ? errorState.message : null;
  const results = useMemo(
    () => (trimmedQuery.length >= 2 && searchState?.key === searchKey ? searchState.results : []),
    [searchKey, searchState, trimmedQuery.length],
  );

  const loadBundle = useCallback(
    async (signal?: AbortSignal) => {
      const payload = await fetchZettelContextBundle(zettelId, signal);
      if (!signal?.aborted) {
        setBundleState({ bundle: payload.bundle, zettelId });
        setErrorState(null);
      }
      return payload.bundle;
    },
    [zettelId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchZettelContextBundle(zettelId, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        setBundleState({ bundle: payload.bundle, zettelId });
        setErrorState(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setErrorState({ message: reason instanceof Error ? reason.message : "relation load failed", zettelId });
      });
    return () => controller.abort();
  }, [localRefreshKey, refreshKey, zettelId]);

  useEffect(() => {
    const controller = new AbortController();
    if (trimmedQuery.length < 2) {
      return () => controller.abort();
    }

    const currentSearchKey = searchKey;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmedQuery, types: targetType });
        const response = await fetch(`/api/context/search?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error("relation search failed");
        const payload = (await response.json()) as { results: ContextSearchResult[] };
        setSearchState({
          key: currentSearchKey,
          results: payload.results.filter((item) => !(item.type === "zettel" && item.id === zettelId)).slice(0, 8),
        });
      } catch {
        if (!controller.signal.aborted) setSearchState({ key: currentSearchKey, results: [] });
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchKey, targetType, trimmedQuery, zettelId]);

  const groups = useMemo(() => {
    if (!bundle) return [];
    return [
      { key: "people", label: "사람", nodes: bundle.grouped.people },
      { key: "media", label: "미디어", nodes: bundle.grouped.media },
      { key: "zettels", label: "연결 메모", nodes: bundle.grouped.zettels },
      { key: "projects", label: "작업", nodes: bundle.grouped.projects },
    ];
  }, [bundle]);
  const relationCount = groups.reduce((count, group) => count + group.nodes.length, 0);

  async function attach(result: ContextSearchResult) {
    if (hasNode(bundle, result)) return;
    setMutatingKey(`attach:${result.type}:${result.id}`);
    try {
      if (result.type === "zettel") {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          "/api/vault/zettel-links",
          { context: relationLabel, sourceId: zettelId, targetId: result.id },
          replaceSnapshot,
        );
      } else {
        const response = await fetch("/api/context/edges", {
          body: JSON.stringify(edgePayload(zettelId, result, relationLabel)),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error("relation attach failed");
      }
      await loadBundle();
      setQuery("");
      onChanged?.();
      toast.success("관계를 추가했습니다.");
    } catch (reason) {
      toast.error("관계 추가에 실패했습니다.", {
        description: reason instanceof Error ? reason.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setMutatingKey(null);
    }
  }

  async function detach(edge: ContextEdge) {
    setMutatingKey(`detach:${edge.id}`);
    try {
      const zettelLinkId = getZettelLinkId(edge);
      if (zettelLinkId) {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/vault/zettel-links/${encodeURIComponent(zettelLinkId)}/delete`,
          undefined,
          replaceSnapshot,
        );
      } else {
        const params = new URLSearchParams({ focusId: zettelId, focusType: "zettel" });
        const response = await fetch(`/api/context/edges/${encodeURIComponent(edge.id)}?${params.toString()}`, { method: "DELETE" });
        if (!response.ok) throw new Error("relation detach failed");
      }
      await loadBundle();
      onChanged?.();
      toast.success("관계를 해제했습니다.");
    } catch (reason) {
      toast.error("관계 해제에 실패했습니다.", {
        description: reason instanceof Error ? reason.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setMutatingKey(null);
    }
  }

  return (
    <GlassCard className="space-y-4" priority="secondary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Relations</p>
        </div>
        <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {relationCount} linked
        </span>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/10 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-md border border-white/10 bg-black/10 p-1">
            {ATTACH_TARGETS.map((item) => (
              <button
                className={cn(
                  "focus-ring min-h-9 rounded px-2.5 text-xs transition",
                  targetType === item.value ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/8 hover:text-foreground",
                )}
                key={item.value}
                onClick={() => setTargetType(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <select className="input-base h-10 w-auto min-w-24 py-0 text-xs" onChange={(event) => setRelationLabel(event.target.value)} value={relationLabel}>
            {RELATION_LABELS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex min-h-11 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`${TYPE_LABELS[targetType]} 검색`}
            value={query}
          />
        </div>

        {query.trim().length >= 2 ? (
          <div className="mt-3 space-y-2">
            {results.length ? (
              results.map((result) => {
                const alreadyLinked = hasNode(bundle, result);
                const key = `attach:${result.type}:${result.id}`;
                return (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-3" key={`${result.type}:${result.id}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{result.title}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{result.subtitle ?? result.type}</p>
                    </div>
                    <button
                      className="focus-ring shrink-0 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={alreadyLinked || mutatingKey !== null}
                      onClick={() => void attach(result)}
                      type="button"
                    >
                      {alreadyLinked ? "연결됨" : mutatingKey === key ? "연결 중" : "연결"}
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="rounded-md border border-dashed border-white/15 bg-white/5 p-3 text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-dashed border-white/15 bg-white/5 p-3 text-sm text-muted-foreground">
          관계를 불러오지 못했습니다.
          <button
            className="ml-2 text-primary underline-offset-4 hover:underline"
            onClick={() => setLocalRefreshKey((value) => value + 1)}
            type="button"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {!bundle && !error ? <p className="rounded-md border border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">관계를 불러오는 중입니다.</p> : null}

      {bundle ? (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <section className="rounded-lg border border-white/10 bg-black/10 p-3" key={group.key}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{group.label}</p>
                <span className="text-[11px] text-muted-foreground">{group.nodes.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {group.nodes.length ? (
                  group.nodes.slice(0, 6).map((node) => (
                    <RelationNodeRow
                      edge={detachableEdgeForNode(bundle, node)}
                      key={`${node.type}:${node.id}`}
                      mutatingKey={mutatingKey}
                      node={node}
                      onDetach={detach}
                    />
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-white/15 bg-white/5 p-3 text-sm text-muted-foreground">비어 있음</p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </GlassCard>
  );
}

function RelationNodeRow({
  edge,
  mutatingKey,
  node,
  onDetach,
}: {
  edge?: ContextEdge;
  mutatingKey: string | null;
  node: ContextNode;
  onDetach: (edge: ContextEdge) => Promise<void>;
}) {
  const detachKey = edge ? `detach:${edge.id}` : "";

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-3">
      <Link className="min-w-0 flex-1" href={node.href}>
        <span className="flex min-w-0 items-center gap-2">
          {iconForType(node.type)}
          <span className="truncate text-sm font-medium text-foreground">{node.title}</span>
        </span>
        {node.subtitle ? <span className="mt-1 block truncate text-xs text-muted-foreground">{node.subtitle}</span> : null}
      </Link>
      {edge ? (
        <button
          aria-label="관계 해제"
          className="focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/10 text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          disabled={mutatingKey !== null}
          onClick={() => void onDetach(edge)}
          type="button"
        >
          {mutatingKey === detachKey ? <span className="h-2 w-2 rounded-full bg-primary" /> : <Trash2 className="h-4 w-4" />}
        </button>
      ) : null}
    </div>
  );
}

function edgePayload(zettelId: string, target: ContextSearchResult, label: string) {
  if (target.type === "task") {
    return {
      focusId: target.id,
      focusType: "task",
      label,
      targetId: zettelId,
      targetType: "zettel",
    };
  }

  return {
    focusId: zettelId,
    focusType: "zettel",
    label,
    targetId: target.id,
    targetType: target.type,
  };
}

function detachableEdgeForNode(bundle: ContextBundle, node: ContextNode) {
  return bundle.edges.find((edge) => edge.kind === "explicit" && isDetachableEdge(edge) && touchesNode(edge, node));
}

function getZettelLinkId(edge: ContextEdge) {
  const prefix = "explicit:zettel_links:";
  if (!edge.id.startsWith(prefix)) return null;
  return edge.id.slice(prefix.length);
}

function hasNode(bundle: ContextBundle | null, node: Pick<ContextNode, "id" | "type">) {
  return Boolean(bundle?.nodes.some((item) => item.id === node.id && item.type === node.type));
}

function isDetachableEdge(edge: ContextEdge) {
  return (
    edge.id.startsWith("explicit:zettel_links:") ||
    edge.id.startsWith("explicit:zettel_people_relations:") ||
    edge.id.startsWith("explicit:zettel_media_relations:") ||
    edge.id.startsWith("explicit:task_zettel_relations:")
  );
}

function touchesNode(edge: ContextEdge, node: ContextNode) {
  return (edge.from.type === node.type && edge.from.id === node.id) || (edge.to.type === node.type && edge.to.id === node.id);
}

function iconForType(type: EntityType) {
  switch (type) {
    case "person":
      return <UserRound className="h-4 w-4 shrink-0 text-primary" />;
    case "media":
      return <Clapperboard className="h-4 w-4 shrink-0 text-primary" />;
    case "task":
      return <CheckSquare className="h-4 w-4 shrink-0 text-primary" />;
    default:
      return <FileText className="h-4 w-4 shrink-0 text-primary" />;
  }
}

async function fetchZettelContextBundle(zettelId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/context/zettel/${encodeURIComponent(zettelId)}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error("relation load failed");
  return response.json() as Promise<{ bundle: ContextBundle }>;
}
