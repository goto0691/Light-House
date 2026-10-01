export type V2ModelRole = "main_analyzer" | "grounded_enricher" | "embedding_provider";

export type V2ModelInputPart =
  | Readonly<{ text: string }>
  | Readonly<{ inlineData: Readonly<{ mimeType: string; data: string }> }>
  /** A provider-fetched public media URL (currently public YouTube videos only). */
  | Readonly<{ fileData: Readonly<{ fileUri: string }>; videoMetadata?: Readonly<{ startOffset: string; endOffset: string }> }>;

export type V2StructuredModelRequest = Readonly<{
  role: V2ModelRole;
  schemaId: string;
  promptVersion: string;
  inputHash: string;
  deadlineMs: number;
  systemInstruction?: string;
  parts?: readonly V2ModelInputPart[];
  responseJsonSchema?: Readonly<Record<string, unknown>>;
}>;

export type V2StructuredModelResult<T> = Readonly<{
  data: T;
  role: V2ModelRole;
  modelId: string;
  inputHash: string;
  outputHash: string;
  tokenUsage?: Readonly<{ input: number; output: number }>;
  latencyMs: number;
}>;

export type V2GroundedCitation = Readonly<{
  url: string;
  title: string | null;
  startByte: number;
  endByte: number;
  citedText: string;
}>;

export type V2GroundedResearchRequest = Readonly<{
  role: "grounded_enricher";
  prompt: string;
  promptVersion: string;
  inputHash: string;
  deadlineMs: number;
}>;

export type V2GroundedResearchResult = Readonly<{
  role: "grounded_enricher";
  modelId: string;
  answer: string;
  citations: readonly V2GroundedCitation[];
  queries: readonly string[];
  inputHash: string;
  outputHash: string;
  tokenUsage?: Readonly<{ input: number; output: number }>;
  latencyMs: number;
}>;

export type V2ModelErrorCode = "timeout" | "quota_exhausted" | "provider_unavailable" | "invalid_schema";

export class V2ModelError extends Error {
  readonly code: V2ModelErrorCode;
  readonly retryable: boolean;
  /** Minimum wait before the next provider call, when the provider reported one. */
  readonly retryAfterMs: number | null;

  constructor(code: V2ModelErrorCode, message: string, retryable: boolean, retryAfterMs: number | null = null) {
    super(message);
    this.name = "V2ModelError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.round(retryAfterMs) : null;
  }
}

export interface V2StructuredModelGateway {
  generate<T>(request: V2StructuredModelRequest): Promise<V2StructuredModelResult<T>>;
}

export interface V2GroundedResearchGateway {
  research(request: V2GroundedResearchRequest): Promise<V2GroundedResearchResult>;
}
