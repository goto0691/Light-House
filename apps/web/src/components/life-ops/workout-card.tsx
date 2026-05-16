import Link from "next/link";

import { WorkoutPropertiesPanel } from "@/components/life-ops/workout-properties-panel";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { WorkoutLog } from "@/lib/mock/life-ops";

type WorkoutCardProps = {
  workout: WorkoutLog;
  onDelete: () => void;
};

export function WorkoutCard({ workout, onDelete }: WorkoutCardProps) {
  return (
    <div className="space-y-3">
      <GlassCard className="p-4" interactive>
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-2xl text-foreground">{workout.date}</p>
          <div className="flex items-center gap-2">
            <Tag value={`강도 ${workout.intensity}`} variant="custom" />
            <button className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/8 hover:text-foreground" onClick={onDelete} type="button">
              삭제
            </button>
          </div>
        </div>
        <Link className="mt-2 block text-sm text-foreground hover:text-primary" href={`/life-ops/workouts/${workout.id}`} scroll={false}>
          {workout.categories}
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">{workout.duration}분</p>
      </GlassCard>
      <details className="rounded-lg border border-white/10 bg-white/5 p-3">
        <summary className="cursor-pointer list-none text-xs text-muted-foreground">속성 편집</summary>
        <div className="mt-3">
          <WorkoutPropertiesPanel workout={workout} />
        </div>
      </details>
    </div>
  );
}
