"use client";

import { useEffect } from "react";

import type { ActionHubSnapshot } from "@/lib/server/action-hub";
import { useActionHubStore } from "@/stores/use-action-hub-store";

export function ActionHubHydrator({ initialSnapshot }: { initialSnapshot?: ActionHubSnapshot }) {
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);

  useEffect(() => {
    if (initialSnapshot) {
      replaceSnapshot(initialSnapshot);
      return;
    }

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
  }, [initialSnapshot, replaceSnapshot]);

  return null;
}
