import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import type { EntityType } from "@/lib/context/types";
import { createCanonicalEntityAndAttach } from "@/lib/server/context";

const CREATE_TYPES = new Set<EntityType>(["person", "zettel", "project", "media", "place"]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    focusId?: string;
    focusType?: EntityType;
    label?: string;
    sourceRelationId?: string;
    targetType?: EntityType;
    title?: string;
  };

  if (!body.focusType || !body.focusId || !body.targetType || !body.title) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!CREATE_TYPES.has(body.targetType)) {
    return NextResponse.json({ error: "Unsupported canonical entity type" }, { status: 400 });
  }

  const bundle = await createCanonicalEntityAndAttach({
    focusId: body.focusId,
    focusType: body.focusType,
    label: body.label,
    sourceRelationId: body.sourceRelationId,
    targetType: body.targetType,
    title: body.title,
  });

  return NextResponse.json({ bundle });
}
