import { NextResponse } from "next/server";

import type { EntityType } from "@/lib/context/types";
import { getSession } from "@/lib/auth/session";
import { createContextEdge } from "@/lib/server/context";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json()) as {
    focusType?: EntityType;
    focusId?: string;
    targetType?: EntityType;
    targetId?: string;
    label?: string;
  };

  if (!body.focusType || !body.focusId || !body.targetType || !body.targetId) {
    return NextResponse.json({ error: "기준 엔티티와 연결 대상을 모두 지정해 주세요." }, { status: 400 });
  }

  const bundle = await createContextEdge({
    focusType: body.focusType,
    focusId: body.focusId,
    targetType: body.targetType,
    targetId: body.targetId,
    label: body.label,
  });

  return NextResponse.json({ bundle });
}
