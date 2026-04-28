# 🗄️ Database Schema (Cloudflare D1 + Drizzle ORM)

> **선행 문서**: [`02_DESIGN_SYSTEM.md`](./02_DESIGN_SYSTEM.md)
> **대상**: Backend 에이전트
> **원칙**: 단일 진실 공급원(SSOT). 모든 스키마는 `packages/db/schema/*.ts`에 정의하고 프론트에서 `@repo/db/schema`로 import한다.
> **AS-IS 보강 기준**: 원본 속성 기반의 다음 스키마 보강은 [`13_ASIS_TO_BE_SCHEMA_ALIGNMENT.md`](./13_ASIS_TO_BE_SCHEMA_ALIGNMENT.md)를 먼저 반영한다.

---

## 1. 설계 원칙

1. **ULID Primary Key** — 모든 `id`는 `text`로 저장된 ULID (26자, 정렬 가능). `nanoid`/UUID 사용 금지.
2. **Timestamps in ISO 8601** — `created_at`, `updated_at` 모두 `text` (예: `2026-04-22T12:34:56.789Z`). D1 SQLite의 `DATETIME` 함정 회피.
3. **Soft Delete** — 모든 사용자 데이터 테이블은 `deleted_at text` 보유. 실제 DELETE는 90일 지난 항목을 Cron으로 수행.
4. **ON DELETE CASCADE** — 상위 엔티티 삭제 시 자식 자동 정리.
5. **Relations = Bridge Table** — N:M은 반드시 별도 테이블. JSON 배열 금지(검색 불가).
6. **FTS5 Companion Tables** — 풀텍스트 검색 대상은 `_fts` 가상 테이블 병기.
7. **user_id 필드** — 단일 사용자지만 모든 주요 테이블에 `user_id` 보유 (미래 다중 사용자 대비).

---

## 2. 파일 구조

```
packages/db/
├── schema/
│   ├── auth.ts              # users, sessions
│   ├── shared.ts            # tags, taggings, attachments, audit_logs
│   ├── action-hub.ts        # projects, tasks, checklists, relations
│   ├── vault.ts             # zettels, zettel_links, media_logs, assets, places
│   ├── prm.ts               # people, interactions, gifts, network_edges
│   ├── life-ops.ts          # daily_logs, habits, habit_logs, workouts, career_history, health_metrics
│   ├── capture.ts           # quick_captures, ai_conversations
│   ├── fts.ts               # FTS5 가상 테이블 선언 (raw SQL)
│   └── index.ts             # 전체 re-export
├── migrations/              # drizzle-kit generate 결과물
└── client.ts                # D1 클라이언트 팩토리
```

---

## 3. 공통 헬퍼

```typescript
// packages/db/schema/_helpers.ts
import { text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ulid } from 'ulidx';

export const id = () => text('id').primaryKey().$defaultFn(() => ulid());
export const userId = () => text('user_id').notNull();
export const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdate(() => new Date().toISOString()),
  deletedAt: text('deleted_at'), // null = active
};
```

---

## 4. 🔐 Auth 스키마 (`schema/auth.ts`)

```typescript
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, timestamps } from './_helpers';

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').unique().notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  hashedPassword: text('hashed_password'), // Lucia Argon2
  locale: text('locale').default('ko-KR'),
  timezone: text('timezone').default('Asia/Seoul'),
  preferences: text('preferences'), // JSON: theme, dashboard layout, 단축키 커스텀
  ...timestamps,
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // Lucia 세션 ID
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(), // Unix epoch
});
```

---

## 5. 🧩 Shared 스키마 (`schema/shared.ts`)

### 5.1. 태그 시스템 (정규화)

```typescript
export const tags = sqliteTable('tags', {
  id: id(),
  userId: userId(),
  name: text('name').notNull(),
  slug: text('slug').notNull(), // URL-safe, 중복 방지
  color: text('color'),          // HSL string, null이면 자동
  parentId: text('parent_id'),   // 계층형 태그 지원 (self-ref)
  usageCount: integer('usage_count').default(0), // 자주 쓰는 순 정렬용
  ...timestamps,
}, (t) => ({
  userSlugUnique: index('idx_tag_user_slug').on(t.userId, t.slug),
}));

// 다형성 태깅: taggable_type + taggable_id로 어떤 엔티티에도 부착
export const taggings = sqliteTable('taggings', {
  id: id(),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  taggableType: text('taggable_type').notNull(), // 'zettel' | 'task' | 'media' | 'person' | ...
  taggableId: text('taggable_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  polyIndex: index('idx_taggings_poly').on(t.taggableType, t.taggableId),
  tagIndex: index('idx_taggings_tag').on(t.tagId),
}));
```

