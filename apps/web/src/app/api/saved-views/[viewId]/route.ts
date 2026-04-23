import { NextResponse } from "next/server";

import { deleteSavedView } from "@/lib/server/ui-state";

type RouteContext = {
  params: Promise<{ viewId: string }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { viewId } = await context.params;
    await deleteSavedView(viewId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Saved view delete failed." },
      { status: 400 },
    );
  }
}
