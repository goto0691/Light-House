# 🔌 API Specification

> **선행 문서**: [`03_DATABASE_SCHEMA.md`](./03_DATABASE_SCHEMA.md)
> **대상**: Backend 에이전트
> **핵심 원칙**: **Server Actions 우선** (RSC + Mutations). 외부 노출/Cron/Webhook은 Route Handlers. REST는 최소화.

---

## 1. 접근 패턴 결정 매트릭스

| 상황 | 수단 | 이유 |
|---|---|---|
| 페이지 최초 렌더링 데이터 | RSC (Server Component) 직접 DB 호출 | 왕복 제로, 스트리밍 가능 |
| 폼 제출, 상태 변경 | **Server Action** | Progressive Enhancement, 타입 안전 |
| Drawer/Modal 재조회 | Server Action + `useActionState` | 동일 |
| 실시간성 필요 없음 폴링 | TanStack Query + Server Action | 캐싱 |
| 외부 시스템(Cron, Webhook) | Route Handler | HTTP 노출 필요 |
| 파일 업로드 | Route Handler (`/api/upload`) — R2 Signed URL | CORS/Stream 편의 |
| AI 스트리밍 응답 | Route Handler + Edge Runtime | SSE |

---

## 2. 디렉토리 규칙

```
apps/web/src/
├── app/
│   ├── (app)/
│   │   └── action-hub/
│   │       ├── actions.ts              # Server Actions
│   │       └── [projectId]/actions.ts
│   └── api/
│       ├── capture/route.ts
│       ├── search/route.ts
│       ├── ai/route/route.ts
│       ├── upload/route.ts
│       └── webhooks/cron/route.ts
└── lib/
    ├── db/
    │   ├── client.ts                   # drizzle(d1)
    │   └── queries/                    # 재사용 쿼리
    │       ├── tasks.ts
    │       ├── zettels.ts
    │       ├── people.ts
    │       └── ...
    └── auth/
        └── session.ts                  # getAuthSession(), requireAuth()
```

---

## 3. Server Action 공통 규약

### 3.1. 시그니처

```typescript
'use server';

import { z } from 'zod';
import { requireAuth } from '@/lib/auth/session';
import { revalidatePath, revalidateTag } from 'next/cache';

const InputSchema = z.object({ /* ... */ });

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } };

export async function myAction(input: z.input<typeof InputSchema>): Promise<ActionResult<OutputType>> {
  const user = await requireAuth();                 // 401 자동 처리
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Invalid input', fields: parsed.error.flatten().fieldErrors } };
  }
  // ... 비즈니스 로직
  revalidateTag('tasks');
  return { ok: true, data: /* ... */ };
}
```

### 3.2. 에러 코드 표준

| 코드 | 상황 |
|---|---|
| `UNAUTHORIZED` | 세션 없음 |
| `FORBIDDEN` | 다른 사용자 데이터 접근 |
| `NOT_FOUND` | 대상 엔티티 없음 |
| `VALIDATION` | Zod 실패 |
| `CONFLICT` | slug 중복 등 |
| `RATE_LIMIT` | Quick Capture 도배 방지 |
| `INTERNAL` | 예상 못한 오류 |

### 3.3. Revalidation 태그 규약

| 태그 | 무효화 시점 |
|---|---|
| `tasks` | Task CRUD |
| `projects` | Project CRUD |
| `zettels` | Zettel CRUD, 링크 변경 |
| `people` | People CRUD, Interaction 생성 |
| `daily-log:{date}` | 해당 날짜 로그 업데이트 |
| `dashboard` | 홈 대시보드 집계값 변경 |

---

## 4. 인증 (Lucia)

### 4.1. 라우트

| 경로 | 메서드 | 핸들러 |
|---|---|---|
| `/login` | GET/POST | 폼 + Server Action `loginAction` |
| `/api/auth/logout` | POST | Lucia 세션 무효화 |
| `/api/auth/me` | GET | 현재 사용자 정보 (클라 캐시용) |

### 4.2. Server Actions

```typescript
export async function loginAction(formData: FormData): Promise<ActionResult<{ redirectTo: string }>>
export async function logoutAction(): Promise<ActionResult>
export async function updateProfileAction(input: UpdateProfileInput): Promise<ActionResult>
```

---

## 5. 🚀 Action Hub API

### 5.1. Projects

