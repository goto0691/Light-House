import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LEGACY_ADAPTERS_V1 } from "@/lib/v2/migration/legacy-adapters-v1";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  await platform.env.DB.prepare("create table media_logs (id text primary key,user_id text not null,media_type text not null,title text not null,rating real,review text,created_at text not null,updated_at text not null,deleted_at text)").run();
  await platform.env.DB.prepare("insert into media_logs values ('inventory-1','user-a','movie','영화',4.5,'감상','2026-08-28','2026-08-28',null)").run();
}, 30_000);

afterAll(async () => { await platform.dispose(); });

describe("legacy inventory on the real D1 binding", () => {
  test("chunks every adapter below workerd's compound-select ceiling", async () => {
    const inventory = await new D1LegacyMigrationRepository(platform.env.DB, "user-a").inventory();
    expect(inventory).toHaveLength(LEGACY_ADAPTERS_V1.length);
    expect(inventory.find((item) => item.table === "media_logs")).toMatchObject({ valid: true, rows: 1 });
  });
});
