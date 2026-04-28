import { NextResponse } from "next/server";

import { updateDailyEntry } from "@/lib/server/life-ops";
import type { DailyEntry } from "@/lib/mock/life-ops";

type Body = {
  kind?: DailyEntry["kind"];
  title?: string | null;
  body?: string | null;
  emotion?: string | null;
  eventSummary?: string | null;
  verse?: string | null;
  background?: string | null;
  tagsSnapshot?: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ entryId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { entryId } = await context.params;
    return NextResponse.json({ snapshot: await updateDailyEntry(entryId, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Daily entry update failed." }, { status: 500 });
  }
}
