import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createVaultZettel } from "@/lib/server/vault";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    type?: string;
    category?: string;
    content?: string;
    tags?: string[];
    status?: string;
    documentKind?: string;
    originalCreatedAt?: string;
    source?: string;
    sourceUrl?: string;
    summary?: string;
  };

  const result = await createVaultZettel({
    title: body.title ?? "",
    type: body.type,
    category: body.category,
    content: body.content,
    tags: body.tags,
    status: body.status,
    documentKind: body.documentKind,
    originalCreatedAt: body.originalCreatedAt,
    source: body.source,
    sourceUrl: body.sourceUrl,
    summary: body.summary,
  });

  return NextResponse.json(result);
}
