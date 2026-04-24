"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { ShellProvider } from "@/components/providers/shell-provider";
import { PWAProvider } from "@/components/providers/pwa-provider";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { CommandPalette } from "@/components/shared/command-palette";
import { HotkeyDialog } from "@/components/shared/hotkey-dialog";
import { NotificationCenter } from "@/components/shared/notification-center";
import { OfflineBanner } from "@/components/shared/offline-banner";
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

export function AppShell({
  children,
  glassOpacity = "full",
}: {
  children: ReactNode;
  glassOpacity?: "full" | "low" | "off";
}) {
  const pathname = usePathname();
  const domain = resolveDomain(pathname);

  return (
    <ShellProvider>
      <div className="min-h-screen bg-background text-foreground" data-app-shell data-glass-opacity={glassOpacity}>
        <PWAProvider />
        <OfflineBanner />
        <div className="fixed inset-0 -z-20 bg-[linear-gradient(180deg,_rgba(22,26,34,0.84),_rgba(14,17,22,1))]" />
        <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,rgba(251,191,36,0.08),transparent_32%),linear-gradient(225deg,rgba(14,165,233,0.06),transparent_34%)]" />
        <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]" />
        <div className="flex min-h-screen">
          <GlobalNav />
          <LocalNav domain={domain} />
          <main className="flex min-h-screen min-w-0 flex-1 flex-col overflow-x-hidden">
            <Breadcrumb />
            <div className="mx-auto flex w-full max-w-[1480px] flex-1 px-4 pb-24 pt-5 md:px-6 md:py-6 xl:px-8">
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </main>
        </div>
        <SideDrawerHost />
        <CommandPalette />
        <NotificationCenter />
        <QuickCaptureModal />
        <HotkeyDialog />
        <ToastViewport />
      </div>
    </ShellProvider>
  );
}
