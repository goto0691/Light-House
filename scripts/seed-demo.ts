import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type D1Meta = {
  changed_db?: boolean;
  changes?: number;
};

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: D1Meta; results?: T[]; success?: boolean }>;
  success?: boolean;
};

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split("=");
    if (!key) continue;
    process.env[key] = rest.join("=");
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function startOfDayIso(daysAgo: number) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - daysAgo);
  return now.toISOString();
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
  const token = process.env.CLOUDFLARE_API_TOKEN ?? required("DATABASE_AUTH_TOKEN");

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });

  const payload = (await response.json()) as D1Envelope<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).join(" | ") || "D1 query failed.");
  }

  const result = payload.result?.[0];
  if (!result || result.success === false) {
    throw new Error("D1 returned no result.");
  }

  return {
    meta: result.meta ?? {},
    rows: result.results ?? [],
  };
}

async function executeD1(sql: string, params: unknown[] = []) {
  return queryD1(sql, params);
}

async function ensureUser() {
  const email = process.env.LIGHT_HOUSE_ADMIN_EMAIL ?? "keeper@lighthouse.local";
  const displayName = process.env.LIGHT_HOUSE_ADMIN_NAME ?? "Light Keeper";

  const existing = await queryD1<{ id: string }>("select id from users where email = ? limit 1", [email]);
  if (existing.rows[0]?.id) {
    return { id: existing.rows[0].id, email };
  }

  const userId = "user-light-keeper";
  await executeD1(
    `insert into users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
     values (?, ?, ?, 'ko-KR', 'Asia/Seoul', '{"theme":"system"}', datetime('now'), datetime('now'))`,
    [userId, email, displayName],
  );

  return { id: userId, email };
}

async function seedActionHub(userId: string) {
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
}

async function main() {
  loadEnvFile();

  const user = await ensureUser();
  await seedActionHub(user.id);

  const taskCount = await queryD1<{ count: number }>("select count(*) as count from tasks where user_id = ?", [user.id]);
  const projectCount = await queryD1<{ count: number }>("select count(*) as count from projects where user_id = ?", [user.id]);

  console.log(`Seeded demo data for ${user.email}`);
  console.log(`Projects: ${projectCount.rows[0]?.count ?? 0}`);
  console.log(`Tasks: ${taskCount.rows[0]?.count ?? 0}`);
}

void main();
