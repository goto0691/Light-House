import { NextResponse } from "next/server";

import { ingestActionHubCapture } from "@/lib/server/action-hub";

type CaptureRequest = {
  text?: string;
  context?: {
    domain?: string;
    projectId?: string | null;
    personId?: string | null;
    forceDomain?: "task" | "interaction" | "zettel" | "diary_entry" | "habit_log" | "media_log" | "workout_log" | null;
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CaptureRequest;
    const text = body.text?.trim() ?? "";

    if (!text) {
      return NextResponse.json({ error: "내용을 입력해 주세요." }, { status: 400 });
    }

    const result = await ingestActionHubCapture(text, body.context);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "캡처 처리에 실패했습니다." }, { status: 500 });
  }
}
