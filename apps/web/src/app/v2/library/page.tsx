import { notFound } from "next/navigation";

import { LibraryView } from "@/components/v2/library-view";
import { requireSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import "../v2-product.css";

export const metadata = { title: "보관함 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2LibraryPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession();
  const db = getV2CloudflareBindings().db;
  const { cursor } = await searchParams;
  const [page, pinnedViews] = await Promise.all([new D1DocumentAuthoringRepository(db, session.userId).listRecordsPage({ cursor }), new D1SavedViewRepository(db, session.userId).list({ pinnedOnly: true })]);
  return <LibraryView key={cursor ?? "first"} pinnedViews={pinnedViews} records={page.records} totalCount={page.totalCount} nextCursor={page.nextCursor} hasPrevious={Boolean(cursor)} />;
}
