"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  "action-hub": "Action Hub",
  vault: "The Vault",
  prm: "PRM",
  "life-ops": "Life Ops",
  settings: "Settings",
  inbox: "Inbox",
  entries: "Daily Entries",
  diaries: "Journal",
  meditations: "Meditation",
};

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs = useMemo(
    () =>
      segments.map((segment, index) => {
        const href = `/${segments.slice(0, index + 1).join("/")}`;
        return {
          href,
          label: LABELS[segment] ?? segment,
        };
      }),
    [segments],
  );

  return (
    <div className="sticky top-0 z-10 flex min-h-12 items-center border-b border-white/10 bg-[rgba(14,17,22,0.72)] px-4 backdrop-blur-xl md:px-6">
      <nav aria-label="Breadcrumb" className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="mr-2 hidden rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-primary md:inline-flex">
          Light House
        </span>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={crumb.href} className="flex items-center gap-2">
              {last ? (
                <span className="font-medium text-foreground">{crumb.label}</span>
              ) : (
                <Link className="transition hover:text-foreground" href={crumb.href}>
                  {crumb.label}
                </Link>
              )}
              {!last ? <span className="text-white/20">/</span> : null}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
