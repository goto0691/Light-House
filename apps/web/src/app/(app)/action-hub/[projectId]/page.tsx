import Link from "next/link";
import { notFound } from "next/navigation";

import { KanbanClient } from "@/components/action-hub/kanban-client";
import { GlassCard } from "@/components/shared/glass-card";
import { getActionHubProject } from "@/lib/server/action-hub";

export default async function ProjectKanbanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getActionHubProject(projectId);
  if (!project) notFound();

  return (
    <section className="space-y-4">
      <GlassCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Action Hub · Kanban</p>
            <h1 className="mt-3 text-3xl font-semibold">{project.title}</h1>
            <p className="mt-3 text-sm text-muted-foreground">{project.recentActivity}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}`}>
              Kanban
            </Link>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}/calendar`}>
              Calendar
            </Link>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}/list`}>
              List
            </Link>
          </div>
        </div>
      </GlassCard>

      <KanbanClient projectId={projectId} />
    </section>
  );
}