### 5.2. 첨부 파일

```typescript
export const attachments = sqliteTable('attachments', {
  id: id(),
  userId: userId(),
  ownerType: text('owner_type').notNull(), // 'task', 'zettel', 'gift', 'person' ...
  ownerId: text('owner_id').notNull(),
  kind: text('kind').notNull(),     // 'image', 'file', 'cover'
  r2Key: text('r2_key').notNull(),  // R2 객체 키
  cdnUrl: text('cdn_url').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  meta: text('meta'),               // JSON: width, height, blurhash
  ...timestamps,
}, (t) => ({
  ownerIndex: index('idx_attach_owner').on(t.ownerType, t.ownerId),
}));
```

### 5.3. 감사 로그

```typescript
export const auditLogs = sqliteTable('audit_logs', {
  id: id(),
  userId: userId(),
  action: text('action').notNull(),     // 'create', 'update', 'soft_delete', 'restore', 'hard_delete'
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  snapshot: text('snapshot'),           // JSON (복원용 직전 상태)
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  entityIndex: index('idx_audit_entity').on(t.entityType, t.entityId),
  userTimeIndex: index('idx_audit_user_time').on(t.userId, t.createdAt),
}));
```

---

### 5.4. Source Document Layer

This layer preserves Notion document behavior after migration. It keeps source database identity, document role, raw properties, preview text, and canonical entity mapping so migrated pages can act like their original Notion documents inside Light House.

```typescript
export const sourceDocuments = sqliteTable('source_documents', {
  id: id(),
  userId: userId(),
  sourceType: text('source_type').notNull().default('notion'),
  sourceId: text('source_id').notNull(),
  importBatchId: text('import_batch_id'),
  sourceDatabase: text('source_database'),
  title: text('title').notNull(),
  documentRole: text('document_role'),
  canonicalEntityType: text('canonical_entity_type'),
  canonicalEntityId: text('canonical_entity_id'),
  status: text('status').notNull().default('active'),
  url: text('url'),
  rawProperties: text('raw_properties'),
  rawContentPreview: text('raw_content_preview'),
  resolvedAt: text('resolved_at'),
  ...timestamps,
});

export const sourceDocumentProperties = sqliteTable('source_document_properties', {
  id: id(),
  sourceDocumentId: text('source_document_id').notNull(),
  propertyKey: text('property_key').notNull(),
  propertyName: text('property_name').notNull(),
  propertyType: text('property_type'),
  valueText: text('value_text'),
  valueJson: text('value_json'),
  normalizedValue: text('normalized_value'),
  createdAt: text('created_at').notNull(),
});

export const sourceDocumentRelations = sqliteTable('source_document_relations', {
  id: id(),
  sourceDocumentId: text('source_document_id').notNull(),
  relationName: text('relation_name').notNull(),
  targetSourceId: text('target_source_id'),
  targetTitle: text('target_title'),
  resolvedEntityType: text('resolved_entity_type'),
  resolvedEntityId: text('resolved_entity_id'),
  confidence: real('confidence'),
  createdAt: text('created_at').notNull(),
});
```

### 5.5. Migration Review Queue

```typescript
export const migrationReviewItems = sqliteTable('migration_review_items', {
  id: id(),
  userId: userId(),
  sourceDocumentId: text('source_document_id'),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  issueType: text('issue_type').notNull(),        // duplicate-media | duplicate-workout | possible-person-artifact | ...
  suggestedAction: text('suggested_action').notNull(),
  confidence: real('confidence'),
  status: text('status').notNull().default('open'), // open | applied | dismissed
  reason: text('reason'),
  payload: text('payload'),                       // JSON evidence/action payload
  resolvedAt: text('resolved_at'),
  ...timestamps,
});
```

---

## 6. 🚀 Action Hub 스키마 (`schema/action-hub.ts`)

