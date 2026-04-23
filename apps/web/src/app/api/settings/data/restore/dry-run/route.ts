import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createRestoreDryRun } from "@/lib/server/restore";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "복원 파일을 선택해 주세요." }, { status: 400 });
  }

  try {
    const result = await createRestoreDryRun(file.name, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "복원 드라이런을 실행하지 못했습니다." },
      { status: 500 },
    );
  }
}
