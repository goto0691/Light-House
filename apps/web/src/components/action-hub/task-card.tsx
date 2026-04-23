import Link from "next/link";

import type { TaskMock } from "@/lib/mock/action-hub";

export function TaskCard({ projectId, task }: { projectId?: string; task: TaskMock }) {
  return (
    <Link
      className="rounded-3xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/8"
      href={projectId ? `/action-hub/${projectId}/tasks/${task.id}` : `/action-hub/inbox?detail=task:${task.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{task.title}</h3>
        <span className={`rounded-full px-2 py-1 text-[11px] ${task.priority === "P1" ? "bg-red-500/15 text-red-300" : task.priority === "P2" ? "bg-amber-500/15 text-amber-300" : "bg-white/8 text-muted-foreground"}`}>
          {task.priority}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-muted-foreground">{task.brainEnergy}</span>
        {task.dueAt ? <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-muted-foreground">{task.dueAt}</span> : null}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Checklist {task.checklist.completed}/{task.checklist.total}
        </span>
        <span>{task.linkedPeople.join(", ") || "solo"}</span>
      </div>
    </Link>
  );
}
