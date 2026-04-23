# 🗺️ Information Architecture (IA)

> **선행 문서**: [`00_MASTER_PLAN.md`](./00_MASTER_PLAN.md)
> **대상**: Frontend 에이전트
> **목표**: 라우트 트리, GNB/LNB 구조, Main Canvas 모드 전환 규칙을 완전히 명세

---

## 1. 전역 레이아웃 (The 3-Pane Workspace)

```
┌──┬──────────────┬────────────────────────────────────────────────┐
│  │              │                                                │
│G │   LNB (2단)  │              Main Canvas (3단)                 │
│N │              │                                                │
│B │   ~220px     │                                                │
│  │   (collapsible│                                                │
│1 │    → 0px)    │                                                │
│단│              │                                                │
│ │              │                                                │
│64│              │                                                │
│px│              │                                                │
└──┴──────────────┴────────────────────────────────────────────────┘
   ← Resizable (Shadcn ResizablePanel) →
```

### 1.1. 반응형 Breakpoint

| 너비 | 동작 |
|---|---|
| ≥ 1280px (xl) | 3단 동시 표시 (기본) |
| 1024–1279px (lg) | LNB 자동 축소 (아이콘만) |
| 768–1023px (md) | LNB 숨김, GNB 유지. 햄버거로 LNB 소환 |
| < 768px (sm) | GNB를 하단 탭바로 이동, LNB는 드로어 |

---

## 2. GNB (Global Navigation Bar)

### 2.1. 구조

```
┌──┐
│🟡│  ← Logo (클릭 시 /dashboard)
├──┤
│🏠│  ← Dashboard   (hotkey: g d)
│🚀│  ← Action Hub  (hotkey: g a)
│🧠│  ← The Vault   (hotkey: g v)
│🤝│  ← PRM         (hotkey: g p)
│⚙️│  ← Life Ops    (hotkey: g l)
├──┤
│  │  ← (공간 확장)
│  │
├──┤
│🔍│  ← Command Palette (Cmd+K)
│➕│  ← Quick Capture (Cmd+Shift+N)
│👤│  ← User Menu (Settings, Logout)
└──┘
```

### 2.2. 디자인 스펙

- **너비**: 64px 고정
- **배경**: `bg-background/60 backdrop-blur-xl` + `border-r border-border/40`
- **아이콘**: Lucide React, 24×24px, `text-muted-foreground` (기본) → `text-foreground` (hover) → `text-primary` (active)
- **활성 상태 인디케이터**: 좌측 2px 세로 바 + subtle glow
- **Tooltip**: Radix Tooltip, 유리 질감(`bg-popover/80 backdrop-blur`), 우측 표시, 200ms 지연
- **순서**: Logo → Domain(5) → Spacer → Utility(3)

### 2.3. 활성 상태 규칙

URL prefix 매칭:
- `/dashboard` → Dashboard 활성
- `/action-hub*` → Action Hub 활성
- `/vault*` → The Vault 활성
- `/prm*` → PRM 활성
- `/life-ops*` → Life Ops 활성
- `/settings*` → User Menu 활성

---

## 3. LNB (Local Navigation Bar)

### 3.1. 공통 구조

모든 도메인 LNB는 3영역:
1. **상단 헤더**: 현재 도메인명 + 숨기기 토글(`⟨`)
2. **중단 메뉴**: 아코디언/트리
3. **하단 푸터**: 도메인별 퀵 액션 (예: "새 프로젝트", "새 Zettel")

### 3.2. 도메인별 LNB 상세

#### 3.2.1. 🏠 Dashboard LNB (단순)

```
[오늘]
  • Today's Anchor (오늘)
  • Yesterday Review (어제)
[주간]
  • This Week
  • Last Week
[커스텀 뷰]
  • + 새 뷰 추가
```

#### 3.2.2. 🚀 Action Hub LNB

```
[📥 Inbox]              ← 라우팅 대기 항목 수 뱃지
[⭐ Pinned]
───────────────
[🎯 진행 중 프로젝트]    ← 아코디언 (펼침 기본)
  ├ MODU WORKS
  ├ 트라우마 수리공방
  ├ 호떡집 컨시어지
  └ + 새 프로젝트
[🛡️ Areas (책임 영역)]
  ├ 웹소설 집필
  ├ 지인 비즈니스
  └ + 새 영역
[📦 Archive]
───────────────
[+ 새 프로젝트/영역]
```

#### 3.2.3. 🧠 The Vault LNB

```
[🔍 전체 검색]
───────────────
[🧠 Zettelkasten]
  ├ 📥 수집함 (Fleeting)       ← 원석
  ├ 📚 문헌 메모 (Literature)
  ├ 💎 영구 메모 (Permanent)   ← 가공됨
  └ 🗺️ MOC (Maps of Content)
       ├ 심리학
       ├ 실존주의
       ├ 비즈니스
       └ + 새 MOC
[📼 Media Logs]
  ├ 🎮 게임
  ├ 📚 도서
  └ 🎬 영상
[📦 Archives]
  ├ 🚲 Gear (홈시어터/자전거)
  ├ 🧸 Collection (수집품)
  └ 📍 Places (장소)
───────────────
[🕸️ 그래프 뷰 열기]
[+ 새 Zettel (Cmd+N)]
```

