import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createCareerEntry } from "@/lib/server/life-ops";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { organization?: string; role?: string; category?: string; startDate?: string; endDate?: string | null; description?: string };
  const snapshot = await createCareerEntry({
    organization: body.organization ?? "",
    role: body.role ?? "",
    category: body.category ?? "work",
    startDate: body.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: body.endDate,
    description: body.description,
  });
  return NextResponse.json({ snapshot });
}
