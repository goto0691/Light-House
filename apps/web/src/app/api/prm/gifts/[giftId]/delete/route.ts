import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteGift } from "@/lib/server/prm";

export async function POST(_: Request, { params }: { params: Promise<{ giftId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { giftId } = await params;
  const snapshot = await deleteGift(giftId);
  return NextResponse.json({ snapshot });
}
