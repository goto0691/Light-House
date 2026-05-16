import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { runCronJob, type CronJob } from "@/lib/server/cron";

type CronRequest = {
  job?: CronJob;
};

function isAuthorized(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  return false;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CronRequest;
    const session = await getSession();

    if (!isAuthorized(request) && !session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (!body.job) {
      return NextResponse.json({ error: "실행할 예약 작업을 지정해 주세요." }, { status: 400 });
    }

    const result = await runCronJob(body.job);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "예약 작업 실행에 실패했습니다." },
      { status: 500 },
    );
  }
}

