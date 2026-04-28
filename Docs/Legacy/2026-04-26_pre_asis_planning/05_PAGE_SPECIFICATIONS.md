# 📄 Page Specifications

> **선행 문서**: [`04_API_SPECIFICATION.md`](./04_API_SPECIFICATION.md)
> **대상**: Frontend 에이전트
> **목표**: 5대 도메인 모든 페이지의 레이아웃·상태·컴포넌트·데이터 소스를 하나의 문서에 고정.

각 페이지 스펙은 다음 포맷을 따른다:
- **Route** — Next.js 경로
- **Purpose** — 한 줄 목적
- **Layout** — 패널 구조 및 모드
- **Data Sources** — 호출할 Server Action / Route Handler (from `04_API_SPECIFICATION.md`)
- **Components** — 사용할 컴포넌트 (from `02_DESIGN_SYSTEM.md`)
- **Interactions** — 사용자 동작 → 결과
- **Loading & Empty** — 상태 처리
- **Hotkeys** — 단축키

---

## 0. 공통 Shell (`app/(app)/layout.tsx`)

**구조**:
```tsx
<AuthGuard>
  <ShellProvider>
    <GlobalNav />                    {/* 64px 고정 */}
    <LocalNav />                     {/* 220px, collapsible */}
    <main className="flex-1 overflow-hidden">
      <Breadcrumb />                 {/* 48px sticky */}
      <CanvasTransition>{children}</CanvasTransition>
    </main>
    <SideDrawerHost />               {/* URL ?detail= 감지 */}
    <CommandPalette />               {/* Cmd+K 트리거 */}
    <QuickCaptureModal />            {/* Cmd+Shift+N */}
    <ToastViewport />
  </ShellProvider>
</AuthGuard>
```

**Shell Context**:
- `isLNBCollapsed`, `setIsLNBCollapsed`
- `activeDomain` (derived from pathname)
- `notifications` (최신 10개, SWR)

**Loading**: Streaming with `<Suspense>` around `{children}`.

---

## 1. 🏠 Dashboard

### 1.1. `/dashboard` — Home Brief

| 속성 | 값 |
|---|---|
| Purpose | 오늘 하루의 통합 브리핑 (30초 내 파악) |
| Layout | **Bento Grid** (12 columns × 자유 row) |
| Data Sources | `getDailyLog(today)`, `listNeedsContact()`, `listTasks({dueBefore:tomorrow, limit:10})`, `getHabitHeatmap`, `listZettels({limit:5, sort:'updated'})`, `getHealthTrend('sleepHours', 7)` |

**Bento 구성 (기본 레이아웃)**:

| 카드 | Span | 내용 |
|---|---|---|
| `<TodaysAnchor>` | 12×1 | 오늘 날짜 + 인사말 + Mood/Energy 원클릭 + 한 줄 의도 입력 |
| `<ActiveTasksWidget>` | 8×3 | `P1` 상단, `Hyper Focus` 보라 강조, 체크 가능 |
| `<HitThemUpWidget>` | 4×3 | 연락 시급 인물 Top 5 카드 스택 |
| `<StreakHeatmapWidget>` | 8×2 | 올해 전체 Heatmap (habits 통합) |
| `<BrainEnergyGauge>` | 4×2 | 오늘의 에너지 레벨 + 이번 주 추이 Sparkline |
| `<RecentZettelsWidget>` | 6×2 | 최근 업데이트된 Zettel 5개 |
| `<UpcomingBirthdays>` | 6×2 | 30일 내 생일 리스트 + 선물 제안 CTA |
| `<QuoteOfDay>` | 12×1 | 영구 메모 중 랜덤 한 줄 (세리프) |

**Components**: `<BentoGrid>`, `<BentoCard>`, `<Heatmap>`, `<Sparkline>`, `<Tag>`, `<GlassCard>`.

**Interactions**:
- 위젯 우상단 `…` → 숨기기 / 새로고침 / 설정
- Task 클릭 → Drawer (`?detail=task:{id}`)
- Person 카드 클릭 → Drawer (`?detail=person:{id}`)

**Hotkeys**:
- `g d` 현재 페이지
- `n` → Quick Capture
- `j`/`k` → 위젯 간 포커스 이동

**Loading**: 각 카드가 독립적으로 Skeleton (Suspense 경계 분리).

**Empty**: 첫 방문 시 온보딩 체크리스트 (Zettel 1개, Person 1명, Habit 1개 생성 유도).

### 1.2. `/life-ops` (Today's Log) — Life Ops Landing

