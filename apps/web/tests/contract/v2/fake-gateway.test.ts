import { describe, expect, it } from "vitest";

import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import type { V2StructuredModelRequest } from "@/lib/v2/ai/gateway";

const request: V2StructuredModelRequest = {
  role: "main_analyzer",
  schemaId: "capture-analysis.v1",
  promptVersion: "capture-analysis.v1",
  inputHash: "sha256:fixture",
  deadlineMs: 1_000,
  systemInstruction: "Analyze the synthetic fixture.",
  parts: [{ text: "fixture" }],
  responseJsonSchema: { type: "object" },
};

describe("fake structured model gateway", () => {
  it("returns deterministic structured data and captures a content-free call", async () => {
    const gateway = new FakeV2StructuredModelGateway("success", { document: { title: "fixture" } });
    const result = await gateway.generate<{ document: { title: string } }>(request);

    expect(result.data.document.title).toBe("fixture");
    expect(result.modelId).toBe("fake:main_analyzer");
    expect(gateway.calls).toEqual([request]);
  });

  it.each([
    ["timeout", "timeout", true],
    ["quota_exhausted", "quota_exhausted", true],
    ["provider_unavailable", "provider_unavailable", true],
    ["invalid_schema", "invalid_schema", false],
  ] as const)("models %s as a typed failure", async (scenario, code, retryable) => {
    const gateway = new FakeV2StructuredModelGateway(scenario);

    await expect(gateway.generate(request)).rejects.toMatchObject({ code, retryable });
  });
});
