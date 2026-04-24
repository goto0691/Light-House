"use client";

import { ActiveTasksWidget } from "@/components/dashboard/widgets/active-tasks-widget";
import { BrainEnergyGauge } from "@/components/dashboard/widgets/brain-energy-gauge";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { HitThemUpWidget } from "@/components/dashboard/widgets/hit-them-up-widget";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { QuoteOfDayWidget } from "@/components/dashboard/widgets/quote-of-day-widget";
import { RecentZettelsWidget } from "@/components/dashboard/widgets/recent-zettels-widget";
import { StreakHeatmapWidget } from "@/components/dashboard/widgets/streak-heatmap-widget";
import { TodaysAnchorWidget } from "@/components/dashboard/widgets/todays-anchor-widget";
import { UpcomingBirthdaysWidget } from "@/components/dashboard/widgets/upcoming-birthdays-widget";
import { PageHeader, PageLayout } from "@/components/shared/page-layout";
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
  const activeTasks = tasks
    .filter((task) => task.status !== "done")
    .sort((left, right) => {
      const priorityRank = { P1: 0, P2: 1, P3: 2 };
      const energyRank = { hyper_focus: 0, normal: 1, routine: 2 };
      return (
        priorityRank[left.priority] - priorityRank[right.priority] ||
        energyRank[left.brainEnergy] - energyRank[right.brainEnergy] ||
        (left.dueAt ?? "").localeCompare(right.dueAt ?? "")
      );
    })
    .slice(0, 4);
  const needsContact = people
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
    .slice(0, 5);
  const recentZettels = zettels.slice(0, 5);
  const birthdays = people.filter((person) => person.upcomingBirthday).slice(0, 4);
  const energySeries = log ? [2, 3, log.energy, 4, 3, 5, log.energy] : [2, 3, 4, 3, 4, 5, 3];
  const quote = zettels[0]?.summary ?? "기록은 흩어진 생각을 다시 집으로 데려오는 일이다.";
  const hasAnyData = Boolean(tasks.length || people.length || zettels.length || media.length || log);

  return (
    <PageLayout>
      <PageHeader
        eyebrow="Light House"
        title="Dashboard"
        description="오늘의 작업, 관계, 기록, 에너지를 한 화면에서 스캔합니다."
        meta={
          <>
            <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted-foreground">{tasks.length} tasks</span>
            <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted-foreground">{people.length} people</span>
            <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted-foreground">{zettels.length} zettels</span>
          </>
        }
      />
      {hasAnyData ? (
        <DashboardGrid>
          <TodaysAnchorWidget dailyLog={log} date={today} />
          <ActiveTasksWidget tasks={activeTasks} />
          <HitThemUpWidget people={needsContact} />
          <StreakHeatmapWidget bestStreak={17} heatmapData={getHeatmapMock()} />
          <BrainEnergyGauge energyScore={log?.energy ?? 3} last7Days={energySeries} />
          <RecentZettelsWidget zettels={recentZettels} />
          <UpcomingBirthdaysWidget people={birthdays} />
          <QuoteOfDayWidget quote={quote} />
        </DashboardGrid>
      ) : (
        <OnboardingChecklist />
      )}
    </PageLayout>
  );
}
