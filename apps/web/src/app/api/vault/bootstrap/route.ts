import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await seedVaultSupportData();
  return NextResponse.json(await getVaultSnapshot());
}
