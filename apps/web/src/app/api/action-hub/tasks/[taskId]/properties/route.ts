import { NextResponse } from "next/server";

import type { TaskMock } from "@/lib/mock/action-hub";
import { updateActionHubTaskProperties } from "@/lib/server/action-hub";

type PropertiesRequest = {
  title?: string;
  kind?: TaskMock["kind"];
  status?: TaskMock["status"];
  priority?: TaskMock["priority"];
  brainEnergy?: TaskMock["brainEnergy"];
  dueAt?: string | null;
  content?: string;
};

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = (await request.json()) as PropertiesRequest;
    const delta = await updateActionHubTaskProperties(taskId, body);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "작업 속성 저장에 실패했습니다." }, { status: 500 });
  }
}
