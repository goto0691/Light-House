import { notFound } from "next/navigation";

import { TaskWorkspaceClient } from "@/components/action-hub/task-workspace-client";
import { getActionHubTask } from "@/lib/server/action-hub";

export default async function TaskWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
}) {
  const { projectId, taskId } = await params;
  const task = await getActionHubTask(projectId, taskId);

  if (!task) notFound();

  return <TaskWorkspaceClient projectId={projectId} taskId={taskId} />;
}