```typescript
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, userId, timestamps } from './_helpers';
import { users } from './auth';
import { people } from './prm';
import { zettels } from './vault';

export const projects = sqliteTable('projects', {
  id: id(),
  userId: userId(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  icon: text('icon'),              // 이모지 또는 Lucide 이름
  color: text('color'),            // HSL
  // 'project' = 기한/목표 있음, 'area' = 지속 책임 영역
  kind: text('kind').notNull().default('project'),
  status: text('status').notNull().default('active'), // 'active' | 'paused' | 'completed' | 'archived'
  category: text('category'),      // '기타', '라이프 관리', '자기계발', '컨시어지', '웹소설' 등 (Select)
  startDate: text('start_date'),
  targetDate: text('target_date'),
  progress: integer('progress').default(0), // 0-100 (자동 계산용 캐시)
  pinned: integer('pinned', { mode: 'boolean' }).default(false),
  displayOrder: integer('display_order').default(0),
  ...timestamps,
}, (t) => ({
  userStatusIndex: index('idx_proj_user_status').on(t.userId, t.status),
  slugUnique: index('idx_proj_slug').on(t.userId, t.slug),
}));

export const tasks = sqliteTable('tasks', {
  id: id(),
  userId: userId(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  // null projectId = Inbox (Quick Capture 전용)

  // 식별
  title: text('title').notNull(),
  // 'development' = 개발/일반 업무 칸반용 (단문 + 체크리스트)
  // 'writing' = 웹소설/에세이 원고용 (장문 content, Zen Editor)
  // 'research' = 자문/리서치
  kind: text('kind').notNull().default('development'),

  // 컨텐츠
  content: text('content'),        // Tiptap JSON 직렬화된 본문

  // 메타
  status: text('status').notNull().default('todo'), // 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'
  priority: text('priority').notNull().default('P2'), // 'P1' | 'P2' | 'P3'
  brainEnergy: text('brain_energy').notNull().default('normal'), // 'hyper_focus' | 'normal' | 'routine'

  // 일정 & 정렬
  startAt: text('start_at'),       // ISO 8601, 캘린더 시작
  dueAt: text('due_at'),           // 마감
  completedAt: text('completed_at'),
  displayOrder: integer('display_order').default(0),

  // 집필 전용 메타
  wordCount: integer('word_count'),
  episodeNumber: integer('episode_number'),  // "25화" 등

  ...timestamps,
}, (t) => ({
  projectIndex: index('idx_task_project').on(t.projectId),
  userStatusIndex: index('idx_task_user_status').on(t.userId, t.status),
  dueIndex: index('idx_task_due').on(t.dueAt),
  kindIndex: index('idx_task_kind').on(t.kind),
}));

export const checklists = sqliteTable('checklists', {
  id: id(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  isCompleted: integer('is_completed', { mode: 'boolean' }).default(false),
  displayOrder: integer('display_order').default(0),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  taskIndex: index('idx_checklist_task').on(t.taskId),
}));

// === Bridge Tables ===
export const taskPeopleRelations = sqliteTable('task_people_relations', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  roleContext: text('role_context'), // '협력자', '자문', '의뢰인', '검토자' ...
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  pk: index('pk_task_people').on(t.taskId, t.personId),
}));

export const taskZettelRelations = sqliteTable('task_zettel_relations', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  zettelId: text('zettel_id').notNull().references(() => zettels.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  pk: index('pk_task_zettel').on(t.taskId, t.zettelId),
}));
```

---

## 7. 🧠 Vault 스키마 (`schema/vault.ts`)

