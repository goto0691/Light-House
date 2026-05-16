import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createActionHubProject } from "@/lib/server/action-hub";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    kind?: "project" | "area";
    category?: string;
    description?: string;
    icon?: string;
    color?: string;
    targetDate?: string | null;
  };

  const delta = await createActionHubProject({
    title: body.title ?? "",
    kind: body.kind,
    category: body.category,
    description: body.description,
    icon: body.icon,
    color: body.color,
    targetDate: body.targetDate,
  });

  return NextResponse.json({ delta });
}
