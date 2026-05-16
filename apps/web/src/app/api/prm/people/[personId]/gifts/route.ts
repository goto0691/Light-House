import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createGift } from "@/lib/server/prm";

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { personId } = await params;
  const body = (await request.json()) as {
    title?: string;
    direction?: "given" | "received";
    occurredAt?: string;
    satisfaction?: string;
    notes?: string;
  };

  const delta = await createGift(personId, {
    title: body.title ?? "",
    direction: body.direction ?? "given",
    occurredAt: body.occurredAt,
    satisfaction: body.satisfaction,
    notes: body.notes,
  });

  return NextResponse.json({ delta });
}
