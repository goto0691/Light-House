"use client";

import { useEffect } from "react";

import { useVaultStore } from "@/stores/use-vault-store";

export function VaultHydrator() {
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);

  useEffect(() => {
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
  }, [replaceSnapshot]);

  return null;
}
