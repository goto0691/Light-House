import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getPRMHydrationSnapshot, seedPRMSupportData } from "@/lib/server/prm";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  await seedPRMSupportData();
  const url = new URL(request.url);
  return NextResponse.json(await getPRMHydrationSnapshot(url.searchParams.get("path") ?? "/prm"));
}
