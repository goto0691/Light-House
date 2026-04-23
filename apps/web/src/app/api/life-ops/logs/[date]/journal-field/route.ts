import { NextResponse } from "next/server";

import { updateLifeOpsJournalField } from "@/lib/server/life-ops";

type Body = {
  field?: "journal" | "meditation" | "gratitude";
  value?: string;
};

export async function POST(request: Request, context: { params: Promise<{ date: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { date } = await context.params;
    if (!body.field) return NextResponse.json({ error: "field is required" }, { status: 400 });
    return NextResponse.json({ snapshot: await updateLifeOpsJournalField(date, body.field, body.value ?? "") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Journal update failed." }, { status: 500 });
  }
}
