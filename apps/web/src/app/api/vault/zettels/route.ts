import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createVaultZettel } from "@/lib/server/vault";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    type?: "fleeting" | "literature" | "permanent" | "moc";
    category?: string;
    content?: string;
  };

  const result = await createVaultZettel({
    title: body.title ?? "",
    type: body.type,
    category: body.category,
    content: body.content,
  });

  return NextResponse.json(result);
}
