import { NextResponse } from "next/server";

import type { EntityType } from "@/lib/context/types";
import { getSession } from "@/lib/auth/session";
import { searchContextNodes } from "@/lib/server/context";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const include = searchParams.get("include")?.split(",").map((value) => value.trim()) ?? [];
  const semantic = include.includes("semantic") || searchParams.get("semantic") === "1";
  const types = searchParams
    .get("types")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) as EntityType[] | undefined;

  const results = await searchContextNodes(q, types, { semantic });
  return NextResponse.json({ results, semantic });
}
