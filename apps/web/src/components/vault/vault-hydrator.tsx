"use client";

import { useEffect } from "react";

import type { VaultSnapshot } from "@/lib/server/vault";
import { useVaultStore } from "@/stores/use-vault-store";

export function VaultHydrator({ initialSnapshot }: { initialSnapshot?: VaultSnapshot }) {
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);

  useEffect(() => {
    if (initialSnapshot) {
      replaceSnapshot(initialSnapshot);
      return;
    }

    let cancelled = false;
    async function hydrate() {
      const response = await fetch("/api/vault/bootstrap", { cache: "no-store" });
      if (!response.ok) return;
      const snapshot = (await response.json()) as Parameters<typeof replaceSnapshot>[0];
      if (!cancelled) replaceSnapshot(snapshot);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [initialSnapshot, replaceSnapshot]);

  return null;
}
