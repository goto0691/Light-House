export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked";
export type TaskKind = "development" | "writing" | "research";

export type TaskMock = {
  id: string;
  projectId: string | null;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: "P1" | "P2" | "P3";
  brainEnergy: "hyper_focus" | "normal" | "routine";
  dueAt?: string;
  checklist: { total: number; completed: number };
  checklistItems: Array<{ id: string; content: string; completed: boolean }>;
  linkedPeople: string[];
  linkedZettels: string[];
  content: string;
};

export type ProjectMock = {
  id: string;
  title: string;
  kind: "project" | "area";
  category: string;
  icon: string;
  color: string;
  progress: number;
  dueLabel: string;
  recentActivity: string;
};

export type PendingCaptureMock = {
  id: string;
  text: string;
  suggestedDomain: string;
  confidence: number;
};

export type ActionHubReference = {
  id: string;
  title: string;
};

export const PROJECTS_MOCK: ProjectMock[] = [
  {
    id: "project-modu-works",
    title: "MODU WORKS",
    kind: "project",
    category: "개발",
    icon: "🛟",
    color: "gold",
    progress: 62,
    dueLabel: "D-9",
    recentActivity: "P1 Shared Layer 마감",
  },
  {
    id: "project-trauma-repair",
    title: "트라우마 수리공방",
    kind: "project",
    category: "집필",
    icon: "✍️",
    color: "sky",
    progress: 41,
    dueLabel: "D-18",
    recentActivity: "25화 초안 수정 중",
  },
  {
    id: "area-hotteok-business",
    title: "호떡집 컨시어지",
    kind: "area",
    category: "비즈니스",
    icon: "🥞",
    color: "orange",
    progress: 55,
    dueLabel: "상시",
    recentActivity: "겨울 메뉴 리서치",
  },
];

