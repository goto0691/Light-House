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
      return NextResponse.json({ error: "prompt, inputText, schema are required." }, { status: 400 });
    }

    const data = await extractStructuredData({
      prompt: body.prompt,
      inputText: body.inputText,
      schema: body.schema,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI extract failed." },
      { status: 500 },
    );
  }
}

