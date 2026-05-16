"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { PRMSnapshot } from "@/lib/server/prm";
import { usePRMStore } from "@/stores/use-prm-store";

function bootstrapUrl(pathname: string, search: string) {
  const path = search ? `${pathname}?${search}` : pathname;
  const params = new URLSearchParams({ path });
  return `/api/prm/bootstrap?${params.toString()}`;
}

function canRenderWithoutBootstrap(pathname: string) {
  if (pathname === "/prm") return true;
  if (pathname === "/prm/graph" || pathname === "/prm/hit-them-up") return true;
  if (pathname === "/prm/gifts" || pathname.startsWith("/prm/gifts/")) return true;
  if (/^\/prm\/[^/]+\/edit$/.test(pathname)) return true;
  return /^\/prm\/[^/]+$/.test(pathname);
}

export function PRMHydrator({ children, initialSnapshot }: { children?: ReactNode; initialSnapshot?: PRMSnapshot }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [ready, setReady] = useState(() => canRenderWithoutBootstrap(pathname));
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);

  useEffect(() => {
    if (initialSnapshot) {
      replaceSnapshot(initialSnapshot);
      setReady(true);
      return;
    }

    if (canRenderWithoutBootstrap(pathname)) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    async function hydrate() {
      const response = await fetch(bootstrapUrl(pathname, search), { cache: "no-store" });
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
  }, [initialSnapshot, pathname, replaceSnapshot, search]);

  if (!ready) {
    return <div className="rounded-lg border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">관계 데이터를 불러오는 중입니다.</div>;
  }

  return <>{children}</>;
}
