import "server-only";

import { Buffer } from "node:buffer";

export type GeminiExecution = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type CaptureRouteAnalysis = {
  domain: "task" | "interaction" | "zettel" | "diary_entry" | "habit_log" | "media_log" | "workout_log";
  title: string;
  summary: string;
  priority: "P1" | "P2" | "P3";
  brainEnergy: "routine" | "normal" | "hyper_focus";
  dueAt: string | null;
  confidence: number;
  shouldAutoRoute: boolean;
};

type GeminiTextPart =
  | { text: string }
  | {
      inlineData: {
        mimeType: string;
        data: string;
      };
    };

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    message?: string;
  };
};

type GenerateGeminiTextInput = {
  systemInstruction: string;
  parts: GeminiTextPart[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingLevel?: "low" | "medium" | "high";
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  responseJsonSchema?: Record<string, unknown>;
};

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY?.trim();
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite-preview";
}

export function createInlineDataPart(data: Uint8Array | Buffer, mimeType: string): GeminiTextPart {
  return {
    inlineData: {
      mimeType,
      data: Buffer.from(data).toString("base64"),
    },
  };
}

export async function generateGeminiText(input: GenerateGeminiTextInput): Promise<GeminiExecution | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  const model = input.model ?? getGeminiModel();
  const startedAt = Date.now();

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: input.systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: input.parts,
        },
      ],
      generationConfig: {
        temperature: input.temperature ?? 0.3,
        topP: 0.9,
        maxOutputTokens: input.maxOutputTokens,
        responseMimeType: input.responseMimeType,
        responseSchema: input.responseSchema,
        responseJsonSchema: input.responseJsonSchema,
        thinkingConfig: input.thinkingLevel
          ? {
              thinkingLevel: input.thinkingLevel,
            }
          : undefined,
      },
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as GeminiResponse;

  if (!response.ok || payload.error?.message) {
    throw new Error(payload.error?.message || `Gemini request failed with status ${response.status}.`);
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const promptText = input.parts
    .map((part) => ("text" in part ? part.text : `[binary:${part.inlineData.mimeType}]`))
    .join("\n");

  return {
    text,
    model,
    inputTokens: payload.usageMetadata?.promptTokenCount ?? estimateTokens(promptText),
    outputTokens: payload.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
    latencyMs: Math.max(1, Date.now() - startedAt),
  };
}

export async function generateGeminiJson<T>(input: Omit<GenerateGeminiTextInput, "responseMimeType">): Promise<(GeminiExecution & { json: T }) | null> {
  const execution = await generateGeminiText({
    ...input,
    responseMimeType: "application/json",
  });

  if (!execution) {
    return null;
  }

  return {
    ...execution,
    json: JSON.parse(execution.text) as T,
  };
}

export async function analyzeQuickCaptureWithAI(input: { text: string; context?: { domain?: string; projectId?: string | null; personId?: string | null } }) {
  const prompt = [
    "Analyze the quick capture and return routing JSON.",
    "Choose the best domain from: task, interaction, zettel, diary_entry, habit_log, media_log, workout_log.",
    "Return compact Korean-aware extraction.",
    `Current context domain: ${input.context?.domain ?? "dashboard"}`,
    `Current projectId: ${input.context?.projectId ?? "null"}`,
    `Current personId: ${input.context?.personId ?? "null"}`,
    `Capture text: ${input.text}`,
  ].join("\n");

  try {
    const result = await generateGeminiJson<CaptureRouteAnalysis>({
      systemInstruction:
        "You are a personal productivity routing engine. Return only valid JSON that matches the requested schema. Keep confidence between 0 and 1.",
      parts: [{ text: prompt }],
      thinkingLevel: "high",
      temperature: 0.2,
      responseJsonSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            enum: ["task", "interaction", "zettel", "diary_entry", "habit_log", "media_log", "workout_log"],
          },
          title: { type: "string" },
          summary: { type: "string" },
          priority: { type: "string", enum: ["P1", "P2", "P3"] },
          brainEnergy: { type: "string", enum: ["routine", "normal", "hyper_focus"] },
          dueAt: { type: "string", nullable: true },
          confidence: { type: "number" },
          shouldAutoRoute: { type: "boolean" },
        },
        required: ["domain", "title", "summary", "priority", "brainEnergy", "dueAt", "confidence", "shouldAutoRoute"],
      },
    });

    return result?.json ?? null;
  } catch {
    return null;
  }
}
