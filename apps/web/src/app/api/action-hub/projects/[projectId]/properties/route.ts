import { NextResponse } from "next/server";

import type { ProjectMock } from "@/lib/mock/action-hub";
import { updateActionHubProjectProperties } from "@/lib/server/action-hub";

type PropertiesRequest = {
  title?: string;
  kind?: ProjectMock["kind"];
  status?: ProjectMock["status"];
  category?: string;
  description?: string;
  icon?: string;
  color?: string;
  targetDate?: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as PropertiesRequest;
    const delta = await updateActionHubProjectProperties(projectId, body);
    return NextResponse.json({ delta });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "프로젝트 속성 저장에 실패했습니다." }, { status: 500 });
  }
}
