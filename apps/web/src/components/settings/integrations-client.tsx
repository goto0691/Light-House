"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { IntegrationCard } from "@/components/settings/integration-card";
import type { CronJob } from "@/lib/server/cron";

type IntegrationsClientProps = {
  initial: {
    integrations: Array<{
      id: string;
      label: string;
      configured: boolean;
    }>;
    recentRuns: Array<{
      id: string;
      action: string;
      createdAt: string;
      summary: string | null;
    }>;
  };
};

const JOBS: Array<{ id: CronJob; label: string }> = [
  { id: "hit_them_up", label: "연락 필요" },
  { id: "daily_backup", label: "백업" },
  { id: "weekly_review", label: "주간 회고" },
  { id: "birthday", label: "생일 알림" },
  { id: "hard_delete", label: "하드 정리" },
];

export function IntegrationsClient({ initial }: IntegrationsClientProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="glass rounded-[20px] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">연동</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Cloudflare / Gemini</h1>
        <div className="mt-5 space-y-3">
          {initial.integrations.map((integration) => (
            <IntegrationCard configured={integration.configured} key={integration.id} label={integration.label} />
          ))}
        </div>
      </div>

      <div className="glass rounded-[20px] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">수동 실행</p>
        <h2 className="mt-3 font-display text-4xl text-foreground">예약 작업 테스트</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {JOBS.map((job) => (
            <button
              className="rounded-md border border-white/10 px-3 py-2 text-sm text-foreground disabled:opacity-60"
              disabled={isPending}
              key={job.id}
              onClick={() => {
                startTransition(async () => {
                  try {
                    const response = await fetch("/api/webhooks/cron", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ job: job.id }),
                    });

                    const payload = (await response.json()) as { error?: string; summary?: string };
                    if (!response.ok) {
                      throw new Error(payload.error ?? "수동 실행에 실패했습니다.");
                    }

                    toast.success(job.label, {
                      description: payload.summary ?? "수동 실행이 완료되었습니다.",
                    });
                  } catch (error) {
                    toast.error(`${job.label} 실행 실패`, {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              {job.label}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-md border border-white/10 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">최근 실행</p>
          <div className="mt-3 space-y-2">
            {initial.recentRuns.length ? (
              initial.recentRuns.map((run) => (
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm" key={run.id}>
                  <p className="text-foreground">{run.action}</p>
                  <p className="mt-1 text-muted-foreground">{new Date(run.createdAt).toLocaleString("ko-KR")}</p>
                  <p className="mt-2 text-muted-foreground">{run.summary ?? "실행 기록이 남아 있지 않습니다."}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">아직 수동 실행 기록이 없습니다.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
