"use client";

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

  return (
    <aside className="glass sticky top-0 flex h-screen w-16 flex-col items-center justify-between border-r border-white/10 px-2 py-4">
      <div className="flex w-full flex-col items-center gap-3">
        <Link
          aria-label="Go to dashboard"
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-sm font-semibold text-primary shadow-[0_0_30px_rgba(251,191,36,0.18)] transition hover:bg-primary/20"
          href="/dashboard"
        >
          LH
        </Link>

        <nav aria-label="Global navigation" className="flex w-full flex-col items-center gap-2 pt-2">
          {DOMAINS.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.path);

            return (
              <Link
                key={item.key}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "relative flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground transition hover:bg-white/6 hover:text-foreground",
                  active && "bg-white/8 text-primary",
                )}
                href={item.path ?? "#"}
                title={`${item.label}${item.hotkey ? ` (${item.hotkey})` : ""}`}
              >
                {active ? <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-primary" /> : null}
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex w-full flex-col items-center gap-2">
        {UTILITY.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.path);

          if (item.key === "search" || item.key === "capture") {
            return (
              <button
                aria-label={item.label}
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground transition hover:bg-white/6 hover:text-foreground"
                key={item.key}
                onClick={item.key === "search" ? openCommandPalette : () => openQuickCapture()}
                title={`${item.label}${item.hotkey ? ` (${item.hotkey})` : ""}`}
                type="button"
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </button>
            );
          }

          return (
            <Link
              key={item.key}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground transition hover:bg-white/6 hover:text-foreground",
                active && "bg-white/8 text-primary",
              )}
              href={item.path ?? "#"}
              title={`${item.label}${item.hotkey ? ` (${item.hotkey})` : ""}`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </Link>
          );
        })}
        <div className="[&_button]:flex [&_button]:h-11 [&_button]:w-11 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-2xl [&_button]:px-0 [&_button]:py-0">
          <LogoutForm iconOnly label="로그아웃" />
        </div>
      </div>
    </aside>
  );
}
