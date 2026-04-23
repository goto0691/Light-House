"use client";

import { useEffect } from "react";

import { useLifeOpsStore } from "@/stores/use-life-ops-store";

export function LifeOpsHydrator() {
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const response = await fetch("/api/life-ops/bootstrap", { cache: "no-store" });
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
