import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await seedActionHubSupportData();
  const snapshot = await getActionHubSnapshot();

  return NextResponse.json(snapshot);
}