→ Dashboard와 유사하나 **Life Ops 중심**으로 축소. 상세는 6장 참조.

---

## 2. 🚀 Action Hub

### 2.1. `/action-hub` — Project Landing

| 속성 | 값 |
|---|---|
| Purpose | 전 프로젝트/영역을 한눈에 |
| Layout | Directory 모드, 2열 (프로젝트 / Areas) |
| Data | `listProjects()` |
| Components | `<ProjectCard>`, `<Tabs>` (All / Project / Area / Archived) |

**ProjectCard**:
- 제목, 아이콘, 카테고리 뱃지
- 진척률 원형 프로그레스 (SVG)
- 남은 P1 개수
- 다음 마감 (D-day)
- 최근 활동 (마지막 Task 업데이트 시각)
- 클릭 → `/action-hub/{id}`

**Hotkeys**: `c p` 새 프로젝트

### 2.2. `/action-hub/inbox` — 라우팅 대기함

| Purpose | Quick Capture된 미분류 Task 관리 |
| Layout | List 모드 |
| Data | `listTasks({ projectId: null })` + `quickCaptures WHERE status='pending'` |
| Components | `<InboxItemRow>` — AI 제안을 보여주고 수락/수정/삭제 |

### 2.3. `/action-hub/{projectId}` — Kanban (기본)

| Purpose | 프로젝트 내 Task 칸반 |
| Layout | Kanban 5 컬럼: Backlog(Todo) / In Progress / Review / Done / Blocked |
| Data | `listTasks({ projectId })` |
| Components | `<KanbanBoard>`, `<KanbanColumn>`, `<TaskCard>`, `<ViewSwitcher>` |

**TaskCard**:
- 제목 (2줄 최대)
- `<Tag variant="priority">` + `<Tag variant="energy">`
- D-day + 아바타(협력자)
- 체크리스트 n/m 프로그레스
- 드래그 핸들

**View Switcher**: `[Kanban] [Calendar] [List]` → URL `?view=`

**Interactions**:
- Task 드래그 → `moveTask(toStatus, toIndex)` (Optimistic)
- 카드 클릭 → Drawer (빠른 편집) 또는 `/action-hub/{id}/tasks/{taskId}` (전체화면)
- `Shift+클릭` → 다중 선택 + 일괄 작업 (bulk status/priority)

**Filter Bar** (상단 우측):
- Priority, Energy, Assignee(Person), Tag 드롭다운 필터
- 검색 input (`?q=`)
- `Save View` (URL 쿼리를 localStorage 프리셋으로)

### 2.4. `/action-hub/{projectId}/calendar` — 캘린더 뷰

| Data | `listTasks({ projectId, from, to })` |
| Components | FullCalendar 래퍼 또는 커스텀 그리드 |
| Interactions | 드래그 → `updateTask({ startAt, dueAt })` |

### 2.5. `/action-hub/{projectId}/list` — 리스트/데이터 그리드

| Components | TanStack Table 기반 `<DataGrid>` |
| Features | 컬럼 resize/reorder/hide, 정렬, 무한 스크롤 |

### 2.6. `/action-hub/{projectId}/tasks/{taskId}` — Zen Workspace

| Purpose | 개발 티켓 편집 또는 집필 |
| Layout | **Deep Work Mode**: 좌 30% 메타 + 우 70% 에디터 |
| Data | `getTask(id)` |

**좌측 30% 패널**:
- Task 제목 (인라인 편집)
- 메타 블록: Priority / Energy / Status (원클릭 토글)
- 일정: Start / Due (Popover 달력)
- Linked People (@mention 추가, 클릭 시 PRM Drawer)
- Linked Zettels ([[ ]] 추가)
- Checklist (드래그 정렬, 토글 즉시 반영, 프로그레스 바 상단)
- Attachments (드롭 업로드)
- Audit log (하단 접기)

**우측 70% 패널**:
- `<ZenEditor>` (Tiptap)
- 상단 툴: `Zen 모드 토글 (F11)`, `분할 뷰 (Cmd+\)`, `글자수 / 단어수`
- 자동 저장 (1s debounce) → `saveTaskContent`
- 집필 모드(kind='writing'): 본문 `font-serif`, max-w-prose
- 개발 모드(kind='development'): `font-sans`, 체크리스트 중심

**Split View (Cmd+\)**: 우측 에디터가 50/50으로 쪼개지고 `<SidekickPanel>` (Zettel/Person 검색) 등장.

