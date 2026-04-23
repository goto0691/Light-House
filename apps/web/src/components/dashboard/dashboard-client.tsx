"use client";

import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
import { Sparkline } from "@/components/shared/sparkline";
import { ZenEditor } from "@/components/shared/zen-editor";
import { getHeatmapMock, getTodayString } from "@/lib/mock/life-ops";
import type { TaskMock } from "@/lib/mock/action-hub";
import type { DailyLogMock } from "@/lib/mock/life-ops";
import type { PersonMock } from "@/lib/mock/prm";
import type { MediaMock, ZettelMock } from "@/lib/mock/vault";

export function DashboardClient({
  log,
  tasks,
  people,
  zettels,
  media,
}: {
  log: DailyLogMock | null;
  tasks: TaskMock[];
  people: PersonMock[];
  zettels: ZettelMock[];
  media: MediaMock[];
}) {
  const today = getTodayString();
  const activeTasks = tasks.filter((task) => task.status !== "done").slice(0, 4);
  const needsContact = people
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
    .slice(0, 5);
  const recentZettels = zettels.slice(0, 5);
  const birthdays = people.filter((person) => person.upcomingBirthday).slice(0, 4);
  const energySeries = log ? [2, 3, log.energy, 4, 3, 5, log.energy] : [2, 3, 4, 3, 4, 5, 3];
  const quote = zettels[0]?.summary ?? "기록은 흩어진 생각을 다시 집으로 데려오는 일이다.";
  const mediaSummary = media.filter((item) => item.status === "completed").length;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-primary">Dashboard</p>
        <h1 className="mt-3 text-3xl font-semibold">Dashboard</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          각 도메인의 로컬 상태를 집계해 오늘의 흐름을 30초 안에 파악할 수 있도록 구성했습니다.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <GlassCard className="xl:col-span-12 min-h-[180px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Today's Anchor</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">
            {log?.journal || "오늘의 의도와 상태를 Life Ops에서 입력해 보세요."}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/8 px-3 py-1 text-sm text-foreground">Mood {log?.mood ?? "-"}</span>
            <span className="rounded-full bg-white/8 px-3 py-1 text-sm text-foreground">Energy {log?.energy ?? "-"}</span>
            <Link className="rounded-full bg-primary/15 px-3 py-1 text-sm text-primary" href="/life-ops">
              Today&apos;s Log
            </Link>
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-8 min-h-[260px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Active Tasks</p>
          <div className="mt-4 space-y-3">
            {activeTasks.map((task) => (
              <Link
                className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-4 py-3"
                href={task.projectId ? `/action-hub/${task.projectId}/tasks/${task.id}` : "/action-hub/inbox"}
                key={task.id}
              >
                <p className="text-sm font-medium text-foreground">{task.title}</p>
                <span className="rounded-full bg-red-500/15 px-2 py-1 text-[11px] text-red-300">{task.priority}</span>
              </Link>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-4 min-h-[260px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Hit Them Up</p>
          <div className="mt-4 space-y-3">
            {needsContact.map((person) => (
              <Link className="block rounded-3xl border border-white/10 bg-white/5 p-4" href={`/prm?detail=person:${person.id}`} key={person.id}>
                <p className="text-sm font-medium text-foreground">{person.name}</p>
                <p className="mt-1 text-sm text-danger">+{person.daysSinceContact - person.cadenceDays} days overdue</p>
              </Link>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-8 min-h-[260px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Streak Heatmap</p>
          <div className="mt-4">
            <Heatmap data={getHeatmapMock()} />
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-4 min-h-[260px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Brain Energy Gauge</p>
          <Sparkline className="mt-6 h-24 w-full" data={energySeries} />
          <p className="mt-4 text-sm text-muted-foreground">{mediaSummary}개의 미디어가 완료 상태입니다.</p>
        </GlassCard>

        <GlassCard className="xl:col-span-6 min-h-[220px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Recent Zettels</p>
          <div className="mt-4 space-y-3">
            {recentZettels.map((zettel) => (
              <Link className="block rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-foreground" href={`/vault?detail=zettel:${zettel.id}`} key={zettel.id}>
                {zettel.title}
              </Link>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-6 min-h-[220px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Upcoming Birthdays</p>
          <div className="mt-4 space-y-3">
            {birthdays.map((item) => (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={item.id}>
                <p className="text-sm font-medium text-foreground">{item.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.upcomingBirthday}</p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-12 min-h-[160px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Quote of the Day</p>
          <p className="mt-5 max-w-3xl font-serif text-2xl leading-10 text-foreground">{quote}</p>
        </GlassCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard className="min-h-[320px]">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Cross-domain Status</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <StatusCard label="Open Tasks" value={String(activeTasks.length)} />
            <StatusCard label="Needs Contact" value={String(needsContact.length)} />
            <StatusCard label="Zettels" value={String(zettels.length)} />
            <StatusCard label="Habits Today" value={String(log?.habits.filter((habit) => habit.completedToday).length ?? 0)} />
          </div>
        </GlassCard>

        <ZenEditor serif placeholder="여기서 @, [[, # 를 입력해 Mention 스텁 드롭다운을 확인하세요." />
      </div>
    </section>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
