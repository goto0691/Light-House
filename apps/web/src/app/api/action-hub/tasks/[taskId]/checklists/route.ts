import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createChecklistItem } from "@/lib/server/action-hub";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { taskId } = await params;
  const body = (await request.json()) as { content?: string };
  const delta = await createChecklistItem(taskId, body.content ?? "");
  return NextResponse.json({ delta });
}
