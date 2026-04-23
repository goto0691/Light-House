import { NextResponse } from "next/server";

import { updateVaultPlaceReview } from "@/lib/server/vault";

type Body = { review?: string };

export async function POST(request: Request, context: { params: Promise<{ placeId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { placeId } = await context.params;
    return NextResponse.json({ snapshot: await updateVaultPlaceReview(placeId, body.review ?? "") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Place review update failed." }, { status: 500 });
  }
}
