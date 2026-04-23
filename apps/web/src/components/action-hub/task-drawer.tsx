"use client";

import { useActionHubStore } from "@/stores/use-action-hub-store";

export function TaskDrawer({ id }: { id: string }) {
  const task = useActionHubStore((state) => state.tasks.find((item) => item.id === id));

  if (!task) {
    return (
      <section className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
        태스크 데이터를 찾지 못했습니다.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">{task.kind}</p>
        <h3 className="mt-2 text-2xl font-semibold text-foreground">{task.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{task.content}</p>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Metric label="Status" value={task.status} />
        <Metric label="Priority" value={task.priority} />
        <Metric label="Energy" value={task.brainEnergy} />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Checklist</p>
        <p className="mt-3 text-sm text-muted-foreground">
          {task.checklist.completed} / {task.checklist.total} 완료
        </p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Links</p>
        <p className="mt-3 text-sm text-muted-foreground">People: {task.linkedPeople.join(", ") || "없음"}</p>
        <p className="mt-1 text-sm text-muted-foreground">Zettels: {task.linkedZettels.join(", ") || "없음"}</p>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-lg font-medium text-foreground">{value}</p>
    </div>
  );
}
