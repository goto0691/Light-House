import { NextResponse } from "next/server";

import { updateCareerEntryProperties } from "@/lib/server/life-ops";

type PropertiesRequest = {
  organization?: string;
  role?: string;
  category?: string;
  startDate?: string;
  endDate?: string | null;
  description?: string;
};

export async function POST(request: Request, context: { params: Promise<{ careerId: string }> }) {
  try {
    const { careerId } = await context.params;
    const body = (await request.json()) as PropertiesRequest;
    const delta = await updateCareerEntryProperties(careerId, body);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "커리어 속성 저장에 실패했습니다." }, { status: 500 });
  }
}
