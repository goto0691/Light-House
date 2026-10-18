import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConnectionGroupsPanel } from "@/components/v2/connection-groups-panel";
import { EntityMergeButton, EntityRenameForm } from "@/components/v2/entity-curation";
import { getSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { CONNECTION_ORDERS, entityKindLabel, readConnectionGroups, readEntitySummary } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { D1EntityCurationRepository } from "@/lib/v2/infrastructure/d1/entity-curation-repository";
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
  const curation = new D1EntityCurationRepository(db, session.userId);
  const entity = await readEntitySummary(db, session.userId, entityId);
  if (!entity) {
    // A merged entity's old address leads to the entity it was merged into.
    const survivor = await curation.resolve(entityId);
    if (survivor && survivor !== entityId) redirect(`/v2/entities/${encodeURIComponent(survivor)}`);
    notFound();
  }
  const mergeQuery = typeof query.merge_q === "string" ? query.merge_q.slice(0, 100) : "";
  const [alternateNames, candidates] = await Promise.all([curation.alternateNames(entity.entityId), mergeQuery ? curation.candidates(entity.entityId, mergeQuery) : []]);
  const expandedGroup = typeof query.group === "string" ? query.group : null;
  const order = CONNECTION_ORDERS.find((value) => value === query.order) ?? "recent";
  const groups = await readConnectionGroups(db, session.userId, entity.entityId, { expandedGroup, order });
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
        <header className="v2-record-heading"><p>{entity.kindLabel}</p><h1>{entity.name}</h1>
          {alternateNames.length ? <p className="v2-entity-alternates">다른 이름: {alternateNames.join(", ")}</p> : null}
          <EntityRenameForm entityId={entity.entityId} name={entity.name} />
        </header>
        {groups.total || groups.pendingCount
          ? <ConnectionGroupsPanel basePath={`/v2/entities/${encodeURIComponent(entity.entityId)}`} expandedGroup={expandedGroup} groups={groups} heading="이 대상과 이어진 기록" order={order} searchHref={typeSearch} />
          : <p className="v2-connection-groups__pending">아직 이어진 기록이 없습니다.</p>}
        <section className="v2-entity-merge" aria-labelledby="entity-merge-heading">
          <h2 id="entity-merge-heading">같은 대상 합치기</h2>
          <p>다른 이름이나 표기로 따로 생긴 같은 대상을 찾아 이 대상으로 합칩니다. 합친 이름은 이 대상의 다른 이름으로 남습니다.</p>
          <form method="get" action={`/v2/entities/${encodeURIComponent(entity.entityId)}#entity-merge-heading`}>
            <label>이름으로 찾기<input type="search" name="merge_q" maxLength={100} defaultValue={mergeQuery} /></label>
            <button type="submit">찾기</button>
          </form>
          {mergeQuery ? candidates.length
            ? <ul>{candidates.map((candidate) => <li key={candidate.entityId}>
                <Link href={`/v2/entities/${encodeURIComponent(candidate.entityId)}`}><strong>{candidate.name}</strong></Link>
                <span>{entityKindLabel(candidate.kind)} · 연결 {candidate.links}개</span>
                <EntityMergeButton entityId={entity.entityId} entityName={entity.name} source={{ entityId: candidate.entityId, name: candidate.name, kindLabel: entityKindLabel(candidate.kind), links: candidate.links }} />
              </li>)}</ul>
            : <p>‘{mergeQuery}’이(가) 들어간 다른 대상이 없습니다.</p> : null}
        </section>
      </article>
    </main>
  );
}
