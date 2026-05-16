import { NextResponse } from "next/server";

import { updateVaultPlaceProperties } from "@/lib/server/vault";

type Body = {
  name?: string | null;
  category?: string | null;
  address?: string | null;
  mapUrl?: string | null;
  firstVisitedAt?: string | null;
  lastVisitedAt?: string | null;
  visitCount?: number | string | null;
  averageRating?: number | string | null;
  review?: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ placeId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { placeId } = await context.params;
    return NextResponse.json({ place: await updateVaultPlaceProperties(placeId, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "장소 속성 저장에 실패했습니다." }, { status: 500 });
  }
}
