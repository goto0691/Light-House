import { describe, expect, test } from "vitest";

import {
  CANONICAL_ROW_SCHEMA_VERSION_FIELD, envelopeCanonicalRow, LIGHTHOUSE_SCHEMA_VERSION,
  SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS, unwrapCanonicalRow,
} from "@/lib/v2/portability/portability-contract-v1";

describe("canonical row schema envelope", () => {
  test.each([
    ["v2_processing_runs", "analysis-v7"], ["v2_analysis_proposals", "analysis-v3"],
    ["v2_type_definitions", 7], ["v2_field_definitions", 4],
    ["v2_predicate_definitions", 6], ["v2_unit_definitions", 2],
  ])("preserves the native %s schema version separately from the archive version", (table, nativeVersion) => {
    const row = { id: "native-row", schema_version: nativeVersion, definition_json: "{}" };
    const wrapped = envelopeCanonicalRow(row, "export-id");
    expect(wrapped.schema_version).toBe(LIGHTHOUSE_SCHEMA_VERSION);
    expect(wrapped[CANONICAL_ROW_SCHEMA_VERSION_FIELD]).toBe(nativeVersion);
    expect(unwrapCanonicalRow(wrapped, String(table))).toEqual(row);
  });

  test.each(["v2-017", "v2-018", "v2-020"] as const)("reads noncolliding old %s rows but rejects already lost native versions", (schemaVersion) => {
    expect(SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS).toContain(schemaVersion);
    const old = { id: "old", schema_version: schemaVersion, user_scope_export_id: "export-id" };
    expect(unwrapCanonicalRow(old, "v2_objects")).toEqual({ id: "old" });
    expect(() => unwrapCanonicalRow(old, "v2_processing_runs")).toThrow("re-export from the source");
    expect(() => unwrapCanonicalRow(old, "v2_type_definitions")).toThrow("re-export from the source");
  });

  test("rejects reserved-field collisions, double enveloping, and native type confusion", () => {
    expect(() => envelopeCanonicalRow({ [CANONICAL_ROW_SCHEMA_VERSION_FIELD]: "forged" }, "export-id")).toThrow("reserved archive metadata");
    expect(() => envelopeCanonicalRow({ user_scope_export_id: "forged" }, "export-id")).toThrow("reserved archive metadata");
    expect(() => envelopeCanonicalRow(envelopeCanonicalRow({ id: "row" }, "export-id"), "export-id")).toThrow();
    expect(() => unwrapCanonicalRow(envelopeCanonicalRow({ schema_version: 2 }, "export-id"), "v2_objects")).toThrow("unexpected reserved");
    expect(() => unwrapCanonicalRow(envelopeCanonicalRow({ schema_version: "2" }, "export-id"), "v2_type_definitions")).toThrow("invalid native");
    expect(() => unwrapCanonicalRow(envelopeCanonicalRow({ schema_version: null }, "export-id"), "v2_processing_runs")).toThrow("invalid native");
  });
});
