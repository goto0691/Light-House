import Link from "next/link";
import { notFound } from "next/navigation";

import { SavedViewActions } from "@/components/v2/saved-view-actions";
import { SearchResults } from "@/components/v2/search-results";
import { SearchPagination } from "@/components/v2/search-pagination";
import { searchPageFromParams } from "@/lib/v2/retrieval/search-params";
import { requireSession } from "@/lib/auth/session";
import { getActiveRestrictedGrant, hasUnexpiredRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import "../../../v2-product.css";

export const dynamic = "force-dynamic";

export default async function V2SavedViewPage({ params, searchParams }: { params: Promise<{ viewId: string }>; searchParams: Promise<{ page?: string }> }) {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession(); const { viewId } = await params; const db = getV2CloudflareBindings().db;
  const view = await new D1SavedViewRepository(db, session.userId).get(viewId); if (!view) notFound();
  const grant = await getActiveRestrictedGrant(db, { userId: session.userId, sessionId: session.sessionId });
  const query = await searchParams;
  const page = await new D1RetrievalRepository(db, session.userId).searchPage(view.queryPlan, Boolean(grant), searchPageFromParams(new URLSearchParams({ page: query.page ?? "1" })), view.display.visibleFields);
  if (grant && !hasUnexpiredRestrictedGrant(grant)) notFound();
  return <main className="v2-product-shell"><nav className="v2-product-nav"><Link href="/v2/library/views"><strong>내 목록</strong></Link><Link href="/v2/search">검색</Link></nav><section className="v2-product-card v2-saved-view-page"><header><div><p>저장된 조건 · {{ list: "목록", cards: "카드", timeline: "타임라인", table: "표" }[view.display.layout]}</p><h1>{view.name}</h1><span>{view.description}</span></div></header><SavedViewActions key={view.id} pinned={view.pinned} viewId={view.id} display={view.display} displayRevision={view.displayRevision} /><div className="v2-search-summary"><span><strong>{page.totalCount}</strong>개 기록 · 현재 {page.results.length}개 표시</span></div><SearchResults queried results={page.results} queryPlan={view.queryPlan} display={view.display} /><SearchPagination page={page.page} totalPages={page.totalPages} pathname={`/v2/library/views/${viewId}`} /></section></main>;
}
