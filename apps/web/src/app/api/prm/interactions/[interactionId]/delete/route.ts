import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteInteraction } from "@/lib/server/prm";

export async function POST(_: Request, { params }: { params: Promise<{ interactionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { interactionId } = await params;
  const delta = await deleteInteraction(interactionId);
  return NextResponse.json({ delta });
}
