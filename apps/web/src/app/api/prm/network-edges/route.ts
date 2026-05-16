import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createNetworkEdge } from "@/lib/server/prm";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json()) as {
    sourcePersonId?: string;
    targetPersonId?: string;
    relationType?: string;
    strength?: number;
    notes?: string;
  };

  const delta = await createNetworkEdge({
    sourcePersonId: body.sourcePersonId ?? "",
    targetPersonId: body.targetPersonId ?? "",
    relationType: body.relationType,
    strength: body.strength,
    notes: body.notes,
  });

  return NextResponse.json({ delta });
}
