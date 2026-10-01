import Link from "next/link";
import { CalendarDays, Link2, Shapes } from "lucide-react";
import type { FacetKind, FacetPage } from "@/lib/v2/retrieval/facet-page";
import "./facet-discovery.css";

const headings = { type: "분류로 보기", entity: "대상과 사람으로 보기", month: "시간으로 보기" };
const descriptions = { type: "현재 볼 수 있는 분류를 모두 찾습니다. 보호 기록은 제외됩니다.", entity: "일반 기록에서 확인된 대상 연결만 표시합니다.", month: "원본을 남긴 달을 기준으로 엽니다. 보호 기록은 제외됩니다." };
const icons = { type: Shapes, entity: Link2, month: CalendarDays };
const panelKinds = ["type", "entity", "month"] as const;

export function facetExploreQuery(params: URLSearchParams, kind: FacetKind, query: string, page: number) {
  const next = new URLSearchParams(params); next.set(`${kind}_q`, query); next.set(`${kind}_page`, String(page)); return next.toString();
}
function monthSearch(key: string) {
  const [year, month] = key.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return `/v2/search?${new URLSearchParams({ from: `${key}-01`, to: `${key}-${last}`, sort: "captured_at" })}`;
}
export function FacetExplorePanels({ pages, query = "", pathname = "/v2/explore" }: { pages: readonly FacetPage[]; query?: string; pathname?: string }) {
  const params = new URLSearchParams(query);
  return <div className="v2-facet-panels">{pages.map((page) => {
    const kind = page.kind, Icon = icons[kind], heading = headings[kind];
    const pageHref = (target: number) => `${pathname}?${facetExploreQuery(params, kind, page.query, target)}#facet-${kind}`;
    return <section className="v2-facet-panel" key={kind} id={`facet-${kind}`} aria-label={heading}><header><Icon aria-hidden="true" size={20} /><div><h2>{heading}</h2><p>{descriptions[kind]}</p></div></header>
      <form method="get" action={`${pathname}#facet-${kind}`}>
        {[...params].filter(([key]) => key !== `${kind}_q` && key !== `${kind}_page`).map(([key, value], index) => <input key={`${key}-${index}`} name={key} type="hidden" value={value} />)}
        <input name={`${kind}_page`} type="hidden" value="1" /><label>{heading} 검색<input type="search" name={`${kind}_q`} maxLength={100} defaultValue={page.query} /></label><button type="submit">{heading} 찾기</button>
      </form>
      <p className="v2-facet-summary">전체 {page.totalCount}개 · {page.page}/{page.totalPages}페이지 · 현재 {page.items.length}개 표시</p>
      {page.items.length ? <ul className="v2-facet-items">{page.items.map((item) => <li key={item.key}><Link prefetch={false} href={kind === "month" ? monthSearch(item.key) : `/v2/search?${new URLSearchParams({ [kind === "entity" ? "entity" : "type"]: item.key })}`}><strong>{item.label}</strong><span>{item.count}개 기록{item.entityKind ? ` · ${item.entityKind}` : ""}</span></Link></li>)}</ul> : <p>현재 조건에 맞는 항목이 없습니다. 검색어를 비워 전체 범위를 볼 수 있습니다.</p>}
      <nav aria-label={`${heading} 페이지`}>{page.page > 1 ? <Link prefetch={false} href={pageHref(page.page - 1)}>이전</Link> : <span>첫 페이지</span>}{page.page < page.totalPages ? <Link prefetch={false} href={pageHref(page.page + 1)}>다음</Link> : <span>마지막 페이지</span>}</nav>
    </section>;
  })}</div>;
}

export const facetExploreKinds = panelKinds;