```typescript
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { id, userId, timestamps } from './_helpers';
import { people } from './prm';

// -- Zettelkasten --
export const zettels = sqliteTable('zettels', {
  id: id(),
  userId: userId(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content: text('content'),        // Tiptap JSON
  contentText: text('content_text'), // plain text (FTS용, trigger로 동기화)
  summary: text('summary'),        // 한 줄 요약
  // 'fleeting' = 원석, 'literature' = 발췌, 'permanent' = 가공됨, 'moc' = Map of Content
  type: text('type').notNull().default('fleeting'),
  category: text('category'),      // '심리학', '실존주의', '비즈니스' ...
  source: text('source'),          // 출처 (책, URL, 대화 등)
  sourceUrl: text('source_url'),

  // 임베딩 메타 (실제 벡터는 Vectorize에)
  vectorId: text('vector_id'),     // Vectorize 내부 ID
  vectorHash: text('vector_hash'), // content 해시. 변경 감지용

  pinned: integer('pinned', { mode: 'boolean' }).default(false),
  ...timestamps,
}, (t) => ({
  userTypeIndex: index('idx_zettel_user_type').on(t.userId, t.type),
  slugUnique: index('idx_zettel_slug').on(t.userId, t.slug),
}));

// 양방향 링크 — source -> target
export const zettelLinks = sqliteTable('zettel_links', {
  id: id(),
  sourceId: text('source_id').notNull().references(() => zettels.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => zettels.id, { onDelete: 'cascade' }),
  context: text('context'),        // 링크 주변 문맥 스니펫
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  sourceIndex: index('idx_zlink_source').on(t.sourceId),
  targetIndex: index('idx_zlink_target').on(t.targetId),
}));

// -- Media Logs (통합) --
export const mediaLogs = sqliteTable('media_logs', {
  id: id(),
  userId: userId(),
  // 'game' | 'book' | 'screen' (screen = 영화/드라마/애니)
  mediaType: text('media_type').notNull(),
  title: text('title').notNull(),
  originalTitle: text('original_title'),

  // 공통 메타
  platformOrPublisher: text('platform_or_publisher'), // 'Nintendo', 'Netflix', '민음사' ...
  creator: text('creator'),        // 감독/저자/크리에이터
  studio: text('studio'),          // 스튜디오 드래곤, MAPPA ...
  genre: text('genre'),            // JSON array string
  releaseYear: integer('release_year'),

  // 상태
  // 'backlog' | 'consuming' | 'completed' | 'dropped' | 'archived'
  status: text('status').notNull().default('backlog'),
  rating: real('rating'),          // 1.0 ~ 5.0
  evaluation: text('evaluation'),  // '인생작' | '평범' | '비추' (ASIS '평가' Select)
  review: text('review'),          // 한 줄 평
  content: text('content'),        // 긴 감상문 Tiptap JSON

  // 게임 특화
  playTime: integer('play_time'),  // 분 단위
  // 도서 특화
  author: text('author'),
  pages: integer('pages'),
  // 영상 특화
  // 'movie' | 'drama' | 'anime' | 'documentary'
  screenKind: text('screen_kind'),
  rewatchValue: integer('rewatch_value', { mode: 'boolean' }).default(false), // 다시 볼 가치

  coverImageUrl: text('cover_image_url'), // Cloudflare Images URL
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  ...timestamps,
}, (t) => ({
  userTypeStatusIndex: index('idx_media_user_type_status').on(t.userId, t.mediaType, t.status),
}));

// -- Assets (장비/수집품) --
export const assets = sqliteTable('assets', {
  id: id(),
  userId: userId(),
  // 'gear' = 장비(홈시어터/자전거), 'collection' = 수집품(피규어/게임기)
  category: text('category').notNull(),
  name: text('name').notNull(),
  brand: text('brand'),
  modelName: text('model_name'),
  acquiredDate: text('acquired_date'),
  acquiredPrice: integer('acquired_price'),
  currentCondition: text('current_condition'), // 'mint' | 'good' | 'fair' | 'poor'
  notes: text('notes'),            // Tiptap JSON (세팅값, 특징)
  coverImageUrl: text('cover_image_url'),
  ...timestamps,
});

// -- Places --
export const places = sqliteTable('places', {
  id: id(),
  userId: userId(),
  name: text('name').notNull(),
  // 'restaurant' | 'cafe' | 'attraction' | 'shop' | 'other'
  category: text('category').notNull(),
  address: text('address'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  mapUrl: text('map_url'),
  // 방문 기록은 여러 번 가능하므로 1:N 서브 테이블
  firstVisitedAt: text('first_visited_at'),
  lastVisitedAt: text('last_visited_at'),
  visitCount: integer('visit_count').default(0),
  averageRating: real('average_rating'),
  notes: text('notes'),
  ...timestamps,
});

export const placeVisits = sqliteTable('place_visits', {
  id: id(),
  placeId: text('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  visitedAt: text('visited_at').notNull(),
  rating: real('rating'),
  review: text('review'),
  companionIds: text('companion_ids'), // JSON array of person_id (누구와 함께)
  expense: integer('expense'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// -- Bridge Tables --
export const zettelMediaRelations = sqliteTable('zettel_media_relations', {
  zettelId: text('zettel_id').notNull().references(() => zettels.id, { onDelete: 'cascade' }),
  mediaId: text('media_id').notNull().references(() => mediaLogs.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  pk: index('pk_zettel_media').on(t.zettelId, t.mediaId),
}));

export const zettelPeopleRelations = sqliteTable('zettel_people_relations', {
  zettelId: text('zettel_id').notNull().references(() => zettels.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  context: text('context'),        // '추천받음' | '대화 중 나옴' ...
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  pk: index('pk_zettel_people').on(t.zettelId, t.personId),
}));

export const mediaPeopleRelations = sqliteTable('media_people_relations', {
  mediaId: text('media_id').notNull().references(() => mediaLogs.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  context: text('context'),        // 'recommended_by' | 'watched_together'
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

---

## 8. 🤝 PRM 스키마 (`schema/prm.ts`)

```typescript
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { id, userId, timestamps } from './_helpers';

