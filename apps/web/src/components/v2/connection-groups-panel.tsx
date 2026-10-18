import { ChevronRight, Link2, Lock } from "lucide-react";
import Link from "next/link";

import type { ConnectionGroupItem, ConnectionGroups, ConnectionOrder } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { RECORD_TIME_ZONE } from "@/lib/v2/presentation/record-date";

/**
 * Connections grouped by the category of what they connect to (D-116): a count per
 * category first, then the newest items of each group. Sensitive records are only
 * counted; AI-proposed links are pointed to, not listed.
 */
const ORDER_LABELS: Readonly<Record<ConnectionOrder, string>> = { recent: "최근순", oldest: "오래된순", name: "이름순" };

export function ConnectionGroupsPanel({ groups, heading, basePath, expandedGroup, searchHref, order = "recent" }: {
  groups: ConnectionGroups;
  heading: string;
  /** The page URL without query: opening a group adds ?group=<key>. */
  basePath: string;
  expandedGroup?: string | null;
  /** A full search for a group, when one exists (entity pages). */
  searchHref?: (groupKey: string) => string | null;
  /** The item order inside each group (?order=). */
  order?: ConnectionOrder;
}) {
  if (!groups.total && !groups.pendingCount) return null;
  const anchor = (groupKey: string) => `connections-${groupKey.replace(/[^a-z0-9_-]/gi, "-")}`;
  const pageHref = (next: { group?: string | null; order?: ConnectionOrder }) => {
    const params = new URLSearchParams();
    const group = next.group === undefined ? expandedGroup : next.group;
    const nextOrder = next.order ?? order;
    if (group) params.set("group", group);
    if (nextOrder !== "recent") params.set("order", nextOrder);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  return (
    <section aria-labelledby="connection-groups-heading" className="v2-connection-groups">
      <header>
        <div><p>{heading}</p><h2 id="connection-groups-heading">연결 {groups.total}</h2></div>
        <Link2 aria-hidden="true" size={18} />
      </header>
      {groups.total > 1 ? <nav aria-label="연결 정렬" className="v2-connection-groups__order">
        {(Object.keys(ORDER_LABELS) as ConnectionOrder[]).map((value) => value === order
          ? <span aria-current="true" key={value}>{ORDER_LABELS[value]}</span>
          : <Link href={`${pageHref({ order: value })}#connection-groups-heading`} key={value} replace scroll={false}>{ORDER_LABELS[value]}</Link>)}
      </nav> : null}
      {groups.summary.length ? (
        <ul aria-label="연결 요약" className="v2-connection-groups__summary">
          {groups.summary.map((group) => <li key={group.groupKey}><a href={`#${anchor(group.groupKey)}`}>{group.label} <b>{group.count}</b></a></li>)}
        </ul>
      ) : null}
      {groups.groups.map((group) => {
        const relationNote = group.relationLabels.filter((label) => label !== group.label);
        const hidden = group.count - group.closedSensitiveCount - group.items.length;
        const search = searchHref?.(group.groupKey) ?? null;
        return (
          <section aria-labelledby={`${anchor(group.groupKey)}-heading`} className="v2-connection-groups__group" id={anchor(group.groupKey)} key={group.groupKey}>
            <h3 id={`${anchor(group.groupKey)}-heading`}>{group.label} <span>{group.count}</span>{relationNote.length ? <small>{relationNote.join(" · ")}</small> : null}</h3>
            {group.items.length ? <ul>{group.items.map((item) => <li key={item.objectId}><ConnectionItem item={item} /></li>)}</ul> : null}
            {group.closedSensitiveCount ? <p className="v2-connection-groups__closed"><Lock aria-hidden="true" size={12} /> 민감한 기록 {group.closedSensitiveCount}개는 기록을 직접 열어 확인하세요.</p> : null}
            {hidden > 0 && expandedGroup !== group.groupKey ? <Link className="v2-connection-groups__more" href={`${pageHref({ group: group.groupKey })}#${anchor(group.groupKey)}`}>{group.label} {group.count - group.closedSensitiveCount}개 모두 보기 <ChevronRight aria-hidden="true" size={13} /></Link> : null}
            {hidden > 0 && expandedGroup === group.groupKey && search ? <Link className="v2-connection-groups__more" href={search}>검색에서 모두 보기 <ChevronRight aria-hidden="true" size={13} /></Link> : null}
          </section>
        );
      })}
      {groups.pendingCount ? <p className="v2-connection-groups__pending">AI가 찾은 연결 {groups.pendingCount}개는 아직 확인 전이라 여기에 넣지 않았습니다.</p> : null}
    </section>
  );
}

function ConnectionItem({ item }: { item: ConnectionGroupItem }) {
  const date = item.date ? new Date(item.date).toLocaleDateString("ko-KR", { timeZone: RECORD_TIME_ZONE }) : null;
  const href = item.objectKind === "document" ? `/v2/records/${encodeURIComponent(item.objectId)}` : item.objectKind === "entity" ? `/v2/entities/${encodeURIComponent(item.objectId)}` : null;
  const body = <><strong>{item.label}</strong>{date ? <time dateTime={item.date!}>{date}</time> : null}{item.origins.includes("ai") ? <em>AI 해석</em> : null}</>;
  return href ? <Link href={href}>{body}</Link> : <span>{body}</span>;
}
