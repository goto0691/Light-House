import { NextResponse } from "next/server";

import type { ContextLensKey, EntityType, RelationKind } from "@/lib/context/types";
import { getSession } from "@/lib/auth/session";
import { getContextBundle } from "@/lib/server/context";

const ENTITY_TYPES: EntityType[] = [
  "project",
  "task",
  "zettel",
  "media",
  "person",
  "daily_log",
  "workout",
  "gift",
  "interaction",
  "place",
  "asset",
  "source_document",
  "tag",
];
const RELATION_KINDS = new Set<RelationKind>(["explicit", "source", "mention", "inferred", "semantic"]);

export async function GET(_request: Request, { params }: { params: Promise<{ entityType: string; entityId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entityType, entityId } = await params;
  if (!ENTITY_TYPES.includes(entityType as EntityType)) {
    return NextResponse.json({ error: "Unsupported entity type" }, { status: 400 });
  }

  const { searchParams } = new URL(_request.url);
  const lens = searchParams.get("lens") as ContextLensKey | null;
  const depth = Number.parseInt(searchParams.get("depth") ?? "1", 10);
  const include = searchParams
    .get("include")
    ?.split(",")
    .map((value) => value.trim())
    .filter((value): value is RelationKind => RELATION_KINDS.has(value as RelationKind));
  const limit = Number.parseInt(searchParams.get("limit") ?? "12", 10);
  const cursor = searchParams.get("cursor") ?? undefined;
  const bundle = await getContextBundle(entityType as EntityType, decodeURIComponent(entityId), {
    cursor,
    depth: Number.isFinite(depth) ? depth : undefined,
    include,
    lens: lens ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return NextResponse.json({ bundle });
}
