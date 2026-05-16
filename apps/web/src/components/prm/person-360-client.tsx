"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { ContextNodeCard } from "@/components/shared/context/context-node-card";
import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { SmartAttachPanel } from "@/components/shared/context/smart-attach-panel";
import type { ContextBundle, ContextNode } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";

type Person360Lens = "timeline" | "media" | "projects" | "notes" | "places" | "gifts" | "source";

const LENSES: Array<{ key: Person360Lens; label: string }> = [
  { key: "timeline", label: "타임라인" },
  { key: "media", label: "미디어" },
  { key: "projects", label: "프로젝트" },
  { key: "notes", label: "지식" },
  { key: "places", label: "장소" },
  { key: "gifts", label: "선물" },
  { key: "source", label: "원본 기록" },
];

function edgeNodes(bundle: ContextBundle, predicate: (node: ContextNode) => boolean) {
  return bundle.nodes.filter((node) => !(node.type === bundle.focus.type && node.id === bundle.focus.id)).filter(predicate);
}

export function Person360Client({ bundle }: { bundle: ContextBundle }) {
  const [activeLens, setActiveLens] = useState<Person360Lens>("timeline");
  const [currentBundle, setCurrentBundle] = useState(bundle);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const lensNodes = useMemo(() => {
    return {
      timeline: edgeNodes(currentBundle, (node) => ["daily_log", "interaction", "gift", "task", "zettel"].includes(node.type)),
      media: currentBundle.grouped.media,
      projects: currentBundle.grouped.projects,
      notes: currentBundle.grouped.zettels,
      places: currentBundle.grouped.places,
      gifts: edgeNodes(currentBundle, (node) => node.type === "gift"),
      source: currentBundle.grouped.source,
    };
  }, [currentBundle]);
  const edgeCount = currentBundle.summary?.edgeCount ?? currentBundle.edges.length;

  function openNode(node: ContextNode) {
    if (node.type === "source_document" || node.type === "tag") {
      router.push(node.href);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("detail", `${currentBundle.focus.type}:${currentBundle.focus.id},${node.type}:${node.id}`);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const mainSlot = (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">관계 상세</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">{currentBundle.focus.title}</h2>
            {currentBundle.focus.subtitle ? <p className="mt-2 text-sm text-muted-foreground">{currentBundle.focus.subtitle}</p> : null}
          </div>
          <Link className="focus-ring rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-white/8 hover:text-foreground" href={`/prm/${currentBundle.focus.id}/edit`} scroll={false}>
            관계 편집
          </Link>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="관계선" value={String(edgeCount)} />
        <Metric label="미디어" value={String(lensNodes.media.length)} />
        <Metric label="지식" value={String(lensNodes.notes.length)} />
        <Metric label="검토" value={String(currentBundle.quality.unresolvedCount)} />
      </section>

      <ContextMapMini bundle={currentBundle} onOpenNode={openNode} />

      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap gap-2">
          {LENSES.map((lens) => (
            <button
              aria-pressed={activeLens === lens.key}
              className={cn(
                "focus-ring min-h-9 rounded-md border px-3 text-xs",
                activeLens === lens.key ? "border-primary/40 bg-primary/12 text-primary" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground",
              )}
              key={lens.key}
              onClick={() => setActiveLens(lens.key)}
              type="button"
            >
              {lens.label} {lensNodes[lens.key].length}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {lensNodes[activeLens].length ? (
            lensNodes[activeLens].map((node) => (
              <ContextNodeCard
                edges={currentBundle.edges.filter((edge) => edge.from.id === node.id || edge.to.id === node.id)}
                key={`${node.type}:${node.id}`}
                node={node}
                onOpen={openNode}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">이 렌즈에는 아직 연결된 데이터가 없습니다.</div>
          )}
        </div>
      </section>

      <SmartAttachPanel focusId={currentBundle.focus.id} focusType="person" onAttached={setCurrentBundle} />
    </div>
  );

  return (
    <EntityContextShell
      bundle={currentBundle}
      density="page"
      mainSlot={mainSlot}
      onBundleUpdate={setCurrentBundle}
      onDetachEdge={(edge) => {
        void fetch(`/api/context/edges/${encodeURIComponent(edge.id)}?focusType=person&focusId=${encodeURIComponent(currentBundle.focus.id)}`, { method: "DELETE" })
          .then((response) => response.json() as Promise<{ bundle: ContextBundle }>)
          .then((payload) => setCurrentBundle(payload.bundle));
      }}
      onOpenNode={openNode}
      railDefaultLens="people"
    />
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
