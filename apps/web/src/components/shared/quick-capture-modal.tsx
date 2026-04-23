"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { ActionHubSnapshot } from "@/lib/server/action-hub";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useShellStore } from "@/stores/use-shell-store";
import { useActionHubStore } from "@/stores/use-action-hub-store";

import { OverlayFrame } from "./overlay-frame";
import { KeyHint } from "./key-hint";

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

const DOMAIN_OPTIONS = [
  { value: "task", label: "Task" },
  { value: "zettel", label: "Zettel" },
  { value: "interaction", label: "Interaction" },
  { value: "diary_entry", label: "Diary" },
  { value: "habit_log", label: "Habit" },
  { value: "media_log", label: "Media" },
] as const;

export function QuickCaptureModal() {
  const router = useRouter();
  const open = useShellStore((state) => state.quickCaptureOpen);
  const context = useShellStore((state) => state.quickCaptureContext);
  const seedText = useShellStore((state) => state.quickCaptureSeedText);
  const close = useShellStore((state) => state.closeQuickCapture);
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);
  const [text, setText] = useState("");
  const [forceDomain, setForceDomain] = useState<(typeof DOMAIN_OPTIONS)[number]["value"] | "">("");
  const [showForceDomain, setShowForceDomain] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setText(seedText);
      return;
    }

    setText("");
    setForceDomain("");
    setShowForceDomain(false);
  }, [open, seedText]);

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
            ...(forceDomain
              ? {
                  context: {
                    ...(context ?? { domain: "dashboard" }),
                    forceDomain,
                  },
                }
              : null),
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
        close();
      } catch (error) {
        toast.error("빠른 입력 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <OverlayFrame
      open={open}
      onClose={close}
      panelClassName="max-w-[560px]"
      subtitle="짧게 던지면 Action Hub 쪽으로 먼저 라우팅하고, 확신이 낮으면 Inbox에서 다시 검토합니다."
      title="빠른 입력"
    >
      <div className="space-y-4 p-5">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground">
          현재 컨텍스트: {context?.label ?? "전역"}
        </div>

        <textarea
          autoFocus
          className="min-h-[160px] w-full resize-none rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm text-foreground outline-none focus:border-primary"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
              event.preventDefault();
              setShowForceDomain((current) => !current);
              return;
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="예: 재민이랑 월요일 호떡집 미팅, 겨울 메뉴 이야기"
          value={text}
        />

        {showForceDomain ? (
          <div className="rounded-3xl border border-white/10 bg-black/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">강제 도메인 선택</p>
              <button
                className="focus-ring inline-flex min-h-10 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition [@media(hover:hover)]:hover:bg-white/8 [@media(hover:hover)]:hover:text-foreground"
                onClick={() => setShowForceDomain(false)}
                type="button"
              >
                닫기
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {DOMAIN_OPTIONS.map((option) => (
                <button
                  className={`focus-ring rounded-2xl border px-3 py-3 text-left text-sm transition ${
                    forceDomain === option.value
                      ? "border-primary/30 bg-primary/12 text-primary"
                      : "border-white/10 bg-white/5 text-foreground [@media(hover:hover)]:hover:bg-white/8"
                  }`}
                  key={option.value}
                  onClick={() => setForceDomain((current) => (current === option.value ? "" : option.value))}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">라우팅 힌트</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {["task", "zettel", "interaction", "diary", "media"].map((item) => (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground" key={item}>
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <KeyHint keys="Enter" />
            <span>전송</span>
            <KeyHint keys="Shift+Enter" />
            <span>줄바꿈</span>
            <KeyHint keys="Cmd+D" />
            <span>강제 도메인 선택</span>
          </div>
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
        {forceDomain ? (
          <div className="flex items-center gap-2 text-xs text-primary">
            <ChevronDown className="h-3.5 w-3.5" />
            강제 도메인: {DOMAIN_OPTIONS.find((option) => option.value === forceDomain)?.label}
          </div>
        ) : null}
      </div>
    </OverlayFrame>
  );
}
