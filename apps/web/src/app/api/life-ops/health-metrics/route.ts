import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { upsertHealthMetric } from "@/lib/server/life-ops";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { date?: string; sleepHours?: number; deepWorkMinutes?: number; weight?: number; stepsCount?: number };
  const snapshot = await upsertHealthMetric({
    date: body.date ?? new Date().toISOString().slice(0, 10),
    sleepHours: Number(body.sleepHours ?? 0),
    deepWorkMinutes: Number(body.deepWorkMinutes ?? 0),
    weight: body.weight,
    stepsCount: body.stepsCount,
  });
  return NextResponse.json({ snapshot });
}
