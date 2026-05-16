import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getVaultHydrationSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  await seedVaultSupportData();
  const url = new URL(request.url);
  return NextResponse.json(await getVaultHydrationSnapshot(url.searchParams.get("path") ?? "/vault"));
}
