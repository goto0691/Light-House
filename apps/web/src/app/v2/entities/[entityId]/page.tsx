import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConnectionGroupsPanel } from "@/components/v2/connection-groups-panel";
import { getSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { readConnectionGroups, readEntitySummary } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import "../../v2-product.css";

export const dynamic = "force-dynamic";

/** One person, company, work or platform with every record connected to it, grouped by category (D-116). */
export default async function V2EntityPage({ params, searchParams }: PageProps<"/v2/entities/[entityId]">) {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await getSession();
  if (!session) notFound();
  const { entityId } = await params;
  const query = await searchParams;
  const db = getV2CloudflareBindings().db;
  const entity = await readEntitySummary(db, session.userId, entityId);
  if (!entity) notFound();
  const expandedGroup = typeof query.group === "string" ? query.group : null;
  const groups = await readConnectionGroups(db, session.userId, entity.entityId, { expandedGroup });
  if (!groups) notFound();
  const typeSearch = (groupKey: string) => groupKey.startsWith("type:") && groupKey !== "type:unclassified"
    ? `/v2/search?entity=${encodeURIComponent(entity.entityId)}&type=${encodeURIComponent(groupKey.slice(5))}` : null;

  return (
    <main className="v2-product-shell">
      <nav className="v2-product-nav" aria-label="V2 탐색"><Link href="/v2/library"><strong>Light House</strong></Link><Link href="/v2/capture">새 기록</Link></nav>
      <article className="v2-product-card v2-entity-page">
        <div className="v2-record-toolbar">
          <Link className="v2-record-back" href="/v2/library"><ArrowLeft aria-hidden="true" size={16} /> 보관함으로</Link>
          <Link className="v2-record-edit" href={`/v2/search?entity=${encodeURIComponent(entity.entityId)}`}><Search aria-hidden="true" size={15} /> 연결된 기록 검색</Link>
        </div>
        <header className="v2-record-heading"><p>{entity.kindLabel}</p><h1>{entity.name}</h1></header>
        {groups.total || groups.pendingCount
          ? <ConnectionGroupsPanel basePath={`/v2/entities/${encodeURIComponent(entity.entityId)}`} expandedGroup={expandedGroup} groups={groups} heading="이 대상과 이어진 기록" searchHref={typeSearch} />
          : <p className="v2-connection-groups__pending">아직 이어진 기록이 없습니다.</p>}
      </article>
    </main>
  );
}
