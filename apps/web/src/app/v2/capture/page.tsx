import { notFound } from "next/navigation";

import { CaptureComposer } from "@/components/v2/capture-composer";
import { PwaRegistration } from "@/components/v2/pwa-registration";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import "../v2-product.css";

export const metadata = { title: "새 기록 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2CapturePage({ searchParams }: PageProps<"/v2/capture">) {
  const flags = getV2ServerFeatureFlags();
  if (!flags.routes) notFound();
  const query = await searchParams;
  const draftId = typeof query.draftId === "string" ? query.draftId : null;
  const templateVersionId = typeof query.template === "string" ? query.template : null;
  return (
    <main className="v2-product-shell">
      <PwaRegistration enabled={flags.offline} />
      <nav className="v2-product-nav" aria-label="V2 탐색"><a href="/v2/library"><strong>Light House</strong></a><span>새 기록</span></nav>
      <CaptureComposer initialDraftId={draftId} initialTemplateVersionId={templateVersionId} offlineEnabled={flags.offline} writeEnabled={flags.write} />
    </main>
  );
}
