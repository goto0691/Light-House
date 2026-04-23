import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteNetworkEdge } from "@/lib/server/prm";

export async function POST(_: Request, { params }: { params: Promise<{ edgeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { edgeId } = await params;
  const snapshot = await deleteNetworkEdge(edgeId);
  return NextResponse.json({ snapshot });
}
