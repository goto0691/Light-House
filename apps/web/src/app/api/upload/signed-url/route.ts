import { NextResponse } from "next/server";

import { createSignedUploadTarget } from "@/lib/server/r2";

type SignedUrlRequest = {
  ownerType?: string;
  ownerId?: string;
  kind?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SignedUrlRequest;

    if (!body.ownerType || !body.ownerId || !body.kind || !body.filename || !body.mimeType || typeof body.sizeBytes !== "number") {
      return NextResponse.json({ error: "ownerType, ownerId, kind, filename, mimeType, sizeBytes are required." }, { status: 400 });
    }

    const target = await createSignedUploadTarget({
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      kind: body.kind,
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });

    return NextResponse.json(target);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create signed upload URL." },
      { status: 500 },
    );
  }
}

