"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

import { countOfflineCaptures } from "@/lib/offline-capture-queue";

export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    function refresh() {
      setOnline(navigator.onLine);
      void countOfflineCaptures().then(setQueued).catch(() => setQueued(0));
    }

    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("offline-captures:changed", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("offline-captures:changed", refresh);
    };
  }, []);

  if (online && queued === 0) return null;

  return (
    <div className="fixed inset-x-3 top-3 z-[80] mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-background/90 px-4 py-3 text-sm text-foreground shadow-2xl backdrop-blur md:top-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-amber-300/25 bg-amber-300/10 text-amber-200">
          <WifiOff className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="font-medium">{online ? "오프라인 입력 동기화 대기 중" : "오프라인 모드"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {queued > 0 ? `${queued}개 빠른 입력을 보관 중입니다. 온라인 복귀 시 자동 전송합니다.` : "네트워크가 돌아오면 캡처와 화면 데이터를 다시 연결합니다."}
          </p>
        </div>
      </div>
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        PWA
      </span>
    </div>
  );
}
