"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import type { LifeOpsSnapshot } from "@/lib/server/life-ops";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

function bootstrapUrl(pathname: string) {
  const params = new URLSearchParams({ path: pathname });
  return `/api/life-ops/bootstrap?${params.toString()}`;
}

export function LifeOpsHydrator({ children, initialSnapshot }: { children?: ReactNode; initialSnapshot?: LifeOpsSnapshot }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const canRenderBeforeStoreHydrates = pathname === "/life-ops/entries" || pathname === "/life-ops/trends";

  useEffect(() => {
    if (initialSnapshot) {
      replaceSnapshot(initialSnapshot);
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    async function hydrate() {
      const response = await fetch(bootstrapUrl(pathname), { cache: "no-store" });
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
  }, [initialSnapshot, pathname, replaceSnapshot]);

  if (!ready && !canRenderBeforeStoreHydrates) {
    return <div className="rounded-lg border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">생활기록 데이터를 불러오는 중입니다.</div>;
  }

  return <>{children}</>;
}
