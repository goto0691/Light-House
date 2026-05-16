import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getLifeOpsHabitHeatmap, getLifeOpsTrendSeries, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  await seedLifeOpsSupportData();
  const [trends, heatmap] = await Promise.all([getLifeOpsTrendSeries(7), getLifeOpsHabitHeatmap()]);
  const rows = trends.rows.reverse();

  return NextResponse.json({
    deepWork: rows.map((row) => Number(row.deepWorkMinutes ?? 0)),
    heatmap,
    sleep: rows.map((row) => Number(row.sleepHours ?? 0)),
  });
}
