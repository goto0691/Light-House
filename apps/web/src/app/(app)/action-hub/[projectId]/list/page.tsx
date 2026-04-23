import Link from "next/link";
import { notFound } from "next/navigation";

import { GlassCard } from "@/components/shared/glass-card";
import { getActionHubProject, getActionHubSnapshot } from "@/lib/server/action-hub";

export default async function ProjectListPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getActionHubProject(projectId);
  if (!project) notFound();

  const snapshot = await getActionHubSnapshot();
  const tasks = snapshot.tasks.filter((task) => task.projectId === projectId);

  return (
    <section className="space-y-4">
      <GlassCard>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">List View</p>
            <h1 className="mt-3 text-3xl font-semibold">{project.title}</h1>
          </div>
          <div className="flex gap-2">
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}`}>
              Kanban
            </Link>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}/calendar`}>
              Calendar
            </Link>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="overflow-hidden rounded-3xl border border-white/10">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-white/5 text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr className="border-t border-white/10" key={task.id}>
                  <td className="px-4 py-3 text-foreground">{task.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{task.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">{task.priority}</td>
                  <td className="px-4 py-3 text-muted-foreground">{task.dueAt ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </section>
  );
}
