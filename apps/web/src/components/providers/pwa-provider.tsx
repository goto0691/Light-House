"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { flushOfflineCaptures } from "@/lib/offline-capture-queue";

export function PWAProvider() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      // V2 owns the shared /sw.js registration and offline-capture cache too.
      // Entering a legacy page must not delete another feature's local state.
      return;
    }

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    async function flushQueue() {
      if (!navigator.onLine) return;
      const result = await flushOfflineCaptures().catch(() => null);
      if (result?.flushed) {
        toast.success("오프라인 입력을 동기화했습니다.", {
          description: `${result.flushed}개 캡처가 작업실로 전송되었습니다.`,
        });
      }
    }

    window.addEventListener("online", flushQueue);
    void flushQueue();
    return () => window.removeEventListener("online", flushQueue);
  }, []);

  return null;
}
