"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AIUsagePanel } from "@/components/settings/ai-usage-panel";

type AISettingsClientProps = {
  initial: {
    enabled: boolean;
    threshold: number;
    fallbackModel: string;
    usage: {
      conversations: number;
      inputTokens: number;
      outputTokens: number;
    };
    recentConversations: Array<{
      id: string;
      purpose: string;
      model: string;
      createdAt: string;
    }>;
  };
};

export function AISettingsClient({ initial }: AISettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [isEnabled, setIsEnabled] = useState(initial.enabled);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [fallbackModel, setFallbackModel] = useState(initial.fallbackModel);
  const [summary, setSummary] = useState("");

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="glass rounded-[20px] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">AI</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">라우팅 설정</h1>
        <div className="mt-5 space-y-4">
          <label className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground">
            <span>AI 기능 활성화</span>
            <input checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} type="checkbox" />
          </label>

          <label className="block rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
            <span className="block">Confidence Threshold: {threshold.toFixed(2)}</span>
            <input className="mt-3 w-full" max="0.95" min="0.4" onChange={(event) => setThreshold(Number(event.target.value))} step="0.05" type="range" value={threshold} />
          </label>

          <label className="block space-y-2 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
            <span className="block">Fallback Model</span>
            <select className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground" onChange={(event) => setFallbackModel(event.target.value)} value={fallbackModel}>
              <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite</option>
              <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="local-template-v1">Local Template</option>
            </select>
          </label>

          <button
            className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  const response = await fetch("/api/settings/ai", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      enabled: isEnabled,
                      threshold,
                      fallbackModel,
                    }),
                  });

                  const payload = (await response.json()) as { error?: string };
                  if (!response.ok) {
                    throw new Error(payload.error ?? "AI 설정 저장에 실패했습니다.");
                  }

                  toast.success("AI 설정을 저장했습니다.");
                } catch (error) {
                  toast.error("AI 설정 저장에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            AI 설정 저장
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  const response = await fetch("/api/ai/summarize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "daily" }),
                  });

                  if (!response.ok || !response.body) {
                    throw new Error("요약 스트림을 시작하지 못했습니다.");
                  }

                  const reader = response.body.getReader();
                  const decoder = new TextDecoder();
                  let done = false;
                  let eventBuffer = "";
                  let nextSummary = "";

                  while (!done) {
                    const result = await reader.read();
                    done = result.done;
                    eventBuffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !done });

                    let boundary = eventBuffer.indexOf("\n\n");
                    while (boundary >= 0) {
                      const message = eventBuffer.slice(0, boundary);
                      eventBuffer = eventBuffer.slice(boundary + 2);
                      const dataLine = message.split("\n").find((line) => line.startsWith("data: "));
                      if (dataLine) {
                        const payload = JSON.parse(dataLine.slice(6)) as { content?: string };
                        if (payload.content) {
                          nextSummary += payload.content;
                        }
                      }
                      boundary = eventBuffer.indexOf("\n\n");
                    }
                  }

                  setSummary(nextSummary.trim());
                  toast.success("오늘 요약을 생성했습니다.");
                } catch (error) {
                  toast.error("AI 요약 생성에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            오늘 요약 생성
          </button>
          <button
            className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  const response = await fetch("/api/ai/summarize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "weekly" }),
                  });

                  if (!response.ok || !response.body) {
                    throw new Error("요약 스트림을 시작하지 못했습니다.");
                  }

                  const reader = response.body.getReader();
                  const decoder = new TextDecoder();
                  let done = false;
                  let eventBuffer = "";
                  let nextSummary = "";

                  while (!done) {
                    const result = await reader.read();
                    done = result.done;
                    eventBuffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !done });

                    let boundary = eventBuffer.indexOf("\n\n");
                    while (boundary >= 0) {
                      const message = eventBuffer.slice(0, boundary);
                      eventBuffer = eventBuffer.slice(boundary + 2);
                      const dataLine = message.split("\n").find((line) => line.startsWith("data: "));
                      if (dataLine) {
                        const payload = JSON.parse(dataLine.slice(6)) as { content?: string };
                        if (payload.content) {
                          nextSummary += payload.content;
                        }
                      }
                      boundary = eventBuffer.indexOf("\n\n");
                    }
                  }

                  setSummary(nextSummary.trim());
                  toast.success("주간 요약을 생성했습니다.");
                } catch (error) {
                  toast.error("AI 요약 생성에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            주간 요약 생성
          </button>
        </div>
        <AIUsagePanel recentConversations={initial.recentConversations} summary={summary} usage={initial.usage} />
      </div>
    </section>
  );
}
