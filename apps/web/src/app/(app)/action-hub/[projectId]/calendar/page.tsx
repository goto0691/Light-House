import { notFound } from "next/navigation";

import { ProjectCalendarClient } from "@/components/action-hub/project-calendar-client";
import { getActionHubProjectDetail } from "@/lib/server/action-hub";

export default async function ProjectCalendarPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const detail = await getActionHubProjectDetail(projectId);
  if (!detail) notFound();

  const tasks = detail.tasks.filter((task) => task.dueAt);

  return <ProjectCalendarClient project={detail.project} tasks={tasks} />;
}
