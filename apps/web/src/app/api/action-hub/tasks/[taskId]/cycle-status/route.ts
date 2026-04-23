import { NextResponse } from "next/server";

import { cycleActionHubTaskStatus } from "@/lib/server/action-hub";

export async function POST(_: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const snapshot = await cycleActionHubTaskStatus(taskId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status update failed." }, { status: 500 });
  }
}
