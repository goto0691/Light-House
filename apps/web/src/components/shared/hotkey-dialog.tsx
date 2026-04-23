"use client";

import { useShellStore } from "@/stores/use-shell-store";

import { OverlayFrame } from "./overlay-frame";

const HOTKEYS = [
  ["Cmd+K", "Command Palette"],
  ["Cmd+Shift+N", "Quick Capture"],
  ["Cmd+\\", "LNB 토글"],
  ["?", "단축키 치트시트"],
  ["g d / a / v / p / l / s", "도메인 이동"],
];

export function HotkeyDialog() {
  const open = useShellStore((state) => state.hotkeyDialogOpen);
  const close = useShellStore((state) => state.closeHotkeyDialog);

  return (
    <OverlayFrame open={open} onClose={close} panelClassName="max-w-[520px]" title="단축키 치트시트">
      <div className="p-5">
        <div className="space-y-2">
          {HOTKEYS.map(([key, description]) => (
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3" key={key}>
              <span className="text-sm text-foreground">{description}</span>
              <code className="rounded-xl bg-black/20 px-2 py-1 text-xs text-primary">{key}</code>
            </div>
          ))}
        </div>
      </div>
    </OverlayFrame>
  );
}
