import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { linkVaultZettels } from "@/lib/server/vault";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    sourceId?: string;
    targetId?: string;
    context?: string;
  };

  const snapshot = await linkVaultZettels({
    sourceId: body.sourceId ?? "",
    targetId: body.targetId ?? "",
    context: body.context,
  });

  return NextResponse.json({ snapshot });
}
