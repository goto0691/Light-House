import { notFound } from "next/navigation";

import { KanbanClient } from "@/components/action-hub/kanban-client";
import { getActionHubProject } from "@/lib/server/action-hub";

export default async function ProjectKanbanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getActionHubProject(projectId);
  if (!project) notFound();

  return <KanbanClient project={project} />;
}
