# 🏛️ Project Light House — 마스터 기획서

> **문서 버전**: v1.0 (2026-04-22)
> **작성자**: Master Planner (30-yr senior PM)
> **독자**: 후속 코딩 에이전트 (Backend / Frontend / DevOps)
> **목적**: 본 문서부터 `07_DEVELOPMENT_ROADMAP.md`까지를 **직렬로** 읽으면 즉시 개발 착수 가능.

---

## 0. Executive Summary

Project Light House는 사용자의 노션 워크스페이스(**MASTER DB + Pneos' Master Dashboard**)를 대체하는 **개인용 통합 정보 관리 웹 애플리케이션**이다. 단순한 노션 이관이 아니라, **"모든 도메인이 거미줄처럼 엮이는 Second Brain"**을 목표로 한다.

### 0.1. 5대 핵심 도메인

| 도메인 | 역할 | 기존 노션 대응 |
|---|---|---|
| 🏠 **Dashboard (Home)** | 오늘의 브리핑, 전 도메인 스냅샷 | Pneos' Master Dashboard |
| 🚀 **Action Hub** | 실행 단위 작업(개발/집필/자문) | 프로젝트 + 에피소드 DB |
| 🧠 **The Vault** | 지식·미디어·수집품 아카이브 | 지식창고 전체 |
| 🤝 **PRM** | 인물 관계망 & 360° 타임라인 | 네트워크 |
| ⚙️ **Life Ops** | 일상 정량화, 습관, 건강 | 라이프 오퍼레이션 |

### 0.2. 설계 철학 4원칙

1. **Relation-First** — 도메인 단절 금지. 모든 엔티티는 `@mention` / `[[link]]`로 양방향 연결.
2. **Zero-Friction Capture** — `Cmd+K`로 어디서든 0.5초 내 입력. AI가 라우팅.
3. **Progressive Disclosure** — 리스트 → 서랍(Drawer) → 전체 페이지의 3단계 공개.
4. **Glass-Calm Aesthetics** — Glassmorphism + 다크톤을 기본. 색상은 데이터가 결정(P1=빨강, HyperFocus=보라 등).

---

## 1. TOBE에서 고도화한 포인트 (As a Senior Planner)

> TOBE 원안을 존중하되, 실제 개발 착수 직전에 드러날 구멍을 메운다.

### 1.1. 스키마 누락분 복원 (ASIS에는 있고 TOBE엔 없음)

| 누락 항목 | 원본 노션 DB | 복원 처리 |
|---|---|---|
| 커리어 & 히스토리 | ASIS Master Archive | `career_history` 신설 (Life Ops 내) |
| 장소 로그 | ASIS 장소 로그 | `places` 신설 (The Vault 내, `assets`와 분리) |
| 운동 로그 | ASIS 운동 로그 | `workout_logs` 신설 (Life Ops, `habit_logs`와 별도) |
| 묵상 / 일기 | ASIS 라이프 오퍼레이션 | `daily_logs.journal` + `daily_logs.meditation` 필드로 통합 |
| 감정 Multi-select | ASIS 일기 | `daily_logs.emotions` (JSON 배열) |

### 1.2. 아키텍처 레이어 보강

| 계층 | TOBE 원안 | 보강 후 |
|---|---|---|
| 인증 | 없음 | **Cloudflare Access** 또는 자체 `users` + `sessions` (단일 사용자라도 필수) |
| 풀텍스트 검색 | 없음 | **D1 FTS5** 가상 테이블 (`zettels_fts`, `tasks_fts`, `daily_logs_fts`) |
| 의미 검색 | 없음 | **Cloudflare Vectorize** (Zettel embedding) |
| 자동화 엔진 | "알아서 하겠지" | **Cloudflare Cron Triggers** (Hit-them-up, 주간 리뷰, 백업) |
| AI 라우팅 | 언급만 | **Workers AI (Llama 3.3) + Anthropic Claude API** (하이브리드) |
| 이미지 파이프라인 | R2 직저장 | **Cloudflare Images** (변형/최적화) + R2 (원본) |
| 오프라인 | 없음 | **PWA + IndexedDB 캐시** + Sync Queue |
| 감사 로그 | 없음 | `audit_logs` 테이블 (삭제/복구 추적) |
| 백업 | 없음 | 주간 `sqlite dump` → R2 자동 저장 |
| 태그 시스템 | JSON 문자열 | `tags` + `taggings` 정규화 (필터/자동완성 성능) |

### 1.3. UX 보강

- **빵부스러기(Breadcrumb)**: 깊은 Drawer 내에서도 현재 위치 파악.
- **Skeleton UI**: Glassmorphism 톤의 로딩 스켈레톤 (번쩍임 방지).
- **Optimistic Updates**: 체크박스/상태 변경은 즉시 반영, 실패 시 롤백 토스트.
- **Empty States**: 모든 리스트에 "첫 항목 추가" 유도 일러스트.
- **키보드 단축키 시스템**: `?`로 치트시트 오버레이 호출.
- **내보내기(Export)**: 모든 도메인 → JSON/Markdown 일괄 다운로드 (Lock-in 방지).

---

## 2. 기술 스택 (확정)

| 레이어 | 기술 | 선택 이유 |
|---|---|---|
| **Framework** | Next.js 15 (App Router, RSC) | 서버 컴포넌트 + 서버 액션으로 RPC 최소화 |
| **Language** | TypeScript 5.4+ (strict) | 타입 안정성 필수 |
| **DB (관계형)** | Cloudflare D1 (SQLite) | 무료·저지연·Drizzle 호환 |
| **ORM** | Drizzle ORM | 타입 안전 + 마이그레이션 수월 |
| **DB (벡터)** | Cloudflare Vectorize | 의미 검색용 (Zettel) |
| **File Storage** | Cloudflare R2 | S3 호환, 이그레스 무료 |
| **Image CDN** | Cloudflare Images | 자동 리사이즈/WebP 변환 |
| **Edge Compute** | Cloudflare Workers | Next.js API 라우트 + Cron |
| **AI** | Anthropic Claude Haiku 4.5 (메인) + Workers AI Llama 3.3 (fallback) | Quick Capture 라우팅, 주간 리뷰 요약 |
| **Styling** | Tailwind CSS 4 + CSS Variables | 디자인 토큰 중앙 관리 |
| **UI Primitives** | Shadcn/ui + Radix UI | 접근성·헤드리스 |
| **Animation** | Framer Motion | Drawer/Modal 물리 애니메이션 |
| **Charts** | Recharts + visx (Heatmap) | 가벼움 + 확장성 |
| **Graph** | D3.js v7 + react-force-graph | Zettel/PRM 네트워크 뷰 |
| **Editor** | Tiptap v2 (ProseMirror) | `@mention`, `[[link]]`, 마크다운 호환 |
| **Forms** | React Hook Form + Zod | 검증 일원화 |
| **State** | Zustand (클라이언트) + TanStack Query | 서버/클라 상태 분리 |
| **Auth** | Lucia Auth v3 (자체) 또는 Cloudflare Access | 단일 사용자 경량 |
| **Deploy** | Vercel (프론트) + Cloudflare Workers (API/D1/R2) | 하이브리드 |
| **CI/CD** | GitHub Actions | 자동 마이그레이션 배포 |
| **Observability** | Vercel Analytics + Axiom (로그) | 최소 필수 |

---

## 3. 저장소 구조 (Monorepo)

```
project-light-house/
├── Docs/                          # ← 본 문서들
├── apps/
│   └── web/                       # Next.js 앱
│       ├── src/
│       │   ├── app/               # App Router
│       │   │   ├── (auth)/        # 로그인 라우트 그룹
│       │   │   ├── (app)/         # 인증 필요 라우트 그룹
│       │   │   │   ├── dashboard/
│       │   │   │   ├── action-hub/
│       │   │   │   ├── vault/
│       │   │   │   ├── prm/
│       │   │   │   ├── life-ops/
│       │   │   │   └── settings/
│       │   │   └── api/           # Route Handlers
│       │   ├── components/
│       │   │   ├── ui/            # shadcn primitives
│       │   │   ├── shell/         # GNB, LNB, Layout
│       │   │   ├── features/      # 도메인별 컴포넌트
│       │   │   └── shared/        # Drawer, Modal, Editor 등
│       │   ├── lib/
│       │   │   ├── db/            # Drizzle schema + client
│       │   │   ├── r2/            # R2 SDK wrapper
│       │   │   ├── ai/            # Claude/Workers AI adapter
│       │   │   └── utils/
│       │   ├── hooks/
│       │   ├── stores/            # Zustand stores
│       │   └── styles/
│       └── public/
├── packages/
│   ├── db/                        # Drizzle schema (단일 출처)
│   └── config/                    # tsconfig, eslint 공유
├── workers/
│   ├── cron/                      # 스케줄 작업
│   └── ai-router/                 # Quick Capture AI 라우팅
├── migrations/                    # D1 마이그레이션 SQL
├── scripts/
│   ├── notion-import.ts           # 노션 → D1 이관 스크립트
│   └── backup.ts                  # R2 백업
├── drizzle.config.ts
├── wrangler.toml
├── next.config.mjs
├── tailwind.config.ts
└── package.json
```

---

## 4. 5대 도메인 개요 (세부는 05 문서에서)

### 4.1. 🏠 Dashboard (Home)
- **기본 경로**: `/dashboard`
- **UI 모드**: Bento Grid (유리 질감 카드)
- **핵심 위젯**: Today's Anchor / Hit-Them-Up / Streak Heatmap / Active Tasks / Recent Zettels / Weekly Vibe

### 4.2. 🚀 Action Hub
- **기본 경로**: `/action-hub`
- **UI 모드**: 칸반 / 캘린더 / 리스트 / Zen Editor
- **핵심 엔티티**: `projects` → `tasks` → `checklists`

### 4.3. 🧠 The Vault
- **기본 경로**: `/vault`
- **UI 모드**: Split View / Masonry Gallery / Network Graph
- **핵심 엔티티**: `zettels` / `media_logs` / `assets` / `places`

### 4.4. 🤝 PRM
- **기본 경로**: `/prm`
- **UI 모드**: Card Grid + Side Drawer (360° 타임라인)
- **핵심 엔티티**: `people` / `interactions` / `gifts` / `network_edges`

### 4.5. ⚙️ Life Ops
- **기본 경로**: `/life-ops`
- **UI 모드**: 원클릭 대시보드 + Heatmap + Sparkline
- **핵심 엔티티**: `daily_logs` / `habits` / `habit_logs` / `health_metrics` / `workout_logs` / `career_history`

---

## 5. 글로벌 상호작용 규칙 (전 도메인 공통)

### 5.1. Mention System (`@` / `[[]]`)
- `@` → PRM 인물 자동완성 → 선택 시 `task_people_relations` 등 자동 INSERT
- `[[` → Zettel/Media/Place 통합 검색 → 선택 시 백링크 자동 생성
- Tiptap 커스텀 extension으로 구현 (06 문서 참조)

### 5.2. Command Palette (`Cmd+K`)
- Fuse.js 기반 전역 검색 (엔티티 + 액션)
- 네비게이션 / 생성 / 검색 / 실행을 한 창에서 수행

### 5.3. Quick Capture (`Cmd+Shift+N`)
- AI가 텍스트 분석 → `quick_captures` 테이블에 잠시 대기 → 라우팅 완료 후 해당 도메인으로 이동
- 라우팅 우선순위: Task > Event(Interaction) > Zettel > Diary

### 5.4. Side Drawer
- 모든 리스트에서 항목 클릭 시 우측 40% Drawer로 상세 표시
- `?detail={id}` 쿼리로 영속화 (딥링크 공유 가능)
- `Esc` 또는 백드롭 클릭으로 닫기

---

## 6. 성공 지표 (Launch Criteria)

**v1 완성 기준 (모든 코딩 에이전트가 충족해야 함)**:

- [ ] 5대 도메인 GNB 이동 및 기본 CRUD 동작
- [ ] `@mention` / `[[link]]` 양방향 동기화
- [ ] `Cmd+K` 전역 검색 (FTS5) 응답 < 100ms
- [ ] Quick Capture AI 라우팅 정확도 > 80% (테스트셋 기준)
- [ ] Daily Log 진입 후 기분/습관 입력까지 3 클릭 이하
- [ ] Hit-Them-Up 알림이 Cron으로 자동 생성
- [ ] 노션 MASTER DB 100% 이관 스크립트 동작
- [ ] 모든 페이지 LCP < 1.5s, CLS < 0.1
- [ ] Dark 모드 기본, Light 모드 대응
- [ ] PWA 설치 가능 (데스크탑/모바일)

---

## 7. 후속 문서 안내

| # | 문서 | 내용 | 대상 에이전트 |
|---|---|---|---|
| 01 | `INFORMATION_ARCHITECTURE.md` | 전체 IA 트리, GNB/LNB, 라우팅 맵 | Frontend |
| 02 | `DESIGN_SYSTEM.md` | 디자인 토큰, 유리 효과, 컴포넌트 규약 | Frontend |
| 03 | `DATABASE_SCHEMA.md` | Drizzle 전체 스키마 + 인덱스 + 마이그레이션 | Backend |
| 04 | `API_SPECIFICATION.md` | Server Action / Route Handler 명세 | Backend |
| 05 | `PAGE_SPECIFICATIONS.md` | 모든 페이지와 컴포넌트 상세 | Frontend |
| 06 | `INTERACTION_PATTERNS.md` | Mention, Quick Capture, Command Palette, 자동화 | Frontend + Backend |
| 07 | `DEVELOPMENT_ROADMAP.md` | Phase별 작업 순서, Agent 분할 | Orchestrator |

---

## 8. 즉시 착수 체크리스트 (Kickoff)

```bash
# 1. 저장소 초기화
pnpm create next-app@latest web --typescript --tailwind --app --turbo

# 2. 의존성 설치
pnpm add drizzle-orm @libsql/client @cloudflare/workers-types
pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-mention
pnpm add framer-motion @tanstack/react-query zustand
pnpm add @radix-ui/react-* # shadcn init
pnpm add recharts d3 react-force-graph-2d
pnpm add lucia @lucia-auth/adapter-sqlite
pnpm add zod react-hook-form @hookform/resolvers

# 3. Cloudflare 프로비저닝
wrangler d1 create light-house-db
wrangler r2 bucket create light-house-assets
wrangler vectorize create zettel-embeddings --dimensions=1024 --metric=cosine

# 4. 첫 마이그레이션
pnpm drizzle-kit generate
wrangler d1 migrations apply light-house-db --remote
```

**다음**: `01_INFORMATION_ARCHITECTURE.md`부터 순차 읽고, `07_DEVELOPMENT_ROADMAP.md`의 Phase 1에 착수.
