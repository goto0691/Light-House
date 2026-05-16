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
      { error: error instanceof Error ? error.message : "단축키 설정을 불러오지 못했습니다." },
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
      { error: error instanceof Error ? error.message : "단축키 설정 저장에 실패했습니다." },
      { status: 400 },
    );
  }
}
