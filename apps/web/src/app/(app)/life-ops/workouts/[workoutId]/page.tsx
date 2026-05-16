import { notFound } from "next/navigation";

import { WorkoutPropertiesPanel } from "@/components/life-ops/workout-properties-panel";
import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getContextBundle } from "@/lib/server/context";
import { getLifeOpsWorkout } from "@/lib/server/life-ops";

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ workoutId: string }>;
}) {
  const { workoutId } = await params;
  const workout = await getLifeOpsWorkout(workoutId);
  if (!workout) notFound();

  const bundle = await getContextBundle("workout", workout.id);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-primary">운동 상세</p>
                <h1 className="mt-3 font-display text-4xl text-foreground">{workout.categories}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{workout.date}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Tag value={`${workout.duration}분`} variant="neutral" />
                <Tag value={`강도 ${workout.intensity}`} variant="custom" />
              </div>
            </div>
            <p className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-muted-foreground">{workout.notes || "운동 기록이 아직 없습니다."}</p>
          </GlassCard>
          <WorkoutPropertiesPanel workout={workout} />
        </div>
      }
      railDefaultLens="dates"
    />
  );
}
