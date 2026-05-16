import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getLifeOpsHydrationSnapshot, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  await seedLifeOpsSupportData();
  const url = new URL(request.url);
  return NextResponse.json(await getLifeOpsHydrationSnapshot(url.searchParams.get("path") ?? "/life-ops"));
}