export const people = sqliteTable('people', {
  id: id(),
  userId: userId(),
  name: text('name').notNull(),
  nickname: text('nickname'),
  birthDate: text('birth_date'),      // YYYY-MM-DD (연도 unknown시 --MM-DD 허용 파서)
  photoUrl: text('photo_url'),        // Cloudflare Images

  // 그룹 (JSON array: '가족', '비즈니스', '친구' ...)
  groups: text('groups'),

  // 던바 모델
  dunbarLayer: integer('dunbar_layer'), // 5 | 15 | 50 | 150
  intimacy: integer('intimacy'),         // 1-10 사용자 주관 점수

  coreValue: text('core_value'),         // 핵심 가치관/특징
  bio: text('bio'),                      // 자유 메모

  // 연락 메타
  lastContactedAt: text('last_contacted_at'),   // trigger로 자동 업데이트
  contactCadenceDays: integer('contact_cadence_days'), // dunbarLayer로부터 기본값, 오버라이드 가능

  // 연락처
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  socialLinks: text('social_links'),     // JSON: {instagram, x, linkedin, ...}

  // 관계 상태
  status: text('status').notNull().default('active'), // 'active' | 'dormant' | 'observing' | 'estranged'
  isFavorite: integer('is_favorite', { mode: 'boolean' }).default(false),

  ...timestamps,
}, (t) => ({
  userStatusIndex: index('idx_person_user_status').on(t.userId, t.status),
  layerIndex: index('idx_person_layer').on(t.userId, t.dunbarLayer),
  lastContactIndex: index('idx_person_last_contact').on(t.lastContactedAt),
}));

export const interactions = sqliteTable('interactions', {
  id: id(),
  userId: userId(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  occurredAt: text('occurred_at').notNull(),
  // 'meeting' | 'call' | 'message' | 'conflict' | 'insight' | 'gift_exchange' | 'life_event'
  type: text('type').notNull().default('meeting'),
  intensity: integer('intensity'),  // 1-5 (ASIS '사건 강도')
  summary: text('summary'),
  content: text('content'),          // Tiptap JSON 상세
  protocol: text('protocol'),        // 대응 프로토콜/핵심 기전 (갈등용)
  // 위치 (옵션)
  placeId: text('place_id'),
  ...timestamps,
}, (t) => ({
  personTimeIndex: index('idx_intr_person_time').on(t.personId, t.occurredAt),
}));

export const gifts = sqliteTable('gifts', {
  id: id(),
  userId: userId(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(), // 'given' | 'received'
  title: text('title').notNull(),
  occurredAt: text('occurred_at').notNull(),
  reason: text('reason'),            // '생일' | '응원' | '감사' (JSON array 허용)
  cost: integer('cost'),
  // '실패' | '보통' | '성공' | '대만족'
  satisfaction: text('satisfaction'),
  options: text('options'),          // 사이즈, 취향 등
  imageUrl: text('image_url'),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  personIndex: index('idx_gift_person').on(t.personId),
}));

// 인물-인물 관계 엣지 (그래프용)
export const networkEdges = sqliteTable('network_edges', {
  id: id(),
  userId: userId(),
  sourcePersonId: text('source_person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  targetPersonId: text('target_person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  // '부부' | '동업자' | '소개해준 사람' | '친구' ...
  relationType: text('relation_type'),
  strength: integer('strength'),     // 1-5
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  sourceIndex: index('idx_edge_source').on(t.sourcePersonId),
  targetIndex: index('idx_edge_target').on(t.targetPersonId),
}));
```

---

## 9. ⚙️ Life Ops 스키마 (`schema/life-ops.ts`)

```typescript
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { id, userId, timestamps } from './_helpers';

// -- Daily Log (하루의 앵커) --
export const dailyLogs = sqliteTable('daily_logs', {
  // date + userId 복합키 대신 사용자별 ULID로 단순화하고 date는 unique로
  id: id(),
  userId: userId(),
  date: text('date').notNull(),      // YYYY-MM-DD

  mood: integer('mood'),              // 1-5
  energyLevel: integer('energy_level'), // 1-5
  // ASIS '감정' Multi-select: 차분함, 기쁨 등 (JSON array)
  emotions: text('emotions'),

  // 저널링 (ASIS '일기' + '묵상' + '감사일기' 통합)
  gratitude: text('gratitude'),       // 감사한 일
  journal: text('journal'),           // 일기 본문 (Tiptap JSON)
  meditation: text('meditation'),     // 묵상/QT (Tiptap JSON)
  meditationVerse: text('meditation_verse'), // 본문말씀

  // AI 자동 생성 요약 (Cron)
  aiSummary: text('ai_summary'),

  ...timestamps,
}, (t) => ({
  userDateUnique: index('idx_dl_user_date').on(t.userId, t.date),
}));

// -- Habits 정의 --
export const habits = sqliteTable('habits', {
  id: id(),
  userId: userId(),
  title: text('title').notNull(),
  description: text('description'),
  // 'boolean' = 했다/안했다, 'number' = 수치(물 2L)
  type: text('type').notNull().default('boolean'),
  targetValue: integer('target_value'), // type='number' 인 경우 목표
  unit: text('unit'),                   // 'L', 'min', 'reps'
  icon: text('icon'),                   // 이모지
  color: text('color'),
  schedule: text('schedule'),           // JSON: weekdays [1,2,3,4,5] 등
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  displayOrder: integer('display_order').default(0),
  ...timestamps,
}, (t) => ({
  userActiveIndex: index('idx_habit_user_active').on(t.userId, t.isActive),
}));

// -- Habit Logs --
export const habitLogs = sqliteTable('habit_logs', {
  id: id(),
  userId: userId(),
  habitId: text('habit_id').notNull().references(() => habits.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),        // YYYY-MM-DD
  value: integer('value').notNull(),   // boolean=1, number=수치
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  habitDateIndex: index('idx_hl_habit_date').on(t.habitId, t.date),
  userDateIndex: index('idx_hl_user_date').on(t.userId, t.date),
}));

