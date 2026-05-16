import { NextResponse } from "next/server";

import { completeAttachmentUpload } from "@/lib/server/r2";

type CompleteUploadRequest = {
  attachmentId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompleteUploadRequest;

    if (!body.attachmentId) {
      return NextResponse.json({ error: "첨부 파일 ID가 필요합니다." }, { status: 400 });
    }

    const result = await completeAttachmentUpload(body.attachmentId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "업로드 완료 처리에 실패했습니다." },
      { status: 500 },
    );
  }
}

