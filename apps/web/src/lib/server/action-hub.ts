import "server-only";

import { ulid } from "ulidx";

import type { PendingCaptureMock, ProjectMock, TaskMock } from "@/lib/mock/action-hub";
import { getSession } from "@/lib/auth/session";
import { queryD1, executeD1 } from "@/lib/server/cloudflare-d1";

export type ActionHubSnapshot = {
  projects: ProjectMock[];
  tasks: TaskMock[];
  pendingCaptures: PendingCaptureMock[];
};

export type CaptureContext = {
  domain?: string;
  projectId?: string | null;
  personId?: string | null;
};

export type CaptureSuggestion = {
  captureId: string;
  status: "routed" | "pending";
  suggested: {
    domain: string;
    fields: Record<string, string | number | null>;
    confidence: number;
  };
  taskId?: string;
  snapshot: ActionHubSnapshot;
};

type UserRow = {
  id: string;
};

type ProjectRow = {
  id: string;
  title: string;
  kind: "project" | "area";
  category: string | null;
  icon: string | null;
  color: string | null;
  progress: number | null;
  targetDate: string | null;
  updatedAt: string;
};

type TaskRow = {
  id: string;
  projectId: string | null;
  title: string;
  kind: "development" | "writing" | "research";
  status: TaskMock["status"];
  priority: TaskMock["priority"];
  brainEnergy: TaskMock["brainEnergy"];
  dueAt: string | null;
  content: string | null;
  checklistTotal: number;
  checklistCompleted: number;
};

type TaskPersonRow = {
  taskId: string;
  personName: string;
};

type TaskZettelRow = {
  taskId: string;
  zettelTitle: string;
};

type CaptureRow = {
  id: string;
  rawText: string;
  suggestedDomain: string | null;
  confidence: number | null;
};

const STATUS_ORDER: TaskMock["status"][] = ["todo", "in_progress", "review", "done", "blocked"];

function startOfDayIso(daysAgo: number) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - daysAgo);
  return now.toISOString();
}

