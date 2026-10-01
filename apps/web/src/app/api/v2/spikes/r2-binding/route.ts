import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2ArchiveAssetsBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!getV2ServerFeatureFlags().routes) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const bucket = getV2ArchiveAssetsBucket();
  await bucket.head("__v2_binding_probe__");

  return Response.json({
    binding: "ARCHIVE_ASSETS",
    ready: true,
    transport: "workers_binding",
  });
}
