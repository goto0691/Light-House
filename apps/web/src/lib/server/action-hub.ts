import "server-only";

import { ulid } from "ulidx";

import type { ActionHubReference, PendingCaptureMock, ProjectMock, TaskMock } from "@/lib/mock/action-hub";
import { getSession } from "@/lib/auth/session";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { analyzeQuickCaptureWithAI } from "@/lib/server/gemini";
import { attachTaskRelationsFromContent } from "@/lib/server/relations";
import { syncTagsForEntity } from "@/lib/server/tagging";

export type ActionHubSnapshot = {
  projects: ProjectMock[];
  tasks: TaskMock[];
  pendingCaptures: PendingCaptureMock[];
  referencePeople: ActionHubReference[];
  referenceZettels: ActionHubReference[];
};

export type CaptureContext = {
  domain?: string;
  projectId?: string | null;
  personId?: string | null;
  forceDomain?: "task" | "interaction" | "zettel" | "diary_entry" | "habit_log" | "media_log" | "workout_log" | null;
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

type UserRow = { id: string };
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
type TaskPersonRow = { taskId: string; personName: string };
type TaskZettelRow = { taskId: string; zettelTitle: string };
type ChecklistRow = { id: string; taskId: string; content: string; isCompleted: number | null };
type ReferenceRow = { id: string; title: string };
type CaptureRow = { id: string; rawText: string; suggestedDomain: string | null; confidence: number | null };

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
  return `${new Date(updatedAt).toLocaleDateString("ko-KR")} 업데이트`;
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

async function resolveUser() {
  const session = await getSession();
  if (!session) throw new Error("세션이 없습니다.");

  const found = await queryD1<UserRow>("select id from users where email = ? limit 1", [session.email]);
  const existing = found.rows[0];
  if (existing) return { id: existing.id, session };

  const userId = "user-light-keeper";
  await executeD1(
    `insert into users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
     values (?, ?, ?, 'ko-KR', 'Asia/Seoul', '{"theme":"system"}', datetime('now'), datetime('now'))`,
    [userId, session.email, session.displayName],
  );
  return { id: userId, session };
}

async function refreshProjectProgress(userId: string, projectId: string) {
  const stats = await queryD1<{ total: number | null; done: number | null }>(
    `select count(*) as total, sum(case when status = 'done' then 1 else 0 end) as done
     from tasks
     where user_id = ? and project_id = ? and deleted_at is null`,
    [userId, projectId],
  );
  const total = Number(stats.rows[0]?.total ?? 0);
  const done = Number(stats.rows[0]?.done ?? 0);
  const progress = total ? Math.round((done / total) * 100) : 0;

  await executeD1(
    `update projects
     set progress = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [progress, projectId, userId],
  );
}

export async function getActionHubSnapshot(): Promise<ActionHubSnapshot> {
  const { id: userId } = await resolveUser();

  const [projectResult, taskResult, taskPeopleResult, taskZettelResult, checklistResult, captureResult, referencePeopleResult, referenceZettelsResult] = await Promise.all([
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
    queryD1<ChecklistRow>(
      `select c.id, c.task_id as taskId, c.content, c.is_completed as isCompleted
       from checklists c
       inner join tasks t on t.id = c.task_id
       where t.user_id = ?
       order by c.display_order asc, c.created_at asc`,
      [userId],
    ),
    queryD1<CaptureRow>(
      `select id, raw_text as rawText, suggested_domain as suggestedDomain, confidence
       from quick_captures
       where user_id = ? and status = 'pending'
       order by created_at desc`,
      [userId],
    ),
    queryD1<ReferenceRow>(`select id, name as title from people where user_id = ? and deleted_at is null order by is_favorite desc, name asc`, [userId]),
    queryD1<ReferenceRow>(`select id, title from zettels where user_id = ? and deleted_at is null order by pinned desc, updated_at desc`, [userId]),
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

  const checklistMap = new Map<string, TaskMock["checklistItems"]>();
  for (const row of checklistResult.rows) {
    const current = checklistMap.get(row.taskId) ?? [];
    current.push({ id: row.id, content: row.content, completed: Boolean(row.isCompleted) });
    checklistMap.set(row.taskId, current);
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
    checklistItems: checklistMap.get(row.id) ?? [],
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
    referencePeople: referencePeopleResult.rows,
    referenceZettels: referenceZettelsResult.rows,
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
  if (!payload) throw new Error("텍스트가 비어 있습니다.");

  const { id: userId } = await resolveUser();
  const aiAnalysis = await analyzeQuickCaptureWithAI({ text: payload, context });
  const forcedDomain = context?.forceDomain ?? null;
  const domain =
    forcedDomain ||
    (aiAnalysis?.domain === "task" || aiAnalysis?.domain === "interaction" || aiAnalysis?.domain === "zettel" ? aiAnalysis.domain : inferDomain(payload));
  const captureId = ulid();
  const confidence = aiAnalysis?.confidence ?? (domain === "task" ? 0.83 : 0.74);
  const suggested = {
    domain,
    fields: {
      title: aiAnalysis?.title?.trim() || summarizeTitle(payload),
      priority: aiAnalysis?.priority ?? "P2",
      projectId: context?.projectId ?? null,
      summary: aiAnalysis?.summary?.trim() || payload,
      dueAt: aiAnalysis?.dueAt ?? null,
      brainEnergy: aiAnalysis?.brainEnergy ?? "normal",
    },
    confidence,
  };

  let taskId: string | undefined;
  if (domain === "task" && (aiAnalysis?.shouldAutoRoute ?? true)) {
    taskId = ulid();
    const taskContent = aiAnalysis?.summary?.trim() || payload;
    await executeD1(
      `insert into tasks
        (id, user_id, project_id, title, kind, content, status, priority, brain_energy, due_at, display_order, created_at, updated_at)
       values (?, ?, ?, ?, 'research', ?, 'todo', 'P2', 'normal', null, 0, datetime('now'), datetime('now'))`,
      [taskId, userId, context?.projectId ?? null, aiAnalysis?.title?.trim() || summarizeTitle(payload), taskContent],
    );
    await executeD1(
      `update tasks
       set priority = ?, brain_energy = ?, due_at = coalesce(?, due_at), updated_at = datetime('now')
       where id = ? and user_id = ?`,
      [aiAnalysis?.priority ?? "P2", aiAnalysis?.brainEnergy ?? "normal", aiAnalysis?.dueAt ?? null, taskId, userId],
    );
    await executeD1(
      `insert into checklists
        (id, task_id, content, is_completed, display_order, completed_at, created_at)
       values (?, ?, '프로젝트 라우팅', 0, 0, null, datetime('now'))`,
      [ulid(), taskId],
    );
    await syncTagsForEntity({
      userId,
      taggableType: "task",
      taggableId: taskId,
      content: taskContent,
    });
    await attachTaskRelationsFromContent({
      userId,
      taskId,
      content: taskContent,
    });
  } else {
    await executeD1(
      `insert into quick_captures
        (id, user_id, raw_text, status, suggested_domain, suggested_fields, confidence, created_at, updated_at)
       values (?, ?, ?, 'pending', ?, ?, ?, datetime('now'), datetime('now'))`,
      [captureId, userId, payload, domain, JSON.stringify(suggested.fields), confidence],
    );
  }

  return {
    captureId,
    status: domain === "task" ? "routed" : "pending",
    suggested,
    taskId,
    snapshot: await getActionHubSnapshot(),
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
  await refreshProjectProgress(userId, projectId);
  return getActionHubSnapshot();
}

export async function cycleActionHubTaskStatus(taskId: string) {
  const { id: userId } = await resolveUser();
  const found = await queryD1<{ status: TaskMock["status"]; projectId: string | null }>(
    `select status, project_id as projectId from tasks where id = ? and user_id = ? limit 1`,
    [taskId, userId],
  );
  const current = found.rows[0];
  if (!current) throw new Error("태스크를 찾지 못했습니다.");

  const currentIndex = STATUS_ORDER.indexOf(current.status);
  const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];
  await executeD1(
    `update tasks
     set status = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [nextStatus, taskId, userId],
  );
  if (current.projectId) {
    await refreshProjectProgress(userId, current.projectId);
  }
  return getActionHubSnapshot();
}

export async function updateActionHubTaskTitle(taskId: string, title: string) {
  const { id: userId } = await resolveUser();
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error("제목은 비워둘 수 없습니다.");
  await executeD1(`update tasks set title = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [nextTitle, taskId, userId]);
  return getActionHubSnapshot();
}

export async function updateActionHubTaskContent(taskId: string, content: string) {
  const { id: userId } = await resolveUser();
  const nextContent = content.trim();
  await executeD1(`update tasks set content = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [nextContent, taskId, userId]);
  await syncTagsForEntity({
    userId,
    taggableType: "task",
    taggableId: taskId,
    content: nextContent,
  });
  await attachTaskRelationsFromContent({
    userId,
    taskId,
    content: nextContent,
  });
  return getActionHubSnapshot();
}

export async function createActionHubProject(input: {
  title: string;
  kind?: ProjectMock["kind"];
  category?: string;
  icon?: string;
  color?: string;
  targetDate?: string | null;
}) {
  const { id: userId } = await resolveUser();
  const title = input.title.trim();
  if (!title) throw new Error("프로젝트 제목은 비워둘 수 없습니다.");
  const id = ulid();
  await executeD1(
    `insert into projects
      (id, user_id, title, slug, description, icon, color, kind, status, category, target_date, progress, pinned, display_order, created_at, updated_at)
     values (?, ?, ?, ?, '', ?, ?, ?, 'active', ?, ?, 0, 0, 999, datetime('now'), datetime('now'))`,
    [id, userId, title, `${slugify(title)}-${id.slice(-6).toLowerCase()}`, input.icon?.trim() || "🛟", input.color?.trim() || "gold", input.kind ?? "project", input.category?.trim() || "미분류", input.targetDate ?? null],
  );
  return getActionHubSnapshot();
}

export async function createChecklistItem(taskId: string, content: string) {
  const { id: userId } = await resolveUser();
  const cleaned = content.trim();
  if (!cleaned) throw new Error("체크리스트 내용은 비워둘 수 없습니다.");

  const task = await queryD1<{ id: string }>("select id from tasks where id = ? and user_id = ? and deleted_at is null limit 1", [taskId, userId]);
  if (!task.rows[0]) throw new Error("태스크를 찾지 못했습니다.");

  const maxOrder = await queryD1<{ nextOrder: number | null }>(
    `select coalesce(max(display_order), -1) + 1 as nextOrder from checklists where task_id = ?`,
    [taskId],
  );
  await executeD1(
    `insert into checklists (id, task_id, content, is_completed, display_order, completed_at, created_at)
     values (?, ?, ?, 0, ?, null, datetime('now'))`,
    [ulid(), taskId, cleaned, Number(maxOrder.rows[0]?.nextOrder ?? 0)],
  );
  return getActionHubSnapshot();
}

export async function toggleChecklistItem(checklistId: string) {
  const { id: userId } = await resolveUser();
  const found = await queryD1<{ isCompleted: number | null; taskId: string; projectId: string | null }>(
    `select c.is_completed as isCompleted, c.task_id as taskId, t.project_id as projectId
     from checklists c
     inner join tasks t on t.id = c.task_id
     where c.id = ? and t.user_id = ?
     limit 1`,
    [checklistId, userId],
  );
  const item = found.rows[0];
  if (!item) throw new Error("체크리스트를 찾지 못했습니다.");

  const next = item.isCompleted ? 0 : 1;
  await executeD1(
    `update checklists
     set is_completed = ?, completed_at = case when ? = 1 then datetime('now') else null end
     where id = ?`,
    [next, next, checklistId],
  );
  if (item.projectId) {
    await refreshProjectProgress(userId, item.projectId);
  }
  return getActionHubSnapshot();
}

export async function deleteChecklistItem(checklistId: string) {
  const { id: userId } = await resolveUser();
  const found = await queryD1<{ projectId: string | null }>(
    `select t.project_id as projectId
     from checklists c
     inner join tasks t on t.id = c.task_id
     where c.id = ? and t.user_id = ?
     limit 1`,
    [checklistId, userId],
  );
  if (!found.rows[0]) throw new Error("체크리스트를 찾지 못했습니다.");
  await executeD1(`delete from checklists where id = ?`, [checklistId]);
  if (found.rows[0].projectId) {
    await refreshProjectProgress(userId, found.rows[0].projectId);
  }
  return getActionHubSnapshot();
}

export async function attachTaskPerson(taskId: string, personId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `insert or ignore into task_people_relations (task_id, person_id, role_context, created_at)
     select ?, ?, null, datetime('now')
     where exists (select 1 from tasks where id = ? and user_id = ? and deleted_at is null)
       and exists (select 1 from people where id = ? and user_id = ? and deleted_at is null)`,
    [taskId, personId, taskId, userId, personId, userId],
  );
  return getActionHubSnapshot();
}

