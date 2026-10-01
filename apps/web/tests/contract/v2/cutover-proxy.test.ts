import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { LEGACY_ADAPTER_BY_TABLE } from "@/lib/v2/migration/legacy-adapters-v1";
import { isLegacyArchiveMutation, middleware, STANDALONE_LEGACY_ADAPTER_MUTATION_ROUTES } from "@/middleware";

const previousFlag = process.env.FLAG_V2_LEGACY_READONLY;
const apiRouteRoot = fileURLToPath(new URL("../../../src/app/api/", import.meta.url));
const explicitlyAllowedNonV2Mutations = new Set([
  "POST /api/settings/ai",
  "POST /api/settings/data/notion/preview",
  "POST /api/settings/profile",
]);

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "v2" && directory === apiRouteRoot ? [] : routeFiles(absolute);
    return entry.name === "route.ts" ? [absolute] : [];
  });
}

function requestPathForRoute(file: string) {
  const segments = path.relative(apiRouteRoot, path.dirname(file)).split(path.sep).filter(Boolean);
  return `/api/${segments.map((segment) => segment.startsWith("[") ? "test-id" : segment).join("/")}`;
}

function mutationHandlers(file: string) {
  const source = readFileSync(file, "utf8");
  const matches = source.matchAll(/export\s+(?:async\s+function\s+|const\s+)(POST|PUT|PATCH|DELETE)\b/g);
  return [...matches].map((match) => match[1]);
}

afterEach(() => {
  if (previousFlag === undefined) Reflect.deleteProperty(process.env, "FLAG_V2_LEGACY_READONLY");
  else process.env.FLAG_V2_LEGACY_READONLY = previousFlag;
});

describe.sequential("V1 mutation cutover boundary", () => {
  it("rejects legacy API mutations when the archive is read-only", async () => {
    process.env.FLAG_V2_LEGACY_READONLY = "1";
    const response = middleware(new NextRequest("https://lighthouse.local/api/capture", { method: "POST" }));

    expect(response.status).toBe(423);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "legacy_readonly" } });
  });

  it.each([
    ["GET", "/api/search"],
    ["GET", "/api/context/zettel/test-id"],
    ["GET", "/api/source-property-mappings"],
    ["GET", "/api/notifications"],
    ["GET", "/api/notifications/notice-1/read"],
    ["GET", "/api/settings/appearance"],
    ["GET", "/api/settings/shortcuts"],
    ["HEAD", "/api/notifications"],
    ["OPTIONS", "/api/settings/shortcuts"],
    ["POST", "/api/v2/captures/commit"],
    ["POST", "/api/export"],
    ["PATCH", "/api/settings/profile"],
    ["POST", "/api/settings/data/notion/preview"],
  ])("allows %s %s through the central guard", (method, pathname) => {
    process.env.FLAG_V2_LEGACY_READONLY = "true";
    const response = middleware(new NextRequest(`https://lighthouse.local${pathname}`, { method }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["POST", "/api/action-hub/capture"],
    ["POST", "/api/context/edges"],
    ["DELETE", "/api/context/edges/edge-1"],
    ["POST", "/api/source-property-mappings"],
    ["POST", "/api/source-property-mappings/apply"],
    ["PATCH", "/api/vault/zettels/zettel-1/title"],
    ["POST", "/api/upload/complete"],
    ["POST", "/api/settings/data/notion/import"],
    ["POST", "/api/webhooks/cron"],
    ["POST", "/api/settings/appearance"],
    ["POST", "/api/settings/shortcuts"],
    ["POST", "/api/notifications"],
    ["POST", "/api/notifications/notice-1/read"],
    ["PATCH", "/api/notifications/notice-1"],
    ["DELETE", "/api/notifications/notice-1"],
  ])("blocks %s %s as a legacy archive mutation", async (method, pathname) => {
    process.env.FLAG_V2_LEGACY_READONLY = "1";
    const response = middleware(new NextRequest(`https://lighthouse.local${pathname}`, { method }));

    expect(response.status).toBe(423);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "legacy_readonly" } });
  });

  it("keeps every standalone adapter-backed mutation route registered and fenced", () => {
    for (const policy of STANDALONE_LEGACY_ADAPTER_MUTATION_ROUTES) {
      expect(LEGACY_ADAPTER_BY_TABLE.has(policy.table), `${policy.table} must remain in the legacy adapter registry`).toBe(true);
      expect(isLegacyArchiveMutation(policy.root, "POST"), `${policy.root} must remain inside the readonly fence`).toBe(true);
    }
  });

  it("requires every non-V2 API mutation handler to be fenced or explicitly allowed", () => {
    const uncovered = routeFiles(apiRouteRoot).flatMap((file) => {
      const pathname = requestPathForRoute(file);
      return mutationHandlers(file)
        .map((method) => `${method} ${pathname}`)
        .filter((operation) => {
          const separator = operation.indexOf(" ");
          const method = operation.slice(0, separator);
          const route = operation.slice(separator + 1);
          return !isLegacyArchiveMutation(route, method) && !explicitlyAllowedNonV2Mutations.has(operation);
        });
    });

    expect(uncovered).toEqual([]);
  });

  it("keeps legacy mutation routes available before cutover", () => {
    process.env.FLAG_V2_LEGACY_READONLY = "0";
    const response = middleware(new NextRequest("https://lighthouse.local/api/records/123", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
