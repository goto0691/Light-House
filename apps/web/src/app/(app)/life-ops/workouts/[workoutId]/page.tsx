import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getContextBundle } from "@/lib/server/context";
import { getLifeOpsSnapshot, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ workoutId: string }>;
}) {
  const { workoutId } = await params;
  await seedLifeOpsSupportData();
  const snapshot = await getLifeOpsSnapshot();
  const workout = snapshot.workouts.find((item) => item.id === workoutId);
  if (!workout) notFound();

  const bundle = await getContextBundle("workout", workout.id);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <GlassCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-primary">Workout Detail</p>
              <h1 className="mt-3 font-display text-4xl text-foreground">{workout.categories}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{workout.date}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tag value={`${workout.duration} min`} variant="neutral" />
              <Tag value={`intensity ${workout.intensity}`} variant="custom" />
            </div>
          </div>
          <p className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-muted-foreground">{workout.notes || "운동 메모가 아직 없습니다."}</p>
        </GlassCard>
      }
      railDefaultLens="dates"
    />
  );
}
