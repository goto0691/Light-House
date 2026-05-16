import { NextResponse } from "next/server";

import { createSummarySSE, summarizeAttachmentDocument } from "@/lib/server/ai";

type DocumentSummarizeRequest = {
  attachmentId?: string;
  prompt?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DocumentSummarizeRequest;

    if (!body.attachmentId) {
      return NextResponse.json({ error: "첨부 파일 ID가 필요합니다." }, { status: 400 });
    }

    const markdown = await summarizeAttachmentDocument({
      attachmentId: body.attachmentId,
      prompt: body.prompt,
    });

    return new Response(createSummarySSE(markdown), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "문서 요약 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}
