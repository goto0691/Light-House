import { NextResponse } from "next/server";

import type { EntityType } from "@/lib/context/types";
import { getSession } from "@/lib/auth/session";
import { deleteContextEdge } from "@/lib/server/context";

export async function DELETE(request: Request, { params }: { params: Promise<{ edgeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { edgeId } = await params;
  const { searchParams } = new URL(request.url);
  const focusType = searchParams.get("focusType") as EntityType | null;
  const focusId = searchParams.get("focusId");

  if (!focusType || !focusId) {
    return NextResponse.json({ error: "기준 엔티티를 지정해 주세요." }, { status: 400 });
  }

  const bundle = await deleteContextEdge({
    edgeId: decodeURIComponent(edgeId),
    focusType,
    focusId,
  });

  return NextResponse.json({ bundle });
}
