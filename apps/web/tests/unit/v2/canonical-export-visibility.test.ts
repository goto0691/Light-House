import { describe, expect, it } from "vitest";

import {
  CANONICAL_TABLE_BY_NAME,
  fullFidelityCanonicalScope,
} from "@/lib/v2/portability/canonical-table-registry-v1";
import type { ExportScopeV1 } from "@/lib/v2/portability/portability-contract-v1";

const scope: ExportScopeV1 = {
  objects: "all",
  privacyLevels: ["normal", "sensitive"],
  includeTrash: false,
  includeHistory: true,
  includeOriginals: true,
};

describe("portable legacy projection visibility", () => {
  it("filters hidden legacy documents, related objects, and attachments from the portable scope", () => {
    for (const table of ["v2_documents", "v2_objects", "v2_attachment_reservations"] as const) {
      const descriptor = CANONICAL_TABLE_BY_NAME.get(table);
      expect(descriptor).toBeTruthy();
      const query = descriptor!.query("user-a", scope);
      expect(query.sql).toContain("portable_legacy_visibility.status is not 'projected'");
      expect(query.sql).toContain("portable_legacy_visibility.user_id=");
      expect(query.sql).toContain("portable_legacy_visibility.projected_object_id=");
      if (table === "v2_objects") expect(query.sql).toContain("scoped_object.user_id=?");
    }
  });

  it("keeps hidden legacy provenance in explicitly marked backup and migration scopes", () => {
    for (const table of ["v2_documents", "v2_objects", "v2_attachment_reservations"] as const) {
      const descriptor = CANONICAL_TABLE_BY_NAME.get(table)!;
      const query = descriptor.query("user-a", fullFidelityCanonicalScope(scope));
      expect(query.sql).not.toContain("portable_legacy_visibility");
    }

    for (const table of [
      "v2_legacy_migration_batches",
      "v2_legacy_source_envelopes",
      "v2_legacy_migration_batch_items",
      "v2_legacy_source_mappings",
    ] as const) {
      const descriptor = CANONICAL_TABLE_BY_NAME.get(table)!;
      const query = descriptor.query("user-a", fullFidelityCanonicalScope(scope));
      expect(query.sql).toContain("and (1 or");
    }
  });
});
