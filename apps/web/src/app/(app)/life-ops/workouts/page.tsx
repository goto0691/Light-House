import { GlassCard } from "@/components/shared/glass-card";
import { getLifeOpsWorkouts, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function WorkoutsPage() {
  await seedLifeOpsSupportData();
  const workouts = await getLifeOpsWorkouts();
  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Workouts</p>
      <h1 className="mt-3 text-3xl font-semibold">운동 로그</h1>
      <div className="mt-5 space-y-3">
        {workouts.map((workout) => (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={workout.date}>
            <div className="flex items-center justify-between">
              <p className="text-lg font-medium text-foreground">{workout.date}</p>
              <p className="text-sm text-muted-foreground">강도 {workout.intensity}/5</p>
            </div>
            <p className="mt-2 text-sm text-foreground">{workout.categories}</p>
            <p className="mt-1 text-sm text-muted-foreground">{workout.duration} minutes</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