**Hotkeys**:
- `Esc` → 프로젝트 칸반으로 복귀
- `Cmd+S` 수동 저장 (확인용, 실제로는 자동)
- `Cmd+Enter` 완료 처리
- `Cmd+.` 상태 사이클

**Loading**: 에디터 쪽 Skeleton, 메타는 즉시 로드.

---

## 3. 🧠 The Vault

### 3.1. `/vault` — 기본 진입

→ `/vault/zettels`로 리다이렉트

### 3.2. `/vault/zettels` — Zettel Split View

| Layout | **3단 Split**: 리스트 320px / 에디터 유동 / 백링크 280px |
| Data | `listZettels()`, 선택 시 `getZettel`, `getBacklinks` |
| Components | `<ZettelList>`, `<ZenEditor>`, `<BacklinkPanel>` |

**좌측 리스트**:
- 타입 탭: `Fleeting` / `Literature` / `Permanent` / `MOC`
- 검색 (FTS5), 태그 필터
- 카드: 제목, 한 줄 요약, 태그, 최종 수정일
- 정렬: 수정일 최신순 (기본)

**중앙 에디터** (선택된 Zettel):
- 제목 (h1 세리프)
- 메타: 타입, 카테고리, 출처, 태그
- 본문 (Tiptap, `@` `[[` `#` 지원)
- 하단 Fleeting → Permanent 승격 버튼 (`promoteZettel`)

**우측 백링크 패널**:
- "이 메모를 참조하는 n개" 리스트
- 각 항목 호버 시 컨텍스트 스니펫
- 아래: "관련 제안" — 의미 검색(semanticSearchZettels) 결과 5개

**Hotkeys**:
- `Cmd+N` 새 Fleeting
- `Cmd+G` 그래프 뷰 이동
- `j/k` 리스트 항목 이동
- `/` 리스트 검색 포커스

**Empty (리스트)**: "첫 번째 원석을 던져보세요" + 큰 `+` 버튼.

### 3.3. `/vault/zettels/graph` — Network Graph

| Purpose | Zettel 망 시각화 |
| Data | `getZettelGraph({ depth: 3 })` |
| Components | `<NetworkGraph>` (react-force-graph) |

**Features**:
- 줌/팬
- 노드 클릭 → Drawer로 상세
- 미니맵
- 필터 바: 타입별 노드 표시/숨김
- 검색으로 노드 포커스 (카메라 이동)

### 3.4. `/vault/zettels/{slug|id}` — 딥링크 상세

Split View의 중앙 패널만 전체 화면. 모바일 / 공유 링크용.

### 3.5. `/vault/media` — 통합 미디어 갤러리

| Layout | Masonry Grid |
| Data | `listMedia()` |
| Components | `<MediaCard>`, `<FilterBar>` |

**MediaCard**:
- 커버 이미지 (16:9 또는 2:3, mediaType에 따라)
- 제목, 크리에이터, 평점 (⭐)
- 상태 뱃지 (backlog/consuming/completed/dropped)
- 호버 시 Glass overlay + Quick actions (상태 변경 / Drawer 열기)

**FilterBar**:
- Type: All / Games / Books / Screens
- Status 체크박스
- Genre 태그
- 정렬: 최근 추가 / 평점 높은 / 완료일

**Create**: 우상단 `+` → Modal:
- URL 붙여넣기 → `enrichMediaFromSource`로 자동 채움

### 3.6. `/vault/media/games|books|screens` — 타입별 뷰

`/vault/media?mediaType=...`로 필터 프리셋만 다름.

### 3.7. `/vault/media/{id}` — 상세 (Drawer 또는 페이지)

- 커버 + 갤러리 (스크린샷 attachment)
- 메타: 장르, 플랫폼, 크리에이터, 제작사, 출시년도
- 별점 슬라이더 (1~5, 0.5 단위)
- 긴 리뷰 에디터 (Tiptap)
- 관련 Zettel (링크 추가)
- 추천자 (Person 멘션)

### 3.8. `/vault/assets` — 장비/수집품

Masonry 또는 Table (토글). 카테고리별 세그먼트.

### 3.9. `/vault/places` — 장소 & 방문 기록

| Layout | 지도 + 리스트 |
| Components | Mapbox/Leaflet + `<PlaceCard>` |
| Features | 방문 기록 추가 시 Interaction도 함께 생성 가능 (Companion Person) |

---

## 4. 🤝 PRM

### 4.1. `/prm` — Card Grid + Drawer

| Layout | Directory 모드, 3~5 column responsive grid |
| Data | `listPeople()` |
| Components | `<PersonCard>`, `<FilterBar>`, `<Drawer>` |

