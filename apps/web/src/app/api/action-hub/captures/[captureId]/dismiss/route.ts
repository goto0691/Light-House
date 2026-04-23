import { NextResponse } from "next/server";

import { dismissPendingCapture } from "@/lib/server/action-hub";

export async function POST(_: Request, context: { params: Promise<{ captureId: string }> }) {
  try {
    const { captureId } = await context.params;
    const snapshot = await dismissPendingCapture(captureId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dismiss failed." }, { status: 500 });
  }
}
