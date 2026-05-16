"use client";

import { useShellStore } from "@/stores/use-shell-store";

import { GlassCard } from "./glass-card";
import { formatKeyHint } from "./key-hint";
import { OverlayFrame } from "./overlay-frame";

const HOTKEYS = [
  ["Cmd+K", "빠른 실행"],
  ["Cmd+Shift+N", "빠른 캡처"],
  ["Cmd+\\", "LNB 토글"],
  ["?", "단축키 치트시트"],
  ["g d / a / v / p / l / s", "도메인 이동"],
];

export function HotkeyDialog() {
  const open = useShellStore((state) => state.hotkeyDialogOpen);
  const close = useShellStore((state) => state.closeHotkeyDialog);

  return (
    <OverlayFrame
      open={open}
      onClose={close}
      panelClassName="max-w-[520px]"
      subtitle="지금 화면을 더 빠르게 다루는 전역 단축키입니다."
      title="단축키 치트시트"
    >
      <div className="p-5">
        <GlassCard className="mb-4 p-4" priority="secondary">
          <p className="text-sm text-muted-foreground">탐색은 `g + key`, 생성은 `c + key`, 전역 오버레이는 컨트롤/⌘ 계열로 통일되어 있습니다.</p>
        </GlassCard>
        <div className="space-y-2">
          {HOTKEYS.map(([key, description]) => (
            <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-4 py-3" key={key}>
              <span className="text-sm text-foreground">{description}</span>
              <code className="rounded-md bg-black/20 px-2 py-1 text-xs text-primary">{formatKeyHint(key)}</code>
            </div>
          ))}
        </div>
      </div>
    </OverlayFrame>
  );
}
