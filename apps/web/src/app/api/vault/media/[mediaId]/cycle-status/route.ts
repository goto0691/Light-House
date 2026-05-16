import { NextResponse } from "next/server";

import { cycleVaultMediaStatus } from "@/lib/server/vault";

export async function POST(_: Request, context: { params: Promise<{ mediaId: string }> }) {
  try {
    const { mediaId } = await context.params;
    return NextResponse.json({ media: await cycleVaultMediaStatus(mediaId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "미디어 상태 저장에 실패했습니다." }, { status: 500 });
  }
}
