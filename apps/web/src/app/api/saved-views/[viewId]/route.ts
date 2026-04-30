import { NextResponse } from "next/server";

import { deleteSavedView, updateSavedView } from "@/lib/server/ui-state";

type RouteContext = {
  params: Promise<{ viewId: string }>;
};

type SavedViewUpdateRequest = {
  name?: string;
  icon?: string | null;
  searchQuery?: string;
  filterState?: Record<string, unknown>;
  sortState?: Record<string, unknown>;
  viewKey?: string | null;
  isDefault?: boolean;
  displayOrder?: number;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { viewId } = await context.params;
    const body = (await request.json()) as SavedViewUpdateRequest;
    const views = await updateSavedView(viewId, {
      name: body.name,
      icon: body.icon,
      searchQuery: body.searchQuery,
      filterState: body.filterState,
      sortState: body.sortState,
      viewKey: body.viewKey,
      isDefault: body.isDefault,
      displayOrder: body.displayOrder,
    });
    return NextResponse.json({ views });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Saved view update failed." },
      { status: 400 },
    );
  }
}

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