```typescript
// app/(app)/action-hub/actions.ts

// 목록 (서버 컴포넌트에서 직접 호출)
export async function listProjects(opts?: { status?: ProjectStatus }): Promise<Project[]>

// 생성
export async function createProject(input: {
  title: string;
  kind: 'project' | 'area';
  category?: string;
  icon?: string;
  color?: string;
  startDate?: string;
  targetDate?: string;
}): Promise<ActionResult<Project>>

// 수정
export async function updateProject(id: string, patch: Partial<ProjectFields>): Promise<ActionResult<Project>>

// 상태 변경 (빠른 토글)
export async function setProjectStatus(id: string, status: ProjectStatus): Promise<ActionResult>

// 삭제 (soft)
export async function archiveProject(id: string): Promise<ActionResult>

// 순서 변경 (LNB 드래그)
export async function reorderProjects(order: string[]): Promise<ActionResult>
```

### 5.2. Tasks

```typescript
export async function listTasks(opts: {
  projectId?: string;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  dueBefore?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: Task[]; total: number }>

export async function getTask(id: string): Promise<TaskWithRelations | null>

export async function createTask(input: CreateTaskInput): Promise<ActionResult<Task>>

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<ActionResult<Task>>

// 칸반 드래그 → 상태 + 순서 한번에
export async function moveTask(input: {
  taskId: string;
  toStatus: TaskStatus;
  toIndex: number;
}): Promise<ActionResult>

// Zen Editor 자동 저장 (debounced 1s)
export async function saveTaskContent(id: string, content: TiptapJSON): Promise<ActionResult>

export async function deleteTask(id: string): Promise<ActionResult>

// 체크리스트
export async function addChecklist(taskId: string, content: string): Promise<ActionResult<Checklist>>
export async function toggleChecklist(id: string): Promise<ActionResult>
export async function reorderChecklists(taskId: string, order: string[]): Promise<ActionResult>

// 관계
export async function linkTaskToPerson(taskId: string, personId: string, roleContext?: string): Promise<ActionResult>
export async function linkTaskToZettel(taskId: string, zettelId: string): Promise<ActionResult>
```

---

## 6. 🧠 Vault API

### 6.1. Zettels

```typescript
export async function listZettels(opts: {
  type?: ZettelType[];
  category?: string;
  tagIds?: string[];
  search?: string;
  sortBy?: 'updated' | 'created' | 'title';
}): Promise<Zettel[]>

export async function getZettel(slugOrId: string): Promise<ZettelWithRelations | null>

export async function createZettel(input: CreateZettelInput): Promise<ActionResult<Zettel>>
export async function updateZettel(id: string, patch: UpdateZettelInput): Promise<ActionResult<Zettel>>
export async function promoteZettel(id: string, toType: 'literature' | 'permanent'): Promise<ActionResult>
export async function deleteZettel(id: string): Promise<ActionResult>

// 링크 (멘션에서 자동 호출)
export async function linkZettels(sourceId: string, targetId: string, context?: string): Promise<ActionResult>
export async function unlinkZettels(sourceId: string, targetId: string): Promise<ActionResult>

// 백링크 조회 (페이지 우측 패널)
export async function getBacklinks(zettelId: string): Promise<Zettel[]>

// 의미 검색
export async function semanticSearchZettels(query: string, limit?: number): Promise<Array<Zettel & { score: number }>>

// 그래프 데이터
export async function getZettelGraph(opts?: { rootId?: string; depth?: number }): Promise<{
  nodes: Array<{ id: string; title: string; type: string; category?: string }>;
  edges: Array<{ source: string; target: string }>;
}>
```

### 6.2. Media Logs

```typescript
export async function listMedia(opts: {
  mediaType?: 'game' | 'book' | 'screen';
  status?: MediaStatus[];
  genre?: string;
  search?: string;
}): Promise<MediaLog[]>

export async function getMedia(id: string): Promise<MediaWithRelations | null>
export async function createMedia(input: CreateMediaInput): Promise<ActionResult<MediaLog>>
export async function updateMedia(id: string, patch: UpdateMediaInput): Promise<ActionResult<MediaLog>>
export async function deleteMedia(id: string): Promise<ActionResult>

// 외부 메타 자동 fetch (선택 기능: TMDB, IGDB, 알라딘 API)
export async function enrichMediaFromSource(mediaType: string, query: string): Promise<ActionResult<Partial<MediaLog>>>
```