#### 3.2.4. 🤝 PRM LNB

```
[🚨 Hit Them Up!]           ← 연락 시급 인원 수 뱃지
[⭐ Favorites]
───────────────
[👥 Dunbar Layers]
  ├ 🔥 Layer 5  (핵심)
  ├ 🤝 Layer 15 (친밀)
  ├ 🌱 Layer 50 (정기적)
  └ 🌊 Layer 150 (지인)
[🏷️ Groups]
  ├ 가족
  ├ 친구
  ├ 직장
  ├ 비즈니스 파트너
  ├ 멘토/은사
  ├ 커뮤니티
  ├ 교회
  └ + 새 그룹
[🎁 Gifts]
  ├ 준 것 (Given)
  └ 받은 것 (Received)
───────────────
[🕸️ 관계망 그래프]
[+ 새 인물]
```

#### 3.2.5. ⚙️ Life Ops LNB

```
[☀️ Today's Log]
[📆 Calendar (월간 Heatmap)]
───────────────
[📈 Trends & Insights]
  ├ Mood Trend
  ├ Sleep Pattern
  ├ Brain Energy
  └ Correlation Matrix
[🏃 운동]
  ├ 운동 로그
  └ 루틴 설정
[🌱 Habits]
  ├ 활성 습관
  └ 설정
[💼 커리어 & 히스토리]
[🙏 묵상 Archive]
[📔 일기 Archive]
───────────────
[+ 오늘 기록하기]
```

### 3.3. LNB 토글 동작

