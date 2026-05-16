import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteChecklistItem } from "@/lib/server/action-hub";

export async function POST(_: Request, { params }: { params: Promise<{ checklistId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { checklistId } = await params;
  const delta = await deleteChecklistItem(checklistId);
  return NextResponse.json({ delta });
}