### 6.3. Assets & Places

```typescript
export async function listAssets(opts?: { category?: string }): Promise<Asset[]>
export async function createAsset(input: CreateAssetInput): Promise<ActionResult<Asset>>
export async function updateAsset(id: string, patch: Partial<Asset>): Promise<ActionResult<Asset>>

export async function listPlaces(opts?: { category?: string }): Promise<Place[]>
export async function createPlace(input: CreatePlaceInput): Promise<ActionResult<Place>>
export async function logPlaceVisit(input: CreateVisitInput): Promise<ActionResult<PlaceVisit>>
```

---

## 7. 🤝 PRM API

### 7.1. People

```typescript
export async function listPeople(opts: {
  layer?: number[];
  group?: string;
  status?: PersonStatus[];
  needsContact?: boolean;    // Hit-Them-Up 필터
  search?: string;
}): Promise<PersonSummary[]>

export async function getPerson(id: string): Promise<PersonWithTimeline | null>
// PersonWithTimeline = person + 최근 30개의 interaction/gift/task 통합 타임라인

export async function createPerson(input: CreatePersonInput): Promise<ActionResult<Person>>
export async function updatePerson(id: string, patch: UpdatePersonInput): Promise<ActionResult<Person>>
export async function deletePerson(id: string): Promise<ActionResult>

// 연락 기록 (간편 호출)
export async function markContacted(personId: string, at?: string): Promise<ActionResult>

// Hit-Them-Up 목록 (Cron 및 UI 공용)
export async function listNeedsContact(): Promise<Array<Person & { daysOverdue: number }>>
```

### 7.2. Interactions

```typescript
export async function listInteractions(personId: string, opts?: { limit?: number; before?: string }): Promise<Interaction[]>
export async function createInteraction(input: CreateInteractionInput): Promise<ActionResult<Interaction>>
export async function updateInteraction(id: string, patch: Partial<Interaction>): Promise<ActionResult>
export async function deleteInteraction(id: string): Promise<ActionResult>
```

### 7.3. Gifts

```typescript
export async function listGifts(personId?: string, opts?: { direction?: 'given' | 'received' }): Promise<Gift[]>
export async function createGift(input: CreateGiftInput): Promise<ActionResult<Gift>>
export async function updateGift(id: string, patch: Partial<Gift>): Promise<ActionResult>
```

### 7.4. Network Edges

```typescript
export async function listEdges(): Promise<NetworkEdge[]>
export async function createEdge(input: CreateEdgeInput): Promise<ActionResult<NetworkEdge>>
export async function getPRMGraph(): Promise<{ nodes: PersonNode[]; edges: EdgeData[] }>
```

---

## 8. ⚙️ Life Ops API

### 8.1. Daily Logs

```typescript
export async function getDailyLog(date: string): Promise<DailyLogWithHabits | null>
// 없으면 null (생성은 아래로)

export async function upsertDailyLog(date: string, patch: UpsertDailyLogInput): Promise<ActionResult<DailyLog>>

export async function setMood(date: string, mood: number): Promise<ActionResult>
export async function setEnergy(date: string, energy: number): Promise<ActionResult>
export async function saveJournal(date: string, field: 'journal' | 'meditation' | 'gratitude', content: any): Promise<ActionResult>

// 자동 생성 (AI 요약)
export async function generateDailySummary(date: string): Promise<ActionResult<string>>
```

### 8.2. Habits

```typescript
export async function listHabits(onlyActive?: boolean): Promise<Habit[]>
export async function createHabit(input: CreateHabitInput): Promise<ActionResult<Habit>>
export async function updateHabit(id: string, patch: Partial<Habit>): Promise<ActionResult>
export async function deactivateHabit(id: string): Promise<ActionResult>

// 원클릭 기록
export async function logHabit(habitId: string, date: string, value?: number): Promise<ActionResult<HabitLog>>
export async function unlogHabit(habitId: string, date: string): Promise<ActionResult>

// Heatmap 데이터
export async function getHabitHeatmap(habitId: string, year: number): Promise<Array<{ date: string; value: number }>>
export async function getAllHabitsHeatmap(year: number): Promise<{ habits: Habit[]; data: Record<string, Record<string, number>> }>

// Streak 계산
export async function getHabitStreak(habitId: string): Promise<{ current: number; longest: number }>
```

