import { NextResponse } from "next/server";

import { updateLifeOpsHabitProperties } from "@/lib/server/life-ops";

type PropertiesRequest = {
  title?: string;
  description?: string;
  icon?: string;
  schedule?: string;
  isActive?: boolean;
};

export async function POST(request: Request, context: { params: Promise<{ habitId: string }> }) {
  try {
    const { habitId } = await context.params;
    const body = (await request.json()) as PropertiesRequest;
    const snapshot = await updateLifeOpsHabitProperties(habitId, body);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Habit properties update failed." }, { status: 500 });
  }
}
