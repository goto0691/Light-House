import { afterEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const harness = vi.hoisted(() => ({ prepare: vi.fn(), bind: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { DB: { prepare: harness.prepare } } }) }));

import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

test("local mode answers from the local D1 binding and never calls the remote API", async () => {
  vi.stubEnv("LIGHT_HOUSE_D1_MODE", "local");
  vi.stubEnv("NODE_ENV", "development");
  const remote = vi.spyOn(globalThis, "fetch");
  harness.prepare.mockReturnValue({ bind: (...values: unknown[]) => { harness.bind(...values); return { all: async () => ({ results: [{ id: "user-one" }], meta: { changes: 1 } }) }; } });
  await expect(queryD1("select id from users where email = ?", ["owner@example.test"])).resolves.toEqual({ rows: [{ id: "user-one" }], meta: { changes: 1 } });
  await expect(executeD1("delete from sessions where id = ?", ["session-one"])).resolves.toEqual({ changes: 1 });
  expect(harness.prepare).toHaveBeenNthCalledWith(1, "select id from users where email = ?");
  expect(harness.bind).toHaveBeenNthCalledWith(1, "owner@example.test");
  expect(remote).not.toHaveBeenCalled();
});

test("production refuses local mode instead of falling back to the remote database", async () => {
  vi.stubEnv("LIGHT_HOUSE_D1_MODE", "local");
  vi.stubEnv("NODE_ENV", "production");
  const remote = vi.spyOn(globalThis, "fetch");
  await expect(queryD1("select 1")).rejects.toThrow(/only for local development/);
  expect(remote).not.toHaveBeenCalled();
  expect(harness.prepare).not.toHaveBeenCalled();
});

test("without local mode the remote endpoint is used as before", async () => {
  vi.stubEnv("LIGHT_HOUSE_D1_MODE", "");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account");
  vi.stubEnv("CLOUDFLARE_D1_DATABASE_ID", "database");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic-token");
  const remote = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, result: [{ success: true, results: [], meta: {} }] })));
  await queryD1("select 1");
  expect(remote).toHaveBeenCalledWith(expect.stringContaining("/d1/database/database/query"), expect.objectContaining({ method: "POST" }));
  expect(harness.prepare).not.toHaveBeenCalled();
});
