"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LOCAL_NAV, type DomainKey } from "@/constants/navigation";
import { cn } from "@/lib/utils/cn";
import { useShellStore } from "@/stores/use-shell-store";

const DOMAIN_LABELS: Record<DomainKey, string> = {
  dashboard: "Dashboard",
  "action-hub": "Action Hub",
  vault: "The Vault",
  prm: "PRM",
  "life-ops": "Life Ops",
};

export function LocalNav({ domain }: { domain: DomainKey }) {
  const pathname = usePathname();
  const items = LOCAL_NAV[domain];
  const collapsed = useShellStore((state) => state.lnbCollapsed);
  const toggle = useShellStore((state) => state.toggleLNB);

  return (
    <aside className="glass sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-white/10 p-4 lg:flex">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Workspace</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">{DOMAIN_LABELS[domain]}</h2>
        </div>
        <button
          aria-label="Collapse local navigation"
          className="rounded-xl border border-white/10 px-2 py-1 text-xs text-muted-foreground transition hover:bg-white/6 hover:text-foreground"
          onClick={toggle}
          type="button"
        >
          {collapsed ? "⟩" : "⟨"}
        </button>
      </div>

      {!collapsed ? (
        <>
          <nav aria-label={`${DOMAIN_LABELS[domain]} local navigation`} className="flex flex-col gap-1">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/6 hover:text-foreground",
                    active && "bg-white/8 text-foreground",
                  )}
                  href={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Shared Layer</p>
            <p className="mt-2 text-sm text-foreground">Command Palette, Quick Capture, Drawer, Hotkeys가 연결되었습니다.</p>
          </div>
        </>
      ) : (
        <div className="mt-auto text-center text-xs text-muted-foreground">Cmd+\</div>
      )}
    </aside>
  );
}
