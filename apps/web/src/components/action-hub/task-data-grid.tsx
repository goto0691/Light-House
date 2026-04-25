import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { TaskMock } from "@/lib/mock/action-hub";

type TaskDataGridProps = {
  projectId: string;
  tasks: TaskMock[];
};

export function TaskDataGrid({ projectId, tasks }: TaskDataGridProps) {
  return (
    <GlassCard>
      <div className="overflow-x-auto rounded-3xl border border-white/10">
        <table className="min-w-[760px] w-full border-collapse text-left text-sm">
          <thead className="bg-white/5 text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Energy</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Checklist</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr className="border-t border-white/10" key={task.id}>
                <td className="px-4 py-3">
                  <Link className="text-foreground transition hover:text-primary" href={`/action-hub/${projectId}/tasks/${task.id}`}>
                    {task.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Tag value={task.status} variant="status" />
                </td>
                <td className="px-4 py-3">
                  <Tag value={task.priority} variant="priority" />
                </td>
                <td className="px-4 py-3">
                  <Tag value={task.brainEnergy} variant="energy" />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{task.dueAt ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {task.checklist.completed}/{task.checklist.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
