import { NextResponse } from "next/server";
import { ulid } from "ulidx";

type CaptureRequest = {
  text?: string;
  context?: {
    domain?: string;
    projectId?: string | null;
    personId?: string | null;
  };
};

function inferDomain(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes("미팅") || normalized.includes("연락")) return "interaction";
  if (normalized.includes("메모") || normalized.includes("아이디어")) return "zettel";
  return "task";
}

export async function POST(request: Request) {
  const body = (await request.json()) as CaptureRequest;
  const text = body.text?.trim() ?? "";

  if (!text) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  const domain = inferDomain(text);
  const confidence = domain === "task" ? 0.83 : 0.74;
  const captureId = ulid();
  const entityId = ulid();

  return NextResponse.json({
    captureId,
    status: confidence >= 0.7 ? "routed" : "pending",
    suggested: {
      domain,
      fields: {
        title: text.length > 40 ? `${text.slice(0, 40)}...` : text,
        priority: "P2",
        projectId: body.context?.projectId ?? null,
      },
      confidence,
    },
    routedEntity: {
      type: domain,
      id: entityId,
    },
  });
}
