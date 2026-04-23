import { notFound } from "next/navigation";

import { ProjectCalendarClient } from "@/components/action-hub/project-calendar-client";
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

  return <ProjectCalendarClient project={project} tasks={tasks} />;
}
