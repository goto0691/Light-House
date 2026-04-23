"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Clock3, CornerDownLeft, Search } from "lucide-react";

import { DOMAINS } from "@/constants/navigation";
import type { SearchItem } from "@/lib/mock/search";
import { useShellStore } from "@/stores/use-shell-store";

import { OverlayFrame } from "./overlay-frame";

const RECENTS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "오늘의 로그", href: "/life-ops" },
  { label: "PRM", href: "/prm" },
];

export function CommandPalette() {
  const router = useRouter();
  const open = useShellStore((state) => state.commandPaletteOpen);
  const close = useShellStore((state) => state.closeCommandPalette);
  const openQuickCapture = useShellStore((state) => state.openQuickCapture);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    let cancelled = false;

    async function loadResults() {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { results: SearchItem[] };
      if (!cancelled) setResults(payload.results);
    }

    void loadResults();

    return () => {
      cancelled = true;
    };
  }, [query]);

  const navigate = (href?: string) => {
    if (!href) return;
    close();
    router.push(href);
  };

  return (
    <OverlayFrame open={open} onClose={close} panelClassName="max-w-[680px] overflow-hidden" title="Command Palette">
      <div className="p-4">
        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            className="w-full border-0 bg-transparent p-0 text-sm text-foreground outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="검색, >액션, @사람, [[지식, #태그"
            value={query}
          />
        </label>

        {!query ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">즉시 이동</p>
              <div className="mt-3 space-y-2">
                {DOMAINS.map((item) => (
                  <button
                    className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-white/6 hover:text-foreground"
                    key={item.key}
                    onClick={() => navigate(item.path)}
                    type="button"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs">{item.hotkey}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                최근 항목
              </p>
              <div className="mt-3 space-y-2">
                {RECENTS.map((item) => (
                  <Link
                    className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/6 hover:text-foreground"
                    href={item.href}
                    key={item.href}
                    onClick={close}
                  >
                    <span>{item.label}</span>
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {results.length ? (
              results.map((item) => (
                <button
                  className="flex w-full items-start justify-between rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/8"
                  key={item.id}
                  onClick={() => navigate(item.href)}
                  type="button"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.snippet}</p>
                  </div>
                  <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {item.type}
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 px-4 py-6 text-center">
                <p className="text-sm text-foreground">아무것도 찾지 못했어요</p>
                <button
                  className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/6 hover:text-foreground"
                  onClick={() => {
                    close();
                    openQuickCapture();
                  }}
                  type="button"
                >
                  <CornerDownLeft className="h-4 w-4" />
                  Enter 대신 Quick Capture로 보내기
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </OverlayFrame>
  );
}
