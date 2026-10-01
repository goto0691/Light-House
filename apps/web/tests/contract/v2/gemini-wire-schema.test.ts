import { GoogleGenAI } from "@google/genai";
import Ajv from "ajv";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ANALYSIS_ENVELOPE_V1_SCHEMA } from "@/lib/v2/ai/analysis-envelope-v1";
import { GeminiMainAnalyzerGateway, type GeminiClientBinding } from "@/lib/v2/ai/gemini-role-gateways";
import { toGeminiResponseJsonSchema } from "@/lib/v2/ai/gemini-wire-schema";
import type { V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { linkAnalysisProviderJsonSchema } from "@/lib/v2/ai/link-analysis-v1";

const routes = { main_analyzer: "gemini-3.6-flash", grounded_enricher: "gemini-3.5-flash-lite" };
const scalarSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "title", "value"],
  properties: {
    version: { const: "wire-v1" },
    title: { type: "string", minLength: 2, maxLength: 8 },
    value: { type: ["string", "number", "boolean", "null"] },
  },
} as const;

function request(schema: Readonly<Record<string, unknown>>): V2StructuredModelRequest {
  return {
    role: "main_analyzer", schemaId: "synthetic-wire.v1", promptVersion: "synthetic-wire.v1",
    inputHash: "synthetic-wire-hash", deadlineMs: 1_000,
    systemInstruction: "Extract only the supplied synthetic input.",
    parts: [{ text: "Synthetic input only." }], responseJsonSchema: schema,
  };
}

function fakeGateway(data: unknown) {
  const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(data) });
  const client: GeminiClientBinding = { models: { generateContent }, interactions: { create: vi.fn() } };
  return { gateway: new GeminiMainAnalyzerGateway(client, routes), generateContent };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

