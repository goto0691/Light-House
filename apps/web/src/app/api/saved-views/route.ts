import { NextResponse } from "next/server";

import { createSavedView, listSavedViews } from "@/lib/server/ui-state";

type SavedViewRequest = {
  domain?: string;
  scope?: string;
  name?: string;
  icon?: string | null;
  searchQuery?: string;
  filterState?: Record<string, unknown>;
  sortState?: Record<string, unknown>;
  viewKey?: string | null;
  isDefault?: boolean;
  displayOrder?: number;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get("domain") ?? undefined;
    const scope = searchParams.get("scope") ?? undefined;
    const views = await listSavedViews({ domain, scope });
    return NextResponse.json({ views });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Saved views load failed." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SavedViewRequest;

    if (!body.domain || !body.scope || !body.name?.trim()) {
      return NextResponse.json({ error: "domain, scope, name are required." }, { status: 400 });
    }

    const views = await createSavedView({
      domain: body.domain,
      scope: body.scope,
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
      { error: error instanceof Error ? error.message : "Saved view create failed." },
      { status: 400 },
    );
  }
}
