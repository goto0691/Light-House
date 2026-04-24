import { NextResponse } from "next/server";

import type { EntityType } from "@/lib/context/types";
import { getSession } from "@/lib/auth/session";
import { resolveSourceRelation } from "@/lib/server/context";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    sourceRelationId?: string;
    targetType?: EntityType;
    targetId?: string;
    label?: string;
  };

  if (!body.sourceRelationId || !body.targetType || !body.targetId) {
    return NextResponse.json({ error: "sourceRelationId, targetType, targetId are required" }, { status: 400 });
  }

  const bundle = await resolveSourceRelation({
    sourceRelationId: body.sourceRelationId,
    targetType: body.targetType,
    targetId: body.targetId,
    label: body.label,
  });

  return NextResponse.json({ bundle });
}