**PersonCard**:
- 아바타 (이니셜 or 사진)
- 이름 + 닉네임
- Dunbar Layer 색상 점
- 그룹 뱃지 (최대 2개)
- **관계 건강도 시각**:
  - `lastContactedAt + cadence` 까지 일수 진행 바
  - 초과 시 카드 테두리 pulse `danger` 글로우
- 생일 7일 내: 🎂 뱃지

**FilterBar**: 상단 탭
- `All` / `🚨 Hit Them Up` / `⭐ Favorites` / `Dunbar 5/15/50/150`
- 그룹 드롭다운
- 검색 (이름/닉네임/bio FTS5)

**Drawer 상세** (`?detail=person:{id}`):
- 헤더: 사진 + 이름 + 메타 + 🎁 선물 수 / 📅 사건 수 / ✅ Task 수
- 액션 버튼: `연락했음 마킹` / `새 Interaction` / `새 Gift`
- 탭: `Timeline` / `Basic Info` / `Relations (Network)`

**Timeline 탭**:
- 시간 역순 혼합 피드: Interactions + Gifts + Tasks (linked) + Zettels (linked)
- 무한 스크롤
- 각 항목 인라인 편집 가능

**Basic Info 탭**:
- 연락처, 주소, 생일 (D-day), 핵심가치, SNS 링크, 자유 메모

**Relations 탭**:
- 미니 그래프: 이 인물과 연결된 사람들(network_edges)
- `+ 관계 추가`

**Hotkeys**:
- `Cmd+P` (PRM 내에서) 빠른 사람 찾기
- `m` 현재 Drawer 인물 `markContacted`

### 4.2. `/prm/graph` — 관계망 그래프

| Data | `getPRMGraph()` |
| Features | 클러스터링 (그룹별 색), 엣지 두께 = 상호작용 횟수 |

### 4.3. `/prm/gifts` — 선물 보드

| Layout | 준 것 / 받은 것 분리 탭 + Gallery |
| Features | 만족도별 필터, 연간 지출 합계, 선물 아이디어 AI 제안 |

### 4.4. `/prm/{personId}` — 딥링크용

Drawer가 아닌 전체 페이지. 내용은 Drawer와 동일하나 공유 가능.

---

## 5. ⚙️ Life Ops

### 5.1. `/life-ops` (redirect to `/life-ops/{today}`)

### 5.2. `/life-ops/{date}` — Daily Command Center

| Layout | 3행 구성 |
| Data | `getDailyLog(date)`, `listHabits()`, `getAllHabitsHeatmap(year)` |

**Row 1 — Top Strip (Mood / Energy / 날짜 네비)**:
- 날짜 제목 + 요일 + D-day (오늘 기준)
- Mood 5단계 이모지 버튼 (원클릭, 하단 파티클)
- Energy 5단계 버튼 (색상 그라디언트)
- Emotions 태그 pills (토글)

**Row 2 — Habit Tracker**:
- 카드 그리드 (n열, 반응형)
- 각 카드: 아이콘 + 제목 + 오늘 값 (boolean=체크, number=수치 입력)
- 체크 시 glow + 햅틱 (80ms)
- 우측에 Streak 불꽃 아이콘 + 일수

**Row 3 — Journaling & Data**:
- 좌 50%: 탭 Editor
  - `📔 일기` / `🙏 묵상` / `🙏 감사`
  - 각 탭은 Tiptap, 자동 저장
  - 묵상 탭은 상단 "본문말씀" 입력
- 우 50%: 데이터 카드
  - Sleep Hours Sparkline (최근 14일)
  - Deep Work 분 총합 (오늘)
  - 운동: 오늘 기록 카드 or `+ 운동 기록`
  - AI 요약 버튼 → `generateDailySummary`

**Row 4 (스크롤) — 오늘의 연결 (Auto-Join)**:
- 이 날짜에 발생한 모든 도메인 이벤트
  - Tasks completed (updatedAt today)
  - Zettels created/edited
  - Interactions (occurredAt today)
  - Gifts
- 시간순 타임라인

**Hotkeys**:
- `←` / `→` 전날/다음날
- `t` 오늘로
- `1-5` Mood 즉시 설정
- `w` 운동 추가 모달

**Loading**: Journal 영역은 Skeleton, 상단 바는 즉시.

**Empty**: 첫 날은 "오늘 기분이 어떠세요?" 5개 이모지 버튼만 크게.

### 5.3. `/life-ops/trends` — 추이 & 상관관계

