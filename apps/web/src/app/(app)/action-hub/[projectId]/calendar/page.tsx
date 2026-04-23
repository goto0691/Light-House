import Link from "next/link";
import { notFound } from "next/navigation";

import { GlassCard } from "@/components/shared/glass-card";
import { getActionHubProject, getActionHubSnapshot } from "@/lib/server/action-hub";

export default async function ProjectCalendarPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getActionHubProject(projectId);
  if (!project) notFound();

  const snapshot = await getActionHubSnapshot();
  const tasks = snapshot.tasks.filter((task) => task.projectId === projectId && task.dueAt);

  return (
    <section className="space-y-4">
      <GlassCard>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Calendar View</p>
            <h1 className="mt-3 text-3xl font-semibold">{project.title}</h1>
          </div>
          <div className="flex gap-2">
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}`}>
              Kanban
            </Link>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}/list`}>
              List
            </Link>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tasks.map((task) => (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={task.id}>
              <p className="text-sm font-medium text-foreground">{task.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">Due {task.dueAt}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-primary">{task.status}</p>
            </div>
          ))}
        </div>
      </GlassCard>
    </section>
  );
}