function formatDueLabel(date: string | null) {
  if (!date) return "상시";

  const target = new Date(`${date}T00:00:00+09:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays > 0) return `D-${diffDays}`;
  if (diffDays === 0) return "오늘";
  return `D+${Math.abs(diffDays)}`;
}

function formatRecentActivity(updatedAt: string) {
  const updated = new Date(updatedAt);
  return `${updated.toLocaleDateString("ko-KR")} 업데이트`;
}

async function resolveUser() {
  const session = await getSession();
  if (!session) {
    throw new Error("세션이 없습니다.");
  }

  const found = await queryD1<UserRow>("select id from users where email = ? limit 1", [session.email]);
  const existing = found.rows[0];
  if (existing) {
    return { id: existing.id, session };
  }

  const userId = "user-light-keeper";
  await executeD1(
    `insert into users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
     values (?, ?, ?, 'ko-KR', 'Asia/Seoul', '{"theme":"system"}', datetime('now'), datetime('now'))`,
    [userId, session.email, session.displayName],
  );

  return { id: userId, session };
}

function withDefaultContent(value: string | null) {
  return value?.trim() ? value : "세부 메모가 아직 없습니다.";
}

function inferDomain(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes("미팅") || normalized.includes("연락")) return "interaction";
  if (normalized.includes("메모") || normalized.includes("아이디어")) return "zettel";
  return "task";
}

function summarizeTitle(text: string) {
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

export async function getActionHubSnapshot(): Promise<ActionHubSnapshot> {
  const { id: userId } = await resolveUser();

  const [projectResult, taskResult, taskPeopleResult, taskZettelResult, captureResult] = await Promise.all([
    queryD1<ProjectRow>(
      `select id, title, kind, category, icon, color, progress, target_date as targetDate, updated_at as updatedAt
       from projects
       where user_id = ? and deleted_at is null
       order by pinned desc, display_order asc, created_at asc`,
      [userId],
    ),
    queryD1<TaskRow>(
      `select
         t.id,
         t.project_id as projectId,
         t.title,
         t.kind,
         t.status,
         t.priority,
         t.brain_energy as brainEnergy,
         t.due_at as dueAt,
         t.content,
         coalesce(sum(case when c.id is not null then 1 else 0 end), 0) as checklistTotal,
         coalesce(sum(case when c.is_completed = 1 then 1 else 0 end), 0) as checklistCompleted
       from tasks t
       left join checklists c on c.task_id = t.id
       where t.user_id = ? and t.deleted_at is null
       group by t.id
       order by case when t.project_id is null then 0 else 1 end asc, t.display_order asc, t.created_at asc`,
      [userId],
    ),
    queryD1<TaskPersonRow>(
      `select r.task_id as taskId, p.name as personName
       from task_people_relations r
       inner join tasks t on t.id = r.task_id
       inner join people p on p.id = r.person_id
       where t.user_id = ?`,
      [userId],
    ),
    queryD1<TaskZettelRow>(
      `select r.task_id as taskId, z.title as zettelTitle
       from task_zettel_relations r
       inner join tasks t on t.id = r.task_id
       inner join zettels z on z.id = r.zettel_id
       where t.user_id = ?`,
      [userId],
    ),
    queryD1<CaptureRow>(
      `select id, raw_text as rawText, suggested_domain as suggestedDomain, confidence
       from quick_captures
       where user_id = ? and status = 'pending'
       order by created_at desc`,
      [userId],
    ),
  ]);

  const taskPeopleMap = new Map<string, string[]>();
  for (const row of taskPeopleResult.rows) {
    const current = taskPeopleMap.get(row.taskId) ?? [];
    current.push(row.personName);
    taskPeopleMap.set(row.taskId, current);
  }

  const taskZettelMap = new Map<string, string[]>();
  for (const row of taskZettelResult.rows) {
    const current = taskZettelMap.get(row.taskId) ?? [];
    current.push(row.zettelTitle);
    taskZettelMap.set(row.taskId, current);
  }

  const projects: ProjectMock[] = projectResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    category: row.category ?? "미분류",
    icon: row.icon ?? "🛟",
    color: row.color ?? "gold",
    progress: row.progress ?? 0,
    dueLabel: formatDueLabel(row.targetDate),
    recentActivity: formatRecentActivity(row.updatedAt),
  }));

  const tasks: TaskMock[] = taskResult.rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    brainEnergy: row.brainEnergy,
    dueAt: row.dueAt ?? undefined,
    checklist: {
      total: Number(row.checklistTotal ?? 0),
      completed: Number(row.checklistCompleted ?? 0),
    },
    linkedPeople: taskPeopleMap.get(row.id) ?? [],
    linkedZettels: taskZettelMap.get(row.id) ?? [],
    content: withDefaultContent(row.content),
  }));

  const pendingCaptures: PendingCaptureMock[] = captureResult.rows.map((row) => ({
    id: row.id,
    text: row.rawText,
    suggestedDomain: row.suggestedDomain ?? "task",
    confidence: Number(row.confidence ?? 0.5),
  }));

  return {
    projects,
    tasks,
    pendingCaptures,
  };
}

export async function getActionHubProject(projectId: string) {
  const snapshot = await getActionHubSnapshot();
  return snapshot.projects.find((project) => project.id === projectId) ?? null;
}

export async function getActionHubTask(projectId: string, taskId: string) {
  const snapshot = await getActionHubSnapshot();
  return snapshot.tasks.find((task) => task.id === taskId && task.projectId === projectId) ?? null;
}

export async function ingestActionHubCapture(text: string, context?: CaptureContext): Promise<CaptureSuggestion> {
  const payload = text.trim();
  if (!payload) {
    throw new Error("텍스트가 비어 있습니다.");
  }

  const { id: userId } = await resolveUser();
  const domain = inferDomain(payload);
  const captureId = ulid();
  const confidence = domain === "task" ? 0.83 : 0.74;
  const suggested = {
    domain,
    fields: {
      title: summarizeTitle(payload),
      priority: "P2",
      projectId: context?.projectId ?? null,
    },
    confidence,
  };

  let taskId: string | undefined;

  if (domain === "task") {
    taskId = ulid();
    await executeD1(
      `insert into tasks
        (id, user_id, project_id, title, kind, content, status, priority, brain_energy, due_at, display_order, created_at, updated_at)
       values (?, ?, ?, ?, 'research', ?, 'todo', 'P2', 'normal', null, 0, datetime('now'), datetime('now'))`,
      [taskId, userId, context?.projectId ?? null, summarizeTitle(payload), payload],
    );

    await executeD1(
      `insert into checklists
        (id, task_id, content, is_completed, display_order, completed_at, created_at)
       values (?, ?, '프로젝트 라우팅', 0, 0, null, datetime('now'))`,
      [ulid(), taskId],
    );
  } else {
    await executeD1(
      `insert into quick_captures
        (id, user_id, raw_text, status, suggested_domain, suggested_fields, confidence, created_at, updated_at)
       values (?, ?, ?, 'pending', ?, ?, ?, datetime('now'), datetime('now'))`,
      [captureId, userId, payload, domain, JSON.stringify(suggested.fields), confidence],
    );
  }

  const snapshot = await getActionHubSnapshot();

  return {
    captureId,
    status: domain === "task" ? "routed" : "pending",
    suggested,
    taskId,
    snapshot,
  };
}

export async function dismissPendingCapture(captureId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `update quick_captures
     set status = 'dismissed', updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [captureId, userId],
  );

  return getActionHubSnapshot();
}

