import { describe, expect, test } from "vitest";

import { defaultV2QueryPlan, validateV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";

describe("V2 retrieval query plan", () => {
  test("normalizes a bounded allowlisted plan", () => {
    expect(defaultV2QueryPlan({ fullText: "  서울숲 달리기  ", typeKeys: ["running_log", "running_log"], propertyFilters: [{ fieldKey: "distance", operator: "gte", value: 5 }] })).toMatchObject({
      fullText: "서울숲 달리기", typeKeys: ["running_log"], sort: { field: "relevance", direction: "desc" }, limit: 50,
    });
  });

  test("rejects unknown keys and SQL-shaped operators", () => {
    expect(() => validateV2QueryPlan({ ...defaultV2QueryPlan(), sql: "drop table v2_documents" })).toThrow(/unsupported keys/);
    expect(() => validateV2QueryPlan({ ...defaultV2QueryPlan(), propertyFilters: [{ fieldKey: "user_rating", operator: "gte or 1=1", value: 4 }] })).toThrow(/operator/);
  });

  test("rejects inverted dates and unbounded limits", () => {
    expect(() => validateV2QueryPlan({ ...defaultV2QueryPlan(), dateFilter: { axis: "captured_at", from: "2026-08-12", to: "2026-01-01" } })).toThrow(/inverted/);
    expect(() => validateV2QueryPlan({ ...defaultV2QueryPlan(), limit: 1000 })).toThrow(/limit/);
  });
});
