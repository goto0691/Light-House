import { NextResponse } from "next/server";

import type { EntityType } from "@/lib/context/types";
import { getSession } from "@/lib/auth/session";
import { createContextEdge } from "@/lib/server/context";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    focusType?: EntityType;
    focusId?: string;
    targetType?: EntityType;
    targetId?: string;
    label?: string;
  };

  if (!body.focusType || !body.focusId || !body.targetType || !body.targetId) {
    return NextResponse.json({ error: "focusType, focusId, targetType, targetId are required" }, { status: 400 });
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
