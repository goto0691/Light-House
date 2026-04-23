import { NextResponse } from "next/server";

import { updateLifeOpsEnergy } from "@/lib/server/life-ops";

type Body = { energy?: number };

export async function POST(request: Request, context: { params: Promise<{ date: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { date } = await context.params;
    return NextResponse.json({ snapshot: await updateLifeOpsEnergy(date, body.energy ?? 3) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Energy update failed." }, { status: 500 });
  }
}
