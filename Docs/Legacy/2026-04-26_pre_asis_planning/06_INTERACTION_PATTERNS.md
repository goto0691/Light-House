# ⚡ Interaction Patterns

> **선행 문서**: [`05_PAGE_SPECIFICATIONS.md`](./05_PAGE_SPECIFICATIONS.md)
> **대상**: Frontend + Backend 에이전트
> **목표**: 페이지 경계를 넘는 글로벌 상호작용 — Mention, Command Palette, Quick Capture, Drawer, Automation — 을 구현 가능한 수준으로 확정.

---

## 1. Mention 시스템 (`@` / `[[` / `#`)

### 1.1. 개요

Tiptap 에디터와 일반 Input 양쪽에서 **3가지 트리거**를 지원한다:

| 트리거 | 대상 | 결과 노드 타입 |
|---|---|---|
| `@` | `people` | `mention.person` |
| `[[` | `zettels` + `media_logs` + `places` | `mention.entity` |
| `#` | `tags` | `mention.tag` |

### 1.2. Tiptap Extension 스펙

```typescript
// components/shared/editor/extensions/mention.ts

export const PersonMention = Mention.extend({
  name: 'personMention',
  addAttributes: () => ({
    personId: { default: null, parseHTML: el => el.getAttribute('data-person-id') },
    label: { default: '' },
  }),
}).configure({
  HTMLAttributes: { class: 'inline-mention inline-mention--person' },
  suggestion: personSuggestionConfig,
});

// 렌더링 HTML
// <span class="inline-mention inline-mention--person" data-person-id="...">@재민</span>
```

### 1.3. 자동완성 로직

1. 사용자가 `@` 입력 → 드롭다운 오픈
2. 이후 타이핑을 debounce 150ms 후 `listPeople({ search })`
3. ↑↓ 선택, Enter 확정
4. **확정 시**:
   - 에디터에 `@재민` 인라인 노드 삽입
   - **Side Effect**: 현재 문서의 `ownerType`/`ownerId`에 따라 브릿지 테이블 INSERT
     - `taskId` 있으면 → `task_people_relations`
     - `zettelId` 있으면 → `zettel_people_relations`
     - 등등
5. **중복 방지**: 이미 존재하면 무시 (UNIQUE KEY)

### 1.4. 링크 동기화 규칙

- **에디터 내 삭제** → 브릿지 row 유지 (의도적 기록일 수 있음). 대신 Drawer의 "Linked People" 섹션에서 × 눌러야 제거
- **Person 삭제** → `ON DELETE CASCADE`로 브릿지 자동 정리
- **에디터 다시 타이핑** → dedupe 후 재연결

### 1.5. 렌더링 스타일

```css
.inline-mention {
  @apply inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-body;
  background: hsl(var(--primary) / 0.14);
  color: hsl(var(--primary));
  font-weight: 500;
  cursor: pointer;
}
.inline-mention--person { background: hsl(var(--dunbar-5) / 0.14); color: hsl(var(--dunbar-5)); }
.inline-mention--entity { background: hsl(var(--info) / 0.14); color: hsl(var(--info)); }
.inline-mention--tag    { background: hsl(var(--muted) / 0.6);  color: hsl(var(--muted-foreground)); }
```

**Hover 동작**: 0.5초 지연 후 미니 Popover로 요약 카드 표시 (이름/아바타/last contact).
**Click 동작**: Drawer 열기 (`?detail={type}:{id}`).

---

## 2. Command Palette (`Cmd+K`)

### 2.1. 레이아웃

- 화면 중앙 상단에서 20% 지점에 등장
- 너비 680px, 최대 높이 500px
- `.glass-elevated` + `shadow-lg`
- 배경 백드롭 `bg-black/40 backdrop-blur-sm`

### 2.2. 입력 규칙

| 입력 | 동작 |
|---|---|
| 일반 텍스트 | 전역 검색 (`/api/search`) |
| `>` 접두 | 액션 모드 (실행 가능한 명령어) |
| `@` 접두 | 사람 검색만 |
| `[[` 접두 | 엔티티 검색만 |
| `#` 접두 | 태그 검색 |
| `?` 접두 | 도움말/단축키 치트시트 |
| 빈 입력 + Enter | 최근 열었던 페이지 |

### 2.3. 결과 섹션 순서

