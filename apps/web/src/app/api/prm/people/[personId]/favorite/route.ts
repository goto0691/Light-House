import { NextResponse } from "next/server";

import { togglePersonFavorite } from "@/lib/server/prm";

export async function POST(_: Request, context: { params: Promise<{ personId: string }> }) {
  try {
    const { personId } = await context.params;
    return NextResponse.json({ snapshot: await togglePersonFavorite(personId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Favorite toggle failed." }, { status: 500 });
  }
}
