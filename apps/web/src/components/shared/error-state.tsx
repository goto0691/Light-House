"use client";

import { AlertTriangle, Copy, RefreshCcw } from "lucide-react";
import { useState } from "react";

import { GlassCard } from "@/components/shared/glass-card";

type ErrorStateProps = {
  title?: string;
  description: string;
  errorId?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = "등대에 문제가 생겼습니다",
  description,
  errorId,
  onRetry,
}: ErrorStateProps) {
  const [copied, setCopied] = useState(false);

  return (
    <GlassCard className="mx-auto max-w-lg text-center" elevation="l3" priority="hero" variant="elevated">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[hsl(var(--danger)/0.16)] bg-[hsl(var(--danger)/0.12)] text-danger shadow-[var(--shadow-md)]">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <p className="mt-5 text-xs uppercase tracking-[0.24em] text-danger">System Error</p>
      <h1 className="text-balance mt-3 font-display text-4xl text-foreground">{title}</h1>
      <p className="text-pretty mt-3 text-sm leading-6 text-muted-foreground">{description}</p>

      {errorId ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-left">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Error ID</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <code className="tabular-nums text-sm text-foreground">{errorId}</code>
            <button
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground transition [@media(hover:hover)]:hover:bg-white/8 [@media(hover:hover)]:hover:text-foreground"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(errorId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {}
              }}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
        </div>
      ) : null}

      {onRetry ? (
        <div className="mt-6 flex justify-center">
          <button
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition [@media(hover:hover)]:hover:brightness-105"
            onClick={onRetry}
            type="button"
          >
            <RefreshCcw className="h-4 w-4" />
            다시 시도
          </button>
        </div>
      ) : null}
    </GlassCard>
  );
}
