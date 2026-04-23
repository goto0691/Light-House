import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getLifeOpsSnapshot, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await seedLifeOpsSupportData();
  return NextResponse.json(await getLifeOpsSnapshot());
}
