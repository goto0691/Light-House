import { describe, expect, test } from "vitest";

import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";
import { promptSafetyLint, templateInputAnalyzerProjection, validateTemplateDefinitionV1, validateTemplateSubmission } from "@/lib/v2/templates/template-definition-v1";

describe("adaptive capture template contract", () => {
  test("validates every system seed without unresolved prompt-safety findings", () => {
    for (const seed of SYSTEM_TEMPLATE_SEEDS) {
      const definition = validateTemplateDefinitionV1(seed.definition);
      expect(promptSafetyLint(definition)).toEqual([]);
    }
  });

  test("rejects leading questions and executable input kinds", () => {
    const seed = SYSTEM_TEMPLATE_SEEDS[0].definition;
    const leading = structuredClone(seed) as unknown as { sections: Array<{ items: Array<{ prompt: string; inputKind?: string }> }> };
    leading.sections[1].items[0].prompt = "가장 좋았던 점은?";
    expect(() => validateTemplateDefinitionV1(leading)).toThrow(/Prompt safety lint/);
    const executable = structuredClone(seed) as unknown as { sections: Array<{ items: Array<{ prompt: string; inputKind?: string }> }> };
    executable.sections[0].items[0].inputKind = "runtime.jsx" as never;
    expect(() => validateTemplateDefinitionV1(executable)).toThrow(/unsupported input kind/);
  });

  test("keeps unanswered, unknown, not-applicable, and withheld distinct and removes AI authority from withheld", () => {
    const definition = validateTemplateDefinitionV1(SYSTEM_TEMPLATE_SEEDS[0].definition);
    const now = "2026-08-12T10:00:00.000Z";
    const submission = validateTemplateSubmission({
      templateVersionId: "version-review",
      appliedAt: now,
      inputs: [
        { itemKey: "subject_name", valueKind: "text", value: "봄날", blankState: "answered", inputOrder: 0, clientTimestamp: now },
        { itemKey: "experienced_at", valueKind: "date", value: null, blankState: "unknown", inputOrder: 1, clientTimestamp: now },
        { itemKey: "companions", valueKind: "json", value: null, blankState: "withheld", inputOrder: 2, clientTimestamp: now },
        { itemKey: "user_rating", valueKind: "rating", value: null, blankState: "not_applicable", inputOrder: 3, clientTimestamp: now },
      ],
    }, definition);
    expect(submission.inputs.map((input) => input.blankState)).toEqual(["answered", "unknown", "withheld", "not_applicable"]);
    expect(templateInputAnalyzerProjection(definition, submission)).toContainEqual(expect.objectContaining({ item_key: "companions", state: "withheld", user_value: null, allowed_ai_operations: [] }));
  });
});