| Layout | 그래프 그리드 |
| Data | `getHealthTrend`, `getHabitHeatmap`, 사용자 선택 |

**Widgets**:
- Mood × Sleep 상관 (산포도)
- 에너지 × 운동 (산포도)
- Habit 일별 달성률 Stacked Bar
- Deep Work 주간 추이 Line
- **Correlation Matrix** (핵심): 변수 간 피어슨 상관계수 heatmap

### 5.4. `/life-ops/habits` — Habit 관리

- 활성/비활성 탭
- 카드 드래그 순서
- 우상단 `+` 새 습관: 제목, 아이콘, 타입, 스케줄(요일 선택)
- Archive된 습관 복원

### 5.5. `/life-ops/workouts` — 운동 로그

| Layout | 달력 + 리스트 |
| Card | 날짜, 카테고리 칩, 소요 시간, 강도 별점 |
| Detail | 본문 Tiptap (세트/무게/리듬) |

### 5.6. `/life-ops/career` — 커리어 타임라인

| Layout | 수직 타임라인 (좌측 기간 바, 우측 카드) |
| Card | 조직, 역할, 성과 하이라이트, 배지 |
| Sort | 최신 → 과거 |

### 5.7. `/life-ops/meditations` & `/life-ops/diaries` — Archive

- Daily Log 중 해당 필드만 채워진 날짜 리스트
- 검색 (FTS5)
- 연도별 Heatmap (언제 얼마나 썼는지)

---

## 6. ⚙️ Settings

### 6.1. `/settings` — 프로필

- 사진 업로드, 표시 이름, 언어, 타임존
- 비밀번호 변경

### 6.2. `/settings/appearance`

- 테마: Dark / Light / System
- Bento 대시보드 레이아웃 편집 (드래그 재배치, 숨김)
- 폰트 크기 배율

### 6.3. `/settings/shortcuts`

- 전체 단축키 표 + 커스텀 바인딩

### 6.4. `/settings/data`

- 노션 가져오기: CSV / Notion Export zip 업로드 → 매핑 UI → 미리보기 → 실행
- 내보내기: JSON / Markdown 선택 → ZIP 다운로드
- 백업 내역: R2의 최근 30일 스냅샷 리스트 + 복원 버튼

### 6.5. `/settings/integrations`

- Anthropic API Key (AI 기능용, 개인 키 옵션)
- Cloudflare 접근 토큰 검증 상태
- Notion API (향후 양방향 동기화 대비)

### 6.6. `/settings/ai`

- AI 기능 on/off
- 월 사용량 현황 (ai_conversations 집계)
- 라우팅 confidence 임계값 슬라이더

---

## 7. 인증 페이지

### 7.1. `/login`

- 중앙 정렬 Glass Card (`max-w-md`)
- Light House 로고 (등대 + 빛)
- 이메일 / 비밀번호 + 로그인
- "첫 로그인 시 비밀번호 설정" 안내 (단일 사용자 가정)

---

## 8. 에러 페이지

- `not-found.tsx` — "길을 잃으셨나요?" + 로고 애니메이션
- `error.tsx` — "등대에 문제가 생겼습니다" + 재시도 버튼 + 에러 ID

---

## 9. 모바일 적응 요약

| 도메인 | 모바일 동작 |
|---|---|
| Dashboard | Bento 1열 쌓임, 위젯 접기 |
| Action Hub 칸반 | 컬럼 가로 스와이프 |
| Task Workspace | 하단 시트(Bottom Sheet)로 메타 정보 |
| Vault Zettels | 리스트 전체화면, 에디터는 별도 페이지 |
| PRM | 카드 2열, Drawer는 Bottom Sheet |
| Life Ops | 세로 스크롤, 스와이프로 전날/다음날 |

GNB는 하단 탭바로 이동 (5개 + 더보기).

---

## 10. 페이지 스캐폴딩 체크리스트

모든 페이지는 생성 시:
- [ ] `page.tsx` + `loading.tsx` + `error.tsx`
- [ ] Metadata (`generateMetadata`)
- [ ] Data Source를 RSC에서 직접 호출 또는 `Suspense` 내 비동기 컴포넌트
- [ ] Empty State 구현
- [ ] Skeleton 구현
- [ ] 주요 Hotkey 바인딩 (`useHotkeys`)
- [ ] a11y: heading 순서, aria, focus trap

---

**다음**: [`06_INTERACTION_PATTERNS.md`](./06_INTERACTION_PATTERNS.md)에서 페이지를 관통하는 상호작용(멘션, Command Palette, Quick Capture, Drawer)을 상세 정의한다.
