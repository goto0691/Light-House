"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { ActionHubSnapshot } from "@/lib/server/action-hub";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useShellStore } from "@/stores/use-shell-store";
import { useActionHubStore } from "@/stores/use-action-hub-store";

import { OverlayFrame } from "./overlay-frame";

type CaptureResponse = {
  captureId: string;
  status: "routed" | "pending";
  suggested: {
    domain: string;
    fields: Record<string, string | number | null>;
    confidence: number;
  };
  taskId?: string;
  snapshot: ActionHubSnapshot;
};

export function QuickCaptureModal() {
  const router = useRouter();
  const open = useShellStore((state) => state.quickCaptureOpen);
  const context = useShellStore((state) => state.quickCaptureContext);
  const close = useShellStore((state) => state.closeQuickCapture);
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const payload = text.trim();
    if (!payload) return;

    startTransition(async () => {
      try {
        const result = await postSnapshotMutation<CaptureResponse, CaptureResponse["snapshot"]>(
          "/api/action-hub/capture",
          {
            text: payload,
            context: context ?? { domain: "dashboard" },
          },
          replaceSnapshot,
        );

        if (result.status === "routed") {
          toast.success("입력이 라우팅되었습니다", {
            description: result.taskId
              ? "D1 Inbox 태스크로 추가했습니다."
              : `${result.suggested.domain} · confidence ${Math.round(result.suggested.confidence * 100)}%`,
          });
        } else {
          toast.warning("검토가 필요한 캡처로 저장했습니다", {
            description: "Action Hub Inbox에서 확인할 수 있습니다.",
          });
        }

        router.push("/action-hub/inbox");
        setText("");
        close();
      } catch (error) {
        toast.error("빠른 입력 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <OverlayFrame open={open} onClose={close} panelClassName="max-w-[560px]" title="빠른 입력">
      <div className="space-y-4 p-5">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground">
          현재 컨텍스트: {context?.label ?? "전역"}
        </div>

        <textarea
          autoFocus
          className="min-h-[160px] w-full resize-none rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm text-foreground outline-none focus:border-primary"
          onChange={(event) => setText(event.target.value)}
          placeholder="예: 재민이랑 월요일 호떡집 미팅, 겨울 메뉴 이야기"
          value={text}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Enter 전송 · Shift+Enter 줄바꿈 · Cmd+D 강제 도메인 선택은 다음 단계에서 연결</p>
          <button
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-70"
            disabled={isPending}
            onClick={submit}
            type="button"
          >
            {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            보내기
          </button>
        </div>
      </div>
    </OverlayFrame>
  );
}
