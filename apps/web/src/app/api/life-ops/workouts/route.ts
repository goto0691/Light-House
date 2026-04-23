import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createWorkout } from "@/lib/server/life-ops";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { date?: string; categories?: string; duration?: number; intensity?: number; notes?: string };
  const snapshot = await createWorkout({
    date: body.date ?? new Date().toISOString().slice(0, 10),
    categories: body.categories ?? "",
    duration: Number(body.duration ?? 0),
    intensity: Number(body.intensity ?? 3),
    notes: body.notes,
  });
  return NextResponse.json({ snapshot });
}
