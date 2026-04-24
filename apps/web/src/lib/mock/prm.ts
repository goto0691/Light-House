import type { SourceDocumentInfo } from "@/lib/mock/vault";

export type PersonMock = {
  id: string;
  name: string;
  nickname?: string;
  layer: 5 | 15 | 50 | 150;
  groups: string[];
  status: "active" | "dormant" | "observing";
  favorite?: boolean;
  bio: string;
  coreValue: string;
  daysSinceContact: number;
  cadenceDays: number;
  upcomingBirthday?: string;
  giftsCount: number;
  interactionsCount: number;
  tasksCount: number;
  timeline: Array<{ id: string; date: string; title: string; kind: "interaction" | "gift" | "task" | "zettel" }>;
  sourceDocument?: SourceDocumentInfo | null;
};

export type GiftMock = {
  id: string;
  personId: string;
  direction: "given" | "received";
  title: string;
  occurredAt: string;
  satisfaction?: string | null;
  notes?: string | null;
};

export type NetworkEdgeMock = {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  relationType?: string | null;
  strength: number;
  notes?: string | null;
};

export const PEOPLE_MOCK: PersonMock[] = [
  {
    id: "person-jaemin",
    name: "김재민",
    nickname: "재민",
    layer: 15,
    groups: ["비즈니스", "친구"],
    status: "active",
    favorite: true,
    bio: "호떡집 비즈니스와 신메뉴 실험을 함께하는 파트너.",
    coreValue: "실행력과 감각이 빠르다.",
    daysSinceContact: 12,
    cadenceDays: 10,
    upcomingBirthday: "05-01",
    giftsCount: 3,
    interactionsCount: 18,
    tasksCount: 4,
    timeline: [
      { id: "interaction-1", date: "2026-04-23", title: "겨울 메뉴 미팅", kind: "interaction" },
      { id: "task-hotteok-research", date: "2026-04-22", title: "호떡집 리서치 Task 연결", kind: "task" },
      { id: "zettel-anxiety", date: "2026-04-15", title: "실존주의 메모 추천", kind: "zettel" },
      { id: "gift-1", date: "2026-02-11", title: "생일 선물 전달", kind: "gift" },
    ],
  },
  {
    id: "person-minseo",
    name: "박민서",
    nickname: "민서",
    layer: 5,
    groups: ["핵심", "교회"],
    status: "active",
    favorite: true,
    bio: "가장 깊은 대화를 나누는 핵심 인물.",
    coreValue: "정직하고 오래 보는 시선.",
    daysSinceContact: 3,
    cadenceDays: 7,
    giftsCount: 1,
    interactionsCount: 31,
    tasksCount: 2,
    timeline: [
      { id: "interaction-2", date: "2026-04-21", title: "주간 회고 대화", kind: "interaction" },
      { id: "zettel-life-ops-ui", date: "2026-04-10", title: "기도 노트 공유", kind: "zettel" },
    ],
  },
  {
    id: "person-eunji",
    name: "최은지",
    nickname: "은지",
    layer: 50,
    groups: ["친구", "커뮤니티"],
    status: "active",
    bio: "책과 전시에 대한 감상을 자주 나누는 친구.",
    coreValue: "섬세한 감각과 기록 습관.",
    daysSinceContact: 29,
    cadenceDays: 21,
    giftsCount: 2,
    interactionsCount: 11,
    tasksCount: 0,
    timeline: [
      { id: "interaction-3", date: "2026-03-25", title: "전시 관람 후기 공유", kind: "interaction" },
      { id: "gift-2", date: "2026-03-01", title: "도서 선물 추천", kind: "gift" },
    ],
  },
  {
    id: "person-daniel",
    name: "Daniel Kim",
    layer: 150,
    groups: ["직장"],
    status: "observing",
    bio: "이전 직장 동료. 간헐적으로 근황을 주고받는다.",
    coreValue: "차분한 실무 감각.",
    daysSinceContact: 87,
    cadenceDays: 60,
    giftsCount: 0,
    interactionsCount: 4,
    tasksCount: 1,
    timeline: [
      { id: "interaction-4", date: "2026-01-20", title: "근황 메시지", kind: "interaction" },
    ],
  },
];

export const GIFT_MOCK: GiftMock[] = [
  { id: "gift-1", personId: "person-jaemin", direction: "given", title: "원두 세트", occurredAt: "2026-02-11", satisfaction: "성공" },
  { id: "gift-2", personId: "person-eunji", direction: "received", title: "전시 도록", occurredAt: "2026-03-01", satisfaction: "대만족" },
  { id: "gift-3", personId: "person-minseo", direction: "given", title: "기도 노트", occurredAt: "2025-12-24", satisfaction: "성공" },
];

export const NETWORK_EDGE_MOCK: NetworkEdgeMock[] = [
  { id: "edge-1", sourcePersonId: "person-minseo", targetPersonId: "person-jaemin", relationType: "church", strength: 4 },
  { id: "edge-2", sourcePersonId: "person-jaemin", targetPersonId: "person-eunji", relationType: "creative", strength: 3 },
];

export function getPersonMock(id: string) {
  return PEOPLE_MOCK.find((person) => person.id === id) ?? null;
}

export function getNeedsContact() {
  return PEOPLE_MOCK.filter((person) => person.daysSinceContact > person.cadenceDays).sort(
    (a, b) => b.daysSinceContact - a.daysSinceContact,
  );
}

export function getLayerColor(layer: PersonMock["layer"]) {
  switch (layer) {
    case 5:
      return "hsl(var(--danger))";
    case 15:
      return "hsl(var(--warning))";
    case 50:
      return "hsl(var(--info))";
    default:
      return "hsl(var(--muted-foreground))";
  }
}
