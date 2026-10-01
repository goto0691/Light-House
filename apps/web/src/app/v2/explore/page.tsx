import { Archive, Compass, Plus, Search, Settings } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FacetExplorePanels, facetExploreKinds } from "@/components/v2/facet-explore-panels";
import { V2MobileNavigation } from "@/components/v2/mobile-navigation";
import { requireSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { readFacetPage } from "@/lib/v2/infrastructure/d1/facet-page-repository";
import { parseFacetRequest } from "@/lib/v2/retrieval/facet-page";
import "../v2-product.css";

export const metadata = { title: "탐색 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession(), raw = await searchParams, params = new URLSearchParams();
  const allowed = facetExploreKinds.flatMap((kind) => [`${kind}_q`, `${kind}_page`]);
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key) || typeof value !== "string") notFound();
    params.set(key, value);
  }
  let requests;
  try { requests = facetExploreKinds.map((kind) => parseFacetRequest(new URLSearchParams({ kind, q: params.get(`${kind}_q`) ?? "", page: params.get(`${kind}_page`) ?? "1" }))); }
  catch { notFound(); }
  const db = getV2CloudflareBindings().db;
  const pages = await Promise.all(requests.map((request) => readFacetPage(db, session.userId, request)));
  return <main className="v2-search-page v2-explore-page"><aside className="v2-search-sidebar">
    <Link className="v2-library-brand" href="/v2/library"><span>LH</span><strong>Light House</strong></Link><Link className="v2-library-new" href="/v2/capture"><Plus aria-hidden="true" size={18} /> 새 기록</Link>
    <nav aria-label="주요 탐색"><Link href="/v2/library"><Archive aria-hidden="true" size={17} /> 보관함</Link><Link aria-current="page" href="/v2/explore"><Compass aria-hidden="true" size={17} /> 탐색</Link><Link href="/v2/search"><Search aria-hidden="true" size={17} /> 검색</Link></nav><Link className="v2-library-settings" href="/settings"><Settings aria-hidden="true" size={17} /> 설정</Link>
  </aside><section className="v2-search-main"><header><p>정해진 폴더가 아니라 연결과 시간으로 봅니다</p><h1>기록 탐색</h1></header>
    <FacetExplorePanels key={params.toString()} pages={pages} query={params.toString()} />
    <Link className="v2-rediscovery-entry" href="/v2/explore/rediscovery"><Compass aria-hidden="true" size={20} /><span><strong>예전 기록 다시 보기</strong><small>사용자가 켠 경우에만 오래된 기록을 한 장씩 제안합니다.</small></span></Link>
  </section><V2MobileNavigation active="explore" /></main>;
}
