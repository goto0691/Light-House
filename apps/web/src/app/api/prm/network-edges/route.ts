import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createNetworkEdge } from "@/lib/server/prm";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    sourcePersonId?: string;
    targetPersonId?: string;
    relationType?: string;
    strength?: number;
    notes?: string;
  };

  const snapshot = await createNetworkEdge({
    sourcePersonId: body.sourcePersonId ?? "",
    targetPersonId: body.targetPersonId ?? "",
    relationType: body.relationType,
    strength: body.strength,
    notes: body.notes,
  });

  return NextResponse.json({ snapshot });
}
