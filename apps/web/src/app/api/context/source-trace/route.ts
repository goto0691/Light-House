import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import type { EntityType } from "@/lib/context/types";
import { getSourceTraceDocuments } from "@/lib/server/context";

const ENTITY_TYPES = new Set<EntityType>([
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
]);

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sourceDocumentIds = searchParams
    .get("sourceDocumentIds")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const focusTypeParam = searchParams.get("focusType");
  const focusType = focusTypeParam && ENTITY_TYPES.has(focusTypeParam as EntityType) ? (focusTypeParam as EntityType) : undefined;
  const focusId = searchParams.get("focusId")?.trim() || undefined;

  const documents = await getSourceTraceDocuments({ sourceDocumentIds, focusType, focusId });
  return NextResponse.json({ documents });
}
