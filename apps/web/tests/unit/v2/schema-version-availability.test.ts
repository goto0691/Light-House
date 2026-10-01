import { describe, expect, test } from "vitest";

import { canonicalTablesForSchemaVersion } from "@/lib/v2/portability/canonical-table-registry-v1";
import { compareLighthouseSchemaVersions } from "@/lib/v2/portability/portability-contract-v1";

describe("cumulative canonical schema availability", () => {
  test("orders Lighthouse revisions numerically instead of by exact string match", () => {
    expect(compareLighthouseSchemaVersions("v2-018", "v2-020")).toBeLessThan(0);
    expect(compareLighthouseSchemaVersions("v2-020", "v2-018")).toBeGreaterThan(0);
    expect(compareLighthouseSchemaVersions("v2-020", "v2-020")).toBe(0);
  });

  test("keeps v2-018 tables in v2-020 while excluding them from v2-017", () => {
    const table = "v2_legacy_migration_batch_items";
    expect(canonicalTablesForSchemaVersion("v2-017").some((item) => item.table === table)).toBe(false);
    expect(canonicalTablesForSchemaVersion("v2-018").some((item) => item.table === table)).toBe(true);
    expect(canonicalTablesForSchemaVersion("v2-020").some((item) => item.table === table)).toBe(true);
  });
});
