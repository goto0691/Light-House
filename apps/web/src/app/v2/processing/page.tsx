import { notFound } from "next/navigation";
import { ProcessingStatusView } from "@/components/v2/processing-status-view";
import { requireSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1ProcessingStatusRepository } from "@/lib/v2/infrastructure/d1/processing-status-repository";
import "../v2-product.css";

export const metadata = { title: "처리 상태 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2ProcessingPage() {
  const flags = getV2ServerFeatureFlags();
  if (!flags.routes) notFound();
  const session = await requireSession();
  // The authenticated page and GET share the same read-only, minimal DTO.
  // A storage outage is retriable in the client; never render it as an empty archive.
  const initialPage = await new D1ProcessingStatusRepository(getV2CloudflareBindings().db, session.userId).list({
    runtime: { enabled: flags.ai && flags.write, configured: Boolean(process.env.GEMINI_API_KEY?.trim()) },
  }).catch(() => null);
  return <ProcessingStatusView initialPage={initialPage} />;
}
