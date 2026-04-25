import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { getTodayString } from "@/lib/mock/life-ops";
import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getLifeOpsWeeklyRhythm, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";

function weekDates() {
  const today = new Date(`${getTodayString()}T00:00:00+09:00`);
  return Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
}

export default async function ThisWeekPage() {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData()]);
  const dates = weekDates();
  const [weeklyRhythm, actionHub, prm] = await Promise.all([getLifeOpsWeeklyRhythm(dates), getActionHubSnapshot(), getPRMSnapshot()]);
  const activeTasks = actionHub.tasks.filter((task) => task.status !== "done").slice(0, 8);
  const needsContact = prm.people.filter((person) => person.daysSinceContact > person.cadenceDays).slice(0, 6);

  return (
    <section className="space-y-4">
      <GlassCard className="p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Dashboard</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">This week</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">최근 7일의 에너지, 습관, 작업, 연락 리듬을 주간 계획 화면으로 모았습니다.</p>
      </GlassCard>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <GlassCard className="p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">7 day rhythm</p>
          <div className="mt-5 grid gap-3 md:grid-cols-7">
            {weeklyRhythm.map((log) => {
              const date = log.date;
              return (
                <Link className="rounded-lg border border-white/10 bg-white/5 p-3 transition hover:bg-white/8" href={`/life-ops/${date}`} key={date}>
                  <p className="text-xs text-muted-foreground">{date.slice(5)}</p>
                  <p className="mt-3 text-2xl font-semibold text-foreground">{log?.energy ?? "-"}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">energy</p>
                </Link>
              );
            })}
          </div>
        </GlassCard>
        <div className="space-y-4">
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Focus queue</p>
            <div className="mt-4 space-y-2">
              {activeTasks.length ? activeTasks.map((task) => (
                <Link className="block rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-foreground transition hover:bg-white/8" href={task.projectId ? `/action-hub/${task.projectId}/tasks/${task.id}` : "/action-hub/inbox"} key={task.id}>
                  {task.title}
                </Link>
              )) : <p className="rounded-lg border border-dashed border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">이번 주에 표시할 활성 태스크가 없습니다.</p>}
            </div>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Hit them up</p>
            <div className="mt-4 space-y-2">
              {needsContact.length ? needsContact.map((person) => (
                <Link className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 text-sm transition hover:bg-white/8" href={`/prm/${person.id}`} key={person.id}>
                  <span className="text-foreground">{person.name}</span>
                  <span className="text-muted-foreground">{person.daysSinceContact}d</span>
                </Link>
              )) : <p className="rounded-lg border border-dashed border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">연락 주기를 넘긴 사람이 없습니다.</p>}
            </div>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
