import { NextResponse } from "next/server";

import type { EntityType } from "@/lib/context/types";
import { getSession } from "@/lib/auth/session";
import { resolveSourceRelation } from "@/lib/server/context";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json()) as {
    sourceRelationId?: string;
    targetType?: EntityType;
    targetId?: string;
    label?: string;
  };

  if (!body.sourceRelationId || !body.targetType || !body.targetId) {
    return NextResponse.json({ error: "원본 관계와 연결 대상을 모두 지정해 주세요." }, { status: 400 });
  }

  const bundle = await resolveSourceRelation({
    sourceRelationId: body.sourceRelationId,
    targetType: body.targetType,
    targetId: body.targetId,
    label: body.label,
  });

  return NextResponse.json({ bundle });
}
