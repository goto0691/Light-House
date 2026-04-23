import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { unlinkVaultZettels } from "@/lib/server/vault";

export async function POST(_: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { linkId } = await params;
  const snapshot = await unlinkVaultZettels(linkId);
  return NextResponse.json({ snapshot });
}
