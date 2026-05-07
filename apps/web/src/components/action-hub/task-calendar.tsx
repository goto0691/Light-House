import { CalendarClock } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { TaskMock } from "@/lib/mock/action-hub";

type TaskCalendarProps = {
  projectId: string;
  tasks: TaskMock[];
};

export function TaskCalendar({ projectId, tasks }: TaskCalendarProps) {
  if (!tasks.length) {
    return <EmptyState description="마감일이 있는 태스크가 아직 없습니다." icon={CalendarClock} title="일정을 기다리는 중" />;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {tasks.map((task) => (
        <Link href={`/action-hub/${projectId}/tasks/${task.id}`} key={task.id} scroll={false}>
          <GlassCard className="h-full p-5" interactive>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.08em] text-primary">{task.dueAt}</p>
                <h3 className="mt-2 line-clamp-2 font-display text-2xl text-foreground">{task.title}</h3>
              </div>
              <Tag value={task.priority} variant="priority" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Tag value={task.status} variant="status" />
              <Tag value={task.brainEnergy} variant="energy" />
            </div>
            <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">{task.content}</p>
          </GlassCard>
        </Link>
      ))}
    </div>
  );
}
