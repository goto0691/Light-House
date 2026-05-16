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
      return NextResponse.json({ error: "프로젝트 ID가 필요합니다." }, { status: 400 });
    }

    const delta = await routeInboxTaskToProject(taskId, body.projectId);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "라우팅에 실패했습니다." }, { status: 500 });
  }
}