```
1. 즉시 이동 (현재 컨텍스트 관련)
2. 최근 항목 (최근 열람 5개)
3. 검색 결과
   - 인물 (3개)
   - 지식 (3개)
   - 작업 (3개)
   - 미디어 (3개)
   - 장소 (2개)
4. 액션 (새 Task, 새 Zettel 등)
```

### 2.4. 단축키

| 키 | 동작 |
|---|---|
| `↑/↓` | 결과 이동 |
| `Enter` | 열기 (새 탭: `Cmd+Enter`) |
| `Cmd+Shift+Enter` | 우측 Drawer로 열기 |
| `Tab` | 섹션 점프 |
| `Esc` | 닫기 |

### 2.5. 구현 노트

- **라이브러리**: `cmdk` (Vercel)
- **상태**: Zustand store `useCommandPalette` (open/close, query)
- **검색 호출**: `useDebouncedQuery` 200ms
- **최근 항목**: localStorage `recent-entities` (LRU 20개)

### 2.6. Empty State

```
"아무것도 찾지 못했어요"

[Enter] 로 이 텍스트를 Quick Capture 로 보내기
```

---

## 3. Quick Capture (`Cmd+Shift+N`)

### 3.1. UI

- 모달 (`.glass-elevated`), 중앙 상단 15%
- 너비 560px, 높이 자동
- 상단: 제목 `빠른 입력` + 현재 컨텍스트 뱃지 (예: `📍 MODU WORKS 프로젝트`)
- 중앙: 멀티라인 Input (auto-grow, max 8줄)
- 하단: 3개 액션
  - `Enter` 보내기 (AI 라우팅)
  - `Shift+Enter` 줄바꿈
  - `Cmd+D` 도메인 강제 선택 (Task/Zettel/Interaction/Diary)

### 3.2. 플로우

```mermaid
[사용자 입력 → Enter]
     ↓
[POST /api/capture]
     ↓
[AI 라우팅 (Claude Haiku)]
     ↓
┌─ confidence ≥ 0.7 ─┐   ┌─ confidence < 0.7 ─┐
│ 자동 엔티티 생성    │   │ Inbox 저장         │
│ Toast: "Task 생성됨 │   │ Toast: "검토 필요"  │
│  → 이동"           │   │  → Inbox 링크       │
└────────────────────┘   └─────────────────────┘
```

### 3.3. Toast 패턴

```tsx
<Toast
  icon="🚀"
  title="Task가 생성되었어요"
  description="'호떡집 겨울 신메뉴 리서치' (P2)"
  actions={[
    { label: '열기', onClick: () => navigate(`/action-hub/...`) },
    { label: '실행 취소', onClick: () => deleteTask(id) },
  ]}
  duration={8000}
/>
```

### 3.4. Offline 핸들링

- 네트워크 실패 시 IndexedDB `pending_captures` 큐에 저장
- 온라인 복귀 시 Service Worker가 자동 재시도

---

## 4. Side Drawer

### 4.1. URL 규약

```
?detail={type}:{id}
```

- 예: `?detail=person:01JABC...`, `?detail=task:01XYZ...`
- 여러 개 겹쳐 열기: `?detail=person:xyz,task:abc` (우측부터 쌓임, 최대 2개)

### 4.2. 라이프사이클

1. URL이 변하면 `useDrawerRouter` 훅이 감지
2. 타입별 컴포넌트 동적 로드 (`React.lazy`)
3. 진입 애니메이션: 오른쪽에서 slide-in (spring)
4. 닫기:
   - `Esc`
   - 백드롭 클릭
   - 다른 Drawer로 대체
5. 내부 상태(스크롤 위치 등)는 브라우저 뒤로가기로 복원 가능 (scroll restoration)

### 4.3. Drawer 템플릿

```tsx
<Drawer width={480}>
  <DrawerHeader>
    <DrawerTitle />       {/* 엔티티 타이틀 */}
    <DrawerActions>       {/* 편집/삭제/공유 */}
  </DrawerHeader>
  <DrawerTabs>            {/* 선택적 탭 */}
  <DrawerScrollArea>
    {children}
  </DrawerScrollArea>
  <DrawerFooter />
</Drawer>
```

### 4.4. 타입별 Drawer 매핑

