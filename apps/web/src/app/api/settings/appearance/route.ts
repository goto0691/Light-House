import { NextResponse } from "next/server";

import { listWidgetLayouts, replaceWidgetLayouts, updateAppearancePreferences } from "@/lib/server/ui-state";

type AppearanceRequest = {
  theme?: "dark" | "light" | "system";
  glassOpacity?: "full" | "low" | "off";
  dashboardLayouts?: Array<{
    widgetKey: string;
    titleOverride?: string | null;
    layout: Record<string, unknown>;
    isHidden?: boolean;
    displayOrder?: number;
  }>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AppearanceRequest;

    const user = await updateAppearancePreferences({
      theme: body.theme,
      glassOpacity: body.glassOpacity,
    });

    const dashboardLayouts = body.dashboardLayouts ? await replaceWidgetLayouts("dashboard", body.dashboardLayouts) : await listWidgetLayouts("dashboard");

    return NextResponse.json({
      preferences: user.preferences,
      dashboardLayouts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Appearance settings update failed." },
      { status: 400 },
    );
  }
}
