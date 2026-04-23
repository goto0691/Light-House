import { NextResponse } from "next/server";

import { ingestActionHubCapture } from "@/lib/server/action-hub";

type CaptureRequest = {
  text?: string;
  context?: {
    domain?: string;
    projectId?: string | null;
    personId?: string | null;
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CaptureRequest;
    const text = body.text?.trim() ?? "";

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const result = await ingestActionHubCapture(text, body.context);

    return NextResponse.json({
      captureId: result.captureId,
      status: result.status,
      suggested: result.suggested,
      routedEntity: result.taskId
        ? {
            type: "task",
            id: result.taskId,
          }
        : {
            type: result.suggested.domain,
            id: result.captureId,
          },
      snapshot: result.snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Capture failed.",
      },
      { status: 500 },
    );
  }
}