// -- Workouts (ASIS 운동 로그 복원) --
export const workouts = sqliteTable('workouts', {
  id: id(),
  userId: userId(),
  date: text('date').notNull(),
  // JSON array: ['등', '가슴', '하체', '유산소'] (ASIS Multi-select)
  categories: text('categories').notNull(),
  durationMinutes: integer('duration_minutes'),
  intensity: integer('intensity'),     // 1-5
  notes: text('notes'),                // Tiptap JSON (운동 세트, 무게, 리듬)
  ...timestamps,
}, (t) => ({
  userDateIndex: index('idx_wo_user_date').on(t.userId, t.date),
}));

// -- Daily Log People Relations (Notion diary related people restore) --
export const dailyLogPeopleRelations = sqliteTable('daily_log_people_relations', {
  dailyLogId: text('daily_log_id').notNull().references(() => dailyLogs.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  context: text('context'), // 'notion_related_people'
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  pk: index('pk_daily_log_people').on(t.dailyLogId, t.personId),
  personIndex: index('idx_daily_log_people_person').on(t.personId),
}));

// -- Health Metrics (수면, 체중 등 연동 대비) --
export const healthMetrics = sqliteTable('health_metrics', {
  id: id(),
  userId: userId(),
  date: text('date').notNull(),
  sleepHours: real('sleep_hours'),
  sleepQuality: integer('sleep_quality'), // 1-5
  weight: real('weight'),
  restingHeartRate: integer('resting_heart_rate'),
  deepWorkMinutes: integer('deep_work_minutes'),
  stepsCount: integer('steps_count'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdate(() => new Date().toISOString()),
}, (t) => ({
  userDateIndex: index('idx_hm_user_date').on(t.userId, t.date),
}));

// -- Career & History (ASIS 복원) --
export const careerHistory = sqliteTable('career_history', {
  id: id(),
  userId: userId(),
  organization: text('organization').notNull(),
  role: text('role').notNull(),
  // 'full_time' | 'part_time' | 'freelance' | 'volunteer' | 'education' | 'military' | 'other'
  category: text('category').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),           // null = 현재
  location: text('location'),
  description: text('description'),    // Tiptap JSON (주요 성과)
  highlights: text('highlights'),      // JSON array of strings
  coverImageUrl: text('cover_image_url'),
  ...timestamps,
}, (t) => ({
  userStartIndex: index('idx_career_user_start').on(t.userId, t.startDate),
}));
```

---

## 10. 📥 Capture & AI 스키마 (`schema/capture.ts`)

```typescript
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { id, userId, timestamps } from './_helpers';

