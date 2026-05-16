"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { useShellStore } from "@/stores/use-shell-store";

import { EmptyState } from "./empty-state";
import { OverlayFrame } from "./overlay-frame";

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationCenter() {
  const open = useShellStore((state) => state.notificationCenterOpen);
  const close = useShellStore((state) => state.closeNotificationCenter);
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void fetch("/api/notifications?limit=10")
      .then((response) => response.json())
      .then((payload: { items?: NotificationItem[] }) => {
        if (!cancelled) {
          setItems(payload.items ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <OverlayFrame
      open={open}
      onClose={close}
      panelClassName="max-w-[520px]"
      subtitle="자동화, 관계 리마인더, 시스템 후속 작업을 여기서 확인합니다."
      title="알림"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">최근 자동화와 시스템 알림을 확인합니다.</p>
          <button
          className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-foreground disabled:opacity-60"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  const response = await fetch("/api/notifications", { method: "POST" });
                  const payload = (await response.json()) as { items?: NotificationItem[]; error?: string };
                  if (!response.ok) {
                    throw new Error(payload.error ?? "모두 읽음 처리에 실패했습니다.");
                  }
                  setItems(payload.items ?? []);
                  toast.success("알림을 모두 읽음 처리했습니다.");
                } catch (error) {
                  toast.error("알림 정리에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            <CheckCheck className="h-4 w-4" />
            모두 읽음
          </button>
        </div>

        <div className="space-y-3">
          {items.length ? (
            items.map((item) => (
              <button
                className="focus-ring block w-full rounded-lg border border-white/10 bg-white/5 p-4 text-left [@media(hover:hover)]:hover:bg-white/8"
                key={item.id}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      const response = await fetch(`/api/notifications/${item.id}/read`, { method: "POST" });
                      const payload = (await response.json()) as { items?: NotificationItem[]; error?: string };
                      if (!response.ok) {
                        throw new Error(payload.error ?? "읽음 처리에 실패했습니다.");
                      }
                      setItems(payload.items ?? []);
                    } catch {
                      // noop
                    }
                  });
                }}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.body ?? "세부 설명이 없습니다."}</p>
                  </div>
                  {item.readAt ? null : <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("ko-KR")}</p>
              </button>
            ))
          ) : (
            <EmptyState description="알림이 생기면 이곳에서 바로 읽음 처리하거나 후속 작업으로 넘어갈 수 있습니다." illustration="generic" title="아직 시스템 알림이 없습니다" />
          )}
        </div>
      </div>
    </OverlayFrame>
  );
}
