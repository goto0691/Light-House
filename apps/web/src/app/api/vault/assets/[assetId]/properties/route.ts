import { NextResponse } from "next/server";

import { updateVaultAssetProperties } from "@/lib/server/vault";

type Body = {
  name?: string | null;
  category?: string | null;
  brand?: string | null;
  condition?: string | null;
  modelName?: string | null;
  acquiredDate?: string | null;
  acquiredPrice?: number | string | null;
  notes?: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { assetId } = await context.params;
    return NextResponse.json({ snapshot: await updateVaultAssetProperties(assetId, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Asset properties update failed." }, { status: 500 });
  }
}
