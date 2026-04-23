import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { BentoCard } from "@/components/shared/bento-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { TaskMock } from "@/lib/mock/action-hub";

type ActiveTasksWidgetProps = {
  tasks: TaskMock[];
};

export function ActiveTasksWidget({ tasks }: ActiveTasksWidgetProps) {
  return (
    <BentoCard colSpan={8} priority="primary" rowSpan={3}>
      <GlassCard className="h-full" interactive>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Active Tasks</p>
            <p className="mt-2 text-sm text-muted-foreground">P1 우선, 몰입 에너지와 마감을 먼저 보여줍니다.</p>
          </div>
          <Link className="text-xs uppercase tracking-[0.18em] text-primary" href="/action-hub">
            Open
          </Link>
        </div>
        <div className="mt-5 space-y-3">
          {tasks.length ? (
            tasks.map((task) => (
              <Link
                className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-primary/20 hover:bg-white/8"
                href={task.projectId ? `/action-hub/${task.projectId}/tasks/${task.id}` : "/action-hub/inbox"}
                key={task.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Tag size="sm" value={task.priority} variant="priority" />
                    <Tag size="sm" value={task.brainEnergy} variant="energy" />
                    {task.dueAt ? <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{task.dueAt}</span> : null}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          ) : (
            <EmptyState
              cta={{ label: "새 Task", onClick: () => window.location.assign("/action-hub"), hotkey: "c p" }}
              description="오늘은 몰입할 Task가 없네요."
              icon="🧭"
              title="비어 있는 브리핑"
            />
          )}
        </div>
      </GlassCard>
    </BentoCard>
  );
}