| Type | 컴포넌트 | 기본 탭 |
|---|---|---|
| `person` | `<PersonDrawer>` | Timeline / Info / Relations |
| `task` | `<TaskDrawer>` | Overview / Checklist / Links |
| `zettel` | `<ZettelDrawer>` | Content / Backlinks |
| `media` | `<MediaDrawer>` | Detail / Review |
| `interaction` | `<InteractionDrawer>` | Summary / Protocol |
| `gift` | `<GiftDrawer>` | Detail |
| `place` | `<PlaceDrawer>` | Info / Visits |

---

## 5. 키보드 단축키 시스템

### 5.1. 전역 단축키

| 키 | 동작 |
|---|---|
| `Cmd+K` | Command Palette |
| `Cmd+Shift+N` | Quick Capture |
| `Cmd+\` | LNB 토글 |
| `?` | 단축키 치트시트 오버레이 |
| `Esc` | 최상위 오버레이/Drawer 닫기 |

### 5.2. Navigation (g + key)

| 키 | 이동 |
|---|---|
| `g d` | Dashboard |
| `g a` | Action Hub |
| `g v` | Vault |
| `g p` | PRM |
| `g l` | Life Ops |
| `g s` | Settings |
| `g t` | Today (Life Ops) |

### 5.3. Creation (c + key)

| 키 | 생성 |
|---|---|
| `c t` | 새 Task |
| `c z` | 새 Zettel (Fleeting) |
| `c p` | 새 Project |
| `c n` | 새 Person |
| `c i` | 새 Interaction |

### 5.4. 구현

```typescript
// lib/hotkeys/registry.ts
import { HotkeysProvider, useHotkeys } from 'react-hotkeys-hook';

export const GLOBAL_HOTKEYS = [
  { combo: 'mod+k',         action: 'openCommandPalette' },
  { combo: 'mod+shift+n',   action: 'openQuickCapture' },
  { combo: 'mod+backslash', action: 'toggleLNB' },
  { combo: 'g>d',           action: 'navigate:/dashboard' },
  // ...
];
```

### 5.5. 컨텍스트 스코프

- `HotkeysProvider` 스코프를 Drawer/Modal에서 재정의
- 에디터 포커스 중에는 `g a` 등 텍스트 입력으로 간주 (예외 처리)

---

## 6. 자동화 엔진 (Cron)

### 6.1. Workers Cron Triggers 설정 (`wrangler.toml`)

```toml
[triggers]
crons = [
  "*/15 * * * *",    # hit_them_up
  "0 3 * * *",       # daily_backup (03:00 KST → UTC 18:00 전날)
  "0 0 * * 1",       # weekly_review (월요일 00:00)
  "0 9 * * *",       # birthday
  "0 4 * * 0",       # hard_delete
]
```

### 6.2. 작업 상세

#### A. Hit-Them-Up (`*/15 * * * *`)

```sql
SELECT p.* FROM people p
WHERE p.user_id = ?
  AND p.status = 'active'
  AND p.deleted_at IS NULL
  AND (
    p.last_contacted_at IS NULL
    OR datetime(p.last_contacted_at, '+' || p.contact_cadence_days || ' days') < datetime('now')
  )
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_id = p.id AND n.kind = 'hit_them_up'
      AND datetime(n.created_at) > datetime('now', '-3 days')
  )
```

→ 결과 인물당 `notifications` INSERT.
→ 3일 내 동일 알림이 있으면 중복 방지.

#### B. Daily Backup (`0 3 * * *`)

1. `wrangler d1 execute --remote --command=".dump"` 상응하는 API 호출
2. 결과 SQL을 gzip → R2 `backups/d1/YYYY-MM-DD.sql.gz`
3. 30일 이상 된 백업 삭제 (R2 lifecycle)

#### C. Weekly Review (`0 0 * * 1`)

1. 지난 주 `daily_logs` + `tasks(completed)` + `zettels(created)` + `interactions` 수집
2. Claude Haiku 4.5에게 요약 요청 (system prompt: "주간 회고 코치")
3. 결과를 새 Zettel (type=`permanent`, category=`주간회고`)로 자동 저장
4. 알림 생성

#### D. Birthday (`0 9 * * *`)

```sql
-- 7일 이내 생일 (연도 무시, 월-일 비교)
SELECT * FROM people
WHERE strftime('%m-%d', birth_date) BETWEEN strftime('%m-%d', 'now') AND strftime('%m-%d', 'now', '+7 days')
  AND user_id = ? AND deleted_at IS NULL;
