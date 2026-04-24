"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LogoutForm } from "@/components/shared/logout-form";
import { DOMAINS, UTILITY } from "@/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { useShellStore } from "@/stores/use-shell-store";

function isActive(pathname: string, href?: string) {
  if (!href) return false;
  if (href === "/dashboard") return pathname === href;
  return pathname.startsWith(href);
}

export function GlobalNav() {
  const pathname = usePathname();
  const openCommandPalette = useShellStore((state) => state.openCommandPalette);
  const openQuickCapture = useShellStore((state) => state.openQuickCapture);
  const openNotificationCenter = useShellStore((state) => state.openNotificationCenter);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/notifications?unreadOnly=1&limit=1")
      .then((response) => response.json())
      .then((payload: { unreadCount?: number }) => {
        if (!cancelled) {
          setUnreadCount(payload.unreadCount ?? 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnreadCount(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <aside className="glass-elevated fixed inset-x-3 bottom-3 z-40 flex h-[68px] items-center justify-between border border-white/10 px-3 py-2 lg:sticky lg:inset-auto lg:top-0 lg:h-screen lg:w-[68px] lg:shrink-0 lg:flex-col lg:border-y-0 lg:border-l-0 lg:px-2 lg:py-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:w-full lg:flex-none lg:flex-col lg:items-center lg:gap-3">
        <Link
          aria-label="Go to dashboard"
          className="focus-ring group relative hidden h-11 w-11 items-center justify-center rounded-lg border border-primary/35 bg-primary/12 text-sm font-semibold text-primary shadow-[0_0_28px_rgba(251,191,36,0.16)] transition hover:-translate-y-0.5 hover:bg-primary/18 lg:flex"
          href="/dashboard"
        >
          <span className="font-display text-base tracking-[0.08em]">LH</span>
          <span className="pointer-events-none absolute -bottom-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-muted-foreground backdrop-blur group-hover:block">
            Light House
          </span>
        </Link>

        <nav aria-label="Global navigation" className="grid flex-1 grid-cols-5 gap-1 lg:flex lg:w-full lg:flex-none lg:flex-col lg:items-center lg:gap-2 lg:pt-2">
          {DOMAINS.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.path);

            return (
              <Link
                key={item.key}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "focus-ring relative flex h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-muted-foreground transition hover:bg-white/6 hover:text-foreground lg:w-11 lg:px-0",
                  active && "bg-white/8 text-primary shadow-[0_0_18px_rgba(251,191,36,0.12)]",
                )}
                href={item.path ?? "#"}
                title={`${item.label}${item.hotkey ? ` (${item.hotkey})` : ""}`}
              >
                {active ? <span className="absolute bottom-0 h-0.5 w-6 rounded-full bg-primary shadow-[0_0_12px_rgba(251,191,36,0.6)] lg:left-0 lg:top-2 lg:h-7 lg:w-0.5" /> : null}
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                <span className="max-w-full truncate text-[10px] leading-none lg:hidden">{item.label.replace("Action Hub", "Action").replace("The Vault", "Vault")}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-1 border-l border-white/10 pl-2 lg:ml-0 lg:w-full lg:flex-col lg:border-l-0 lg:pl-0">
        {UTILITY.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.path);

          if (item.key === "search" || item.key === "capture" || item.key === "notifications") {
            return (
              <button
                aria-label={item.label}
                className="focus-ring relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-white/6 hover:text-foreground"
                key={item.key}
                onClick={
                  item.key === "search"
                    ? openCommandPalette
                    : item.key === "capture"
                      ? () => openQuickCapture()
                      : openNotificationCenter
                }
                title={`${item.label}${item.hotkey ? ` (${item.hotkey})` : ""}`}
                type="button"
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
                {item.key === "notifications" && unreadCount > 0 ? (
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_12px_rgba(251,191,36,0.6)]" />
                ) : null}
              </button>
            );
          }

          return (
            <Link
              key={item.key}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "focus-ring hidden h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-white/6 hover:text-foreground lg:flex",
                active && "bg-white/8 text-primary",
              )}
              href={item.path ?? "#"}
              title={`${item.label}${item.hotkey ? ` (${item.hotkey})` : ""}`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </Link>
          );
        })}
        <div className="hidden [&_button]:h-11 [&_button]:w-11 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-lg [&_button]:px-0 [&_button]:py-0 lg:[&_button]:flex">
          <LogoutForm iconOnly label="로그아웃" />
        </div>
      </div>
    </aside>
  );
}
