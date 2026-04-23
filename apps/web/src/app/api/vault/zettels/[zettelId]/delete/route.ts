import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteVaultZettel } from "@/lib/server/vault";

export async function POST(_: Request, { params }: { params: Promise<{ zettelId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { zettelId } = await params;
  const snapshot = await deleteVaultZettel(zettelId);
  return NextResponse.json({ snapshot });
}
