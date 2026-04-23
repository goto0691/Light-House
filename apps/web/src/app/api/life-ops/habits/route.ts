import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createLifeOpsHabit } from "@/lib/server/life-ops";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { title?: string; description?: string; icon?: string; schedule?: string };
  const snapshot = await createLifeOpsHabit({
    title: body.title ?? "",
    description: body.description,
    icon: body.icon,
    schedule: body.schedule,
  });
  return NextResponse.json({ snapshot });
}
