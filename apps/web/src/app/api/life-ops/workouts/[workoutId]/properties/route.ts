import { NextResponse } from "next/server";

import { updateWorkoutProperties } from "@/lib/server/life-ops";

type PropertiesRequest = {
  date?: string;
  categories?: string;
  duration?: number;
  intensity?: number;
  notes?: string;
};

export async function POST(request: Request, context: { params: Promise<{ workoutId: string }> }) {
  try {
    const { workoutId } = await context.params;
    const body = (await request.json()) as PropertiesRequest;
    const snapshot = await updateWorkoutProperties(workoutId, body);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Workout properties update failed." }, { status: 500 });
  }
}
