import { describe, expect, test } from "vitest";

import {
  projectFirstContextModule,
  resolvePresentedContextModule,
  resolveRecordPreset,
} from "@/lib/v2/presentation/extension-registry";
import type { PresentedField } from "@/lib/v2/presentation/record-presentation";

function field(fieldKey: string, overrides: Partial<PresentedField> = {}): PresentedField {
  return {
    propertyId: `property-${fieldKey}`, fieldKey, label: fieldKey, dataType: "decimal", value: 5, renderer: "number",
    sourceClass: "user_explicit", sourceLabel: "원문에서 명시함", claimRisk: "low", reviewStatus: "accepted",
    lockedByUser: false, evidence: [], ...overrides,
  };
}

function module(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    moduleKey: "workout.metrics.v1", presentationVersion: 1, presentationKind: "metric_grid", title: "활동 수치",
    fields: [field("distance"), field("duration")], sourceLabels: ["원문에서 명시함"], previewPolicy: "full", ...overrides,
  };
}

function invalid(value: unknown) {
  const result = resolvePresentedContextModule(value);
  expect(result.kind).toBe("fallback");
  if (result.kind === "fallback") expect(result.reason).toBe("invalid");
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function assertPlainTree(value: unknown) {
  if (!value || typeof value !== "object") return;
  expect(Object.getPrototypeOf(value)).toBe(Array.isArray(value) ? Array.prototype : Object.prototype);
  Object.values(value).forEach(assertPlainTree);
}

function nested(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

function countJsonNodes(value: unknown): number {
  if (!value || typeof value !== "object") return 1;
  return 1 + Object.values(value).reduce<number>((total, child) => total + countJsonNodes(child), 0);
}

describe("context module projection trust boundary", () => {
  test("sensitive projection carries no original fields or source labels", () => {
    const projected = projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "sensitive",
      fields: [field("distance", { value: "비밀 원문", sourceLabel: "비밀 출처" }), field("duration")],
    });
    expect(projected).toMatchObject({ previewPolicy: "redacted", fields: [], sourceLabels: [] });
    expect(JSON.stringify(projected)).not.toContain("비밀");
  });

  test("two copies of one key do not satisfy the distinct metric requirement", () => {
    expect(projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal",
      fields: [field("distance"), field("distance", { propertyId: "another-distance" })],
    })).toBeNull();
  });

  test("unregistered preset cannot activate a known module", () => {
    expect(projectFirstContextModule({
      preset: { ...resolveRecordPreset("running_log"), presetKey: "runtime.ai.generated" }, privacyLevel: "normal",
      fields: [field("distance"), field("duration")],
    })).toBeNull();
  });

  test("registered generic preset cannot be forged to enable a module", () => {
    expect(projectFirstContextModule({
      preset: { ...resolveRecordPreset(null), moduleKeys: ["workout.metrics.v1"] }, privacyLevel: "normal",
      fields: [field("distance"), field("duration")],
    })).toBeNull();
  });

  test("projection is detached from caller-owned field and evidence objects", () => {
    const value = { amount: 5 };
    const locator = { nested: { line: 1 } };
    const original = field("distance", {
      renderer: "json", value,
      evidence: [{ evidenceId: "e1", sourceItemId: "source-1", locatorKind: "text", locator, quote: "원문" }],
    });
    const projected = projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal", fields: [original, field("duration")],
    });
    expect(projected).not.toBeNull();
    value.amount = 99;
    locator.nested.line = 99;
    expect(projected?.fields[0].value).toEqual({ amount: 5 });
    expect(projected?.fields[0].evidence[0].locator).toEqual({ nested: { line: 1 } });
    assertDeepFrozen(projected);
    assertPlainTree(projected);
  });

  test("first accepted duplicate wins without reordering independent keys", () => {
    const projected = projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal",
      fields: [
        field("pace", { propertyId: "proposed-pace", reviewStatus: "proposed", value: 99 }),
        field("duration", { propertyId: "first-duration", value: 12, sourceClass: "user_locked", lockedByUser: true }),
        field("distance", { value: 4 }),
        field("duration", { propertyId: "later-duration", value: 999, sourceClass: "ai_inferred" }),
        field("pace", { value: 3 }),
      ],
    });
    expect(projected?.fields.map(({ propertyId, value }) => ({ propertyId, value }))).toEqual([
      { propertyId: "first-duration", value: 12 }, { propertyId: "property-distance", value: 4 },
      { propertyId: "property-pace", value: 3 },
    ]);
    expect(projected?.fields[0].lockedByUser).toBe(true);
  });

  test.each(["proposed", "disputed"] as const)("%s field cannot complete the minimum requirement", (reviewStatus) => {
    expect(projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal",
      fields: [field("distance"), field("duration", { reviewStatus })],
    })).toBeNull();
  });

  test("unrelated accepted fields do not create an empty decorative module", () => {
    expect(projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal",
      fields: [field("director"), field("restaurant_address")],
    })).toBeNull();
  });

  test("restricted projection returns no module even when complete", () => {
    expect(projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "restricted",
      fields: [field("distance"), field("duration")],
    })).toBeNull();
  });

  test("a detached unmodified registered preset remains compatible", () => {
    const preset = structuredClone(resolveRecordPreset("running_log"));
    expect(projectFirstContextModule({ preset, privacyLevel: "normal", fields: [field("distance"), field("duration")] }))
      .toMatchObject({ moduleKey: "workout.metrics.v1", previewPolicy: "full" });
  });

  test.each([
    ["version", { version: 2 }], ["variant", { mainVariant: "event_overview" }],
    ["modules", { moduleKeys: ["workout.metrics.v1", "runtime.ai.generated"] }],
    ["inspector", { inspectorSectionKeys: ["execute-script"] }],
  ])("a forged preset %s is not an activation instruction", (_name, changes) => {
    const preset = { ...resolveRecordPreset("running_log"), ...changes } as Parameters<typeof projectFirstContextModule>[0]["preset"];
    expect(projectFirstContextModule({ preset, privacyLevel: "normal", fields: [field("distance"), field("duration")] })).toBeNull();
  });

  test("a null preset from an old malformed projection does not throw", () => {
    const preset = null as unknown as Parameters<typeof projectFirstContextModule>[0]["preset"];
    expect(projectFirstContextModule({ preset, privacyLevel: "normal", fields: [field("distance"), field("duration")] })).toBeNull();
  });

  test("projection does not invoke caller-owned source-label accessors", () => {
    let calls = 0;
    const candidate = field("distance");
    Object.defineProperty(candidate, "sourceLabel", { enumerable: true, get() { calls += 1; return "untrusted computed label"; } });
    expect(projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal", fields: [candidate, field("duration")],
    })).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("context module consumer boundary", () => {
  test.each([
    ["undefined", undefined], ["null", null], ["boolean", false], ["number", 5],
    ["string", "module"], ["array", []], ["empty object", {}],
  ])("malformed input %s safely falls back", (_name, value) => {
    invalid(value);
  });

  test("an uninstalled module is omitted without interpreting its payload", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(resolvePresentedContextModule(module({ moduleKey: "future.module.v99", fields: cyclic, presentationVersion: 99 })))
      .toEqual({ kind: "omit" });
  });

  test("locked known module is omitted before examining version or private payload", () => {
    expect(resolvePresentedContextModule(module({ previewPolicy: "locked", presentationVersion: 99, fields: () => "private" })))
      .toEqual({ kind: "omit" });
  });

  test.each([0, 2, "1", null, Number.NaN])("known incompatible version %j falls back explicitly", (presentationVersion) => {
    expect(resolvePresentedContextModule(module({ presentationVersion }))).toEqual({ kind: "fallback", reason: "version" });
  });

  test("version mismatch precedes redaction while revealing no payload", () => {
    expect(resolvePresentedContextModule(module({ presentationVersion: 2, previewPolicy: "redacted", title: "비밀" })))
      .toEqual({ kind: "fallback", reason: "version" });
  });

  test("redacted module emits only its static registry identity", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = resolvePresentedContextModule(module({ previewPolicy: "redacted", title: "비밀 제목", fields: cyclic, sourceLabels: ["비밀 출처"] }));
    expect(result).toEqual({ kind: "redacted", moduleKey: "workout.metrics.v1" });
    expect(JSON.stringify(result)).not.toContain("비밀");
    assertDeepFrozen(result);
  });

  test("empty structurally valid module is omitted", () => {
    expect(resolvePresentedContextModule(module({ fields: [], sourceLabels: [] }))).toEqual({ kind: "omit" });
  });

  test("one metric is malformed, not a complete supported module", () => {
    invalid(module({ fields: [field("distance")] }));
  });

  test("the complete eight-key supported metric set is retained", () => {
    const keys = ["distance", "duration", "elapsed_time", "average_heart_rate", "pace", "calories", "steps", "cadence"];
    const result = resolvePresentedContextModule(module({ fields: keys.map((key) => field(key)) }));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.module.fields.map(({ fieldKey }) => fieldKey)).toEqual(keys);
  });

  test.each([
    ["text", "기억할 운동"], ["number", 4.5], ["boolean", false], ["date", "2026-09-22"],
    ["rating", 4.5], ["json", { intervals: [1, null, { value: true }] }],
  ] as const)("preserves the existing %s renderer and value", (renderer, value) => {
    const input = module({ fields: [field("distance", { renderer, value }), field("duration")] });
    const result = resolvePresentedContextModule(input);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.module.fields[0]).toMatchObject({ renderer, value });
  });

  test("retains arbitrarily long valid strings without the old 800-character presentation cut", () => {
    const long = "긴 원문\n".repeat(400);
    const input = module({ title: long, sourceLabels: [long, "원문에서 명시함"], fields: [field("distance", { renderer: "text", value: long, label: long, sourceLabel: long }), field("duration")] });
    const result = resolvePresentedContextModule(input);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.module.title).toBe(long);
      expect(result.module.fields[0].value).toBe(long);
      expect(result.module.fields[0].label).toBe(long);
      expect(result.module.sourceLabels).toEqual([long, "원문에서 명시함"]);
    }
  });

  test("accepted provenance, evidence and source text survive the detached immutable copy", () => {
    const value = { items: [{ flag: false }] };
    const locator = { page: 2, range: { start: 0, end: 20 }, labels: ["OCR"] };
    const original = field("distance", {
      renderer: "json", value, sourceClass: "image_ocr", sourceLabel: "이미지에서 읽음", claimRisk: "autobiographical", lockedByUser: true,
      evidence: [{ evidenceId: "e1", sourceItemId: null, locatorKind: "image_region", locator, quote: "줄 1\n줄 2" }],
    });
    const result = resolvePresentedContextModule(module({ fields: [original, field("duration")], sourceLabels: ["이미지에서 읽음", "원문에서 명시함"] }));
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.module.fields[0]).toEqual(original);
    expect(result.module.fields[0]).not.toBe(original);
    value.items[0].flag = true;
    locator.range.end = 99;
    locator.labels.push("mutated");
    expect(result.module.fields[0].value).toEqual({ items: [{ flag: false }] });
    expect(result.module.fields[0].evidence[0].locator).toEqual({ page: 2, range: { start: 0, end: 20 }, labels: ["OCR"] });
    assertDeepFrozen(result);
    assertPlainTree(result);
  });

  test.each([
    ["kind", { presentationKind: "fact_summary" }], ["script kind", { presentationKind: "runtime.jsx" }],
    ["policy", { previewPolicy: "preview" }], ["missing title", { title: undefined }],
    ["object title", { title: {} }], ["missing fields", { fields: undefined }],
    ["object fields", { fields: {} }], ["missing labels", { sourceLabels: undefined }],
    ["non-string source", { sourceLabels: [42] }], ["unknown executable", { component: "eval" }],
  ])("rejects malformed module %s", (_name, changes) => invalid(module(changes)));

  test.each([
    ["duplicate key", [field("distance"), field("distance", { propertyId: "other" })]],
    ["duplicate property", [field("distance"), field("duration", { propertyId: "property-distance" })]],
    ["unregistered field", [field("distance"), field("director")]],
    ["too many fields", Array.from({ length: 9 }, (_, index) => field(`field-${index}`))],
    ["proposed field", [field("distance"), field("duration", { reviewStatus: "proposed" })]],
    ["disputed field", [field("distance"), field("duration", { reviewStatus: "disputed" })]],
  ])("rejects %s in a full module", (_name, fields) => invalid(module({ fields })));

  test.each([
    ["null", null], ["unknown renderer", { ...field("distance"), renderer: "html" }],
    ["property id", { ...field("distance"), propertyId: 7 }], ["field key", { ...field("distance"), fieldKey: null }],
    ["label", { ...field("distance"), label: {} }], ["data type", { ...field("distance"), dataType: [] }],
    ["source class", { ...field("distance"), sourceClass: null }], ["source label", { ...field("distance"), sourceLabel: [] }],
    ["risk", { ...field("distance"), claimRisk: "guaranteed" }], ["review status", { ...field("distance"), reviewStatus: "approved" }],
    ["lock", { ...field("distance"), lockedByUser: "false" }], ["evidence list", { ...field("distance"), evidence: {} }],
    ["unknown member", { ...field("distance"), html: "<script>" }],
  ])("rejects malformed field %s", (_name, badField) => invalid(module({ fields: [badField, field("duration")] })));

  test.each([
    ["evidence id", { evidenceId: 1 }], ["source item id", { sourceItemId: {} }],
    ["locator kind", { locatorKind: false }], ["locator array", { locator: [] }],
    ["locator null", { locator: null }], ["quote", { quote: 1 }], ["unknown member", { code: "eval()" }],
  ])("rejects malformed evidence %s", (_name, changes) => {
    const evidence = { evidenceId: "e1", sourceItemId: null, locatorKind: "text", locator: { start: 0 }, quote: null, ...changes };
    invalid(module({ fields: [{ ...field("distance"), evidence: [evidence] }, field("duration")] }));
  });

  test.each([
    ["undefined", undefined], ["NaN", Number.NaN], ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY], ["bigint", 1n], ["function", () => 1],
    ["symbol", Symbol("private")], ["date", new Date("2026-09-22")], ["map", new Map([["key", 1]])],
    ["set", new Set([1])], ["regexp", /pattern/], ["typed array", new Uint8Array([1])],
    ["sparse array", new Array(3)], ["custom prototype", Object.create({ inherited: "secret" })],
  ])("rejects non-JSON %s without renderer execution", (_name, value) => {
    invalid(module({ fields: [field("distance", { renderer: "json", value }), field("duration")] }));
  });

  test("rejects a cycle in the value", () => {
    const value: Record<string, unknown> = { amount: 2 };
    value.self = value;
    invalid(module({ fields: [field("distance", { renderer: "json", value }), field("duration")] }));
  });

  test("rejects a cycle in evidence separately from the field value", () => {
    const locator: Record<string, unknown> = {};
    locator.self = locator;
    invalid(module({ fields: [field("distance", { evidence: [{ evidenceId: "e1", sourceItemId: null, locatorKind: "text", locator, quote: null }] }), field("duration")] }));
  });

  test("permits shared acyclic references by cloning them, not treating a DAG as a cycle", () => {
    const shared = { finite: 2 };
    const result = resolvePresentedContextModule(module({ fields: [field("distance", { renderer: "json", value: { first: shared, second: shared } }), field("duration")] }));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.module.fields[0].value).toEqual({ first: { finite: 2 }, second: { finite: 2 } });
  });

  test("does not execute accessor values while rejecting them", () => {
    let calls = 0;
    const value = Object.defineProperty({}, "secret", { enumerable: true, get() { calls += 1; throw new Error("Do not execute payload"); } });
    invalid(module({ fields: [field("distance", { renderer: "json", value }), field("duration")] }));
    expect(calls).toBe(0);
  });

  test("rejects symbol-keyed JSON members instead of silently losing them", () => {
    const value = { visible: 1, [Symbol("hidden")]: "original" };
    invalid(module({ fields: [field("distance", { renderer: "json", value }), field("duration")] }));
  });

  test("rejects throwing proxies without letting a module crash its generic record", () => {
    const value = new Proxy({}, { ownKeys() { throw new Error("hostile module"); } });
    invalid(module({ fields: [field("distance", { renderer: "json", value }), field("duration")] }));
  });

  test("preserves own __proto__ JSON data without prototype mutation", () => {
    const value: unknown = JSON.parse('{"__proto__":{"polluted":"never"},"constructor":"text"}');
    const result = resolvePresentedContextModule(module({ fields: [field("distance", { renderer: "json", value }), field("duration")] }));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.module.fields[0].value).toEqual(value);
      expect(Object.getOwnPropertyDescriptor(result.module.fields[0].value, "__proto__"))
        .toEqual({ value: { polluted: "never" }, enumerable: true, writable: false, configurable: false });
      assertPlainTree(result);
    }
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  test("accepts ordinary deep JSON within the traversal budget", () => {
    expect(resolvePresentedContextModule(module({ fields: [field("distance", { renderer: "json", value: nested(20) }), field("duration")] })).kind).toBe("ready");
  });

  test("rejects JSON beyond depth 32 without truncation", () => {
    invalid(module({ fields: [field("distance", { renderer: "json", value: nested(40) }), field("duration")] }));
  });

  test("accepts a large finite JSON payload below 10000 visited nodes", () => {
    expect(resolvePresentedContextModule(module({ fields: [field("distance", { renderer: "json", value: Array.from({ length: 9800 }, (_, index) => index) }), field("duration")] })).kind).toBe("ready");
  });

  test("rejects a payload above 10000 visited nodes instead of slicing it", () => {
    invalid(module({ fields: [field("distance", { renderer: "json", value: Array.from({ length: 10001 }, (_, index) => index) }), field("duration")] }));
  });

  test("shares the traversal budget across fields", () => {
    const value = Array.from({ length: 6000 }, (_, index) => index);
    invalid(module({ fields: [field("distance", { renderer: "json", value }), field("duration", { renderer: "json", value })] }));
  });

  test("shares the traversal budget with evidence locators", () => {
    const values = Array.from({ length: 6000 }, (_, index) => index);
    invalid(module({ fields: [field("distance", {
      renderer: "json", value: values,
      evidence: [{ evidenceId: "e1", sourceItemId: null, locatorKind: "text", locator: { values }, quote: null }],
    }), field("duration")] }));
  });

  test("counts evidence metadata toward the whole-module traversal budget", () => {
    const evidence = Array.from({ length: 2000 }, (_, index) => ({ evidenceId: `e-${index}`, sourceItemId: null, locatorKind: "text", locator: {}, quote: null }));
    invalid(module({ fields: [field("distance", { evidence }), field("duration")] }));
  });

  test.each(["fields", "sourceLabels", "evidence"])("rejects extra properties on the %s metadata array", (target) => {
    const fields = [field("distance"), field("duration")];
    const sourceLabels = ["원문에서 명시함"];
    const extra = target === "fields" ? fields : target === "sourceLabels" ? sourceLabels : fields[0].evidence;
    Object.defineProperty(extra, "extra", { value: "must not be silently dropped", enumerable: true });
    invalid(module({ fields, sourceLabels }));
  });

  test("does not execute metadata accessors in a full projection", () => {
    let calls = 0;
    const input = module();
    Object.defineProperty(input, "title", { enumerable: true, get() { calls += 1; return "secret"; } });
    invalid(input);
    expect(calls).toBe(0);
  });

  test("does not inspect redacted original title, fields or source-label accessors", () => {
    let calls = 0;
    const input = module({ previewPolicy: "redacted" });
    for (const key of ["title", "fields", "sourceLabels"]) {
      Object.defineProperty(input, key, { enumerable: true, get() { calls += 1; throw new Error("private payload"); } });
    }
    expect(resolvePresentedContextModule(input)).toEqual({ kind: "redacted", moduleKey: "workout.metrics.v1" });
    expect(calls).toBe(0);
  });

  test("source labels must follow the distinct field provenance, not an independent assertion", () => {
    invalid(module({ sourceLabels: ["검증되지 않은 외부 주장"] }));
  });

  test("exact whole-module depth 32 remains valid while depth 33 falls back", () => {
    const within = module({ fields: [field("distance", { renderer: "json", value: nested(29) }), field("duration")] });
    expect(resolvePresentedContextModule(within).kind).toBe("ready");
    invalid(module({ fields: [field("distance", { renderer: "json", value: nested(30) }), field("duration")] }));
  });

  test("accepts exactly 10000 whole-module JSON nodes and rejects node 10001", () => {
    const values: number[] = [];
    const input = module({ fields: [field("distance", { renderer: "json", value: values }), field("duration")] });
    const remaining = 10_000 - countJsonNodes(input);
    for (let index = 0; index < remaining; index += 1) values.push(index);
    expect(countJsonNodes(input)).toBe(10_000);
    expect(resolvePresentedContextModule(input).kind).toBe("ready");
    values.push(10_001);
    invalid(input);
  });

  test("normalizes null-prototype JSON values and locators to deeply frozen plain objects", () => {
    const value: Record<string, unknown> = Object.create(null);
    const nestedValue: Record<string, unknown> = Object.create(null);
    Object.assign(nestedValue, {
      constructor: "literal constructor", toString: "literal toString", hasOwnProperty: "literal hasOwnProperty",
    });
    value.children = [nestedValue];
    value.original = { preserved: true };
    const locator: Record<string, unknown> = Object.create(null);
    locator.range = Object.assign(Object.create(null), { start: 1, end: 20 });
    const input = module({ fields: [field("distance", {
      renderer: "json", value,
      evidence: [{ evidenceId: "e1", sourceItemId: "source-1", locatorKind: "text", locator, quote: "정확 원문" }],
    }), field("duration")] });
    const result = resolvePresentedContextModule(input);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(JSON.stringify(result.module.fields[0].value)).toBe(JSON.stringify(value));
    expect(JSON.stringify(result.module.fields[0].evidence[0].locator)).toBe(JSON.stringify(locator));
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.getPrototypeOf(locator)).toBeNull();
    assertPlainTree(result);
    assertDeepFrozen(result);
  });

  test("projector also normalizes nested plain JSON without deleting prototype-named data", () => {
    const value: unknown = JSON.parse('{"children":[{"constructor":"literal","toString":"literal name"}]}');
    const locator: Record<string, unknown> = Object.create(null);
    locator.nested = Object.assign(Object.create(null), { preserved: "원문 위치" });
    const projected = projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal",
      fields: [field("distance", { renderer: "json", value,
        evidence: [{ evidenceId: "e1", sourceItemId: null, locatorKind: "text", locator, quote: null }] }), field("duration")],
    });
    expect(projected).not.toBeNull();
    expect(projected?.fields[0].value).toEqual(value);
    expect(projected?.fields[0].evidence[0].locator).toEqual(locator);
    assertPlainTree(projected);
    assertDeepFrozen(projected);
  });

  test("deep own __proto__ data remains intact in the immutable module and its original", () => {
    const value: unknown = JSON.parse('{"children":[{"__proto__":{"kept":1},"constructor":"literal"}]}');
    const original = JSON.stringify(value);
    const projected = projectFirstContextModule({
      preset: resolveRecordPreset("running_log"), privacyLevel: "normal",
      fields: [field("distance", { renderer: "json", value }), field("duration")],
    });
    expect(projected?.fields[0].value).toEqual(value);
    assertPlainTree(projected);
    assertDeepFrozen(projected);
    expect(JSON.stringify(value)).toBe(original);
  });

  test("own __proto__ inside an evidence locator is retained without mutating the original", () => {
    const locator = JSON.parse('{"range":{"__proto__":{"kept":1},"start":0}}') as Record<string, unknown>;
    const original = JSON.stringify(locator);
    const result = resolvePresentedContextModule(module({ fields: [field("distance", {
      evidence: [{ evidenceId: "e1", sourceItemId: null, locatorKind: "text", locator, quote: null }],
    }), field("duration")] }));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.module.fields[0].evidence[0].locator).toEqual(locator);
    assertPlainTree(result);
    assertDeepFrozen(result);
    expect(JSON.stringify(locator)).toBe(original);
  });
});
