"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import type { VaultSnapshot } from "@/lib/server/vault";
import { useVaultStore } from "@/stores/use-vault-store";

type VaultHydratorState = { status: "loading" | "ready" | "error"; error?: string; attempt: number };

export function VaultHydrator({
  children,
  initialError,
  initialSnapshot,
}: {
  children?: ReactNode;
  initialError?: string;
  initialSnapshot?: VaultSnapshot;
}) {
  const [state, setState] = useState<VaultHydratorState>(() =>
    initialError ? { status: "error", error: initialError, attempt: 0 } : { status: "loading", attempt: 0 },
  );
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);

  useEffect(() => {
    if (initialSnapshot) {
      replaceSnapshot(initialSnapshot);
      setState((current) => ({ ...current, status: "ready", error: undefined }));
      return;
    }

    if (initialError && state.attempt === 0) {
      setState((current) => ({ ...current, status: "error", error: initialError }));
      return;
    }

    let cancelled = false;
    async function hydrate() {
      setState((current) => ({ ...current, status: "loading", error: undefined }));
      try {
        const response = await fetch("/api/vault/bootstrap", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as Parameters<typeof replaceSnapshot>[0] | { error?: string } | null;
        if (!response.ok) {
          throw new Error((payload && "error" in payload ? payload.error : undefined) ?? `Vault bootstrap failed with ${response.status}.`);
        }
        if (!payload || !("zettels" in payload)) {
          throw new Error("Vault bootstrap returned an invalid snapshot.");
        }
        if (!cancelled) {
          replaceSnapshot(payload);
          setState((current) => ({ ...current, status: "ready", error: undefined }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : "Vault 데이터를 불러오지 못했습니다.",
          }));
        }
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [initialError, initialSnapshot, replaceSnapshot, state.attempt]);

  if (state.status === "error") {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/8 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Vault 데이터를 불러오지 못했습니다.</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{state.error}</p>
            <button
              className="focus-ring mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8"
              onClick={() => setState((current) => ({ status: "loading", attempt: current.attempt + 1 }))}
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status !== "ready") {
    return <div className="rounded-lg border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">Vault 데이터를 불러오는 중입니다.</div>;
  }

  return <>{children}</>;
}
