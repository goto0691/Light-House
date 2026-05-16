import { notFound } from "next/navigation";

import { ProjectListClient } from "@/components/action-hub/project-list-client";
import { getActionHubProjectDetail } from "@/lib/server/action-hub";

export default async function ProjectListPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const detail = await getActionHubProjectDetail(projectId);
  if (!detail) notFound();

  return <ProjectListClient project={detail.project} tasks={detail.tasks} />;
}
