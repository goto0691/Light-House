import { NextResponse } from "next/server";

import { routeInboxTaskToProject } from "@/lib/server/action-hub";

type RouteRequest = {
  projectId?: string;
};

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = (await request.json()) as RouteRequest;

    if (!body.projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const snapshot = await routeInboxTaskToProject(taskId, body.projectId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Route failed." }, { status: 500 });
  }
}
