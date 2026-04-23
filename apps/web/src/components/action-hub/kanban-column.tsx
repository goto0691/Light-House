import { Plus } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import type { TaskMock } from "@/lib/mock/action-hub";

type KanbanColumnProps = {
  status: string;
  title: string;
  tasks: TaskMock[];
  children: React.ReactNode;
};

export function KanbanColumn({ status, title, tasks, children }: KanbanColumnProps) {
  return (
    <GlassCard className="min-h-[420px]" interactive>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-muted-foreground">{tasks.length}</span>
        </div>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/10 text-muted-foreground transition hover:bg-white/8 hover:text-foreground" type="button">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {tasks.length ? children : <EmptyState className="min-h-[180px]" description={`${title} 컬럼은 비어 있습니다.`} icon="·" title={`${status} empty`} />}
      </div>
    </GlassCard>
  );
}

