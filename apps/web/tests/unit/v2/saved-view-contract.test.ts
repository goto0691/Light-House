import { describe, expect, test } from "vitest";

import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { validateSavedViewDefinition } from "@/lib/v2/retrieval/saved-view-contract";

describe("saved view DSL", () => {
  const valid = { name: "평점 높은 영화", description: null, iconKey: "type.movie", queryPlan: defaultV2QueryPlan({ typeKeys: ["movie_review"], propertyFilters: [{ fieldKey: "user_rating", operator: "gte", value: 4 }] }), display: { layout: "cards", density: "comfortable", groupBy: null, visibleFields: ["user_rating"] } };
  test("keeps membership query separate from display state", () => { expect(validateSavedViewDefinition(valid)).toMatchObject({ queryPlan: { typeKeys: ["movie_review"] }, display: { layout: "cards", visibleFields: ["user_rating"] } }); });
  test("rejects executable or unknown display fields", () => { expect(() => validateSavedViewDefinition({ ...valid, display: { ...valid.display, renderer: "runtime.jsx" } })).toThrow(/unsupported keys/); });
});
