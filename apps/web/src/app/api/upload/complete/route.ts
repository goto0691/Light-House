import { NextResponse } from "next/server";

import { completeAttachmentUpload } from "@/lib/server/r2";

type CompleteUploadRequest = {
  attachmentId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompleteUploadRequest;

    if (!body.attachmentId) {
      return NextResponse.json({ error: "attachmentId is required." }, { status: 400 });
    }

    const result = await completeAttachmentUpload(body.attachmentId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to finalize upload." },
      { status: 500 },
    );
  }
}

