import { NextResponse } from "next/server";

import { applySourcePropertyMapping } from "@/lib/server/source-workbench";
import type { SourcePropertyBatchApplyInput } from "@/lib/source-workbench-types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SourcePropertyBatchApplyInput;
    if (!body.propertyName?.trim()) {
      return NextResponse.json({ error: "propertyName is required." }, { status: 400 });
    }
    if (!body.targetField?.trim()) {
      return NextResponse.json({ error: "targetField is required." }, { status: 400 });
    }

    const payload = await applySourcePropertyMapping(body);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "원본 컬럼 값을 표준 속성에 일괄 적용하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
