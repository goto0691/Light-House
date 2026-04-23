"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useShellStore } from "@/stores/use-shell-store";

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return element.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

export function useGlobalHotkeys() {
  const router = useRouter();
  const sequence = useRef<string[]>([]);
  const openCommandPalette = useShellStore((state) => state.openCommandPalette);
  const openQuickCapture = useShellStore((state) => state.openQuickCapture);
  const toggleLNB = useShellStore((state) => state.toggleLNB);
  const openHotkeyDialog = useShellStore((state) => state.openHotkeyDialog);

  useEffect(() => {
    const routes: Record<string, string> = {
      gd: "/dashboard",
      ga: "/action-hub",
      gv: "/vault",
      gp: "/prm",
      gl: "/life-ops",
      gs: "/settings",
      gt: "/life-ops",
    };

    const resetSequence = () => {
      sequence.current = [];
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openQuickCapture();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggleLNB();
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        openHotkeyDialog();
        return;
      }

      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "g") {
        sequence.current = ["g"];
        window.setTimeout(resetSequence, 900);
        return;
      }

      if (sequence.current[0] === "g") {
        const combo = `g${key}`;
        if (routes[combo]) {
          event.preventDefault();
          router.push(routes[combo]);
        }
        resetSequence();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openCommandPalette, openHotkeyDialog, openQuickCapture, router, toggleLNB]);
}
