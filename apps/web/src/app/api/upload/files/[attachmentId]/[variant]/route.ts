import { NextResponse } from "next/server";

import { getAttachmentVariant } from "@/lib/server/r2";

type RouteContext = {
  params: Promise<{
    attachmentId: string;
    variant: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { attachmentId, variant } = await context.params;
    if (variant !== "preview" && variant !== "original") {
      return NextResponse.json({ error: "지원하지 않는 파일 형식입니다." }, { status: 400 });
    }

    const asset = await getAttachmentVariant(attachmentId, variant);
    return new Response(asset.body, {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": variant === "preview" ? "public, max-age=86400" : "private, no-store",
        "X-Light-House-Asset-Mode": asset.mode,
        "X-Light-House-NAS-Path": asset.nasPath,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "첨부 파일을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
