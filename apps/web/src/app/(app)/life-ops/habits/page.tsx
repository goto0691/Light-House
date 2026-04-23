import { GlassCard } from "@/components/shared/glass-card";
import { getTodayString } from "@/lib/mock/life-ops";
import { getLifeOpsLog, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function HabitsPage() {
  await seedLifeOpsSupportData();
  const log = await getLifeOpsLog(getTodayString());
  if (!log) return null;

  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Habits</p>
      <h1 className="mt-3 text-3xl font-semibold">활성 습관 관리</h1>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {log.habits.map((habit) => (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={habit.id}>
            <div className="flex items-center justify-between">
              <span className="text-2xl">{habit.icon}</span>
              <span className="text-xs text-muted-foreground">{habit.streak} streak</span>
            </div>
            <h2 className="mt-3 text-lg font-medium text-foreground">{habit.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">요일 스케줄, 타입, 색상은 다음 단계에서 편집 가능하게 연결합니다.</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
