"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { PRMSnapshot } from "@/lib/server/prm";
import { usePRMStore } from "@/stores/use-prm-store";

export function PRMHydrator({ children, initialSnapshot }: { children?: ReactNode; initialSnapshot?: PRMSnapshot }) {
  const [ready, setReady] = useState(false);
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);

  useEffect(() => {
    if (initialSnapshot) {
      replaceSnapshot(initialSnapshot);
      setReady(true);
      return;
    }

    let cancelled = false;
    async function hydrate() {
      const response = await fetch("/api/prm/bootstrap", { cache: "no-store" });
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
    return <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">PRM 데이터를 불러오는 중입니다.</div>;
  }

  return <>{children}</>;
}
