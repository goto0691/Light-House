import { describe, expect, it } from "vitest";

import { validateJsonSchemaValue } from "@/lib/v2/ai/safe-json-schema";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "rating", "tags"],
  properties: {
    kind: { enum: ["place", "work"] },
    rating: { type: ["number", "null"], minimum: 0, maximum: 5 },
    tags: { type: "array", maxItems: 2, items: { type: "string", minLength: 1 } },
  },
} as const;

describe("eval-free JSON Schema validation", () => {
  it("accepts the supported structured output subset", () => {
    expect(validateJsonSchemaValue(schema, { kind: "place", rating: 4.5, tags: ["date"] })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects type, bound, required, item, and extra-property violations", () => {
    const result = validateJsonSchemaValue(schema, { kind: "unknown", rating: 6, tags: ["", "a", "b"], extra: true });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/allowed values|above 5|more than 2|shorter than 1|not allowed/);
    expect(validateJsonSchemaValue(schema, { kind: "place", tags: [] }).errors.join(" ")).toContain("rating is required");
  });
});
