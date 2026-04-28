import { NextResponse } from "next/server";

import { updatePersonProfile } from "@/lib/server/prm";
import type { PersonMock } from "@/lib/mock/prm";

type Body = {
  name?: string;
  nickname?: string | null;
  aliases?: string | null;
  birthDate?: string | null;
  birthdayMemo?: string | null;
  groups?: string[];
  dunbarLayer?: number | null;
  intimacy?: number | null;
  coreValue?: string | null;
  bio?: string | null;
  profileBody?: string | null;
  contactCadenceDays?: number | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  socialLinks?: string | null;
  status?: PersonMock["status"];
};

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  try {
    const body = (await request.json()) as Body;
    const { personId } = await params;
    return NextResponse.json({ snapshot: await updatePersonProfile(personId, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Person profile update failed." }, { status: 500 });
  }
}
