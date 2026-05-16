import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getActionHubHydrationSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  await seedActionHubSupportData();
  const url = new URL(request.url);
  const snapshot = await getActionHubHydrationSnapshot(url.searchParams.get("path") ?? "/action-hub");

  return NextResponse.json(snapshot);
}
