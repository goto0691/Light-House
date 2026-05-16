import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteVaultZettel } from "@/lib/server/vault";

export async function POST(_: Request, { params }: { params: Promise<{ zettelId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { zettelId } = await params;
  return NextResponse.json(await deleteVaultZettel(zettelId));
}
