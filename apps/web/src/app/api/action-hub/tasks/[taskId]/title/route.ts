import { NextResponse } from "next/server";

import { updateActionHubTaskTitle } from "@/lib/server/action-hub";

type TitleRequest = {
  title?: string;
};

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = (await request.json()) as TitleRequest;

    if (!body.title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const snapshot = await updateActionHubTaskTitle(taskId, body.title);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Title update failed." }, { status: 500 });
  }
}
