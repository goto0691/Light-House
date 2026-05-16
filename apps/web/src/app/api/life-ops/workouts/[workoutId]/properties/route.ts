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
    const delta = await updateWorkoutProperties(workoutId, body);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "운동 속성 저장에 실패했습니다." }, { status: 500 });
  }
}
