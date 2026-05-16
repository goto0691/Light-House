import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getVaultZettel, updateVaultZettelDetails } from "@/lib/server/vault";

type Body = {
  title?: string;
  content?: string;
  tags?: string[];
  type?: string;
  category?: string;
  status?: string;
  documentKind?: string;
  aliases?: string[];
  sourceReliability?: string;
  reviewCadence?: string;
  reviewDueAt?: string;
  originalCreatedAt?: string;
  source?: string;
  sourceUrl?: string;
  summary?: string;
};

export async function GET(_request: Request, context: { params: Promise<{ zettelId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { zettelId } = await context.params;
  const zettel = await getVaultZettel(zettelId);
  if (!zettel) return NextResponse.json({ error: "지식을 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ zettel });
}

export async function POST(request: Request, context: { params: Promise<{ zettelId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = (await request.json()) as Body;
    const { zettelId } = await context.params;
    return NextResponse.json({
      zettel: await updateVaultZettelDetails(zettelId, {
        title: body.title ?? "",
        content: body.content ?? "",
        tags: body.tags,
        type: body.type,
        category: body.category,
        status: body.status,
        documentKind: body.documentKind,
        aliases: body.aliases,
        sourceReliability: body.sourceReliability,
        reviewCadence: body.reviewCadence,
        reviewDueAt: body.reviewDueAt,
        originalCreatedAt: body.originalCreatedAt,
        source: body.source,
        sourceUrl: body.sourceUrl,
        summary: body.summary,
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "지식 세부 정보 저장에 실패했습니다." }, { status: 500 });
  }
}
