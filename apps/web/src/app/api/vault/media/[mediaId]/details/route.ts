import { NextResponse } from "next/server";

import { updateVaultMediaDetails } from "@/lib/server/vault";
import type { MediaMock } from "@/lib/mock/vault";

type Body = {
  title?: string;
  mediaType?: MediaMock["mediaType"];
  originalTitle?: string | null;
  subtype?: string | null;
  platformOrPublisher?: string | null;
  creator?: string | null;
  studio?: string | null;
  genre?: string | null;
  releaseYear?: number | null;
  status?: MediaMock["status"];
  rating?: number | null;
  evaluation?: string | null;
  review?: string | null;
  content?: string | null;
  relationNote?: string | null;
  playTime?: number | null;
  author?: string | null;
  pages?: number | null;
  screenKind?: string | null;
  rewatchValue?: boolean | null;
  loggedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ mediaId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { mediaId } = await context.params;
    return NextResponse.json({ snapshot: await updateVaultMediaDetails(mediaId, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Media details update failed." }, { status: 500 });
  }
}
