"use client";

import { useEffect } from "react";

import { useActionHubStore } from "@/stores/use-action-hub-store";

export function ActionHubHydrator() {
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const response = await fetch("/api/action-hub/bootstrap", { cache: "no-store" });
      if (!response.ok) return;

      const snapshot = (await response.json()) as Parameters<typeof replaceSnapshot>[0];
      if (!cancelled) {
        replaceSnapshot(snapshot);
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [replaceSnapshot]);

  return null;
}
