import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { TaskMock } from "@/lib/mock/action-hub";
import { TASK_KIND_OPTIONS } from "@/lib/properties/task";
import { optionLabel } from "@/lib/properties/types";

export function TaskCard({ projectId, task }: { projectId?: string; task: TaskMock }) {
  const progress = task.checklist.total ? Math.round((task.checklist.completed / task.checklist.total) * 100) : 0;

  return (
    <GlassCard
      as={Link}
      className="group block"
      elevation="l1"
      href={projectId ? `/action-hub/${projectId}/tasks/${task.id}` : `/action-hub/inbox?detail=task:${task.id}`}
      interactive
      priority="secondary"
      scroll={false}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-10 w-1.5 rounded-full bg-white/10 transition [@media(hover:hover)]:group-hover:bg-primary/60" />
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.08em] text-muted-foreground">{optionLabel(TASK_KIND_OPTIONS, task.kind, task.kind)}</p>
            <h3 className="text-pretty mt-1 line-clamp-2 text-sm font-medium text-foreground">{task.title}</h3>
          </div>
        </div>
        <div className="shrink-0 space-y-2 text-right">
          <Tag value={task.priority} variant="priority" />
          <Tag value={task.status} variant="status" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Tag value={task.brainEnergy} variant="energy" />
        {task.dueAt ? <span className="tabular-nums rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] tracking-[0.08em] text-muted-foreground">{task.dueAt}</span> : null}
      </div>

      <div className="mt-4 rounded-full bg-black/10 p-1">
        <div className="h-1.5 rounded-full bg-primary/75 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums tracking-[0.08em]">
          체크리스트 {task.checklist.completed}/{task.checklist.total}
        </span>
        <span className="truncate">{task.linkedPeople.slice(0, 3).join(", ") || "단독 작업"}</span>
      </div>
    </GlassCard>
  );
}