### 8.3. Workouts

```typescript
export async function listWorkouts(opts?: { from?: string; to?: string }): Promise<Workout[]>
export async function createWorkout(input: CreateWorkoutInput): Promise<ActionResult<Workout>>
export async function updateWorkout(id: string, patch: Partial<Workout>): Promise<ActionResult>
export async function deleteWorkout(id: string): Promise<ActionResult>
```

### 8.4. Health Metrics & Career

```typescript
export async function upsertHealthMetric(date: string, patch: Partial<HealthMetric>): Promise<ActionResult>
export async function getHealthTrend(metric: keyof HealthMetric, days: number): Promise<Array<{ date: string; value: number }>>

export async function listCareer(): Promise<CareerHistory[]>
export async function createCareer(input: CreateCareerInput): Promise<ActionResult<CareerHistory>>
export async function updateCareer(id: string, patch: Partial<CareerHistory>): Promise<ActionResult>
```

---

## 9. 🔍 검색 API (통합)

### 9.1. Route Handler: `GET /api/search`

```typescript
// 요청
GET /api/search?q=재민&types=person,task,zettel&limit=20

// 응답
{
  "results": [
    { "type": "person", "id": "...", "title": "김재민", "snippet": "...", "score": 0.95 },
    { "type": "task",   "id": "...", "title": "...", "snippet": "...", "score": 0.80 },
    { "type": "zettel", "id": "...", "title": "...", "snippet": "...", "score": 0.72 }
  ],
  "elapsedMs": 42
}
```

- FTS5 테이블 병렬 쿼리 (Promise.all)
- 스니펫은 `snippet()` 함수로 강조 표시 (`<mark>...</mark>`)
- 상위 score 순 정렬

### 9.2. 의미 검색 변형

```
GET /api/search?q=...&semantic=1   → Zettel 에만 Vectorize 사용
```

---

## 10. 📥 Quick Capture API

### 10.1. Route Handler: `POST /api/capture`

```typescript
// 요청
{
  "text": "호떡집 겨울 신메뉴 리서치, 다음주까지",
  "context": {                 // 현재 페이지 (AI 힌트)
    "domain": "action-hub",
    "projectId": "...",
    "personId": null
  }
}

// 응답
{
  "captureId": "...",
  "status": "routed",
  "suggested": {
    "domain": "task",
    "fields": {
      "title": "호떡집 겨울 신메뉴 리서치",
      "priority": "P2",
      "projectId": "...",          // '지인 비즈니스' 자동 인식
      "dueAt": "2026-04-29",
      "brainEnergy": "normal"
    },
    "confidence": 0.87
  },
  "routedEntity": { "type": "task", "id": "..." }
}
```

### 10.2. 라우팅 로직 (`workers/ai-router`)

```
Step 1. 컨텍스트 + 텍스트 → Claude Haiku 4.5 호출
Step 2. 프롬프트는 JSON 응답 강제 (Tool Use)
Step 3. confidence >= 0.7 → 자동 생성
        confidence <  0.7 → quick_captures에 pending 남겨두고 UI에서 확인 요청
Step 4. 사용자가 수정하면 학습 안됨(단일 사용자), 대신 confidence 임계 조정
```

### 10.3. 프롬프트 템플릿 (Claude Haiku 4.5)

```
You are a personal productivity router. Given a short text and optional context,
decide which domain this belongs to and extract structured fields.

Domains: task | zettel | interaction | diary_entry | habit_log | media_log | workout
...

Return ONLY valid JSON matching the provided schema.
```

- **모델**: `claude-haiku-4-5` (Anthropic API)
- **Fallback**: Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Rate limit**: 사용자당 분당 60회

---

## 11. 🤖 AI API

### 11.1. Route Handler: `POST /api/ai/route` (스트리밍)

Quick Capture와 동일 로직이지만 대화형 UI에서 사용.

### 11.2. `POST /api/ai/summarize`

```typescript
// 요청: { type: 'daily' | 'weekly' | 'project'; id?: string; date?: string }
// 응답: SSE 스트림 (Markdown)
```

- Daily: 해당 날짜의 모든 도메인 이벤트 요약
- Weekly: 주간 회고 자동 생성 (Cron 매주 일요일 23:00)
- Project: 프로젝트의 현재 진척과 블로커 요약

