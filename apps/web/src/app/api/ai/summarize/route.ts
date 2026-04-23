import { NextResponse } from "next/server";

import { createSummarySSE, generateAISummary } from "@/lib/server/ai";

type SummarizeRequest = {
  type?: "daily" | "weekly" | "project";
  date?: string;
  id?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SummarizeRequest;

    if (body.type === "project" && !body.id) {
      return NextResponse.json({ error: "Project summary requires an id." }, { status: 400 });
    }

    const markdown = await generateAISummary(
      body.type === "project"
        ? { type: "project", id: body.id! }
        : {
            type: body.type === "weekly" ? "weekly" : "daily",
            date: body.date,
          },
    );

    return new Response(createSummarySSE(markdown), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI summarize failed." },
      { status: 500 },
    );
  }
}

