import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteGift } from "@/lib/server/prm";

export async function POST(_: Request, { params }: { params: Promise<{ giftId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { giftId } = await params;
  const delta = await deleteGift(giftId);
  return NextResponse.json({ delta });
}
