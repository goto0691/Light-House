import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { executeNotionImport } from "@/lib/server/notion-import";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "가져올 파일을 선택해 주세요." }, { status: 400 });
  }

  const result = await executeNotionImport(file.name, new Uint8Array(await file.arrayBuffer()));
  return NextResponse.json(result);
}
