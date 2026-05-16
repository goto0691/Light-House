"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";

import { DOMAIN_LABELS } from "@/constants/display-labels";
import { LOCAL_NAV, type DomainKey } from "@/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { useShellStore } from "@/stores/use-shell-store";

export function LocalNav({ domain }: { domain: DomainKey }) {
  const pathname = usePathname();
  const items = LOCAL_NAV[domain];
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
  const collapsed = useShellStore((state) => state.lnbCollapsed);
  const toggle = useShellStore((state) => state.toggleLNB);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      className={cn(
        "glass sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/10 transition-[width,padding] duration-200 lg:flex",
        collapsed ? "w-[68px] px-2 py-4" : "w-[248px] p-4",
      )}
    >
      <div className={cn("mb-5 flex items-center", collapsed ? "justify-center" : "justify-between")}>
        <div className={cn(collapsed && "hidden")}>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Light House</p>
          <h2 className="mt-2 font-display text-[1.35rem] leading-7 text-foreground">{DOMAIN_LABELS[domain]}</h2>
        </div>
        <button
          aria-label={collapsed ? "왼쪽 메뉴 펼치기" : "왼쪽 메뉴 접기"}
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-xs text-muted-foreground hover:bg-white/6 hover:text-foreground"
          onClick={toggle}
          type="button"
        >
          <ToggleIcon className="h-4 w-4" />
        </button>
      </div>

      {!collapsed ? (
        <>
          <nav aria-label={`${DOMAIN_LABELS[domain]} 메뉴`} className="flex flex-col gap-1">
            {items.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "focus-ring min-h-10 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-white/6 hover:text-foreground",
                    active && "bg-white/8 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                  )}
                  href={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-primary">공유 레이어</p>
            <p className="mt-2 text-sm text-foreground">검색, 캡처, 드로어, 알림이 전역에서 이어집니다.</p>
            <p className="mt-3 text-xs tracking-[0.12em] text-muted-foreground">단축키 \ · 메뉴 접기</p>
          </div>
        </>
      ) : (
        <div className="mt-auto [writing-mode:vertical-rl] text-center text-[10px] tracking-[0.18em] text-muted-foreground">단축키 \</div>
      )}
    </aside>
  );
}