beforeEach(() => {
  // Fail closed even if a future test accidentally constructs an actual SDK client.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network is prohibited in wire-schema tests."); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Gemini provider wire projection without weakening canonical validation", () => {
  test("projects string/number constants and enum-only nodes into explicit types", () => {
    expect(toGeminiResponseJsonSchema({ type: "object", properties: {
      version: { const: "analysis-v1" }, numeric: { const: 3.5 },
      role: { enum: ["prompt", "insight"] }, score: { enum: [1, 2.5] },
    } })).toEqual({ type: "object", properties: {
      version: { type: "string", enum: ["analysis-v1"] }, numeric: { type: "number", enum: [3.5] },
      role: { type: "string", enum: ["prompt", "insight"] }, score: { type: "number", enum: [1, 2.5] },
    } });
  });

  test("removes string length and array upper bounds while retaining required, minItems, and numeric limits", () => {
    expect(toGeminiResponseJsonSchema({ type: "object", additionalProperties: false, required: ["items"], properties: {
      items: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", minLength: 2, maxLength: 20 } },
      rating: { type: "number", minimum: 0, maximum: 5, description: "minLength is a word in this description" },
    } })).toEqual({ type: "object", additionalProperties: false, required: ["items"], properties: {
      items: { type: "array", minItems: 1, items: { type: "string" } },
      rating: { type: "number", minimum: 0, maximum: 5, description: "minLength is a word in this description" },
    } });
  });

  test("preserves user property names that collide with schema keywords", () => {
    const required = ["const", "minLength", "maxLength", "enum", "type"];
    const schema = { type: "object", required, properties: Object.fromEntries(required.map((name) => [name, { type: "string", minLength: 1, maxLength: 10 }])) };
    expect(toGeminiResponseJsonSchema(schema)).toEqual({ type: "object", required, properties: Object.fromEntries(required.map((name) => [name, { type: "string" }])) });
  });

  test("uses anyOf for multiple non-null types while keeping nullable pairs and scalar semantics", () => {
    const projected = toGeminiResponseJsonSchema({ type: ["string", "number", "boolean", "null"] });
    expect(projected).not.toHaveProperty("type");
    expect(projected.anyOf).toBeInstanceOf(Array);
    const validate = new Ajv({ strict: false }).compile(projected);
    for (const value of ["text", 4.5, false, null]) expect(validate(value), JSON.stringify(value)).toBe(true);
    for (const value of [{}, []]) expect(validate(value), JSON.stringify(value)).toBe(false);
    expect(toGeminiResponseJsonSchema({ type: ["integer", "null"], minimum: 0 })).toEqual({ type: ["integer", "null"], minimum: 0 });
  });

  test("leaves frozen canonical schema unchanged and returns an independent idempotent projection", () => {
    const canonical = deepFreeze(structuredClone(ANALYSIS_ENVELOPE_V1_SCHEMA));
    const before = JSON.stringify(canonical);
    const projected = toGeminiResponseJsonSchema(canonical);
    expect(JSON.stringify(canonical)).toBe(before);
    expect(projected).not.toBe(canonical);
    expect(projected.properties).not.toBe(canonical.properties);
    expect(toGeminiResponseJsonSchema(projected)).toEqual(projected);
    expect(canonical.properties.contract_version).toEqual({ const: "analysis-v1" });
    expect(canonical.properties.bundle_summary.maxLength).toBe(2000);
  });

  test("projects the existing link provider schema by dropping only array upper bounds", () => {
    const before = JSON.stringify(linkAnalysisProviderJsonSchema);
    const withoutMaxItems = JSON.parse(before, (key, value) => key === "maxItems" ? undefined : value);
    expect(before).toMatch(/"maxItems":/);
    expect(toGeminiResponseJsonSchema(linkAnalysisProviderJsonSchema)).toEqual(withoutMaxItems);
    expect(JSON.stringify(linkAnalysisProviderJsonSchema)).toBe(before);
  });

  test("sends the projected full analysis schema through the installed SDK to fake fetch only", async () => {
    const response = {
      contract_version: "analysis-v1", capture_id: "synthetic-capture", analyzed_revision_id: "synthetic-revision",
      language: "ko", bundle_summary: "합성 입력", document_proposals: [], entity_proposals: [], event_proposals: [],
      field_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
    };
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(response) }] } }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    // An explicit synthetic key and model routes avoid reading project credentials.
    const sdk = new GoogleGenAI({ apiKey: "synthetic-offline-only", vertexai: false });
    const gateway = new GeminiMainAnalyzerGateway(sdk as unknown as GeminiClientBinding, routes);
    const canonicalBefore = JSON.stringify(ANALYSIS_ENVELOPE_V1_SCHEMA);
    await expect(gateway.generate(request(ANALYSIS_ENVELOPE_V1_SCHEMA))).resolves.toMatchObject({ data: response });
    expect(fetch).toHaveBeenCalledTimes(1);
    const generation = bodies[0].generationConfig as Record<string, unknown>;
    expect(generation.responseMimeType).toBe("application/json");
    expect(generation).not.toHaveProperty("responseSchema");
    expect(generation.responseJsonSchema).toEqual(toGeminiResponseJsonSchema(ANALYSIS_ENVELOPE_V1_SCHEMA));
    expect(generation.responseJsonSchema).toMatchObject({ properties: {
      contract_version: { type: "string", enum: ["analysis-v1"] },
      source_extractions: { items: { properties: { kind: { type: "string", enum: ["image_ocr", "transcript_extract", "document_extract"] } } } },
      field_proposals: { items: { properties: { value: { anyOf: expect.any(Array) } } } },
    } });
    expect(JSON.stringify(generation)).not.toMatch(/"(?:const|minLength|maxLength|maxItems|abortSignal)":/);
    expect(JSON.stringify(ANALYSIS_ENVELOPE_V1_SCHEMA)).toBe(canonicalBefore);
  });

  test.each(["original text", 4.5, false, null])("preserves returned scalar value %j without coercion", async (value) => {
    const data = deepFreeze({ version: "wire-v1", title: "제목", value });
    const { gateway, generateContent } = fakeGateway(data);
    const result = await gateway.generate<typeof data>(request(scalarSchema));
    expect(result.data).toEqual(data);
    expect(Object.is(result.data.value, value)).toBe(true);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ responseJsonSchema: toGeminiResponseJsonSchema(scalarSchema) }) }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test.each([
    ["constant", { version: "wrong", title: "제목", value: null }],
    ["minimum length", { version: "wire-v1", title: "", value: null }],
    ["maximum length", { version: "wire-v1", title: "too long title", value: null }],
    ["scalar type", { version: "wire-v1", title: "제목", value: { hidden: true } }],
  ])("rejects a canonical %s violation after the provider projection", async (_name, data) => {
    const { gateway, generateContent } = fakeGateway(data);
    await expect(gateway.generate(request(scalarSchema))).rejects.toMatchObject({ code: "invalid_schema", retryable: false });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("rejects an array above the canonical maxItems even though the provider schema omits it", async () => {
    const listSchema = { type: "object", additionalProperties: false, required: ["tags"], properties: { tags: { type: "array", maxItems: 2, items: { type: "string" } } } } as const;
    expect(toGeminiResponseJsonSchema(listSchema)).toEqual({ type: "object", additionalProperties: false, required: ["tags"], properties: { tags: { type: "array", items: { type: "string" } } } });
    const { gateway, generateContent } = fakeGateway({ tags: ["a", "b", "c"] });
    await expect(gateway.generate(request(listSchema))).rejects.toMatchObject({ code: "invalid_schema", retryable: false });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
