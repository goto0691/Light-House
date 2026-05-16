import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getVaultAssetList, seedVaultSupportData } from "@/lib/server/vault";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  await seedVaultSupportData();
  return NextResponse.json({ assets: await getVaultAssetList() });
}
