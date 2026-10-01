import { notFound } from "next/navigation";

import { V2Lab } from "@/components/v2/lab/v2-lab";
import { DocumentEditor } from "@/components/v2/editor/document-editor";
import { ProductAuditFixture } from "@/components/v2/lab/product-audit-fixture";
import { ManualLinkAuditFixture } from "@/components/v2/lab/manual-link-audit-fixture";
import { LinkAnalysisAuditFixture } from "@/components/v2/lab/link-analysis-audit-fixture";
import { EditorPolicyAuditFixture } from "@/components/v2/lab/editor-policy-audit-fixture";
import { LinkDraftSessionAuditFixture } from "@/components/v2/lab/link-draft-session-audit-fixture";
import { SearchLocationAuditFixture } from "@/components/v2/lab/search-location-audit-fixture";
import { SavedViewDisplayAuditFixture } from "@/components/v2/lab/saved-view-display-audit-fixture";
import { SavedFieldReaderAuditFixture } from "@/components/v2/lab/saved-field-reader-audit-fixture";
import { CatalogDiscoveryAuditFixture } from "@/components/v2/lab/catalog-discovery-audit-fixture";
import { SavedViewCatalogAuditFixture } from "@/components/v2/saved-view-catalog-audit-fixture";
import { RecordModulesAuditFixture } from "@/components/v2/lab/record-modules-audit-fixture";
import { createRecordModuleTransportFixture } from "@/components/v2/lab/record-module-transport-fixture";
import { ProcessingStatusAuditFixture } from "@/components/v2/lab/processing-status-audit-fixture";
import { NaturalSearchAuditFixture } from "@/components/v2/lab/natural-search-audit-fixture";
import { VideoAnalysisAuditFixture } from "@/components/v2/lab/video-analysis-audit-fixture";
import { parseSavedViewCatalogRequest } from "@/lib/v2/retrieval/saved-view-catalog";
import { toPublicV2FeatureFlags } from "@/lib/v2/config/feature-flags";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import "./v2-lab.css";
import "../v2/v2-product.css";

export const metadata = {
  title: "Light House V2 · 구현 실험실",
  description: "Light House V2 A+ 디자인과 핵심 상호작용을 검증하는 격리된 구현 화면",
  manifest: "/v2-manifest.webmanifest",
};

export const dynamic = "force-dynamic";

export default async function V2LabPage({ searchParams }: PageProps<"/v2-lab">) {
  const serverFlags = getV2ServerFeatureFlags();
  if (!serverFlags.routes) notFound();
  const query = await searchParams;
  const requestedSurface = typeof query.surface === "string" ? query.surface : undefined;
  if (requestedSurface === "manual-links") return <ManualLinkAuditFixture />;
  if (requestedSurface === "link-analysis") return <LinkAnalysisAuditFixture />;
  if (requestedSurface === "editor-policy") return <EditorPolicyAuditFixture state={query.policy === "locked" || query.policy === "returned" ? query.policy : "normal"} />;
  if (requestedSurface === "link-draft-session") return <LinkDraftSessionAuditFixture />;
  if (requestedSurface === "search-location") return <SearchLocationAuditFixture />;
  if (requestedSurface === "saved-view-display") return <SavedViewDisplayAuditFixture />;
  if (requestedSurface === "saved-field-reader") return <SavedFieldReaderAuditFixture />;
  if (requestedSurface === "record-modules") return <RecordModulesAuditFixture serverPresentationJson={JSON.stringify(createRecordModuleTransportFixture())} />;
  if (requestedSurface === "processing-status") return <ProcessingStatusAuditFixture />;
  if (requestedSurface === "catalog-discovery") return <CatalogDiscoveryAuditFixture />;
  if (requestedSurface === "natural-search") return <NaturalSearchAuditFixture />;
  if (requestedSurface === "video-analysis") return <VideoAnalysisAuditFixture />;
  if (requestedSurface === "saved-view-catalog") {
    const params = new URLSearchParams();
    for (const name of ["q", "page", "pinned"]) {
      const value = query[name];
      if (typeof value === "string") params.set(name, value);
      else if (Array.isArray(value)) for (const item of value) params.append(name, item);
    }
    let request;
    try { request = parseSavedViewCatalogRequest(params); } catch { notFound(); }
    return <SavedViewCatalogAuditFixture initialRequest={request} labNavigation={query.catalogNav === "lab"} />;
  }
  if (requestedSurface === "product-library" || requestedSurface === "product-fields") return <ProductAuditFixture kind={requestedSurface === "product-library" ? "library" : "fields"} />;
  if (requestedSurface === "authoring") {
    return (
      <main className="v2-lab v2-product-editor">
        <DocumentEditor
          ownerId="authoring-lab-user"
          initial={{
            recordId: "authoring-browser-fixture",
            title: "실제 revision 편집기",
            bodyMarkdown: "# 원본을 지키는 편집\n\n사용자의 변경은 새 revision으로 저장된다.",
            currentRevisionId: "revision-browser-fixture-1",
            currentVersion: 1,
            writtenAt: "2026-08-12T09:00:00.000Z",
            documentStatus: "draft",
            privacyLevel: "normal",
            sourceCount: 1,
          }}
          writeEnabled
        />
      </main>
    );
  }
  const initialSurface = ["library", "record", "adaptive", "search", "explore", "template", "portability", "capture", "editor"].includes(requestedSurface ?? "")
    ? (requestedSurface as "library" | "record" | "adaptive" | "search" | "explore" | "template" | "portability" | "capture" | "editor")
    : "library";
  const initialDraftId = typeof query.draftId === "string" ? query.draftId : undefined;

  return <V2Lab flags={toPublicV2FeatureFlags(serverFlags)} initialDraftId={initialDraftId} initialSurface={initialSurface} />;
}
