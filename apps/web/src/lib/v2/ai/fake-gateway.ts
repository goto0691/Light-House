import {
  V2ModelError,
  type V2GroundedResearchGateway,
  type V2GroundedResearchRequest,
  type V2GroundedResearchResult,
  type V2StructuredModelGateway,
  type V2StructuredModelRequest,
  type V2StructuredModelResult,
} from "@/lib/v2/ai/gateway";

export type FakeGatewayScenario = "success" | "timeout" | "quota_exhausted" | "provider_unavailable" | "invalid_schema";

export class FakeV2StructuredModelGateway implements V2StructuredModelGateway {
  readonly calls: V2StructuredModelRequest[] = [];

  constructor(
    private readonly scenario: FakeGatewayScenario,
    private readonly fixture: unknown = {},
  ) {}

  async generate<T>(request: V2StructuredModelRequest): Promise<V2StructuredModelResult<T>> {
    this.calls.push(request);

    if (this.scenario === "timeout") throw new V2ModelError("timeout", "The fake model exceeded its deadline.", true);
    if (this.scenario === "quota_exhausted") throw new V2ModelError("quota_exhausted", "The fake quota is exhausted.", true);
    if (this.scenario === "provider_unavailable") throw new V2ModelError("provider_unavailable", "The fake provider is unavailable.", true);
    if (this.scenario === "invalid_schema") throw new V2ModelError("invalid_schema", "The fake output does not satisfy the schema.", false);

    return {
      data: structuredClone(this.fixture) as T,
      role: request.role,
      modelId: `fake:${request.role}`,
      inputHash: request.inputHash,
      outputHash: `fake-output:${request.inputHash}`,
      tokenUsage: { input: 10, output: 20 },
      latencyMs: 1,
    };
  }
}

export class FakeV2GroundedResearchGateway implements V2GroundedResearchGateway {
  readonly calls: V2GroundedResearchRequest[] = [];

  constructor(private readonly scenario: FakeGatewayScenario, private readonly fixture?: Partial<V2GroundedResearchResult>) {}

  async research(request: V2GroundedResearchRequest): Promise<V2GroundedResearchResult> {
    this.calls.push(request);
    if (this.scenario === "timeout") throw new V2ModelError("timeout", "The fake grounded model timed out.", true);
    if (this.scenario === "quota_exhausted") throw new V2ModelError("quota_exhausted", "The fake grounded quota is exhausted.", true);
    if (this.scenario === "provider_unavailable") throw new V2ModelError("provider_unavailable", "The fake grounded provider is unavailable.", true);
    if (this.scenario === "invalid_schema") throw new V2ModelError("invalid_schema", "The fake grounded result is invalid.", false);
    return {
      role: "grounded_enricher",
      modelId: "fake:grounded_enricher",
      answer: JSON.stringify({ contract_version: "grounded-result-v1", identity_status: "resolved", canonical_name: "봄날", facts: [{ field_key: "director", label: "감독", value_type: "text", value: "홍길동", citation_urls: ["https://example.test/work"] }, { field_key: "cast", label: "주연 배우", value_type: "json", value: ["김하늘", "박바다"], citation_urls: ["https://example.test/work"] }], summary: "공식 작품 정보가 확인되었습니다." }),
      citations: [{ url: "https://example.test/work", title: "공식 작품", startByte: 0, endByte: 12, citedText: "공식 작품 정보" }],
      queries: ["영화 봄날 공식 정보"],
      inputHash: request.inputHash,
      outputHash: `fake-grounded:${request.inputHash}`,
      tokenUsage: { input: 8, output: 12 },
      latencyMs: 1,
      ...this.fixture,
    };
  }
}