// Quick Capture 인박스 (AI 라우팅 전 또는 후)
export const quickCaptures = sqliteTable('quick_captures', {
  id: id(),
  userId: userId(),
  rawText: text('raw_text').notNull(),
  // 'pending' | 'routed' | 'manual' | 'dismissed'
  status: text('status').notNull().default('pending'),

  // AI 라우팅 결과
  suggestedDomain: text('suggested_domain'), // 'task' | 'zettel' | 'interaction' | 'diary' | 'habit'
  suggestedFields: text('suggested_fields'), // JSON
  confidence: real('confidence'),            // 0.0-1.0

  // 최종 라우팅된 엔티티
  routedEntityType: text('routed_entity_type'),
  routedEntityId: text('routed_entity_id'),

  ...timestamps,
}, (t) => ({
  userStatusIndex: index('idx_qc_user_status').on(t.userId, t.status),
}));

// AI 대화 히스토리 (Claude API 호출 로그, 선택적 기능)
export const aiConversations = sqliteTable('ai_conversations', {
  id: id(),
  userId: userId(),
  // 'routing' | 'summary' | 'review' | 'assistant'
  purpose: text('purpose').notNull(),
  input: text('input').notNull(),
  output: text('output').notNull(),
  model: text('model').notNull(),      // 'claude-haiku-4-5' | 'llama-3.3-70b'
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  userTimeIndex: index('idx_ai_user_time').on(t.userId, t.createdAt),
}));
```

---

## 11. 🔎 FTS5 가상 테이블 (`schema/fts.ts` — raw SQL)

Drizzle은 FTS5 가상 테이블을 직접 지원하지 않으므로 **마이그레이션 SQL로 관리**.

```sql
-- migrations/0002_fts.sql

-- Zettels 전문 검색
CREATE VIRTUAL TABLE zettels_fts USING fts5(
  zettel_id UNINDEXED,
  title,
  content_text,
  summary,
  category,
  tokenize = 'trigram remove_diacritics 2'
);

-- Zettels 동기화 트리거
CREATE TRIGGER zettels_ai AFTER INSERT ON zettels BEGIN
  INSERT INTO zettels_fts(zettel_id, title, content_text, summary, category)
  VALUES (new.id, new.title, new.content_text, new.summary, new.category);
END;
CREATE TRIGGER zettels_ad AFTER DELETE ON zettels BEGIN
  DELETE FROM zettels_fts WHERE zettel_id = old.id;
END;
CREATE TRIGGER zettels_au AFTER UPDATE ON zettels BEGIN
  UPDATE zettels_fts SET title=new.title, content_text=new.content_text,
    summary=new.summary, category=new.category WHERE zettel_id=new.id;
END;

-- Tasks 전문 검색 (동일 패턴)
CREATE VIRTUAL TABLE tasks_fts USING fts5(task_id UNINDEXED, title, content, tokenize='trigram');
-- + triggers

-- People 전문 검색
CREATE VIRTUAL TABLE people_fts USING fts5(person_id UNINDEXED, name, nickname, bio, core_value, tokenize='trigram');
-- + triggers

-- Media Logs 전문 검색
CREATE VIRTUAL TABLE media_fts USING fts5(media_id UNINDEXED, title, original_title, creator, review, tokenize='trigram');
-- + triggers

-- Daily Logs 전문 검색
CREATE VIRTUAL TABLE daily_logs_fts USING fts5(log_id UNINDEXED, date UNINDEXED, journal, meditation, gratitude, tokenize='trigram');
-- + triggers
```

> `trigram` 토크나이저는 한글 부분 문자열 검색에 가장 적합.

---

## 12. 🧭 Vectorize (의미 검색)

- 인덱스명: `zettel-embeddings`
- 차원: 1024 (`@cf/baai/bge-m3`)
- 메트릭: cosine
- 메타: `{ userId, zettelId, type, category }`

**동기화 전략**:
- Zettel `create/update` 시 `content_text`의 sha256 해시가 `vector_hash`와 다르면 재임베딩
- Cloudflare Workers AI로 임베딩 생성 → Vectorize upsert
- `vector_id` 저장

---

## 13. 📊 ERD (Domain View)

```
┌────────── AUTH ──────────┐
│ users ─┬─ sessions        │
└────────┼─────────────────┘
         │
  ┌──────┴────────────────────────────────────────────┐
  │ all tables have user_id                           │
  │                                                    │
  ▼                    ▼                ▼             ▼           ▼
