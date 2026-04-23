import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { restoreImportedRelationsForUser } from "@/lib/server/notion-import";
import { resolveCurrentUser } from "@/lib/server/session-user";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const user = await resolveCurrentUser();
  const body = (await request.json().catch(() => null)) as { importBatchId?: string | null } | null;
  const result = await restoreImportedRelationsForUser(user.id, body?.importBatchId ?? undefined);
  return NextResponse.json(result);
}
