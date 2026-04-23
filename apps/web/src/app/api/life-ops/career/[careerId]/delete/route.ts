import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteCareerEntry } from "@/lib/server/life-ops";

export async function POST(_: Request, { params }: { params: Promise<{ careerId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { careerId } = await params;
  const snapshot = await deleteCareerEntry(careerId);
  return NextResponse.json({ snapshot });
}
