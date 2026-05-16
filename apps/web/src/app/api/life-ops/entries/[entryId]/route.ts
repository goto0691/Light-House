import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getDailyEntryArchiveDetail, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ entryId: string }>;
  },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  await seedLifeOpsSupportData();
  const { entryId } = await params;
  const entry = await getDailyEntryArchiveDetail(decodeURIComponent(entryId));
  if (!entry) return NextResponse.json({ error: "일일 기록을 찾지 못했습니다." }, { status: 404 });

  return NextResponse.json({ entry });
}
