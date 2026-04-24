"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Clock3, CornerDownLeft, Sparkles, Search } from "lucide-react";

import { DOMAINS } from "@/constants/navigation";
import { useSearchSuggestions } from "@/hooks/use-search-suggestions";
import type { ContextSearchResult } from "@/lib/context/types";
import type { SearchItem } from "@/lib/mock/search";
import { resolveSearchPrefix } from "@/lib/utils/search-prefix";
import { useShellStore } from "@/stores/use-shell-store";

import { EmptyState } from "./empty-state";
import { KeyHint } from "./key-hint";
import { OverlayFrame } from "./overlay-frame";

const RECENTS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "오늘의 로그", href: "/life-ops" },
  { label: "PRM", href: "/prm" },
];

const ACTIONS = [
  { label: "새 Task 만들기", href: "/action-hub/inbox?detail=task:new", type: "action" },
  { label: "Vault로 이동", href: "/vault", type: "action" },
  { label: "오늘 로그 열기", href: "/life-ops", type: "action" },
] as const;

type PaletteItem = {
  id: string;
  title: string;
  snippet: string;
  href?: string;
  type: SearchItem["type"] | ContextSearchResult["type"];
  score?: number;
};

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = useShellStore((state) => state.commandPaletteOpen);
  const close = useShellStore((state) => state.closeCommandPalette);
  const openQuickCapture = useShellStore((state) => state.openQuickCapture);
  const openHotkeyDialog = useShellStore((state) => state.openHotkeyDialog);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [contextResults, setContextResults] = useState<PaletteItem[]>([]);

  const normalizedQuery = query.trim();
  const searchIntent = useMemo(() => resolveSearchPrefix(query), [query]);
  const isActionMode = searchIntent.mode === "action";
  const isHelpMode = searchIntent.mode === "help";
  const results = useSearchSuggestions({
    query: searchIntent.query,
    types: searchIntent.types,
    enabled: Boolean(searchIntent.query) && !isActionMode && !isHelpMode,
    limit: 20,
  });

  useEffect(() => {
    if (!searchIntent.query || isActionMode || isHelpMode) {
      setContextResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ include: "semantic", q: searchIntent.query });
        if (searchIntent.types?.length) params.set("types", searchIntent.types.join(","));
        const response = await fetch(`/api/context/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("context search failed");
        const payload = (await response.json()) as { results?: ContextSearchResult[] };
        setContextResults(
          (payload.results ?? []).slice(0, 20).map((item) => ({
            href: item.href,
            id: item.id,
            score: item.score,
            snippet: item.preview ?? item.subtitle ?? item.type,
            title: item.title,
            type: item.type,
          })),
        );
      } catch {
        if (!controller.signal.aborted) setContextResults([]);
      }
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isActionMode, isHelpMode, searchIntent.query, searchIntent.types]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const navigate = (href?: string) => {
    if (!href) return;
    close();
    router.push(href);
  };

  const openInDrawer = (item?: { type: string; id: string; href?: string }) => {
    if (!item) return;
    if (!["person", "task", "zettel", "media", "place"].includes(item.type)) {
      navigate(item.href);
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("detail", `${item.type}:${item.id}`);
    close();
    router.push(`${pathname}?${params.toString()}`);
  };

  const visibleActions = useMemo(() => {
    if (isActionMode) {
      const actionQuery = searchIntent.query.toLowerCase();
      return ACTIONS.filter((item) => item.label.toLowerCase().includes(actionQuery));
    }
    return [];
  }, [isActionMode, searchIntent.query]);

  const flattened: PaletteItem[] = query.trim()
    ? visibleActions.length
      ? visibleActions.map((item) => ({
          id: item.href,
          title: item.label,
          snippet: "즉시 실행 액션",
          href: item.href,
          type: item.type,
        }))
      : contextResults.length
        ? contextResults
        : results
    : [
        ...DOMAINS.map((item) => ({
          id: item.path ?? item.key,
          title: item.label,
          snippet: item.hotkey ?? "즉시 이동",
          href: item.path,
          type: "action" as const,
        })),
        ...RECENTS.map((item) => ({
          id: item.href,
          title: item.label,
          snippet: "최근 항목",
          href: item.href,
          type: "action" as const,
        })),
      ];

  useEffect(() => {
    setActiveIndex(0);
  }, [contextResults.length, query, results.length, visibleActions.length]);

  return (
    <OverlayFrame
      open={open}
      onClose={close}
      panelClassName="max-w-[680px] overflow-hidden"
      subtitle="검색, 즉시 이동, 액션 실행을 한 번에 처리합니다."
      title="Command Palette"
    >
      <div className="p-4">
        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            className="w-full border-0 bg-transparent p-0 text-sm text-foreground outline-none"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (!flattened.length) {
                if (event.key === "Enter" && query.trim()) {
                  event.preventDefault();
                  close();
                  openQuickCapture({ domain: "dashboard", label: "Command Palette" }, query.trim());
                }
                if (event.key === "?" && query.trim() === "") {
                  event.preventDefault();
                }
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => (current + 1) % flattened.length);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => (current - 1 + flattened.length) % flattened.length);
                return;
              }

              if (event.key === "Tab") {
                event.preventDefault();
                setActiveIndex((current) => (current + 1) % flattened.length);
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                if (event.metaKey && event.shiftKey) {
                  openInDrawer(flattened[activeIndex]);
                } else if (event.metaKey || event.ctrlKey) {
                  navigate(flattened[activeIndex]?.href);
                } else {
                  navigate(flattened[activeIndex]?.href);
                }
              }
            }}
            placeholder="검색, >액션, @사람, [[지식, #태그"
            value={query}
          />
          <KeyHint keys="Esc" />
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
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">빠른 접두어</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["@ 사람", "[[ 지식", "# 태그", "> 액션", "? 도움말"].map((item) => (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
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
              <button
                className="focus-ring mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary transition [@media(hover:hover)]:hover:bg-primary/15"
                onClick={() => {
                  close();
                  openQuickCapture();
                }}
                type="button"
              >
                <Sparkles className="h-4 w-4" />
                Quick Capture 열기
              </button>
            </section>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {isHelpMode ? (
              <EmptyState
                cta={{
                  label: "단축키 열기",
                  hotkey: "?",
                  onClick: () => {
                    close();
                    openHotkeyDialog();
                  },
                }}
                description="도움말 접두어를 입력했으니 단축키 치트시트로 바로 넘어갈 수 있습니다."
                illustration="generic"
                title="도움말 모드"
              />
            ) : null}
            {!isHelpMode && (visibleActions.length ? visibleActions : contextResults.length ? contextResults : results).length ? (
              (visibleActions.length
                ? visibleActions.map((item) => ({
                    id: item.href,
                    title: item.label,
                    snippet: "즉시 실행 액션",
                    href: item.href,
                    type: item.type,
                  }))
                : contextResults.length
                  ? contextResults
                  : results
              ).map((item, index) => (
                <button
                  className={`flex w-full items-start justify-between rounded-3xl border px-4 py-3 text-left transition ${
                    activeIndex === index
                      ? "border-primary/25 bg-primary/10"
                      : "border-white/10 bg-white/5 [@media(hover:hover)]:hover:bg-white/8"
                  }`}
                  key={item.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => navigate(item.href)}
                  type="button"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.snippet}</p>
                    {"score" in item && typeof item.score === "number" ? (
                      <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-primary">context score {(item.score * 100).toFixed(0)}</p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {item.type}
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                cta={{
                  label: "Quick Capture로 보내기",
                  hotkey: "Enter",
                  onClick: () => {
                    close();
                    openQuickCapture({ domain: "dashboard", label: "Command Palette" }, query.trim());
                  },
                }}
                description="검색 결과가 없으면 지금 입력한 문장을 바로 캡처로 던져서 분류 흐름으로 넘길 수 있습니다."
                illustration="generic"
                title="아무것도 찾지 못했어요"
              />
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3.5 w-3.5" /> 열기</span>
            <span className="inline-flex items-center gap-1">⌘↵ Drawer</span>
            <span className="inline-flex items-center gap-1">Tab 섹션 점프</span>
          </div>
          <span className="uppercase tracking-[0.16em]">최근 · 검색 · 액션</span>
        </div>
      </div>
    </OverlayFrame>
  );
}
