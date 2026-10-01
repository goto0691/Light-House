import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!getV2ServerFeatureFlags().routes) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const { db } = getV2CloudflareBindings();
  const result = await db.prepare("select 1 as binding_ready").first<{ binding_ready: number }>();

  return Response.json({
    binding: "DB",
    ready: result?.binding_ready === 1,
    transport: "workers_binding",
  });
}
