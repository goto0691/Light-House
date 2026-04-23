import Link from "next/link";

import { ProjectCard } from "@/components/action-hub/project-card";
import { GlassCard } from "@/components/shared/glass-card";
import { getActionHubSnapshot } from "@/lib/server/action-hub";

export default async function ActionHubPage() {
  const snapshot = await getActionHubSnapshot();

  return (
    <section className="space-y-6">
      <GlassCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-primary">Action Hub</p>
            <h1 className="mt-3 text-3xl font-semibold">프로젝트 랜딩</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              기획서의 P4 기준으로 프로젝트/영역 랜딩, Inbox, Kanban, List, Calendar, Zen Workspace 흐름을 열었습니다.
            </p>
          </div>
          <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href="/action-hub/inbox">
            Inbox 보기
          </Link>
        </div>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-3">
        {snapshot.projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}