export async function detachTaskPerson(taskId: string, personName: string) {
  const { id: userId } = await resolveUser();
  const person = await queryD1<{ id: string }>("select id from people where name = ? and user_id = ? limit 1", [personName, userId]);
  const personId = person.rows[0]?.id;
  if (!personId) throw new Error("연결할 인물을 찾지 못했습니다.");
  await executeD1(`delete from task_people_relations where task_id = ? and person_id = ?`, [taskId, personId]);
  return getActionHubSnapshot();
}

export async function attachTaskZettel(taskId: string, zettelId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `insert or ignore into task_zettel_relations (task_id, zettel_id, created_at)
     select ?, ?, datetime('now')
     where exists (select 1 from tasks where id = ? and user_id = ? and deleted_at is null)
       and exists (select 1 from zettels where id = ? and user_id = ? and deleted_at is null)`,
    [taskId, zettelId, taskId, userId, zettelId, userId],
  );
  return getActionHubSnapshot();
}

export async function detachTaskZettel(taskId: string, zettelTitle: string) {
  const { id: userId } = await resolveUser();
  const zettel = await queryD1<{ id: string }>("select id from zettels where title = ? and user_id = ? and deleted_at is null limit 1", [zettelTitle, userId]);
  const zettelId = zettel.rows[0]?.id;
  if (!zettelId) throw new Error("연결할 메모를 찾지 못했습니다.");
  await executeD1(`delete from task_zettel_relations where task_id = ? and zettel_id = ?`, [taskId, zettelId]);
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
      ('person-eunji', ?, '최은지', '은지', '["친구","커뮤니티"]', 50, '섬세한 감각과 기록 습관.', '책과 전화를 자주 나누는 친구.', ?, 21, 'active', 0, datetime('now'), datetime('now'))`,
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

  return { userId, email: session.email };
}
