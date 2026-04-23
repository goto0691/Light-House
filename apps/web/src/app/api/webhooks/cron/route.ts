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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!body.job) {
      return NextResponse.json({ error: "Cron job is required." }, { status: 400 });
    }

    const result = await runCronJob(body.job);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron execution failed." },
      { status: 500 },
    );
  }
}

