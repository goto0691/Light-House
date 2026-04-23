import { NextResponse } from "next/server";

import { cycleVaultMediaStatus } from "@/lib/server/vault";

export async function POST(_: Request, context: { params: Promise<{ mediaId: string }> }) {
  try {
    const { mediaId } = await context.params;
    return NextResponse.json({ snapshot: await cycleVaultMediaStatus(mediaId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Media status update failed." }, { status: 500 });
  }
}
