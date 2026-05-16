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
      return NextResponse.json({ error: "업로드 소유자, 파일 이름, 형식, 크기 정보를 모두 지정해 주세요." }, { status: 400 });
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
      { error: error instanceof Error ? error.message : "업로드 URL 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}

