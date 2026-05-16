import { NextResponse } from "next/server";

import { updateCurrentUserPreferences } from "@/lib/server/session-user";

type AISettingsRequest = {
  enabled?: boolean;
  threshold?: number;
  fallbackModel?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AISettingsRequest;
    const user = await updateCurrentUserPreferences({
      aiEnabled: Boolean(body.enabled),
      aiRoutingThreshold: Math.min(0.95, Math.max(0.4, Number(body.threshold ?? 0.7))),
      aiFallbackModel: body.fallbackModel?.trim() || "gemini-3.1-flash-lite-preview",
    });

    return NextResponse.json({
      preferences: user.preferences,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 설정 저장에 실패했습니다." },
      { status: 400 },
    );
  }
}
