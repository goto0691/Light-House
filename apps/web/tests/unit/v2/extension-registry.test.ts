import { describe, expect, test } from "vitest";

import {
  contextModuleRegistry,
  isAllowedContextModule,
  isAllowedRecordPreset,
  projectFirstContextModule,
  recordPresetRegistry,
  resolveRecordPreset,
} from "@/lib/v2/presentation/extension-registry";
import type { PresentedField } from "@/lib/v2/presentation/record-presentation";

function field(fieldKey: string): PresentedField {
  return {
    propertyId: `property-${fieldKey}`, fieldKey, label: fieldKey, dataType: "decimal", value: 5, renderer: "number",
    sourceClass: "user_explicit", sourceLabel: "원문에서 명시함", claimRisk: "low", reviewStatus: "accepted",
    lockedByUser: false, evidence: [],
  };
}

describe("safe presentation extension registry", () => {
  test("has unique code-owned preset and module keys", () => {
    expect(new Set(recordPresetRegistry.map((item) => item.presetKey)).size).toBe(recordPresetRegistry.length);
    expect(new Set(contextModuleRegistry.map((item) => item.moduleKey)).size).toBe(contextModuleRegistry.length);
    expect(isAllowedRecordPreset("record.document.v1")).toBe(true);
    expect(isAllowedContextModule("runtime.ai.component")).toBe(false);
  });

  test("falls back from an unknown stored preset to a type-safe code preset", () => {
    expect(resolveRecordPreset("running_log", "ai.generated.jsx").presetKey).toBe("record.workout.v1");
    expect(resolveRecordPreset("unknown_new_type", "ai.generated.jsx").presetKey).toBe("record.document.v1");
  });

  test("projects at most one module only when enough accepted fields exist", () => {
    const preset = resolveRecordPreset("running_log");
    expect(projectFirstContextModule({ preset, fields: [field("distance")], privacyLevel: "normal" })).toBeNull();
    expect(projectFirstContextModule({ preset, fields: [field("distance"), field("duration"), field("pace")], privacyLevel: "normal" })).toMatchObject({
      moduleKey: "workout.metrics.v1", presentationKind: "metric_grid",
    });
    expect(projectFirstContextModule({ preset, fields: [field("distance"), field("duration")], privacyLevel: "restricted" })).toBeNull();
  });
});
