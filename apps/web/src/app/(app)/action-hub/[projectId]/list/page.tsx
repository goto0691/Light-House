import { notFound } from "next/navigation";

import { ProjectListClient } from "@/components/action-hub/project-list-client";
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

  return <ProjectListClient project={project} tasks={tasks} />;
}
