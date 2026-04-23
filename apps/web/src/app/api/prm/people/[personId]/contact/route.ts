import { NextResponse } from "next/server";

import { markPersonContacted } from "@/lib/server/prm";

export async function POST(_: Request, context: { params: Promise<{ personId: string }> }) {
  try {
    const { personId } = await context.params;
    return NextResponse.json({ snapshot: await markPersonContacted(personId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Contact update failed." }, { status: 500 });
  }
}
