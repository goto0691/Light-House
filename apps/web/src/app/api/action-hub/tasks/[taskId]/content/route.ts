import { NextResponse } from "next/server";

import { updateActionHubTaskContent } from "@/lib/server/action-hub";

type ContentRequest = {
  content?: string;
};

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = (await request.json()) as ContentRequest;
    const delta = await updateActionHubTaskContent(taskId, body.content ?? "");
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "본문 저장에 실패했습니다." }, { status: 500 });
  }
}
