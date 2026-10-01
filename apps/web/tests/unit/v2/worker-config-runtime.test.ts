import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("loads the Worker runtime config without the safe-build process flag", async () => {
  vi.stubEnv("LIGHT_HOUSE_SAFE_WORKER_BUILD", undefined);
  const { default: config } = await import("../../../open-next.config");
  expect(config.default).toBeDefined();
  expect(config.buildCommand).toBe("node scripts/build-next-worker-safe.mjs");
});

test("rejects direct Next-for-Worker builds before spawning Next", () => {
  const env = { ...process.env };
  delete env.LIGHT_HOUSE_SAFE_WORKER_BUILD;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../scripts/build-next-worker-safe.mjs", import.meta.url))], { env, encoding: "utf8", windowsHide: true });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Direct OpenNext builds are disabled");
  expect(result.stdout).toBe("");
});
