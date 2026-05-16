import { NextResponse } from "next/server";

import { getPRMPerson } from "@/lib/server/prm";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ personId: string }>;
  },
) {
  const { personId } = await params;
  const person = await getPRMPerson(personId);
  if (!person) {
    return NextResponse.json({ error: "인물 데이터를 찾지 못했습니다." }, { status: 404 });
  }

  return NextResponse.json({ sourceDocument: person.sourceDocument ?? null });
}
