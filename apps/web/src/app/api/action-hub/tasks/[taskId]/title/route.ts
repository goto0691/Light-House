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
      return NextResponse.json({ error: "제목을 입력해 주세요." }, { status: 400 });
    }

    const delta = await updateActionHubTaskTitle(taskId, body.title);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "제목 저장에 실패했습니다." }, { status: 500 });
  }
}
