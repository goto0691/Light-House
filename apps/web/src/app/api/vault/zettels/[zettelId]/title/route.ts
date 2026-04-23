import { NextResponse } from "next/server";

import { updateVaultZettelTitle } from "@/lib/server/vault";

type Body = { title?: string };

export async function POST(request: Request, context: { params: Promise<{ zettelId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { zettelId } = await context.params;
    return NextResponse.json({ snapshot: await updateVaultZettelTitle(zettelId, body.title ?? "") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Zettel title update failed." }, { status: 500 });
  }
}
