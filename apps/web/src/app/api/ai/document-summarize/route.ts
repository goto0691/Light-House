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
      return NextResponse.json({ error: "attachmentId is required." }, { status: 400 });
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
      { error: error instanceof Error ? error.message : "Document summarization failed." },
      { status: 500 },
    );
  }
}
