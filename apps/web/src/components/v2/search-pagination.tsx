import Link from "next/link";

export function SearchPagination({ page, totalPages, pathname, query }: { page: number; totalPages: number; pathname: string; query?: string }) {
  if (totalPages <= 1) return null;
  function href(next: number) {
    const params = new URLSearchParams(query);
    params.set("page", String(next));
    return `${pathname}?${params.toString()}`;
  }
  return <nav className="v2-pagination" aria-label="검색 결과 페이지">{page > 1 ? <Link href={href(page - 1)}>이전 페이지</Link> : <span /> }<span>{page} / {totalPages} 페이지</span>{page < totalPages ? <Link href={href(page + 1)}>다음 페이지</Link> : <span />}</nav>;
}
