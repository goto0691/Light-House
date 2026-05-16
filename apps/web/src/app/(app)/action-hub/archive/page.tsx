import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getActionHubArchive } from "@/lib/server/action-hub";

export default async function ActionHubArchivePage() {
  const archive = await getActionHubArchive();

  return (
    <section className="space-y-4">
      <GlassCard className="p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">작업실</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">보관함</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">완료된 작업과 마감된 프로젝트를 회고 가능한 형태로 모아둡니다.</p>
      </GlassCard>
      {archive.tasks.length || archive.projects.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">완료 작업</p>
            <div className="mt-4 space-y-3">
              {archive.tasks.map((task) => (
                <Link className="block rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/8" href={task.projectId ? `/action-hub/${task.projectId}/tasks/${task.id}` : "/action-hub/inbox"} key={task.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{task.title}</p>
                    <Tag value={task.priority} variant="priority" />
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{task.content}</p>
                </Link>
              ))}
            </div>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">닫힌 프로젝트</p>
            <div className="mt-4 space-y-3">
              {archive.projects.map((project) => (
                <Link className="block rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/8" href={`/action-hub/${project.id}`} key={project.id}>
                  <p className="text-sm font-medium text-foreground">{project.icon} {project.title}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{project.recentActivity}</p>
                </Link>
              ))}
            </div>
          </GlassCard>
        </div>
      ) : (
        <EmptyState description="완료된 작업이 쌓이면 이곳에서 주간/월간 회고 자료로 다시 볼 수 있습니다." illustration="task" title="아카이브가 아직 비어 있습니다" />
      )}
    </section>
  );
}
