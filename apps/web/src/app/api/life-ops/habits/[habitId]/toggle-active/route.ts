import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { toggleHabitActive } from "@/lib/server/life-ops";

export async function POST(_: Request, { params }: { params: Promise<{ habitId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { habitId } = await params;
  const delta = await toggleHabitActive(habitId);
  return NextResponse.json({ delta });
}
