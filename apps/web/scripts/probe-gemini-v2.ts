import { createHash } from "node:crypto";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

import { createGeminiRoleGateways } from "../src/lib/v2/ai/gemini-role-gateways";

loadEnvConfig(path.resolve(import.meta.dirname, ".."), process.env.NODE_ENV !== "production");

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    language: { type: "string", enum: ["ko"] },
    sourceKind: { type: "string", enum: ["synthetic_probe"] },
    imagePresent: { type: "boolean" },
  },
  required: ["language", "sourceKind", "imagePresent"],
} as const;

async function main() {
  const roleArgument = process.argv.indexOf("--role");
  const requestedRole = roleArgument >= 0 ? process.argv[roleArgument + 1] : "all";
  if (!new Set(["all", "main", "grounded"]).has(requestedRole)) {
    console.error("--role must be one of: all, main, grounded");
    process.exitCode = 2;
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required. This probe sends synthetic data only.");
    process.exitCode = 2;
    return;
  }
  const gateways = createGeminiRoleGateways(apiKey);
  const result: Record<string, unknown> = { syntheticOnly: true, requestedRole };

  if (requestedRole === "all" || requestedRole === "main") {
    try {
      const analyzed = await gateways.mainAnalyzer.generate<{
        language: "ko";
        sourceKind: "synthetic_probe";
        imagePresent: boolean;
      }>({
        role: "main_analyzer",
        schemaId: "gemini-capability-probe.v1",
        promptVersion: "gemini-capability-probe.v1",
        inputHash: hash("한국어 합성 프로브 + 1px PNG"),
        deadlineMs: 45_000,
        systemInstruction:
          "입력은 제품 배포 전 기능 확인용 합성 데이터다. 언어는 ko, sourceKind는 synthetic_probe, 이미지가 첨부되었으면 imagePresent는 true로 반환하라.",
        parts: [
          { text: "한국어 왕복과 이미지 입력을 확인하는 합성 프로브입니다." },
          {
            inlineData: {
              mimeType: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            },
          },
        ],
        responseJsonSchema: schema,
      });
      result.main = {
        modelId: analyzed.modelId,
        data: analyzed.data,
        tokenUsage: analyzed.tokenUsage,
        latencyMs: analyzed.latencyMs,
      };
    } catch (error) {
      throw new Error(`main_analyzer probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (requestedRole === "all" || requestedRole === "grounded") {
    try {
      const grounded = await gateways.groundedResearch.research({
        role: "grounded_enricher",
        prompt: "Google의 공식 문서를 검색해 Gemini 3.5 Flash-Lite 모델의 컨텍스트 윈도 크기를 한 문장으로 답하고 출처를 인용하라.",
        promptVersion: "gemini-grounding-probe.v2",
        inputHash: hash("Gemini 3.5 Flash-Lite official context window"),
        deadlineMs: 45_000,
      });
      result.grounded = {
        modelId: grounded.modelId,
        queryCount: grounded.queries.length,
        citationCount: grounded.citations.length,
        citationHosts: [...new Set(grounded.citations.map((citation) => new URL(citation.url).host))],
        tokenUsage: grounded.tokenUsage,
        latencyMs: grounded.latencyMs,
      };
    } catch (error) {
      throw new Error(`grounded_enricher probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
