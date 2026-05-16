import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { attachTaskZettel, detachTaskZettel } from "@/lib/server/action-hub";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { taskId } = await params;
  const body = (await request.json()) as { zettelId?: string; zettelTitle?: string; mode?: "attach" | "detach" };
  const delta =
    body.mode === "detach"
      ? await detachTaskZettel(taskId, body.zettelTitle ?? "")
      : await attachTaskZettel(taskId, body.zettelId ?? "");

  return NextResponse.json({ delta });
}
