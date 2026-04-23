"use client";

import { useEffect } from "react";

import { usePRMStore } from "@/stores/use-prm-store";

export function PRMHydrator() {
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const response = await fetch("/api/prm/bootstrap", { cache: "no-store" });
      if (!response.ok) return;
      const snapshot = (await response.json()) as Parameters<typeof replaceSnapshot>[0];
      if (!cancelled) replaceSnapshot(snapshot);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [replaceSnapshot]);

  return null;
}
