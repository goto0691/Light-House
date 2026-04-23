import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { toggleHabitActive } from "@/lib/server/life-ops";

export async function POST(_: Request, { params }: { params: Promise<{ habitId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { habitId } = await params;
  const snapshot = await toggleHabitActive(habitId);
  return NextResponse.json({ snapshot });
}
