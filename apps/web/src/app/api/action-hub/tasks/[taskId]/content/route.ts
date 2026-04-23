import { NextResponse } from "next/server";

import { updateActionHubTaskContent } from "@/lib/server/action-hub";

type ContentRequest = {
  content?: string;
};

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = (await request.json()) as ContentRequest;
    const snapshot = await updateActionHubTaskContent(taskId, body.content ?? "");
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Content update failed." }, { status: 500 });
  }
}
