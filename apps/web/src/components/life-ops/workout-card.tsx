import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { WorkoutLog } from "@/lib/mock/life-ops";
import Link from "next/link";

type WorkoutCardProps = {
  workout: WorkoutLog;
  onDelete: () => void;
};

export function WorkoutCard({ workout, onDelete }: WorkoutCardProps) {
  return (
    <GlassCard className="p-4" interactive>
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-2xl text-foreground">{workout.date}</p>
        <div className="flex items-center gap-2">
          <Tag value={`intensity-${workout.intensity}`} variant="custom" />
          <button className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" onClick={onDelete} type="button">
            삭제
          </button>
        </div>
      </div>
      <Link className="mt-2 block text-sm text-foreground transition hover:text-primary" href={`/life-ops/workouts/${workout.id}`}>
        {workout.categories}
      </Link>
      <p className="mt-1 text-sm text-muted-foreground">{workout.duration} minutes</p>
    </GlassCard>
  );
}
