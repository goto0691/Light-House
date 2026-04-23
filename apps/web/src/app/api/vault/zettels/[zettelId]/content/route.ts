import { NextResponse } from "next/server";

import { updateVaultZettelContent } from "@/lib/server/vault";

type Body = { content?: string };

export async function POST(request: Request, context: { params: Promise<{ zettelId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { zettelId } = await context.params;
    return NextResponse.json({ snapshot: await updateVaultZettelContent(zettelId, body.content ?? "") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Zettel content update failed." }, { status: 500 });
  }
}