export async function routeInboxTaskToProject(taskId: string, projectId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `update tasks
     set project_id = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [projectId, taskId, userId],
  );

  return getActionHubSnapshot();
}

export async function cycleActionHubTaskStatus(taskId: string) {
  const { id: userId } = await resolveUser();
  const found = await queryD1<{ status: TaskMock["status"] }>(
    `select status from tasks where id = ? and user_id = ? limit 1`,
    [taskId, userId],
  );
  const current = found.rows[0];
  if (!current) {
    throw new Error("태스크를 찾지 못했습니다.");
  }

  const currentIndex = STATUS_ORDER.indexOf(current.status);
  const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];

  await executeD1(
    `update tasks
     set status = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [nextStatus, taskId, userId],
  );

  return getActionHubSnapshot();
}

export async function updateActionHubTaskTitle(taskId: string, title: string) {
  const { id: userId } = await resolveUser();
  const nextTitle = title.trim();
  if (!nextTitle) {
    throw new Error("제목은 비워둘 수 없습니다.");
  }

  await executeD1(
    `update tasks
     set title = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [nextTitle, taskId, userId],
  );

  return getActionHubSnapshot();
}

export async function updateActionHubTaskContent(taskId: string, content: string) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `update tasks
     set content = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [content.trim(), taskId, userId],
  );

  return getActionHubSnapshot();
}

