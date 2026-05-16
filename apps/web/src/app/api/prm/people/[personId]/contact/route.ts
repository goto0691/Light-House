import { NextResponse } from "next/server";

import { markPersonContacted } from "@/lib/server/prm";

export async function POST(_: Request, context: { params: Promise<{ personId: string }> }) {
  try {
    const { personId } = await context.params;
    return NextResponse.json({ delta: await markPersonContacted(personId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "연락 기록 저장에 실패했습니다." }, { status: 500 });
  }
}
