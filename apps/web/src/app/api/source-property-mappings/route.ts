import { NextResponse } from "next/server";

import { listCurrentSourcePropertyMappings, upsertSourcePropertyMapping } from "@/lib/server/source-workbench";
import type { SourcePropertyMappingMutationInput } from "@/lib/source-workbench-types";

export async function GET() {
  try {
    const rules = await listCurrentSourcePropertyMappings();
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "원본 컬럼 매핑 규칙을 불러오지 못했습니다." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as SourcePropertyMappingMutationInput;
    if (!body.propertyName?.trim()) {
      return NextResponse.json({ error: "원본 컬럼명을 지정해 주세요." }, { status: 400 });
    }

    const workbench = await upsertSourcePropertyMapping(body);
    return NextResponse.json({ workbench });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "원본 컬럼 매핑 규칙을 저장하지 못했습니다. source_property_mappings 마이그레이션 적용 상태를 확인해 주세요.",
      },
      { status: 400 },
    );
  }
}
