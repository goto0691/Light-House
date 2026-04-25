"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { LifeOpsSnapshot } from "@/lib/server/life-ops";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

export function LifeOpsHydrator({ children, initialSnapshot }: { children?: ReactNode; initialSnapshot?: LifeOpsSnapshot }) {
  const [ready, setReady] = useState(false);
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);

  useEffect(() => {
    if (initialSnapshot) {
      replaceSnapshot(initialSnapshot);
      setReady(true);
      return;
    }

    let cancelled = false;
    async function hydrate() {
      const response = await fetch("/api/life-ops/bootstrap", { cache: "no-store" });
      if (!response.ok) return;
      const snapshot = (await response.json()) as Parameters<typeof replaceSnapshot>[0];
      if (!cancelled) {
        replaceSnapshot(snapshot);
        setReady(true);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [initialSnapshot, replaceSnapshot]);

  if (!ready) {
    return <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">Life Ops 데이터를 불러오는 중입니다.</div>;
  }

  return <>{children}</>;
}
