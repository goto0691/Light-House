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
    const snapshot = await updateActionHubTaskProperties(taskId, body);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Task properties update failed." }, { status: 500 });
  }
}
