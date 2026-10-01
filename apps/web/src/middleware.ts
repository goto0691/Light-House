import { NextResponse, type NextRequest } from "next/server";

import { parseBooleanFlag } from "@/lib/v2/config/feature-flags";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const STANDALONE_LEGACY_ADAPTER_MUTATION_ROUTES = [
  { root: "/api/notifications", table: "notifications" },
  { root: "/api/settings/appearance", table: "widget_layouts" },
  { root: "/api/settings/shortcuts", table: "shortcut_bindings" },
] as const;

export const LEGACY_ARCHIVE_MUTATION_ROOTS = [
  "/api/action-hub",
  "/api/ai",
  "/api/capture",
  "/api/life-ops",
  "/api/prm",
  "/api/saved-views",
  "/api/upload",
  "/api/vault",
  "/api/webhooks/cron",
  "/api/settings/data/notion/import",
  "/api/settings/data/notion/repair",
  "/api/settings/data/restore",
  ...STANDALONE_LEGACY_ADAPTER_MUTATION_ROUTES.map(({ root }) => root),
] as const;

function isInsideRouteRoot(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}

export function isLegacyArchiveMutation(path: string, method: string) {
  return !SAFE_METHODS.has(method.toUpperCase()) && LEGACY_ARCHIVE_MUTATION_ROOTS.some((root) => isInsideRouteRoot(path, root));
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const legacyMutation = !path.startsWith("/api/v2/") && isLegacyArchiveMutation(path, request.method);
  if (legacyMutation && parseBooleanFlag(process.env.FLAG_V2_LEGACY_READONLY, false)) {
    return NextResponse.json({ error: { code: "legacy_readonly", message: "The previous archive is read-only. Create and edit records in Light House V2." } }, { status: 423, headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