export async function seedActionHubSupportData() {
  const { id: userId, session } = await resolveUser();

  await executeD1(
    `insert or ignore into people
      (id, user_id, name, nickname, groups, dunbar_layer, core_value, bio, last_contacted_at, contact_cadence_days, status, is_favorite, created_at, updated_at)
     values
      ('person-jaemin', ?, '김재민', '재민', '["비즈니스","친구"]', 15, '실행력과 감각이 빠르다.', '호떡집 비즈니스와 신메뉴 실험을 함께하는 파트너.', ?, 10, 'active', 1, datetime('now'), datetime('now')),
      ('person-minseo', ?, '박민서', '민서', '["핵심","교회"]', 5, '정직하고 오래 보는 시선.', '가장 깊은 대화를 나누는 핵심 인물.', ?, 7, 'active', 1, datetime('now'), datetime('now')),
      ('person-eunji', ?, '최은지', '은지', '["친구","커뮤니티"]', 50, '섬세한 감각과 기록 습관.', '책과 전시에 대한 감상을 자주 나누는 친구.', ?, 21, 'active', 0, datetime('now'), datetime('now'))`,
    [userId, startOfDayIso(12), userId, startOfDayIso(3), userId, startOfDayIso(29)],
  );

  await executeD1(
    `insert or ignore into zettels
      (id, user_id, title, slug, content, content_text, summary, type, category, pinned, created_at, updated_at)
     values
      ('zettel-anxiety', ?, '존재의 불안과 실존주의', 'existential-anxiety', '실존적 불안은 방향 상실이 아니라 자유의 무게를 체감하는 순간에 발생한다.', '실존적 불안은 방향 상실이 아니라 자유의 무게를 체감하는 순간에 발생한다.', '불안은 회피 대상이 아니라 선택의 자유를 드러내는 신호다.', 'permanent', '실존주의', 1, datetime('now'), datetime('now')),
      ('zettel-life-ops-ui', ?, 'Life Ops 화면 구조 메모', 'life-ops-ui', 'Daily Command Center의 흐름을 날짜-에너지-습관-저널 순으로 유지한다.', 'Daily Command Center의 흐름을 날짜-에너지-습관-저널 순으로 유지한다.', 'Life Ops UI 구조 노트.', 'fleeting', '제품 설계', 0, datetime('now'), datetime('now')),
      ('zettel-hotteok', ?, '호떡집 본점', 'hotteok-hq', '메뉴 실험과 대화가 동시에 발생하는 핵심 장소 메모.', '메뉴 실험과 대화가 동시에 발생하는 핵심 장소 메모.', '호떡집 운영 관련 메모.', 'fleeting', '비즈니스', 0, datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into projects
      (id, user_id, title, slug, description, icon, color, kind, status, category, target_date, progress, pinned, display_order, created_at, updated_at)
     values
      ('project-modu-works', ?, 'MODU WORKS', 'modu-works', '프로젝트 라이트 하우스 구현 트랙.', '🛟', 'gold', 'project', 'active', '개발', '2026-04-25', 62, 1, 0, datetime('now'), datetime('now')),
      ('project-trauma-repair', ?, '트라우마 수리공방', 'trauma-repair', '장문 집필 프로젝트.', '✍️', 'sky', 'project', 'active', '집필', '2026-04-28', 41, 0, 1, datetime('now'), datetime('now')),
      ('area-hotteok-business', ?, '호떡집 컨시어지', 'hotteok-concierge', '비즈니스 운영 영역.', '🥞', 'orange', 'area', 'active', '비즈니스', null, 55, 0, 2, datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into tasks
      (id, user_id, project_id, title, kind, content, status, priority, brain_energy, due_at, display_order, created_at, updated_at)
     values
      ('task-p1-shell', ?, 'project-modu-works', 'P1 Shared Layer 마감 정리', 'development', '공용 상호작용 레이어를 마무리하고 다음 슬라이스 전환 준비.', 'review', 'P1', 'hyper_focus', '2026-04-25', 0, datetime('now'), datetime('now')),
      ('task-life-ops', ?, 'project-modu-works', 'Life Ops Daily Command Center UI 보강', 'development', '날짜 라우트, Heatmap, 저널링 경험을 정리한다.', 'in_progress', 'P1', 'normal', '2026-04-26', 1, datetime('now'), datetime('now')),
      ('task-prm', ?, 'project-modu-works', 'PRM Card Grid와 Drawer 연결', 'development', '관계 건강도, 타임라인, 선물 보드 진입점 구현.', 'done', 'P2', 'normal', '2026-04-23', 2, datetime('now'), datetime('now')),
      ('task-episode-25', ?, 'project-trauma-repair', '25화 결말 장면 다시 쓰기', 'writing', '세리프 중심 장문 집필. 감정 고조와 정리 리듬을 조율한다.', 'in_progress', 'P1', 'hyper_focus', '2026-04-28', 0, datetime('now'), datetime('now')),
      ('task-hotteok-research', ?, 'area-hotteok-business', '호떡집 겨울 신메뉴 리서치', 'research', '경쟁 메뉴, 가격 정책, SNS 레퍼런스를 조사한다.', 'todo', 'P2', 'routine', '2026-04-29', 0, datetime('now'), datetime('now')),
      ('task-inbox-capture', ?, null, '재민이랑 월요일 호떡집 미팅', 'research', 'Quick Capture에서 넘어온 미분류 항목.', 'todo', 'P2', 'normal', '2026-04-28', 0, datetime('now'), datetime('now'))`,
    [userId, userId, userId, userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into checklists
      (id, task_id, content, is_completed, display_order, completed_at, created_at)
     values
      ('check-task-p1-shell-1', 'task-p1-shell', '쉘 라우트 점검', 1, 0, datetime('now'), datetime('now')),
      ('check-task-p1-shell-2', 'task-p1-shell', 'Hotkey 테스트', 1, 1, datetime('now'), datetime('now')),
      ('check-task-p1-shell-3', 'task-p1-shell', 'Drawer 링크 점검', 1, 2, datetime('now'), datetime('now')),
      ('check-task-p1-shell-4', 'task-p1-shell', 'Toast 검증', 1, 3, datetime('now'), datetime('now')),
      ('check-task-p1-shell-5', 'task-p1-shell', 'Palette 검색 테스트', 1, 4, datetime('now'), datetime('now')),
      ('check-task-p1-shell-6', 'task-p1-shell', '문서 반영', 0, 5, null, datetime('now')),
      ('check-task-life-ops-1', 'task-life-ops', 'Daily route 정리', 1, 0, datetime('now'), datetime('now')),
      ('check-task-life-ops-2', 'task-life-ops', 'Heatmap 연결', 1, 1, datetime('now'), datetime('now')),
      ('check-task-life-ops-3', 'task-life-ops', '저널 UI polish', 0, 2, null, datetime('now')),
      ('check-task-life-ops-4', 'task-life-ops', '트렌드 카드 보강', 0, 3, null, datetime('now')),
      ('check-task-prm-1', 'task-prm', 'Person grid', 1, 0, datetime('now'), datetime('now')),
      ('check-task-prm-2', 'task-prm', 'Drawer 연결', 1, 1, datetime('now'), datetime('now')),
      ('check-task-prm-3', 'task-prm', 'Timeline 카드', 1, 2, datetime('now'), datetime('now')),
      ('check-task-prm-4', 'task-prm', 'Graph 진입점', 1, 3, datetime('now'), datetime('now')),
      ('check-task-prm-5', 'task-prm', 'Gift 보드', 1, 4, datetime('now'), datetime('now')),
      ('check-task-episode-25-1', 'task-episode-25', '씬 구조 재정리', 1, 0, datetime('now'), datetime('now')),
      ('check-task-episode-25-2', 'task-episode-25', '감정선 리듬 조정', 0, 1, null, datetime('now')),
      ('check-task-episode-25-3', 'task-episode-25', '후반부 세리프 재작성', 0, 2, null, datetime('now')),
      ('check-task-hotteok-research-1', 'task-hotteok-research', '경쟁 메뉴 조사', 0, 0, null, datetime('now')),
      ('check-task-hotteok-research-2', 'task-hotteok-research', '가격 비교', 0, 1, null, datetime('now')),
      ('check-task-hotteok-research-3', 'task-hotteok-research', 'SNS 레퍼런스 수집', 0, 2, null, datetime('now')),
      ('check-task-hotteok-research-4', 'task-hotteok-research', '정리 문서 작성', 0, 3, null, datetime('now')),
      ('check-task-hotteok-research-5', 'task-hotteok-research', '실험안 선택', 0, 4, null, datetime('now')),
      ('check-task-inbox-capture-1', 'task-inbox-capture', '프로젝트 라우팅', 0, 0, null, datetime('now'))`,
  );

  await executeD1(
    `insert or ignore into task_people_relations
      (task_id, person_id, role_context, created_at)
     values
      ('task-p1-shell', 'person-jaemin', '리뷰 파트너', datetime('now')),
      ('task-life-ops', 'person-minseo', 'Life Ops 피드백', datetime('now')),
      ('task-prm', 'person-jaemin', '도메인 연결', datetime('now')),
      ('task-prm', 'person-eunji', '관계 카드 테스트', datetime('now')),
      ('task-hotteok-research', 'person-jaemin', '메뉴 실험', datetime('now')),
      ('task-inbox-capture', 'person-jaemin', '미팅 대상', datetime('now'))`,
  );

  await executeD1(
    `insert or ignore into task_zettel_relations
      (task_id, zettel_id, created_at)
     values
      ('task-p1-shell', 'zettel-anxiety', datetime('now')),
      ('task-life-ops', 'zettel-life-ops-ui', datetime('now')),
      ('task-episode-25', 'zettel-anxiety', datetime('now')),
      ('task-hotteok-research', 'zettel-hotteok', datetime('now'))`,
  );

  await executeD1(
    `insert or ignore into quick_captures
      (id, user_id, raw_text, status, suggested_domain, suggested_fields, confidence, created_at, updated_at)
     values
      ('capture-1', ?, '호떡집 겨울 메뉴 회의 메모 정리', 'pending', 'task', '{"title":"호떡집 겨울 메뉴 회의 메모 정리"}', 0.68, datetime('now'), datetime('now')),
      ('capture-2', ?, '민서랑 나눈 실존주의 대화 메모', 'pending', 'zettel', '{"title":"민서랑 나눈 실존주의 대화 메모"}', 0.66, datetime('now'), datetime('now'))`,
    [userId, userId],
  );

  return {
    userId,
    email: session.email,
  };
}
