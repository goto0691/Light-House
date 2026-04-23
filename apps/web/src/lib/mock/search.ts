export type SearchItem = {
  type: "person" | "task" | "zettel" | "media" | "place" | "action";
  id: string;
  title: string;
  snippet: string;
  href?: string;
  score: number;
};

export const MOCK_SEARCH_ITEMS: SearchItem[] = [
  {
    type: "task",
    id: "task-hotteok-menu",
    title: "호떡집 겨울 신메뉴 리서치",
    snippet: "다음 주까지 경쟁 메뉴와 가격 정책을 정리할 작업입니다.",
    href: "/action-hub?detail=task:task-hotteok-menu",
    score: 0.94,
  },
  {
    type: "person",
    id: "person-jaemin",
    title: "김재민",
    snippet: "비즈니스 파트너. 최근 연락 12일 전.",
    href: "/prm?detail=person:person-jaemin",
    score: 0.91,
  },
  {
    type: "zettel",
    id: "zettel-anxiety",
    title: "존재의 불안과 실존주의",
    snippet: "실존적 불안의 구조와 선택의 무게에 대한 메모.",
    href: "/vault?detail=zettel:zettel-anxiety",
    score: 0.88,
  },
  {
    type: "media",
    id: "media-dune",
    title: "듄: 파트 2",
    snippet: "영상 로그. 사운드 디자인과 신화성에 대한 감상.",
    href: "/vault?detail=media:media-dune",
    score: 0.72,
  },
  {
    type: "place",
    id: "place-hotteok",
    title: "호떡집 본점",
    snippet: "겨울 메뉴 테스트와 미팅이 자주 열리는 장소.",
    href: "/vault?detail=place:place-hotteok",
    score: 0.69,
  },
  {
    type: "action",
    id: "create-zettel",
    title: "새 Zettel 만들기",
    snippet: "Fleeting 메모를 바로 생성합니다.",
    href: "/vault",
    score: 0.6,
  },
];

export function searchMockItems(query: string, limit = 12) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return MOCK_SEARCH_ITEMS.slice(0, limit);

  return MOCK_SEARCH_ITEMS.filter((item) => {
    const haystack = `${item.title} ${item.snippet}`.toLowerCase();
    return haystack.includes(normalized);
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
