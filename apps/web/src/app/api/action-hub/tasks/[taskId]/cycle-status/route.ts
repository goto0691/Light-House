import { NextResponse } from "next/server";

import { cycleActionHubTaskStatus } from "@/lib/server/action-hub";

export async function POST(_: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const delta = await cycleActionHubTaskStatus(taskId);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "상태 저장에 실패했습니다." }, { status: 500 });
  }
}
