import { describe, expect, test } from "vitest";

import { queryPlanFromSearchParams, searchPageFromParams } from "@/lib/v2/retrieval/search-params";

describe("V2 search URL projection", () => {
  test("keeps pagination outside the saved query contract and rejects malformed page values", () => {
    expect(searchPageFromParams(new URLSearchParams("page=2"))).toBe(2);
    for (const value of ["-2", "1.5", "NaN", "Infinity", "9007199254740992"]) expect(searchPageFromParams(new URLSearchParams({ page: value }))).toBe(1);
    expect(queryPlanFromSearchParams(new URLSearchParams("q=기록&page=2"))).toEqual(queryPlanFromSearchParams(new URLSearchParams("q=기록")));
  });
  test("does not invent a zero rating filter for an empty URL", () => {
    expect(queryPlanFromSearchParams(new URLSearchParams()).propertyFilters).toEqual([]);
  });

  test("projects stable URL fields into the allowlisted query plan", () => {
    const plan = queryPlanFromSearchParams(new URLSearchParams("q=서울숲&type=running_log&rating=4&from=2026-01-01&to=2026-12-31&sort=captured_at"));
    expect(plan).toMatchObject({ fullText: "서울숲", typeKeys: ["running_log"], propertyFilters: [{ fieldKey: "user_rating", operator: "gte", value: 4 }], dateFilter: { axis: "captured_at", from: "2026-01-01", to: "2026-12-31" }, sort: { field: "captured_at" } });
  });

  test("drops malformed URL filters instead of throwing a server-render error", () => {
    const params = new URLSearchParams({ q: "x".repeat(500), type: "Movie Review,runtime/jsx", from: "2026-99-99", to: "not-a-date", entity_kind: "DROP TABLE", entity: "x".repeat(200) });
    expect(queryPlanFromSearchParams(params)).toMatchObject({ fullText: "x".repeat(300), typeKeys: [], entityFilters: [], dateFilter: null });
  });
});
