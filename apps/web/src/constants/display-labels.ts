export type DisplayDomainKey = "dashboard" | "action-hub" | "vault" | "prm" | "life-ops" | "settings";

export const DOMAIN_LABELS: Record<DisplayDomainKey, string> = {
  dashboard: "오늘 보기",
  "action-hub": "작업실",
  vault: "지식금고",
  prm: "관계",
  "life-ops": "생활기록",
  settings: "설정",
};

export const ROUTE_SEGMENT_LABELS: Record<string, string> = {
  dashboard: DOMAIN_LABELS.dashboard,
  "action-hub": DOMAIN_LABELS["action-hub"],
  vault: DOMAIN_LABELS.vault,
  prm: DOMAIN_LABELS.prm,
  "life-ops": DOMAIN_LABELS["life-ops"],
  settings: DOMAIN_LABELS.settings,
  inbox: "수신함",
  archive: "보관함",
  entries: "일일 기록",
  diaries: "저널",
  meditations: "묵상",
  habits: "습관",
  workouts: "운동",
  trends: "흐름",
  career: "커리어",
  profile: "프로필",
  appearance: "화면",
  data: "데이터",
  "source-mapping": "원본 컬럼",
  integrations: "연동",
  ai: "AI",
  shortcuts: "단축키",
  zettels: "지식",
  media: "미디어",
  assets: "자산",
  places: "장소",
  graph: "그래프",
  gifts: "선물",
  "hit-them-up": "연락 필요",
  tasks: "작업",
  calendar: "캘린더",
  edit: "편집",
  list: "목록",
  new: "새로 만들기",
};

export const UTILITY_LABELS = {
  account: "계정",
  commandPalette: "빠른 실행",
  notifications: "알림",
  quickCapture: "빠른 캡처",
  search: "검색",
} as const;

export const CAPTURE_DOMAIN_LABELS: Record<string, string> = {
  task: "작업",
  zettel: "지식",
  interaction: "상호작용",
  diary_entry: "일기",
  habit_log: "습관",
  media_log: "미디어",
};

export function getCaptureDomainLabel(value: string | null | undefined) {
  if (!value) return "미분류";
  return CAPTURE_DOMAIN_LABELS[value] ?? value;
}
