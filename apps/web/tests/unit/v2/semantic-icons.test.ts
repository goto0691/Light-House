import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEMANTIC_ICON_KEY,
  isAllowedSemanticIcon,
  resolveSemanticIcon,
  semanticIconCatalog,
} from "@/lib/v2/presentation/semantic-icons";

describe("semantic icon catalog", () => {
  it("has unique stable keys", () => {
    const keys = semanticIconCatalog.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back for unknown or disallowed keys", () => {
    expect(resolveSemanticIcon("type.does-not-exist").key).toBe(DEFAULT_SEMANTIC_ICON_KEY);
    expect(resolveSemanticIcon("type.template", "type").key).toBe(DEFAULT_SEMANTIC_ICON_KEY);
  });

  it("allows a compatible semantic key without exposing a library name as the key", () => {
    expect(isAllowedSemanticIcon("type.workout", "template")).toBe(true);
    expect(resolveSemanticIcon("type.workout").lucideName).toBe("Dumbbell");
    expect(resolveSemanticIcon("type.workout").key).not.toContain("lucide");
  });
});
