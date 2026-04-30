export type SourceDocumentInfo = {
  id: string;
  sourceDatabase: string | null;
  sourceId: string;
  documentRole: string | null;
  status: string;
  url?: string | null;
  preview: string | null;
  properties: Array<{ name: string; value: string; type?: string | null }>;
};

export type ZettelMock = {
  id: string;
  title: string;
  type: "fleeting" | "literature" | "permanent" | "moc" | "reference";
  category: string;
  summary: string;
  content: string;
  outgoingLinks: Array<{ id: string; targetId: string; title: string }>;
  backlinks: string[];
  related: string[];
  tags: string[];
  aliases: string[];
  pinned?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  status?: string | null;
  documentKind?: string | null;
  sourceReliability?: string | null;
  reviewCadence?: string | null;
  reviewDueAt?: string | null;
  originalCreatedAt?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  sourceDocument?: SourceDocumentInfo | null;
};

export type MediaMock = {
  id: string;
  mediaType: "game" | "book" | "screen";
  title: string;
  originalTitle?: string | null;
  subtype?: string | null;
  platformOrPublisher?: string | null;
  creator: string;
  studio?: string | null;
  genre?: string | null;
  releaseYear?: number | null;
  status: "backlog" | "consuming" | "completed" | "dropped";
  rating?: number | null;
  evaluation?: string | null;
  review: string;
  content?: string | null;
  relationNote?: string | null;
  playTime?: number | null;
  author?: string | null;
  pages?: number | null;
  screenKind?: string | null;
  rewatchValue?: boolean | null;
  coverImageUrl?: string | null;
  loggedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  sourceDocument?: SourceDocumentInfo | null;
};

export type AssetMock = {
  id: string;
  category: "gear" | "collection";
  name: string;
  brand: string;
  condition: string;
};

export type PlaceMock = {
  id: string;
  category: "restaurant" | "cafe" | "shop";
  name: string;
  address: string;
  review: string;
};

export const ZETTELS_MOCK: ZettelMock[] = [
  {
    id: "zettel-anxiety",
    title: "존재의 불안과 실존주의",
    type: "permanent",
    category: "실존주의",
    summary: "불안은 회피 대상이 아니라 선택의 자유를 드러내는 신호다.",
    content: "실존적 불안은 방향 상실이 아니라 자유의 무게를 체감하는 순간에 발생한다.",
    outgoingLinks: [],
    backlinks: ["기도와 불안의 언어", "호떡집 브랜딩과 진정성"],
    related: ["사르트르 입문 메모", "듄: 파트 2 감상"],
    tags: ["실존주의"],
    aliases: ["실존적 불안"],
  },
  {
    id: "zettel-prayer",
    title: "기도와 불안의 언어",
    type: "literature",
    category: "묵상",
    summary: "기도는 불안을 없애기보다 들고 견디는 방식이다.",
    content: "불안을 없애 달라는 요청이 아니라, 그 불안을 들고 걸을 힘을 달라는 기도로 이동한다.",
    outgoingLinks: [{ id: "zlink-1", targetId: "zettel-anxiety", title: "존재의 불안과 실존주의" }],
    backlinks: ["존재의 불안과 실존주의"],
    related: ["시편 23편 메모"],
    tags: ["묵상"],
    aliases: [],
  },
  {
    id: "zettel-hotteok",
    title: "호떡집 브랜딩과 진정성",
    type: "fleeting",
    category: "비즈니스",
    summary: "브랜드 언어는 메뉴보다 먼저 관계의 온도를 설명해야 한다.",
    content: "호떡집이 파는 것은 간식보다 위로일 수 있다.",
    outgoingLinks: [{ id: "zlink-2", targetId: "zettel-anxiety", title: "존재의 불안과 실존주의" }],
    backlinks: ["존재의 불안과 실존주의"],
    related: ["호떡집 본점"],
    tags: ["비즈니스"],
    aliases: [],
  },
];

export const MEDIA_MOCK: MediaMock[] = [
  { id: "media-dune", mediaType: "screen", title: "듄: 파트 2", creator: "드니 빌뇌브", status: "completed", review: "신화적 스케일과 사운드 디자인이 압도적이다." },
  { id: "media-sartre", mediaType: "book", title: "실존주의는 휴머니즘이다", creator: "장 폴 사르트르", status: "consuming", review: "실존주의의 입문 개념을 짧게 압축한다." },
  { id: "media-hades", mediaType: "game", title: "Hades", creator: "Supergiant Games", status: "completed", review: "반복 플레이가 서사와 감정선을 강화한다." },
];

export const ASSETS_MOCK: AssetMock[] = [
  { id: "asset-bike", category: "gear", name: "로드 자전거", brand: "Trek", condition: "good" },
  { id: "asset-speaker", category: "gear", name: "북쉘프 스피커", brand: "KEF", condition: "mint" },
  { id: "asset-figure", category: "collection", name: "듄 피규어", brand: "Bandai", condition: "good" },
];

export const PLACES_MOCK: PlaceMock[] = [
  { id: "place-hotteok", category: "restaurant", name: "호떡집 본점", address: "성수 어딘가", review: "메뉴 테스트와 대화가 자주 열리는 장소." },
  { id: "place-museum", category: "shop", name: "현대미술관", address: "서울 종로", review: "전시 감상 후 메모가 풍성하게 생기는 공간." },
];

export function getZettelMock(id: string) {
  return ZETTELS_MOCK.find((item) => item.id === id) ?? null;
}

export function getMediaMock(id: string) {
  return MEDIA_MOCK.find((item) => item.id === id) ?? null;
}

export function getPlaceMock(id: string) {
  return PLACES_MOCK.find((item) => item.id === id) ?? null;
}
