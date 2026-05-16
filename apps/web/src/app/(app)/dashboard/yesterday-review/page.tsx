import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getTodayString } from "@/lib/mock/life-ops";
import { getActionHubTasks, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getLifeOpsLog, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getPRMPeopleTouchedOn, seedPRMSupportData } from "@/lib/server/prm";
import { getVaultZettelsTouchedOn, seedVaultSupportData } from "@/lib/server/vault";

function offsetDate(days: number) {
  const date = new Date(`${getTodayString()}T00:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function YesterdayReviewPage() {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const date = offsetDate(-1);
  const [log, tasks, touchedPeople, touchedZettels] = await Promise.all([
    getLifeOpsLog(date),
    getActionHubTasks(),
    getPRMPeopleTouchedOn(date),
    getVaultZettelsTouchedOn(date),
  ]);
  const completed = tasks.filter((task) => task.status === "done" || task.dueAt === date).slice(0, 6);

  return (
    <section className="space-y-4">
      <GlassCard className="p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">오늘 보기</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">어제 회고</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{date}의 작업, 기록, 관계 흔적을 하루 회고용으로 모았습니다.</p>
      </GlassCard>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">일일 기록</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Tag value={`기분 ${log?.mood ?? "-"}`} variant="custom" />
              <Tag value={`에너지 ${log?.energy ?? "-"}`} variant="neutral" />
              <Tag value={`몰입 ${log?.deepWorkMinutes ?? 0}분`} variant="neutral" />
            </div>
            <p className="mt-5 text-sm leading-7 text-muted-foreground">{log?.journal || "해당 날짜의 저널이 아직 없습니다."}</p>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">타임라인</p>
            <div className="mt-4 space-y-3">
              {(log?.timeline ?? []).map((item) => (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3" key={`${item.time}-${item.label}`}>
                  <p className="text-sm text-foreground">{item.label}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.time} · {item.type}</p>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
        <div className="space-y-4">
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">작업</p>
            <div className="mt-4 space-y-2">
              {completed.map((task) => (
                <Link className="block rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-foreground hover:bg-white/8" href={task.projectId ? `/action-hub/${task.projectId}/tasks/${task.id}` : "/action-hub/inbox"} key={task.id}>
                  {task.title}
                </Link>
              ))}
            </div>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">사람과 지식</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {touchedPeople.map((person) => <Link className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted-foreground" href={`/prm/${person.id}`} key={person.id}>{person.name}</Link>)}
              {touchedZettels.map((zettel) => <Link className="rounded-md border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-primary" href={`/vault/zettels/${zettel.id}`} key={zettel.id}>{zettel.title}</Link>)}
            </div>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
