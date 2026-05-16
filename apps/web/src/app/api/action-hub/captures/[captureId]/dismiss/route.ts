import { NextResponse } from "next/server";

import { dismissPendingCapture } from "@/lib/server/action-hub";

export async function POST(_: Request, context: { params: Promise<{ captureId: string }> }) {
  try {
    const { captureId } = await context.params;
    const delta = await dismissPendingCapture(captureId);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "캡처 삭제에 실패했습니다." }, { status: 500 });
  }
}
