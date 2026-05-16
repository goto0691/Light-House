import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import type { DailyEntry } from "@/lib/mock/life-ops";
import { getDailyEntryArchivePage, seedLifeOpsSupportData } from "@/lib/server/life-ops";

const DAILY_ENTRY_KINDS = new Set<DailyEntry["kind"]>(["journal", "meditation", "sermon_note", "workout", "note"]);

function parsePositiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  await seedLifeOpsSupportData();
  const url = new URL(request.url);
  const kinds = url.searchParams.getAll("kind").filter((kind): kind is DailyEntry["kind"] => DAILY_ENTRY_KINDS.has(kind as DailyEntry["kind"]));
  const page = await getDailyEntryArchivePage({
    hasEmotion: url.searchParams.get("hasEmotion") === "1",
    hasPeople: url.searchParams.get("hasPeople") === "1",
    kinds,
    limit: parsePositiveInteger(url.searchParams.get("limit")),
    offset: parsePositiveInteger(url.searchParams.get("offset")),
    q: url.searchParams.get("q") ?? undefined,
  });

  return NextResponse.json(page);
}
