"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { ShellProvider } from "@/components/providers/shell-provider";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { CommandPalette } from "@/components/shared/command-palette";
import { HotkeyDialog } from "@/components/shared/hotkey-dialog";
import { QuickCaptureModal } from "@/components/shared/quick-capture-modal";
import { SideDrawerHost } from "@/components/shared/side-drawer-host";
import { ToastViewport } from "@/components/shared/toast-viewport";
import { GlobalNav } from "@/components/shell/global-nav";
import { LocalNav } from "@/components/shell/local-nav";
import type { DomainKey } from "@/constants/navigation";

function resolveDomain(pathname: string): DomainKey {
  if (pathname.startsWith("/action-hub")) return "action-hub";
  if (pathname.startsWith("/vault")) return "vault";
  if (pathname.startsWith("/prm")) return "prm";
  if (pathname.startsWith("/life-ops")) return "life-ops";
  return "dashboard";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const domain = resolveDomain(pathname);

  return (
    <ShellProvider>
      <div className="min-h-screen bg-background text-foreground">
        <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.10),_transparent_25%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.08),_transparent_30%),linear-gradient(180deg,_rgba(22,26,34,0.75),_rgba(14,17,22,1))]" />
        <div className="flex min-h-screen">
          <GlobalNav />
          <LocalNav domain={domain} />
          <main className="flex min-h-screen min-w-0 flex-1 flex-col">
            <Breadcrumb />
            <div className="flex-1 px-4 py-4 md:px-6 md:py-6">{children}</div>
          </main>
        </div>
        <SideDrawerHost />
        <CommandPalette />
        <QuickCaptureModal />
        <HotkeyDialog />
        <ToastViewport />
      </div>
    </ShellProvider>
  );
}
