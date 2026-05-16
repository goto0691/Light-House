import { NextResponse } from "next/server";

import { updateLifeOpsMood } from "@/lib/server/life-ops";

type Body = { mood?: number };

export async function POST(request: Request, context: { params: Promise<{ date: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { date } = await context.params;
    return NextResponse.json({ delta: await updateLifeOpsMood(date, body.mood ?? 3) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mood update failed." }, { status: 500 });
  }
}
