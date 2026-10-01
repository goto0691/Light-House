import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import type { PresentedField } from "@/lib/v2/presentation/record-presentation";

// This exercises the installed server Flight encoder with a synthetic client
// reference. It is not a browser, authenticated route, or deployment check.
const fixture = fileURLToPath(new URL("../../fixtures/v2/context-module-rsc-transport.cjs", import.meta.url));
type TransportResult = {
  completed: boolean;
  chunks: number;
  reactVersion: string;
  errors: Array<{ name: string; message: string }>;
  wire: string;
  diagnostics: string;
  decoded: { fields?: readonly PresentedField[]; previewPolicy?: string; sourceLabels?: readonly string[] } | null;
  presentationJson: string | null;
};

function field(fieldKey: string, overrides: Partial<PresentedField> = {}): PresentedField {
  return {
    propertyId: `property-${fieldKey}`, fieldKey, label: fieldKey, dataType: "decimal", value: 5, renderer: "number",
    sourceClass: "user_explicit", sourceLabel: "원문에서 명시함", claimRisk: "low", reviewStatus: "accepted",
    lockedByUser: false, evidence: [], ...overrides,
  };
}

function input(fields: readonly PresentedField[]) {
  return {
    moduleKey: "workout.metrics.v1", presentationVersion: 1, presentationKind: "metric_grid", title: "활동 수치",
    fields, sourceLabels: [...new Set(fields.map(({ sourceLabel }) => sourceLabel))], previewPolicy: "full",
  };
}

function transport(packet: unknown, expectedDiagnostic?: RegExp): TransportResult {
  const result = spawnSync(process.execPath, ["--conditions=react-server", fixture], {
    input: JSON.stringify(packet), encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
    env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  if (expectedDiagnostic) expect(result.stderr).toMatch(expectedDiagnostic);
  else expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as TransportResult;
  expect(parsed.completed).toBe(true);
  expect(parsed.chunks).toBeGreaterThan(0);
  expect(parsed.reactVersion).toMatch(/^19\.3\.0-canary-/);
  return { ...parsed, diagnostics: result.stderr };
}

function jsonFields() {
  return [field("distance", {
    renderer: "json", value: { intervals: [{ seconds: 40, rest: false }], label: "정확 JSON 원문" },
    evidence: [{ evidenceId: "e1", sourceItemId: null, locatorKind: "text", locator: { range: { start: 1, end: 20 } }, quote: "정확 위치" }],
  }), field("duration")];
}

describe("installed Next server Flight encoder for context modules", () => {
  test.each(["null-value", "null-locator"])("negative control %s is rejected while the stream reaches EOF", (control) => {
    const result = transport({ operation: "resolve", input: input(jsonFields()), control });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Classes or null prototypes are not supported");
    expect(result.wire).toContain("context-module-transport-error");
  });

  test("actual resolver's nested JSON and evidence round-trip the string client-prop boundary", () => {
    const result = transport({ operation: "resolve", input: input(jsonFields()) });
    expect(result.errors).toEqual([]);
    expect(result.decoded).toEqual(input(jsonFields()));
    expect(result.wire).not.toContain("context-module-transport-error");
  });

  test("all six field renderers remain encodable", () => {
    const fields = [
      field("distance", { renderer: "number", value: 4.5 }), field("duration", { renderer: "text", value: "한 시간" }),
      field("elapsed_time", { renderer: "boolean", value: false }), field("average_heart_rate", { renderer: "date", value: "2026-09-22" }),
      field("pace", { renderer: "rating", value: 4.5 }), field("calories", { renderer: "json", value: { amount: 300, unit: "kcal" } }),
    ];
    const result = transport({ operation: "resolve", input: input(fields) });
    expect(result.errors).toEqual([]);
    expect(result.decoded?.fields).toEqual(fields);
  });

  test("supported prototype-named JSON properties remain literal data in the encoded stream", () => {
    const value: unknown = JSON.parse('{"constructor":"literal constructor","toString":"literal toString","hasOwnProperty":"literal method name"}');
    const result = transport({ operation: "resolve", input: input([field("distance", { renderer: "json", value }), field("duration")]) });
    expect(result.errors).toEqual([]);
    expect(result.decoded?.fields?.[0].value).toEqual(value);
  });

  test("negative control own __proto__ receives an explicit Flight data-loss diagnostic", () => {
    const result = transport({ operation: "resolve", input: input(jsonFields()), control: "own-proto" }, /Expected not to serialize an object with own property `__proto__`/);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toContain("When parsed this property will be omitted");
    expect(Object.prototype.hasOwnProperty.call(result.decoded?.fields?.[0].value, "__proto__")).toBe(false);
    expect(result.presentationJson).toBeNull();
  });

  test("string projection boundary preserves own __proto__ values and locators through actual Flight decoding", () => {
    const value: unknown = JSON.parse('{"children":[{"__proto__":{"kept":1},"original":"EXACT_VALUE_SENTINEL"}]}');
    const locator = JSON.parse('{"range":{"__proto__":{"original":true},"start":0}}') as Record<string, unknown>;
    const fields = [field("distance", { renderer: "json", value,
      evidence: [{ evidenceId: "e1", sourceItemId: null, locatorKind: "text", locator, quote: "EXACT_QUOTE" }] }), field("duration")];
    const result = transport({ operation: "resolve", input: input(fields) });
    expect(result.errors).toEqual([]);
    expect(result.decoded).toEqual(input(fields));
    expect(result.presentationJson).toBe(JSON.stringify(input(fields)));
    expect(result.wire).toContain("GENERIC_DOCUMENT_SENTINEL");
    expect(Object.prototype).not.toHaveProperty("kept");
  });

  test("the actual sensitive projector serializes no private field, source or evidence payload", () => {
    const fields = [field("distance", {
      renderer: "text", value: "PRIVATE_VALUE_SENTINEL", sourceLabel: "PRIVATE_SOURCE_SENTINEL",
      evidence: [{ evidenceId: "private-evidence", sourceItemId: "private-source", locatorKind: "text", locator: { private: true }, quote: "PRIVATE_QUOTE_SENTINEL" }],
    }), field("duration")];
    const result = transport({ operation: "project", fields, privacyLevel: "sensitive" });
    expect(result.errors).toEqual([]);
    expect(result.decoded).toMatchObject({ previewPolicy: "redacted", fields: [], sourceLabels: [] });
    expect(result.wire).not.toContain("PRIVATE_");
    expect(result.wire).not.toContain("private-evidence");
    expect(result.wire).not.toContain("private-source");
  });

  test("the actual normal projector serializes a long original value through EOF without truncating", () => {
    const value = "long-original-value-".repeat(200);
    const result = transport({ operation: "project", fields: [field("distance", { renderer: "text", value }), field("duration")], privacyLevel: "normal" });
    expect(result.errors).toEqual([]);
    expect(result.decoded?.fields?.[0].value).toBe(value);
    expect(result.decoded?.previewPolicy).toBe("full");
  });
});