```

→ 알림 생성 + Gift 제안 CTA.

#### E. Hard Delete (`0 4 * * 0`)

```sql
DELETE FROM <table> WHERE deleted_at IS NOT NULL AND datetime(deleted_at) < datetime('now', '-90 days');
```

모든 soft-delete 테이블에 대해 반복.

### 6.3. Cron 수동 트리거 (테스트)

```
POST /api/webhooks/cron
Authorization: Bearer {CRON_SECRET}
Body: { "job": "hit_them_up" }
```

Settings > Integrations에 "지금 실행" 버튼 배치.

---

## 7. AI 자동 라우팅 프롬프트

### 7.1. System Prompt

```
You are the routing agent of Light House — a personal information management system.

Given a short piece of text from the user, you must decide which domain it belongs to
and extract structured fields. Always respond with ONLY a JSON object matching the schema.

Available domains:
- task: an actionable item (work, research, errand)
- zettel: a thought, insight, quote, idea worth keeping
- interaction: a meeting, call, or event with another person
- diary_entry: a personal reflection for today
- habit_log: a habit check-in
- media_log: a book/game/movie to log

Consider the context object which tells you where the user is right now.
```

### 7.2. Tool Use Schema

```json
{
  "name": "route_capture",
  "input_schema": {
    "type": "object",
    "properties": {
      "domain": { "type": "string", "enum": ["task", "zettel", "interaction", "diary_entry", "habit_log", "media_log"] },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "fields": { "type": "object" },
      "reasoning": { "type": "string" }
    },
    "required": ["domain", "confidence", "fields"]
  }
}
```

### 7.3. 도메인별 `fields` 스키마

- **task**: `{ title, priority?, dueAt?, projectId?, brainEnergy?, personIds? }`
- **zettel**: `{ title, content, type, category?, tags? }`
- **interaction**: `{ personName, type, summary, occurredAt }`
- **diary_entry**: `{ content }`
- **habit_log**: `{ habitName, value }`
- **media_log**: `{ mediaType, title, status }`

### 7.4. Caching

Anthropic API의 prompt caching을 활용 — system prompt를 캐시하여 95% 비용 절감.

---

## 8. 실시간성 / Optimistic Updates

### 8.1. 적용 범위

| 액션 | Optimistic |
|---|---|
| 체크리스트 토글 | ✅ |
| Task 상태 변경 | ✅ |
| 습관 체크 | ✅ |
| Mood 버튼 | ✅ |
| 태그 추가/삭제 | ✅ |
| 신규 생성 (Task/Zettel) | ❌ (ID가 서버 ULID이므로) |

### 8.2. TanStack Query 패턴

```typescript
const mutation = useMutation({
  mutationFn: toggleChecklist,
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: ['checklists', taskId] });
    const previous = queryClient.getQueryData(['checklists', taskId]);
    queryClient.setQueryData(['checklists', taskId], (old) => toggleInList(old, id));
    return { previous };
  },
  onError: (err, id, ctx) => {
    queryClient.setQueryData(['checklists', taskId], ctx.previous);
    toast.error('롤백했어요 — 다시 시도해 주세요');
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['checklists', taskId] }),
});
```

### 8.3. 햅틱 피드백

- 모바일: `navigator.vibrate(10)` (성공) / `navigator.vibrate([20, 10, 20])` (롤백)
- 데스크탑: subtle sound via Web Audio API (옵션, Settings)

---

## 9. Offline / PWA

### 9.1. Service Worker 전략

- **앱 쉘**: Cache First (`workbox.precaching`)
- **이미지 (Cloudflare Images)**: Stale While Revalidate, max-age 7d
- **API**: Network First, fallback to cache (읽기만)
- **Mutations**: **BackgroundSync Queue** — 오프라인 시 IndexedDB 저장, 복귀 시 재전송

### 9.2. manifest.json

```json
{
  "name": "Light House",
  "short_name": "LightHouse",
  "theme_color": "#FBBF24",
  "background_color": "#0E1116",
  "display": "standalone",
  "start_url": "/dashboard",
  "shortcuts": [
    { "name": "Quick Capture", "url": "/?capture=1", "icons": [...] },
    { "name": "Today's Log", "url": "/life-ops" }
  ]
}
```

### 9.3. 설치 유도

Dashboard 첫 진입 7일차부터 하단 우측에 작은 Glass Card로 "홈 화면에 추가" 유도 (1회 무시 시 30일 지연).

---

## 10. 드래그 & 드롭 패턴

### 10.1. 라이브러리

- `@dnd-kit/core` + `@dnd-kit/sortable`

### 10.2. 적용 영역

| 영역 | 동작 |
|---|---|
| 칸반 Task | 컬럼 간 이동 + 컬럼 내 정렬 → `moveTask` |
| Checklist | 세로 정렬 → `reorderChecklists` |
| LNB 프로젝트 | 수직 드래그 → `reorderProjects` |
| Bento Dashboard | 격자 드래그 → `updateLayout` (localStorage + server) |
| Drawer 내 Gallery | `attachments` 정렬 |

### 10.3. 상호작용 규칙

- 드래그 시작: 150ms hold or 8px 이동
- 시각 피드백: 그림자 상승 + 60% opacity 원본, 플레이스홀더는 dashed border
- 자동 스크롤: 뷰포트 가장자리 80px 근처
- 취소: `Esc`

---

## 11. 상태 관리 아키텍처

### 11.1. 계층

```
┌───────────────────────────────────┐
│ URL State (source of truth)       │ ← Next.js useSearchParams
├───────────────────────────────────┤
│ Server State (cacheable)          │ ← TanStack Query
├───────────────────────────────────┤
│ UI State (ephemeral, local)       │ ← Zustand / useState
├───────────────────────────────────┤
│ Persisted State (user prefs)      │ ← localStorage + Zustand persist
└───────────────────────────────────┘
```

### 11.2. Zustand Store 목록

- `useCommandPalette` — open, query, recent
- `useQuickCapture` — open, context
- `useShell` — lnbCollapsed, zenMode
- `useHotkeyDialog` — cheatsheet open
- `useNotifications` — unread count cache

### 11.3. 금지 사항

- 서버 데이터를 Zustand에 담지 말 것 → TanStack Query가 소스
- URL로 표현 가능한 상태는 URL에 (공유/복원 가능)

---

## 12. 알림 / Toast 규약

### 12.1. 레벨

| 레벨 | 색상 | 예 |
|---|---|---|
| `success` | `--success` | 저장됨, 생성됨 |
| `info` | `--info` | 라우팅됨, 알림 |
| `warning` | `--warning` | 오프라인, 재시도 중 |
| `error` | `--danger` | 실패 |

### 12.2. 위치 / 라이프

- 우하단, 세로 스택
- 기본 4초, action 있으면 8초
- `error`는 수동 닫기 필요
- 최대 5개 동시, 초과 시 큐 대기

### 12.3. 구현

Sonner 라이브러리 사용, `.glass` 변형 커스텀.

---

## 13. 검색 UX 상세

### 13.1. 스니펫 강조

FTS5 `snippet()` 함수:
```sql
SELECT snippet(zettels_fts, 2, '<mark>', '</mark>', '…', 16) AS snippet
FROM zettels_fts WHERE zettels_fts MATCH ?
```

### 13.2. 정렬 우선순위

1. **타이틀 매치** (부스트 ×3)
2. **정확한 구절** (부스트 ×2)
3. **최근 업데이트** (부스트 ×1.5)
4. BM25 기본 점수

### 13.3. Recent + Suggested

Command Palette 초기 상태:
- 최근 5
- AI 제안 3 (맥락 기반, 비동기 로드)

---

## 14. 접근성 상호작용 요약

- 모든 인터랙티브 요소 `role="button"` 또는 `<button>` 사용
- Drawer 오픈 시 포커스 트랩 + 내부 첫 포커스 가능 요소에 포커스
- 닫힐 때 트리거로 포커스 복귀
- 모달 열림 시 `aria-modal="true"`, 배경 `aria-hidden="true"`
- 라이브 영역(토스트) `role="status"` + `aria-live="polite"`

---

## 15. 에러 복원 전략

| 시나리오 | 복원 |
|---|---|
| Server Action 타임아웃 | TanStack Query 자동 재시도 3회, exponential backoff |
| AI 라우팅 실패 | 일반 Inbox에 저장, 사용자가 수동 처리 |
| Drawer 로드 실패 | "다시 시도" 버튼 + 에러 ID |
| 에디터 저장 실패 | localStorage 자동 스냅샷, 복귀 시 "복구하시겠어요?" |
| 이미지 업로드 실패 | 재시도 큐 + 토스트 |

---

**다음**: [`07_DEVELOPMENT_ROADMAP.md`](./07_DEVELOPMENT_ROADMAP.md)에서 이 모든 문서를 기반으로 실제 개발 순서를 정한다.
