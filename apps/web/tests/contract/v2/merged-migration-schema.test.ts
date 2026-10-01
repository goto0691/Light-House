import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const directory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
const all = readdirSync(directory).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
const v2 = all.filter((name) => /^\d{4}_v2_.*\.sql$/.test(name));
const base = all.filter((name) => Number(name.slice(0, 4)) <= 5);
const legacy = all.filter((name) => !v2.includes(name) && !base.includes(name));

function apply(names: string[], minimalUsers = false) {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    if (minimalUsers) db.exec("CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL)");
    for (const name of names) db.exec(readFileSync(`${directory}/${name}`, "utf8"));
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => String(row.name));
  } finally { db.close(); }
}

describe("remote legacy and V2 migration families", () => {
  it("keeps isolated V2 fixtures separate from same-number legacy migrations", () => {
    expect(v2).toHaveLength(27);
    expect(legacy).toHaveLength(8);
    expect(all.filter((name) => name.startsWith("0006_"))).toHaveLength(2);
    const tables = apply(v2, true);
    expect(tables).toContain("v2_capture_bundles");
    expect(tables).not.toContain("daily_logs");
  });

  it.each([
    ["legacy then V2", [...base, ...legacy, ...v2]],
    ["V2 then legacy additions", [...base, ...v2, ...legacy]],
    ["full filename order", all],
  ] as const)("preserves both schemas in %s order", (_label, names) => {
    const tables = apply([...names]);
    expect(tables).toContain("daily_logs");
    expect(tables).toContain("source_property_mappings");
    expect(tables).toContain("v2_capture_bundles");
    expect(tables).toContain("v2_link_curation_revisions");
  });
});
