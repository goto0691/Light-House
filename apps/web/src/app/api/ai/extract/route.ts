import { NextResponse } from "next/server";

import { extractStructuredData } from "@/lib/server/ai";

type ExtractRequest = {
  prompt?: string;
  inputText?: string;
  schema?: Record<string, unknown>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtractRequest;

    if (!body.prompt || !body.inputText || !body.schema) {
      return NextResponse.json({ error: "프롬프트, 입력 텍스트, 스키마를 모두 지정해 주세요." }, { status: 400 });
    }

    const data = await extractStructuredData({
      prompt: body.prompt,
      inputText: body.inputText,
      schema: body.schema,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 구조화 추출에 실패했습니다." },
      { status: 500 },
    );
  }
}

