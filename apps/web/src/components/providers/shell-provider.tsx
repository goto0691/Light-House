"use client";

import type { PropsWithChildren } from "react";

import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";

export function ShellProvider({ children, captureHref, searchHref }: PropsWithChildren<{ captureHref?: string; searchHref?: string }>) {
  useGlobalHotkeys({ captureHref, searchHref });
  return <>{children}</>;
}
