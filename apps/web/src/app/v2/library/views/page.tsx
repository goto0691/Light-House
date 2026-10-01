import Link from "next/link";
import { notFound } from "next/navigation";

import { SavedViewCatalog } from "@/components/v2/saved-view-catalog";
import { V2MobileNavigation } from "@/components/v2/mobile-navigation";
import { requireSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import { parseSavedViewCatalogRequest } from "@/lib/v2/retrieval/saved-view-catalog";
import "../../v2-product.css";

export const metadata = { title: "내 목록 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2SavedViewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  let request;
  try { request = parseSavedViewCatalogRequest(params); } catch { notFound(); }
  const page = await new D1SavedViewRepository(getV2CloudflareBindings().db, session.userId).listPage(request);
  return <main className="v2-product-shell"><nav className="v2-product-nav"><Link href="/v2/library"><strong>Light House</strong></Link><Link href="/v2/search">검색</Link></nav><SavedViewCatalog key={`${page.query}:${page.page}:${page.pinnedOnly}`} initialPage={page} /><V2MobileNavigation active="library" /></main>;
}
