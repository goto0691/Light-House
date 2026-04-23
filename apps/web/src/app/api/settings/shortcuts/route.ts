import { NextResponse } from "next/server";

import { listShortcutBindings, replaceShortcutBindings } from "@/lib/server/ui-state";

type ShortcutRequest = {
  bindings?: Array<{
    category: string;
    actionKey: string;
    label: string;
    binding: string;
    isEnabled?: boolean;
    isCustom?: boolean;
    displayOrder?: number;
  }>;
};

export async function GET() {
  try {
    const bindings = await listShortcutBindings();
    return NextResponse.json({ bindings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shortcut settings load failed." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ShortcutRequest;
    const bindings = await replaceShortcutBindings(body.bindings ?? []);
    return NextResponse.json({ bindings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shortcut settings update failed." },
      { status: 400 },
    );
  }
}