export const TASKS_MOCK: TaskMock[] = [
  {
    id: "task-p1-shell",
    projectId: "project-modu-works",
    title: "P1 Shared Layer 마감 정리",
    kind: "development",
    status: "review",
    priority: "P1",
    brainEnergy: "hyper_focus",
    dueAt: "2026-04-25",
    checklist: { total: 6, completed: 5 },
    checklistItems: [
      { id: "check-task-p1-shell-1", content: "쉘 라우트 점검", completed: true },
      { id: "check-task-p1-shell-2", content: "Hotkey 테스트", completed: true },
      { id: "check-task-p1-shell-3", content: "Drawer 링크 점검", completed: true },
      { id: "check-task-p1-shell-4", content: "Toast 검증", completed: true },
      { id: "check-task-p1-shell-5", content: "Palette 검색 테스트", completed: true },
      { id: "check-task-p1-shell-6", content: "문서 반영", completed: false },
    ],
    linkedPeople: ["김재민"],
    linkedZettels: ["존재의 불안과 실존주의"],
    content: "공용 상호작용 레이어를 마무리하고 다음 슬라이스 전환 준비.",
  },
  {
    id: "task-life-ops",
    projectId: "project-modu-works",
    title: "Life Ops Daily Command Center UI 보강",
    kind: "development",
    status: "in_progress",
    priority: "P1",
    brainEnergy: "normal",
    dueAt: "2026-04-26",
    checklist: { total: 4, completed: 2 },
    checklistItems: [
      { id: "check-task-life-ops-1", content: "Daily route 정리", completed: true },
      { id: "check-task-life-ops-2", content: "Heatmap 연결", completed: true },
      { id: "check-task-life-ops-3", content: "저널 UI polish", completed: false },
      { id: "check-task-life-ops-4", content: "트렌드 카드 보강", completed: false },
    ],
    linkedPeople: ["박민서"],
    linkedZettels: ["Life Ops 화면 구조 메모"],
    content: "날짜 라우트, Heatmap, 저널링 경험을 정리한다.",
  },
  {
    id: "task-prm",
    projectId: "project-modu-works",
    title: "PRM Card Grid와 Drawer 연결",
    kind: "development",
    status: "done",
    priority: "P2",
    brainEnergy: "normal",
    dueAt: "2026-04-23",
    checklist: { total: 5, completed: 5 },
    checklistItems: [
      { id: "check-task-prm-1", content: "Person grid", completed: true },
      { id: "check-task-prm-2", content: "Drawer 연결", completed: true },
      { id: "check-task-prm-3", content: "Timeline 카드", completed: true },
      { id: "check-task-prm-4", content: "Graph 진입점", completed: true },
      { id: "check-task-prm-5", content: "Gift 보드", completed: true },
    ],
    linkedPeople: ["김재민", "최은지"],
    linkedZettels: [],
    content: "관계 건강도, 타임라인, 선물 보드 진입점 구현.",
  },
  {
    id: "task-episode-25",
    projectId: "project-trauma-repair",
    title: "25화 결말 장면 다시 쓰기",
    kind: "writing",
    status: "in_progress",
    priority: "P1",
    brainEnergy: "hyper_focus",
    dueAt: "2026-04-28",
    checklist: { total: 3, completed: 1 },
    checklistItems: [
      { id: "check-task-episode-25-1", content: "씬 구조 재정리", completed: true },
      { id: "check-task-episode-25-2", content: "감정선 리듬 조정", completed: false },
      { id: "check-task-episode-25-3", content: "후반부 세리프 재작성", completed: false },
    ],
    linkedPeople: [],
    linkedZettels: ["존재의 불안과 실존주의"],
    content: "세리프 중심 장문 집필. 감정 고조와 정리 리듬을 조율한다.",
  },
  {
    id: "task-hotteok-research",
    projectId: "area-hotteok-business",
    title: "호떡집 겨울 신메뉴 리서치",
    kind: "research",
    status: "todo",
    priority: "P2",
    brainEnergy: "routine",
    dueAt: "2026-04-29",
    checklist: { total: 5, completed: 0 },
    checklistItems: [
      { id: "check-task-hotteok-research-1", content: "경쟁 메뉴 조사", completed: false },
      { id: "check-task-hotteok-research-2", content: "가격 비교", completed: false },
      { id: "check-task-hotteok-research-3", content: "SNS 레퍼런스 수집", completed: false },
      { id: "check-task-hotteok-research-4", content: "정리 문서 작성", completed: false },
      { id: "check-task-hotteok-research-5", content: "실험안 선택", completed: false },
    ],
    linkedPeople: ["김재민"],
    linkedZettels: ["호떡집 본점"],
    content: "경쟁 메뉴, 가격 정책, SNS 레퍼런스를 조사한다.",
  },
  {
    id: "task-inbox-capture",
    projectId: null,
    title: "재민이랑 월요일 호떡집 미팅",
    kind: "research",
    status: "todo",
    priority: "P2",
    brainEnergy: "normal",
    dueAt: "2026-04-28",
    checklist: { total: 1, completed: 0 },
    checklistItems: [{ id: "check-task-inbox-capture-1", content: "프로젝트 라우팅", completed: false }],
    linkedPeople: ["김재민"],
    linkedZettels: [],
    content: "Quick Capture에서 넘어온 미분류 항목.",
  },
];

export const PENDING_CAPTURES: PendingCaptureMock[] = [
  {
    id: "capture-1",
    text: "호떡집 겨울 메뉴 회의 메모 정리",
    suggestedDomain: "task",
    confidence: 0.68,
  },
  {
    id: "capture-2",
    text: "민서랑 나눈 실존주의 대화 메모",
    suggestedDomain: "zettel",
    confidence: 0.66,
  },
];

export function getProjectMock(id: string) {
  return PROJECTS_MOCK.find((project) => project.id === id) ?? null;
}

export function getTaskMock(id: string) {
  return TASKS_MOCK.find((task) => task.id === id) ?? null;
}

export function getTasksByProject(projectId: string) {
  return TASKS_MOCK.filter((task) => task.projectId === projectId);
}

export function getInboxTasks() {
  return TASKS_MOCK.filter((task) => task.projectId === null);
}

export function groupTasksByStatus(projectId: string) {
  const buckets: Record<TaskStatus, TaskMock[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
    blocked: [],
  };

  for (const task of getTasksByProject(projectId)) {
    buckets[task.status].push(task);
  }

  return buckets;
}
