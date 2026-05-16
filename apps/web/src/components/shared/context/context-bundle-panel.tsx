"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { SmartAttachPanel } from "@/components/shared/context/smart-attach-panel";
import type { ContextBundle, ContextEdge, ContextLensKey, ContextNode, EntityType } from "@/lib/context/types";

export function ContextBundlePanel({
  entityType,
  entityId,
  density = "drawer",
  enableAttach = false,
  railDefaultLens,
  refreshKey,
  mainSlot,
}: {
  entityType: EntityType;
  entityId: string;
  density?: "drawer" | "page" | "compact";
  enableAttach?: boolean;
  railDefaultLens?: ContextLensKey;
  refreshKey?: number | string;
  mainSlot: (bundle: ContextBundle) => React.ReactNode;
}) {
  const [bundle, setBundle] = useState<ContextBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void fetch(`/api/context/${entityType}/${encodeURIComponent(entityId)}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("맥락을 불러오지 못했습니다.");
        return response.json() as Promise<{ bundle: ContextBundle }>;
      })
      .then((payload) => {
        if (!cancelled) setBundle(payload.bundle);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "맥락을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, entityType, refreshKey]);

  function openNode(node: ContextNode) {
    if (node.type === "source_document" || node.type === "tag") {
      router.push(node.href);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    const current = params.get("detail")?.split(",").filter(Boolean) ?? [];
    const next = [`${entityType}:${entityId}`, `${node.type}:${node.id}`].filter((value, index, array) => array.indexOf(value) === index).slice(0, 2);
    params.set("detail", next.length > 1 ? next.join(",") : current.join(",") || `${node.type}:${node.id}`);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function detachEdge(edge: ContextEdge) {
    const response = await fetch(
      `/api/context/edges/${encodeURIComponent(edge.id)}?${new URLSearchParams({ focusType: entityType, focusId: entityId }).toString()}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error("관계 해제에 실패했습니다.");
    const payload = (await response.json()) as { bundle: ContextBundle };
    setBundle(payload.bundle);
  }

  if (error) {
    return <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">{error}</div>;
  }

  if (!bundle) {
    return <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">맥락을 불러오는 중입니다.</div>;
  }

  return (
    <EntityContextShell
      bundle={bundle}
      density={density}
      mainSlot={
        <div className="space-y-4">
          {mainSlot(bundle)}
          {enableAttach ? <SmartAttachPanel focusId={entityId} focusType={entityType} onAttached={setBundle} /> : null}
        </div>
      }
      onBundleUpdate={setBundle}
      onDetachEdge={(edge) => {
        void detachEdge(edge);
      }}
      onOpenNode={openNode}
      railDefaultLens={railDefaultLens}
    />
  );
}
