import { NextResponse } from "next/server";

import { toggleLifeOpsHabit } from "@/lib/server/life-ops";

export async function POST(_: Request, context: { params: Promise<{ date: string; habitId: string }> }) {
  try {
    const { date, habitId } = await context.params;
    return NextResponse.json({ snapshot: await toggleLifeOpsHabit(date, habitId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Habit toggle failed." }, { status: 500 });
  }
}
