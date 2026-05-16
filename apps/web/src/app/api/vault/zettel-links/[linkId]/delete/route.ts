import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { unlinkVaultZettels } from "@/lib/server/vault";

export async function POST(_: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { linkId } = await params;
  return NextResponse.json(await unlinkVaultZettels(linkId));
}
