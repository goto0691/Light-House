"use client";

import type { PropsWithChildren } from "react";

import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";

export function ShellProvider({ children }: PropsWithChildren) {
  useGlobalHotkeys();
  return <>{children}</>;
}
