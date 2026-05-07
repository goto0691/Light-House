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
              <th className="px-4 py-3">제목</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">우선순위</th>
              <th className="px-4 py-3">에너지</th>
              <th className="px-4 py-3">마감일</th>
              <th className="px-4 py-3">체크리스트</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr className="border-t border-white/10" key={task.id}>
                <td className="px-4 py-3">
                  <Link className="text-foreground transition hover:text-primary" href={`/action-hub/${projectId}/tasks/${task.id}`} scroll={false}>
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
