import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteCareerEntry } from "@/lib/server/life-ops";

export async function POST(_: Request, { params }: { params: Promise<{ careerId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { careerId } = await params;
  const delta = await deleteCareerEntry(careerId);
  return NextResponse.json({ delta });
}
