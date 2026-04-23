import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createPersonInteraction } from "@/lib/server/prm";

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { personId } = await params;
  const body = (await request.json()) as {
    summary?: string;
    type?: string;
    occurredAt?: string;
    content?: string;
  };

  const snapshot = await createPersonInteraction(personId, {
    summary: body.summary ?? "",
    type: body.type,
    occurredAt: body.occurredAt,
    content: body.content,
  });

  return NextResponse.json({ snapshot });
}
