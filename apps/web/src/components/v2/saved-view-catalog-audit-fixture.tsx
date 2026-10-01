"use client";
import Link from "next/link";
import { validateSavedViewCatalogPage, type SavedViewCatalogRequest } from "@/lib/v2/retrieval/saved-view-catalog";
import { SavedViewCatalog } from "./saved-view-catalog";
import { V2MobileNavigation } from "./mobile-navigation";

/** Synthetic metadata only; does not access an account or saved queries. */
export function SavedViewCatalogAuditFixture({ initialRequest = { query: "", page: 1, pinnedOnly: false }, labNavigation = false }: { initialRequest?: SavedViewCatalogRequest; labNavigation?: boolean }) {
  const views = Array.from({ length: 45 }, (_, index) => ({ id: `catalog-${String(index + 1).padStart(3, "0")}`, name: `합성 목록 ${String(index + 1).padStart(3, "0")}`, description: `합성 설명 ${index + 1}`, iconKey: "type.collection", pinned: index < 3, pinOrder: index < 3 ? index : null }))
    .filter((view) => (!initialRequest.pinnedOnly || view.pinned) && view.name.toLowerCase().includes(initialRequest.query.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(views.length / 20)), page = Math.min(initialRequest.page, totalPages);
  const initialPage = validateSavedViewCatalogPage({ contract: "saved-view-catalog.v1", query: initialRequest.query, pinnedOnly: initialRequest.pinnedOnly, page, pageSize: 20, totalCount: views.length, totalPages, views: views.slice((page - 1) * 20, page * 20) }, initialRequest);
  return <main className="v2-product-shell"><nav className="v2-product-nav"><Link href="/v2/library"><strong>Light House</strong></Link><Link href="/v2/search">검색</Link></nav><SavedViewCatalog key={`${initialPage.query}:${initialPage.page}:${initialPage.pinnedOnly}`} initialPage={initialPage} /><V2MobileNavigation active="library" moreHrefOverrides={labNavigation ? { templates: "/v2-lab?surface=product-library" } : undefined} /></main>;
}
