import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { updateVaultZettelDetails } from "@/lib/server/vault";

type Body = {
  title?: string;
  content?: string;
  tags?: string[];
  type?: string;
  category?: string;
  status?: string;
  documentKind?: string;
  originalCreatedAt?: string;
  source?: string;
  sourceUrl?: string;
  summary?: string;
};

export async function POST(request: Request, context: { params: Promise<{ zettelId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as Body;
    const { zettelId } = await context.params;
    return NextResponse.json({
      snapshot: await updateVaultZettelDetails(zettelId, {
        title: body.title ?? "",
        content: body.content ?? "",
        tags: body.tags,
        type: body.type,
        category: body.category,
        status: body.status,
        documentKind: body.documentKind,
        originalCreatedAt: body.originalCreatedAt,
        source: body.source,
        sourceUrl: body.sourceUrl,
        summary: body.summary,
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Zettel details update failed." }, { status: 500 });
  }
}
