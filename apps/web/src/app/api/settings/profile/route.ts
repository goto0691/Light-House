import { NextResponse } from "next/server";

import { updateCurrentUserProfile } from "@/lib/server/session-user";

type ProfileRequest = {
  displayName?: string;
  locale?: string;
  timezone?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProfileRequest;
    const user = await updateCurrentUserProfile({
      displayName: body.displayName ?? "",
      locale: body.locale ?? "ko-KR",
      timezone: body.timezone ?? "Asia/Seoul",
    });

    return NextResponse.json({
      profile: {
        displayName: user.displayName,
        email: user.email,
        locale: user.locale,
        timezone: user.timezone,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Profile update failed." },
      { status: 400 },
    );
  }
}