- **단축키**: `Cmd+\` 토글
- **URL 영속화**: localStorage에 `lnb-collapsed-{domain}` 저장
- **Zen Mode 자동 진입**: Task detail, Writing editor에서는 **자동 Collapse** (사용자가 다시 펼치면 기억)

---

## 4. 라우트 맵 (Next.js App Router)

### 4.1. 디렉토리 구조

```
app/
├── (auth)/
│   └── login/
│       └── page.tsx                    # /login
│
├── (app)/
│   ├── layout.tsx                      # 전역 Shell (GNB + LNB + Canvas)
│   │
│   ├── dashboard/
│   │   └── page.tsx                    # /dashboard
│   │
│   ├── action-hub/
│   │   ├── page.tsx                    # /action-hub (프로젝트 리스트)
│   │   ├── inbox/
│   │   │   └── page.tsx                # /action-hub/inbox
│   │   └── [projectId]/
│   │       ├── page.tsx                # /action-hub/{id} (칸반 기본)
│   │       ├── calendar/page.tsx       # /action-hub/{id}/calendar
│   │       ├── list/page.tsx           # /action-hub/{id}/list
│   │       └── tasks/
│   │           └── [taskId]/
│   │               └── page.tsx        # /action-hub/{id}/tasks/{taskId} (Zen 모드)
│   │
│   ├── vault/
│   │   ├── page.tsx                    # /vault (기본: Permanent list)
│   │   ├── zettels/
│   │   │   ├── page.tsx                # /vault/zettels
│   │   │   ├── graph/page.tsx          # /vault/zettels/graph
│   │   │   └── [zettelId]/page.tsx     # /vault/zettels/{id}
│   │   ├── media/
│   │   │   ├── page.tsx                # /vault/media (통합 갤러리)
│   │   │   ├── games/page.tsx
│   │   │   ├── books/page.tsx
│   │   │   ├── screens/page.tsx
│   │   │   └── [mediaId]/page.tsx
│   │   ├── assets/
│   │   │   ├── page.tsx
│   │   │   └── [assetId]/page.tsx
│   │   └── places/
│   │       ├── page.tsx
│   │       └── [placeId]/page.tsx
│   │
│   ├── prm/
│   │   ├── page.tsx                    # /prm (카드 그리드)
│   │   ├── graph/page.tsx              # /prm/graph
│   │   ├── gifts/page.tsx              # /prm/gifts
│   │   └── [personId]/page.tsx         # /prm/{id} (깊은 링크용, 서랍은 ?detail=)
│   │
│   ├── life-ops/
│   │   ├── page.tsx                    # /life-ops (오늘)
│   │   ├── [date]/page.tsx             # /life-ops/2026-04-22
│   │   ├── trends/page.tsx
│   │   ├── habits/page.tsx
│   │   ├── workouts/
│   │   │   ├── page.tsx
│   │   │   └── [workoutId]/page.tsx
│   │   ├── career/page.tsx
│   │   ├── meditations/page.tsx
│   │   └── diaries/page.tsx
│   │
│   └── settings/
│       ├── page.tsx
│       ├── profile/page.tsx
│       ├── appearance/page.tsx
│       ├── data/page.tsx               # 내보내기/가져오기
│       ├── integrations/page.tsx       # Notion import, API keys
│       └── shortcuts/page.tsx
│
├── api/                                # Route Handlers
│   ├── auth/[...lucia]/route.ts
│   ├── capture/route.ts                # POST /api/capture (Quick Capture)
│   ├── ai/
│   │   ├── route/route.ts              # POST /api/ai/route (라우팅)
│   │   └── summarize/route.ts
│   ├── search/route.ts                 # GET  /api/search?q=
│   ├── upload/route.ts                 # POST /api/upload (R2 signed URL)
│   └── webhooks/
│       └── cron/route.ts               # Cloudflare Cron 호출용
│
├── layout.tsx                          # 루트 레이아웃
└── globals.css
```

### 4.2. URL 쿼리 규약

| 쿼리 | 의미 | 예 |
|---|---|---|
| `?detail={id}` | 우측 Side Drawer 열기 | `/prm?detail=abc123` |
| `?view=kanban\|calendar\|list` | 뷰 모드 전환 | `/action-hub/xyz?view=calendar` |
| `?filter={json}` | 필터 상태 | `/vault/zettels?filter={"tag":"심리학"}` |
| `?q={query}` | 도메인 내 검색 | `/prm?q=재민` |
| `?zen=1` | Zen Mode 강제 | `/action-hub/.../tasks/.../?zen=1` |

---

## 5. Main Canvas UI 모드 (5종)

| 모드 | 적용 페이지 | 핵심 특징 |
|---|---|---|
| **A. Dashboard** | `/dashboard`, `/life-ops` | Bento Grid, 위젯 기반, 드래그 재배치 |
| **B. Deep Work (Zen)** | Task detail, Zettel detail | LNB 자동 숨김, 30/70 Split, 전체화면 토글 |
| **C. Directory** | `/prm`, `/vault/media`, `/vault/assets`, `/vault/places`, `/action-hub/{id}/list` | 카드/테이블, 필터 사이드, Side Drawer |
| **D. Kanban/Calendar** | `/action-hub/{id}`, `/action-hub/{id}/calendar` | 드래그앤드롭, 뷰 스위처 |
| **E. Graph** | `/vault/zettels/graph`, `/prm/graph` | D3 Force, 줌/팬, 미니맵 |

### 5.1. 모드 전환 시 애니메이션

- **크로스페이드**: 220ms `ease-out`
- **Layout shift 방지**: Framer Motion `LayoutGroup`
- **Zen 진입**: LNB가 좌측으로 slide-out, Canvas 확장 (300ms)

---

## 6. 브레드크럼 (Breadcrumb)

### 6.1. 위치
- Main Canvas 상단 48px 높이 Sticky Header 내 좌측
- Zen Mode에서는 미니멀화 (호버 시만 표시)

### 6.2. 규칙

```
🚀 Action Hub / MODU WORKS / Tasks / 칸반 보드 실시간 동기화
```

- 최상위(도메인)는 이모지 + 이름
- 중간 계층은 클릭 시 해당 계층으로 이동
- 마지막(현재)은 클릭 불가, `text-foreground`
- 중간 생략 시 `...` 메뉴 (Radix DropdownMenu)

---

## 7. 전역 상수 (`constants/navigation.ts`)

```typescript
// 후속 에이전트는 이 상수를 기반으로 GNB/LNB 렌더링
export const DOMAINS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'Home', path: '/dashboard', hotkey: 'g d' },
  { key: 'action-hub', label: 'Action Hub', icon: 'Rocket', path: '/action-hub', hotkey: 'g a' },
  { key: 'vault', label: 'The Vault', icon: 'Brain', path: '/vault', hotkey: 'g v' },
  { key: 'prm', label: 'PRM', icon: 'Users', path: '/prm', hotkey: 'g p' },
  { key: 'life-ops', label: 'Life Ops', icon: 'Settings2', path: '/life-ops', hotkey: 'g l' },
] as const;

export const UTILITY = [
  { key: 'search', label: 'Search', icon: 'Search', hotkey: 'mod+k' },
  { key: 'capture', label: 'Quick Capture', icon: 'Plus', hotkey: 'mod+shift+n' },
  { key: 'user', label: 'Account', icon: 'User', path: '/settings' },
] as const;
```

---

## 8. 접근성 (a11y) 필수 규칙

- 모든 GNB/LNB 항목에 `aria-label`
- 현재 활성 페이지는 `aria-current="page"`
- Drawer 오픈 시 포커스 트랩(Radix Dialog 활용)
- `Esc`로 모든 오버레이 닫힘
- 키보드만으로 전체 네비게이션 가능

---

**다음**: [`02_DESIGN_SYSTEM.md`](./02_DESIGN_SYSTEM.md)에서 시각 언어를 확정한다.