ACTION HUB         VAULT           PRM           LIFE OPS       CAPTURE
                                                                  │
projects           zettels ─────┐  people ───┐  daily_logs       │
  └─ tasks           └─ links   │    ├─ interactions   └─ habit_logs  │
       ├─ checklists            │    ├─ gifts              └─ habits  │
       ├─ task_people ──────────┼────┘                                │
       └─ task_zettel ──────────┘      ├─ network_edges               │
                                       └─ zettel_people ◄─┐           │
  media_logs ──── media_people ◄───────┘                  │           │
  assets                                                  │           │
  places ─── place_visits                                 │           │
  career_history                                          │           │
                                                                      │
                                                           quick_captures
                                                           ai_conversations

SHARED: tags ── taggings (polymorphic) / attachments / audit_logs
```

---

## 14. 인덱스 요약 (성능 필수)

| 인덱스 | 용도 | 예상 쿼리 |
|---|---|---|
| `idx_task_due` | 캘린더/오늘 뷰 | `WHERE due_at BETWEEN ... AND user_id=?` |
| `idx_task_user_status` | 칸반 컬럼 | `WHERE user_id=? AND status=?` |
| `idx_person_last_contact` | Hit-Them-Up | `WHERE last_contacted_at < ?` |
| `idx_intr_person_time` | 인물 타임라인 | `WHERE person_id=? ORDER BY occurred_at DESC` |
| `idx_dl_user_date` | Daily Log 조회 | `WHERE user_id=? AND date=?` |
| `idx_hl_habit_date` | Heatmap | `WHERE habit_id=? AND date BETWEEN ...` |
| `idx_zettel_slug` | URL 해석 | `WHERE user_id=? AND slug=?` |
| `idx_taggings_poly` | 태그 필터 | `WHERE taggable_type=? AND taggable_id=?` |

---

## 15. 트리거 정책 (D1 raw SQL)

### 15.1. `people.last_contacted_at` 자동 업데이트

```sql
CREATE TRIGGER update_last_contact_on_interaction
AFTER INSERT ON interactions
BEGIN
  UPDATE people
  SET last_contacted_at = NEW.occurred_at
  WHERE id = NEW.person_id AND (last_contacted_at IS NULL OR last_contacted_at < NEW.occurred_at);
END;
```

### 15.2. `places.last_visited_at` / `visit_count` 자동 업데이트

```sql
CREATE TRIGGER update_place_on_visit
AFTER INSERT ON place_visits
BEGIN
  UPDATE places
  SET last_visited_at = NEW.visited_at,
      visit_count = (SELECT COUNT(*) FROM place_visits WHERE place_id = NEW.place_id),
      first_visited_at = COALESCE(first_visited_at, NEW.visited_at)
  WHERE id = NEW.place_id;
END;
```

### 15.3. `projects.progress` 캐시

→ 트리거 대신 **Server Action에서 명시적 재계산**. 트리거 폭주 방지.

---

## 16. 마이그레이션 워크플로

```bash
# 스키마 변경 후
pnpm drizzle-kit generate       # migrations/XXXX_*.sql 생성
pnpm drizzle-kit check          # 충돌 확인

# 로컬 적용
wrangler d1 migrations apply light-house-db --local

# 원격 적용
wrangler d1 migrations apply light-house-db --remote

# FTS5 / 트리거 등 수동 SQL은 migrations/ 폴더에 직접 추가
# 파일명: 0002_fts_virtual_tables.sql
```

---

## 17. 백업 정책

- **일 1회** (03:00 KST) Cron Trigger가 `wrangler d1 export` 실행 → R2 `backups/d1/YYYY-MM-DD.sql`
- **R2 Lifecycle**: 90일 경과 파일 자동 삭제
- **수동 내보내기**: Settings → Data 페이지에서 JSON 압축 파일로 다운로드

---

**다음**: [`04_API_SPECIFICATION.md`](./04_API_SPECIFICATION.md)에서 이 스키마를 노출하는 API를 정의한다.
