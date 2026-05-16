import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteNetworkEdge } from "@/lib/server/prm";

export async function POST(_: Request, { params }: { params: Promise<{ edgeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { edgeId } = await params;
  const delta = await deleteNetworkEdge(edgeId);
  return NextResponse.json({ delta });
}
