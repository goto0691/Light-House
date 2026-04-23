# 🗓️ Development Roadmap

> **선행 문서**: [`06_INTERACTION_PATTERNS.md`](./06_INTERACTION_PATTERNS.md)
> **대상**: Orchestrator + 모든 코딩 에이전트
> **목표**: 7개 Phase, 총 약 10주 스프린트. 각 Phase는 **독립적으로 데모 가능**하도록 설계.

---

## 0. 개발 원칙

1. **Vertical Slice First** — 각 Phase는 하나의 도메인을 DB → API → UI 끝까지 완성한다. 수평 레이어별 개발 금지.
2. **Test Before Next** — Phase 완료 조건에 통합 테스트 통과가 포함된다.
3. **문서 동기화** — 스키마/API 변경 시 해당 Docs 파일을 먼저 수정한 후 코드 작성.
4. **PR 단위** — 하나의 Phase는 여러 PR로 쪼개되, 각 PR은 Vercel 프리뷰가 동작해야 한다.
5. **Feature Flags** — 실험 기능은 `NEXT_PUBLIC_FLAG_*` 환경변수로 토글.

---

## 1. Phase 타임라인 (10주)

| Phase | 기간 | 목표 | 대표 산출물 |
|---|---|---|---|
| **P0. Foundation** | 1주 | 모노레포, 인증, Shell | 로그인 → 빈 Dashboard 진입 |
| **P1. Shared Layer** | 1주 | 공용 컴포넌트, 편집기, Drawer, Command Palette | Tiptap 에디터 + `@/[[`/` 멘션 |
| **P2. Life Ops** | 1.5주 | 일일 로그 + 습관 + Heatmap | Mood/Habit 원클릭, 연간 잔디 |
| **P3. PRM** | 1.5주 | 인물 카드 + Drawer 타임라인 + Hit-Them-Up Cron | 관계 건강도 자동화 |
| **P4. Action Hub** | 2주 | 프로젝트/칸반/캘린더/Zen 에디터 | 집필 + 개발 두 모드 공존 |
| **P5. The Vault** | 2주 | Zettel + 백링크 + 그래프 + 미디어 갤러리 | Vectorize 의미 검색 |
| **P6. Home + AI + Notion Import** | 1주 | Bento Dashboard, Quick Capture AI, 노션 이관 | 실사용 준비 |
| **P7. Hardening** | 자유 | 성능, PWA, 백업, 모바일 | v1 Launch |

---

## 2. 에이전트 역할 분담

| 에이전트 | 주 담당 | Phase에서의 역할 |
|---|---|---|
| **Backend Agent** | 스키마, Server Actions, Route Handlers, Cron | 매 Phase 선행 |
| **Frontend Shell Agent** | Shell, GNB/LNB, Drawer, 공통 컴포넌트 | P0–P1 집중 |
| **Frontend Domain Agent** (×5) | 도메인별 페이지/뷰 | P2–P6 병렬 가능 |
| **AI/Automation Agent** | Quick Capture 라우팅, 주간 요약, Vectorize | P5–P6 |
| **DevOps Agent** | Cloudflare 프로비저닝, CI/CD, 백업 | P0 + 지속 |
| **Migration Agent** | 노션 데이터 이관 스크립트 | P6 |
| **QA Agent** | Playwright E2E, 접근성 감사 | P7 집중, 매 Phase 체크 |

---

## 3. Phase 상세

### 3.1. P0. Foundation (1주)

**목표**: 인프라 + 빈 껍데기. 로그인 후 Dashboard까지 진입 가능.

#### DevOps
- [ ] Cloudflare 계정에 D1 / R2 / Vectorize / Workers AI 프로비저닝
- [ ] GitHub 리포지토리 + `main` / `develop` 브랜치
- [ ] GitHub Actions: PR 시 `typecheck + lint + test + build`
- [ ] Vercel 프로젝트 연결 (Preview 자동)
- [ ] `wrangler.toml` 환경변수 관리 (dev/preview/prod)

#### Backend
- [ ] `packages/db` 패키지 초기화
- [ ] `schema/auth.ts` (users, sessions)
- [ ] Drizzle migrate 스크립트
- [ ] Lucia 세팅 (argon2 해시)
- [ ] `seed.ts` — 관리자 사용자 1명

#### Frontend Shell
- [ ] Next.js 15 App Router 스캐폴딩
- [ ] Tailwind v4 + `globals.css` + 디자인 토큰
- [ ] `(auth)/login/page.tsx` + Server Action
- [ ] `(app)/layout.tsx` 3-pane Shell (정적)
- [ ] `<GlobalNav>` 기본 구조 (라우팅만)
- [ ] `<LocalNav>` 섀시 (도메인별 조건부 렌더)
- [ ] `<Breadcrumb>` 자동 생성 훅
- [ ] `<ThemeProvider>` (next-themes, 기본 Dark)
- [ ] 404 / error.tsx 페이지

#### 완료 조건 (Exit Criteria)
- 이메일/비밀번호 로그인 → `/dashboard` 리다이렉트
- 5개 GNB 아이콘 클릭으로 경로 변경 (빈 페이지라도 OK)
- Lighthouse 데스크탑 점수 > 90
- CI 파이프라인 그린

---

### 3.2. P1. Shared Layer (1주)

**목표**: 모든 도메인이 의존하는 공통 UI 인프라 완성.

#### Backend
- [ ] `schema/shared.ts` (tags, taggings, attachments, audit_logs, notifications)
- [ ] `schema/capture.ts` (quick_captures, ai_conversations)
- [ ] FTS5 가상 테이블 **틀만** 생성 (콘텐츠는 Phase별로)
- [ ] `/api/upload/signed-url` + `/api/upload/complete` (R2)
- [ ] `/api/search` skeleton (빈 응답 OK)
- [ ] Rate limit 미들웨어

#### Frontend Shell
- [ ] `<GlassCard>`, `<Tag>`, `<Drawer>`, `<Modal>`, `<Toast>` 공용 컴포넌트
- [ ] `<CommandPalette>` cmdk 기반, 빈 결과/최근/검색 섹션
- [ ] `<QuickCaptureModal>` — 라우팅 없이 일단 `quick_captures`에 raw_text만 저장
- [ ] `<ZenEditor>` Tiptap 래퍼 + 슬래시 커맨드
- [ ] Mention extension 3종 (`@` `[[` `#`) — **stub 자동완성** (하드코딩 리스트로 UI 검증)
- [ ] `<Heatmap>`, `<Sparkline>` 프리미티브
- [ ] `<BentoGrid>` / `<BentoCard>` 배치
- [ ] 전역 Hotkey 레지스트리 + 치트시트 오버레이
- [ ] URL-driven Drawer Host (`?detail=`)

#### 완료 조건
- `Cmd+K` 열림/닫힘, 빈 검색 결과 표시
- `Cmd+Shift+N`으로 캡처 모달 → `quick_captures` row 생성 확인
- Tiptap에서 `@`/`[[`/`#` 시 드롭다운 오픈 (실제 검색은 P3 이후)
- Drawer가 URL 변경으로 열리고 `Esc`로 닫힘
- `?` 키로 치트시트 표시

---

### 3.3. P2. Life Ops (1.5주)

**목표**: 하루의 앵커 — 가장 자주 쓸 페이지를 먼저 완성해 드리븐.

#### Backend
- [ ] `schema/life-ops.ts` 전체
- [ ] Server Actions: `getDailyLog`, `upsertDailyLog`, `setMood`, `setEnergy`, `saveJournal`
- [ ] Habits CRUD + `logHabit` / `unlogHabit`
- [ ] `getHabitHeatmap`, `getAllHabitsHeatmap`, `getHabitStreak`
- [ ] Workouts CRUD
- [ ] Health Metrics upsert
- [ ] Career History CRUD
- [ ] FTS5 — `daily_logs_fts` + triggers

#### Frontend Domain
- [ ] `/life-ops` → `/life-ops/{today}` 리다이렉트
- [ ] `/life-ops/{date}` — Daily Command Center (5.2 스펙)
  - Top Strip (Mood/Energy/Emotion)
  - Habit Tracker 그리드
  - Journal/Meditation/Gratitude 탭 에디터
  - Health 카드 (sleep, workout)
  - Auto-Join 타임라인 (stub)
- [ ] `/life-ops/trends` — 차트 그리드 (Recharts)
- [ ] `/life-ops/habits` — 습관 관리
- [ ] `/life-ops/workouts`, `/life-ops/career`, `/life-ops/meditations`, `/life-ops/diaries`
- [ ] LNB (Life Ops 버전)

#### QA
- [ ] 연속 7일 Mood 입력 E2E
- [ ] 습관 체크 → Heatmap 갱신 visual regression
- [ ] 에디터 자동 저장 네트워크 실패 시 localStorage 복원

#### 완료 조건
- 오늘/어제/1주일 전 Daily Log 전환 가능
- Habit Streak 정확 계산
- Heatmap에 올해 1월부터 오늘까지 색 채워짐

---

### 3.4. P3. PRM (1.5주)

**목표**: 인물 카드 + Drawer 타임라인 + 자동화 Hit-Them-Up.

#### Backend
- [ ] `schema/prm.ts` 전체 + triggers (last_contacted_at 자동 업데이트)
- [ ] Server Actions: `listPeople`, `getPerson` (타임라인 조인), `markContacted`, `listNeedsContact`
- [ ] Interactions / Gifts / Network Edges CRUD
- [ ] Hit-Them-Up Cron + Notifications 생성
- [ ] FTS5 — `people_fts`

#### Frontend Domain
- [ ] `/prm` — Card Grid + FilterBar
- [ ] `<PersonCard>` with 관계 건강도 시각
- [ ] `<PersonDrawer>` with Timeline/Info/Relations 탭
- [ ] `/prm/gifts` — 선물 보드
- [ ] `/prm/graph` — 관계망 (D3)
- [ ] `/prm/{personId}` 딥링크
- [ ] LNB (PRM 버전) — Dunbar 그룹 뱃지 카운트
- [ ] Mention(@) 자동완성이 실제 `listPeople` 호출로 전환

#### Automation
- [ ] Cron `hit_them_up` 실제 데이터로 검증 (3일 중복 방지 포함)
- [ ] Birthday Cron + 7일 내 생일 뱃지

#### 완료 조건
- 인물 30명 입력 시 Card Grid 렌더 < 200ms
- Cron 호출 후 Drawer 열면 "n일 연락 안됨" 표시
- @멘션 → Drawer → Task 생성 → Linked People 연결 왕복 동작

---

### 3.5. P4. Action Hub (2주)

**목표**: 칸반/캘린더/Zen 에디터 + 두 모드(개발/집필) 공존.

#### Backend
- [ ] `schema/action-hub.ts` 전체
- [ ] Server Actions: Projects/Tasks/Checklists CRUD + `moveTask` + `saveTaskContent`
- [ ] 브릿지 테이블 (`taskPeopleRelations`, `taskZettelRelations`) CRUD
- [ ] FTS5 — `tasks_fts`
- [ ] Progress 자동 계산 로직 (project.progress 캐시)

#### Frontend Domain
- [ ] `/action-hub` — Project Landing
- [ ] `/action-hub/inbox` — 라우팅 대기함
- [ ] `/action-hub/{id}` — Kanban 드래그앤드롭 (@dnd-kit)
- [ ] `/action-hub/{id}/calendar` + `/list`
- [ ] `/action-hub/{id}/tasks/{taskId}` — Zen Workspace (Split View, 자동 저장)
- [ ] kind='writing' 모드: serif 본문, 에피소드 번호 UI
- [ ] kind='development' 모드: checklist 중심
- [ ] Sidekick Panel (Split View) — Zettel/Person 검색
- [ ] LNB (Action Hub 버전)

#### QA
- [ ] 칸반 드래그 Optimistic + 서버 롤백 시나리오
- [ ] 에디터 3초 자동 저장 + 브라우저 강제 종료 후 복구
- [ ] 체크리스트 1000개 스트레스 테스트

#### 완료 조건
- 프로젝트 3개, 태스크 100개 환경에서 FPS 60 유지
- Zen Mode에서 LNB/GNB 숨김 토글
- @멘션 저장 시 `task_people_relations`에 row INSERT 확인

---

### 3.6. P5. The Vault (2주)

**목표**: 지식 Second Brain — 백링크, 그래프, 의미 검색.

#### Backend
- [ ] `schema/vault.ts` 전체
- [ ] Zettel CRUD + `promoteZettel` + `linkZettels` / `unlinkZettels`
- [ ] `getBacklinks`, `getZettelGraph`
- [ ] **Vectorize 연동**: Zettel create/update 시 임베딩 생성 (`@cf/baai/bge-m3`)
- [ ] `semanticSearchZettels` Server Action
- [ ] Media Logs / Assets / Places CRUD
- [ ] `enrichMediaFromSource` (선택: TMDB/Aladin API)
- [ ] FTS5 — `zettels_fts`, `media_fts`

#### Frontend Domain
- [ ] `/vault/zettels` — 3-pane Split View (리스트 + 에디터 + 백링크)
- [ ] `/vault/zettels/graph` — D3 Force Graph (react-force-graph-2d)
- [ ] `/vault/media` — Masonry Gallery + FilterBar
- [ ] `/vault/media/{id}` — 상세 Drawer + 페이지
- [ ] `/vault/assets`, `/vault/places` (+ 지도)
- [ ] `[[` 자동완성이 실제 Zettel/Media/Place 통합 검색으로 동작
- [ ] 백링크 패널 + 관련 제안(의미 검색)
- [ ] LNB (Vault 버전)

#### AI/Automation
- [ ] 임베딩 업데이트는 Queue + Background Worker (대량 이관 대비)
- [ ] Vector hash 비교로 중복 임베딩 방지

#### 완료 조건
- Zettel 200개 시 그래프 렌더 < 1s
- `[[`로 링크 → 타 Zettel 백링크에 자동 등장
- 의미 검색 "존재의 불안" → 실존주의 Zettel 상위 3개

---

### 3.7. P6. Home + AI + Notion Import (1주)

**목표**: 대시보드 완성 + AI 라우팅 실동작 + 실사용 데이터 이관.

#### Backend / AI
- [ ] `POST /api/capture` — Claude Haiku 4.5 호출 (prompt caching 적용)
- [ ] Fallback: Workers AI Llama 3.3
- [ ] `POST /api/ai/summarize` SSE (daily/weekly/project)
- [ ] Daily Summary Cron (새벽 요약)
- [ ] Weekly Review Cron + 자동 Zettel 생성

#### Migration
- [ ] `scripts/notion-import.ts` — Notion Export zip → D1 INSERT
- [ ] 스키마 매핑:
  - `지식 창고` → `zettels` (type 분기)
  - `묵상`/`일기` → `daily_logs.meditation`/`.journal`
  - `커리어&히스토리` → `career_history`
  - `컨텐츠 로그` + `도서/영상/게임` → `media_logs`
  - `장소 로그` → `places`
  - `프로젝트` → `projects` + `tasks`
  - `에피소드 DB` → `tasks` (kind='writing')
  - `네트워크` → `people`
  - `사건` → `interactions`
  - `선물` → `gifts`
  - `라이프 로그` → `daily_logs` (자동 집계)
  - `운동 로그` → `workouts`
- [ ] Dry-run 모드 + 충돌 보고서

#### Frontend Domain
- [ ] `/dashboard` — Bento Grid 완성 (모든 위젯)
- [ ] `<TodaysAnchor>`, `<ActiveTasksWidget>`, `<HitThemUpWidget>`, `<StreakHeatmapWidget>`, `<BrainEnergyGauge>`, `<RecentZettelsWidget>`, `<UpcomingBirthdays>`, `<QuoteOfDay>`
- [ ] 위젯 드래그 재배치 (react-grid-layout)
- [ ] `/settings/data` — 노션 Import UI (업로드 → 매핑 미리보기 → 실행)
- [ ] `/settings/ai` — API 키, 사용량, confidence 임계값
- [ ] `/settings/appearance` — 테마, Bento 레이아웃 초기화

#### 완료 조건
- Quick Capture "재민이랑 호떡집 월요일 미팅" → Interaction 자동 생성 + Task 제안
- 노션 Export zip → 10분 내 전체 이관 완료
- Dashboard 첫 로드 LCP < 1.5s

---

### 3.8. P7. Hardening (자유 기간, v1 Launch)

#### 성능
- [ ] Route Segment별 분석 (Next.js Route Analytics)
- [ ] Image Lazy Load + blurhash placeholder
- [ ] Virtualized list (TanStack Virtual) — 1000+ row 대비
- [ ] DB 쿼리 EXPLAIN QUERY PLAN 감사, 필요 인덱스 추가
- [ ] Cloudflare Cache Rules 설정

#### 모바일
- [ ] 하단 탭바 GNB (sm breakpoint)
- [ ] Bottom Sheet Drawer
- [ ] 스와이프 제스처 (전날/다음날, 칸반 컬럼 이동)
- [ ] Safe area inset 대응

#### PWA
- [ ] Service Worker (Workbox)
- [ ] BackgroundSync for offline mutations
- [ ] Install prompt
- [ ] App Shortcuts

#### 백업 & 복원
- [ ] Daily Cron 백업 실동작
- [ ] Settings → Data → 백업 리스트 UI
- [ ] 수동 내보내기 (JSON/Markdown zip)
- [ ] 복원 드라이런

#### QA
- [ ] Playwright 전 도메인 Happy Path E2E
- [ ] axe-core 접근성 감사 (0 critical)
- [ ] Visual regression (Chromatic or Percy)
- [ ] Lighthouse CI 경계값 고정

#### 런치 체크리스트 ([`00_MASTER_PLAN.md`](./00_MASTER_PLAN.md) §6과 동일)
- [ ] 5대 도메인 GNB 이동 및 기본 CRUD 동작
- [ ] `@mention` / `[[link]]` 양방향 동기화
- [ ] `Cmd+K` 전역 검색 (FTS5) 응답 < 100ms
- [ ] Quick Capture AI 라우팅 정확도 > 80%
- [ ] Daily Log 진입 후 기분/습관 입력까지 3 클릭 이하
- [ ] Hit-Them-Up 알림이 Cron으로 자동 생성
- [ ] 노션 MASTER DB 100% 이관 스크립트 동작
- [ ] 모든 페이지 LCP < 1.5s, CLS < 0.1
- [ ] Dark 모드 기본, Light 모드 대응
- [ ] PWA 설치 가능

---

## 4. 병렬화 가능 영역

> 에이전트 다수 투입 시 아래는 **동시 진행** 가능.

| 병렬 그룹 | 조건 |
|---|---|
| P2 + P3 | P1 완료 후 → Life Ops와 PRM는 스키마가 독립 |
| P4 + P5 | P3 완료 후 → Action Hub와 Vault는 브릿지 테이블 단방향 의존, PR 머지 순서만 맞추면 OK |
| Migration + P6 AI | P5 완료 후 → 이관 Agent와 AI Agent 분리 |
| Hardening의 모든 서브 작업 | P6 완료 후 → 성능/모바일/PWA/백업/QA 모두 분리 |

---

## 5. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| D1 쿼리 성능 한계 | 검색 느림 | FTS5 튜닝, 캐시 레이어 (Cloudflare KV), 필요 시 Turso로 마이그레이션 |
| Cloudflare Images 비용 | 예산 초과 | R2 원본 + next/image 온디맨드 변환으로 대체 |
| Claude API 요금 폭주 | 지속 비용 | Prompt caching, 월 예산 알림, Workers AI fallback |
| Tiptap Mention 복잡도 | 구현 리스크 | P1에서 stub로 검증 후 P3/P5에서 실 연동 |
| 노션 Export 포맷 변경 | 이관 실패 | CSV + JSON 두 경로 지원, dry-run 보고서 필수 |
| 단일 사용자 인증 오버엔지니어링 | 일정 지연 | Cloudflare Access 우선 → Lucia는 v2로 연기 가능 |

---

## 6. 브랜치 & PR 전략

- `main` = Production (Vercel + Workers prod)
- `develop` = Staging (Vercel preview + Workers staging)
- Feature: `feat/p{n}-{slug}` (예: `feat/p2-life-ops-habits`)
- Fix: `fix/p{n}-{slug}`
- Chore: `chore/{slug}`

### PR 템플릿 체크
```
## 관련 Phase: P2
## 관련 Docs: 05_PAGE_SPECIFICATIONS.md §5.2, 03_DATABASE_SCHEMA.md §9
## 변경 사항
- [ ] 스키마 변경? → migrations 파일 포함
- [ ] API 변경? → 04 문서 업데이트
- [ ] UI 변경? → 스크린샷 첨부

## 테스트
- [ ] Unit
- [ ] E2E (해당 시)
- [ ] 수동 시나리오
```

---

## 7. 환경변수 (최종)

```bash
# .env.local (Vercel)
DATABASE_URL=              # D1 HTTP API URL
DATABASE_AUTH_TOKEN=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=light-house-assets
R2_PUBLIC_URL=             # CDN prefix
CLOUDFLARE_IMAGES_TOKEN=
VECTORIZE_INDEX=zettel-embeddings
ANTHROPIC_API_KEY=
WORKERS_AI_TOKEN=
LUCIA_SESSION_SECRET=
CRON_SECRET=
NEXT_PUBLIC_APP_URL=

# Flags
NEXT_PUBLIC_FLAG_AI_ROUTING=1
NEXT_PUBLIC_FLAG_SEMANTIC_SEARCH=1
NEXT_PUBLIC_FLAG_PWA=1
```

---

## 8. 에이전트별 "지금 당장" 지시서

### Backend Agent — Start Here
1. `pnpm create-turbo@latest` 로 Monorepo 초기화
2. `packages/db` 생성, `drizzle.config.ts` 설정
3. [`03_DATABASE_SCHEMA.md`](./03_DATABASE_SCHEMA.md) §4부터 순서대로 `schema/*.ts` 파일 작성
4. `pnpm drizzle-kit generate` → `migrations/` 확인
5. `wrangler d1 migrations apply` 로컬 적용
6. `schema/fts.ts` raw SQL 파일 추가 (trigger 포함)
7. 작성 완료 후 orchestrator에게 "P0 Backend complete" 보고

### Frontend Shell Agent — Start Here
1. Next.js 15 App Router 스캐폴딩 (apps/web)
2. Tailwind v4 설정 + [`02_DESIGN_SYSTEM.md`](./02_DESIGN_SYSTEM.md)의 CSS 변수/클래스 적용
3. `app/(app)/layout.tsx`에 [`01_IA.md`](./01_INFORMATION_ARCHITECTURE.md) §1–§3의 3-pane Shell 구현
4. `DOMAINS` / `UTILITY` 상수 추가 (`constants/navigation.ts`)
5. `<GlobalNav>` / `<LocalNav>` / `<Breadcrumb>` 최소 구현
6. 오른쪽 Drawer, Command Palette, Quick Capture는 P1에서

### DevOps Agent — Start Here
1. Cloudflare에 리소스 생성:
   ```bash
   wrangler d1 create light-house-db
   wrangler r2 bucket create light-house-assets
   wrangler vectorize create zettel-embeddings --dimensions=1024 --metric=cosine
   ```
2. GitHub Actions 워크플로 3개: `ci.yml`, `preview.yml`, `deploy.yml`
3. Vercel 환경변수 프로비저닝
4. Cloudflare Workers Cron 스케줄 등록 (wrangler.toml)

### QA Agent — Start Here
1. `tests/e2e` Playwright 설정
2. smoke test: 로그인 → 5개 도메인 페이지 방문 → 로그아웃
3. 각 Phase 완료 체크리스트를 issue로 생성

---

## 9. Definition of Done (DoD)

하나의 Phase가 완료되려면:

- ✅ 모든 Exit Criteria 충족
- ✅ Docs 문서 업데이트 (변경 사항 반영)
- ✅ `develop` 브랜치 green (CI)
- ✅ Vercel Preview 스크린샷 Slack 공유
- ✅ 이전 Phase 회귀 테스트 통과
- ✅ Orchestrator가 승인 명시

---

## 10. 다음 단계

모든 에이전트는:

1. 먼저 [`00_MASTER_PLAN.md`](./00_MASTER_PLAN.md)를 읽고
2. 본인 역할에 해당하는 섹션(본 문서 §8) 지시에 따라
3. 첫 커밋은 **본인 도메인 문서 한 번 다시 정독 후** 수행.

🛟 **막히면**: Orchestrator에게 "Phase {n}, §{x} 해석 차이" 형태로 질의.

**등대는 이미 준비됐다. 이제 바다로 나갈 차례다.** 🌊
