import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await seedPRMSupportData();
  return NextResponse.json(await getPRMSnapshot());
}
