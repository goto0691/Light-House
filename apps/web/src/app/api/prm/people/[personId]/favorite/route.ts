import { NextResponse } from "next/server";

import { togglePersonFavorite } from "@/lib/server/prm";

export async function POST(_: Request, context: { params: Promise<{ personId: string }> }) {
  try {
    const { personId } = await context.params;
    return NextResponse.json({ delta: await togglePersonFavorite(personId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "즐겨찾기 저장에 실패했습니다." }, { status: 500 });
  }
}