### 11.3. `POST /api/ai/enhance` (Zettel 보조)

- Zettel 원석을 영구 메모로 승격 시 AI가 구조화 제안

---

## 12. 📎 파일 업로드

### 12.1. `POST /api/upload/signed-url`

```typescript
// 요청
{
  "ownerType": "zettel",
  "ownerId": "...",
  "filename": "hero.png",
  "mimeType": "image/png",
  "sizeBytes": 234567
}

// 응답 (Presigned URL, 15분 유효)
{
  "uploadUrl": "https://...r2.cloudflarestorage.com/...",
  "r2Key": "user/.../vault/2026/04/01JABC.png",
  "attachmentId": "..."
}
```

### 12.2. 업로드 후 `POST /api/upload/complete`

```typescript
{ "attachmentId": "..." }
// → Cloudflare Images 변형 트리거 + attachments.cdn_url 업데이트
```

---

## 13. 🔔 Webhook: Cron (`POST /api/webhooks/cron`)

> Cloudflare Cron Trigger → Next.js로 전달.
> 인증: `Authorization: Bearer ${CRON_SECRET}`

### 13.1. 스케줄

| Cron | 목적 | 처리 |
|---|---|---|
| `*/15 * * * *` | Hit-Them-Up 알림 체크 | `last_contacted_at + cadence < now` 사용자에 알림 생성 |
| `0 3 * * *` | 일일 백업 | D1 dump → R2 |
| `0 0 * * 1` | 주간 리뷰 자동 생성 | 지난 주 daily_logs 요약 → `ai_summary` |
| `0 9 * * *` | 생일 알림 | 7일 내 생일 인물 알림 |
| `0 4 * * 0` | 소프트 삭제 하드 정리 | `deleted_at < now - 90d` 항목 DELETE |

### 13.2. 요청 body

```json
{ "job": "hit_them_up" | "daily_backup" | "weekly_review" | "birthday" | "hard_delete" }
```

---

## 14. 📨 Notifications API (인앱)

```typescript
// 알림 테이블은 schema/shared.ts에 추가 (내부용, 단일 사용자라도 구현 권장)
export const notifications = sqliteTable('notifications', {
  id: id(),
  userId: userId(),
  kind: text('kind').notNull(),     // 'hit_them_up' | 'birthday' | 'due_soon' | 'ai_summary_ready'
  title: text('title').notNull(),
  body: text('body'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull(),
});
```

```typescript
export async function listNotifications(opts?: { unreadOnly?: boolean }): Promise<Notification[]>
export async function markNotificationRead(id: string): Promise<ActionResult>
export async function markAllRead(): Promise<ActionResult>
```

---

## 15. 📤 데이터 내보내기

### 15.1. `GET /api/export`

- 쿼리: `?domains=all|action-hub,vault&format=json|markdown`
- 응답: ZIP 스트림
- JSON: 스키마 그대로 덤프
- Markdown: 각 엔티티 개별 `.md` 파일 (노션 스타일)

---

## 16. 🔐 권한 / 접근 통제

모든 Server Action은:
```typescript
const user = await requireAuth();                // 401
const entity = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
if (!entity) return notFound();                  // 404
if (entity.userId !== user.id) return forbidden(); // 403
```

**공유 헬퍼** `lib/auth/ownership.ts`:
```typescript
export async function ensureOwnership<T extends { userId: string }>(entity: T | null | undefined): Promise<asserts entity is T> {
  const user = await requireAuth();
  if (!entity) throw new Error('NOT_FOUND');
  if (entity.userId !== user.id) throw new Error('FORBIDDEN');
}
```

---

## 17. ⏱️ Rate Limit

- Quick Capture: 60 req/min/user (메모리 기반 토큰 버킷, Workers Durable Object로 업그레이드 가능)
- AI 호출: 월 $X 예산 모니터링, 초과 시 Workers AI로 fallback
- 업로드: 10 req/min/user, 파일당 50MB 제한

---

## 18. 📊 Type 공유

```typescript
// packages/db/schema/index.ts
export type User = typeof users.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
// ... 모든 테이블에 대해

// apps/web는 '@repo/db' 패키지로 import
```

---

**다음**: [`05_PAGE_SPECIFICATIONS.md`](./05_PAGE_SPECIFICATIONS.md)에서 이 API를 소비하는 UI 페이지들을 정의한다.
