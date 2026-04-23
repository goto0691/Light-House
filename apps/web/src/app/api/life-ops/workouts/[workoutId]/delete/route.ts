import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteWorkout } from "@/lib/server/life-ops";

export async function POST(_: Request, { params }: { params: Promise<{ workoutId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workoutId } = await params;
  const snapshot = await deleteWorkout(workoutId);
  return NextResponse.json({ snapshot });
}
