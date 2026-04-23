# 🧩 Component Specifications

> **선행 문서**: [`02_DESIGN_SYSTEM.md`](./02_DESIGN_SYSTEM.md), [`05_PAGE_SPECIFICATIONS.md`](./05_PAGE_SPECIFICATIONS.md), [`06_INTERACTION_PATTERNS.md`](./06_INTERACTION_PATTERNS.md)
> **대상**: Frontend 에이전트 (GPT-5.4 / Claude Code)
> **목표**: 모든 화면 × 모든 컴포넌트를 **단 하나의 문서**에서 조회 가능하도록 고정.
>
> 이 문서는 "이 화면을 구현해줘"라는 요청을 받았을 때 에이전트가 **별도 탐색 없이** 필요한 모든 컴포넌트·props·상태·토큰·인터랙션을 조립할 수 있도록 설계되었다.

---

## 0. 사용 방법 (Agent Usage Guide)

### 0.1. 화면 단위 작업 플로우

```
[1] 화면 라우트 확인 (예: /dashboard)
       ↓
[2] § 4~8 에서 해당 화면 섹션 참조
       ↓
[3] "Component Tree" 그대로 조립
       ↓
[4] § 3 Shared Primitives 에서 하위 컴포넌트 props 조회
       ↓
[5] § 9 Matrix 로 누락 없는지 교차 확인
       ↓
[6] § 10 State Patterns (Loading/Empty/Error) 추가
```

### 0.2. 컴포넌트 명세 포맷

모든 컴포넌트는 다음 블록을 포함한다:

- **Path**: 파일 경로 (`apps/web/src/components/...`)
- **Purpose**: 1줄 목적
- **Props**: TypeScript interface
- **Tokens**: 사용하는 DESIGN_SYSTEM 토큰
- **Motion**: 적용 모션 (from §6 of DESIGN_SYSTEM)
- **A11y**: 접근성 요구사항
- **Used On**: 사용되는 화면 라우트

### 0.3. 네이밍 규칙

| 카테고리 | 접두/접미 | 위치 |
|---|---|---|
| UI primitives | 없음 (Shadcn 이름) | `components/ui/` |
| Shell | `<Global*>`, `<Local*>` | `components/shell/` |
| 공용 컴포넌트 | 기능명 | `components/shared/` |
| 도메인 컴포넌트 | 도메인 접두 | `components/features/{domain}/` |
| Widget (Dashboard) | `*Widget` 접미 | `components/features/dashboard/widgets/` |
| Drawer | `*Drawer` 접미 | `components/features/{domain}/drawers/` |

---

## 1. 컴포넌트 아키텍처 원칙

### 1.1. 3계층 합성(Composition) 구조

```
┌─────────────────────────────────────────────────┐
│ L3 Screen (page.tsx)                            │ ← RSC, 데이터 fetch
│  └─ L2 Feature Component                        │ ← 도메인 비즈니스 로직
│       └─ L1 Shared Primitive (<GlassCard> 등)   │ ← Design System 기반
│            └─ L0 UI Primitive (Shadcn)          │ ← Radix/Headless
└─────────────────────────────────────────────────┘
```

**AI 에이전트 규칙**:
- L3는 **데이터만** 가져와서 L2에 넘긴다 (비즈니스 로직 금지).
- L2는 **도메인 로직**(Optimistic update, form validation)을 담당.
- L1은 **시각적 일관성**만 책임 (로직 금지).
- L0는 **접근성·키보드 네비**를 책임.

### 1.2. Server vs Client 분기 규칙

| 컴포넌트 성격 | 실행 환경 | 예시 |
|---|---|---|
| 데이터 fetching, 초기 렌더 | **RSC** (기본) | `page.tsx`, `<TaskList>` (리스트 렌더) |
| 인터랙션, 상태, useHook | **'use client'** | `<TaskCard>` (체크박스), `<ZenEditor>` |
| 정적 표시 (props만) | **RSC** | `<Tag>`, `<GlassCard>` |
| 폼, Mutation | **'use client'** | `<TaskForm>`, `<QuickCaptureModal>` |

### 1.3. Props 네이밍 규칙

- Boolean: `is*` / `has*` / `can*` (예: `isLoading`, `hasError`)
- Handler: `on*` (예: `onSelect`, `onDelete`)
- Render prop: `render*` 또는 `*Slot`
- Variant: `variant`, `size`, `tone` (enum만 허용, boolean 조합 금지)
- Children: React node만. 복잡한 구조는 slot pattern 사용.

---

## 2. 컴포넌트 디렉토리 맵

```
apps/web/src/components/
├── ui/                          # L0: Shadcn primitives (자동 생성)
│   ├── button.tsx, input.tsx, dialog.tsx, dropdown-menu.tsx,
│   ├── tooltip.tsx, tabs.tsx, accordion.tsx, toast.tsx,
│   ├── resizable.tsx, popover.tsx, command.tsx, scroll-area.tsx,
│   ├── avatar.tsx, badge.tsx, progress.tsx, separator.tsx,
│   └── sheet.tsx
│
├── shell/                       # L1: 전역 레이아웃
│   ├── GlobalNav.tsx
│   ├── LocalNav.tsx
│   ├── Breadcrumb.tsx
│   ├── CanvasTransition.tsx
│   ├── SideDrawerHost.tsx
│   ├── CommandPalette.tsx
│   ├── QuickCaptureModal.tsx
│   ├── HotkeyCheatsheet.tsx
│   ├── NotificationBell.tsx
│   └── AuthGuard.tsx
│
├── shared/                      # L1: 도메인 불문 공용
│   ├── GlassCard.tsx
│   ├── Tag.tsx
│   ├── BentoGrid.tsx
│   ├── Heatmap.tsx
│   ├── Sparkline.tsx
│   ├── NetworkGraph.tsx
│   ├── SkeletonBlock.tsx
│   ├── EmptyState.tsx
│   ├── ErrorBoundary.tsx
│   ├── UserAvatar.tsx
│   ├── TagInput.tsx
│   ├── DatePicker.tsx
│   ├── FileDropzone.tsx
│   ├── FilterBar.tsx
│   ├── ViewSwitcher.tsx
│   ├── DataGrid.tsx
│   ├── KeyHint.tsx
│   ├── editor/
│   │   ├── ZenEditor.tsx
│   │   ├── extensions/PersonMention.ts
│   │   ├── extensions/EntityMention.ts
│   │   ├── extensions/TagMention.ts
│   │   └── SlashCommandMenu.tsx
│   └── drawer/
│       ├── DrawerShell.tsx
│       ├── DrawerHeader.tsx
│       ├── DrawerTabs.tsx
│       └── DrawerFooter.tsx
│
└── features/                    # L2: 도메인별 기능
    ├── dashboard/
    │   ├── DashboardGrid.tsx
    │   └── widgets/
    │       ├── TodaysAnchorWidget.tsx
    │       ├── ActiveTasksWidget.tsx
    │       ├── HitThemUpWidget.tsx
    │       ├── StreakHeatmapWidget.tsx
    │       ├── BrainEnergyGauge.tsx
    │       ├── RecentZettelsWidget.tsx
    │       ├── UpcomingBirthdaysWidget.tsx
    │       └── QuoteOfDayWidget.tsx
    │
    ├── action-hub/
    │   ├── ProjectCard.tsx
    │   ├── InboxItemRow.tsx
    │   ├── KanbanBoard.tsx
    │   ├── KanbanColumn.tsx
    │   ├── TaskCard.tsx
    │   ├── TaskCalendar.tsx
    │   ├── TaskDataGrid.tsx
    │   ├── TaskMetaPanel.tsx
    │   ├── TaskChecklistPanel.tsx
    │   ├── TaskAttachments.tsx
    │   ├── SidekickPanel.tsx
    │   ├── AuditLogAccordion.tsx
    │   └── drawers/TaskDrawer.tsx
    │
    ├── vault/
    │   ├── ZettelList.tsx
    │   ├── ZettelCard.tsx
    │   ├── BacklinkPanel.tsx
    │   ├── PromoteZettelButton.tsx
    │   ├── MediaCard.tsx
    │   ├── MediaMasonry.tsx
    │   ├── MediaCreateModal.tsx
    │   ├── AssetCard.tsx
    │   ├── PlaceCard.tsx
    │   ├── PlaceMap.tsx
    │   ├── ZettelGraphCanvas.tsx
    │   ├── MOCListItem.tsx
    │   └── drawers/
    │       ├── ZettelDrawer.tsx
    │       ├── MediaDrawer.tsx
    │       ├── PlaceDrawer.tsx
    │       └── AssetDrawer.tsx
    │
    ├── prm/
    │   ├── PersonCard.tsx
    │   ├── PersonHealthBar.tsx
    │   ├── PersonGrid.tsx
    │   ├── PersonFilterTabs.tsx
    │   ├── PersonTimelineFeed.tsx
    │   ├── TimelineItem.tsx
    │   ├── PersonInfoForm.tsx
    │   ├── PersonRelationsMini.tsx
    │   ├── GiftCard.tsx
    │   ├── GiftBoard.tsx
    │   ├── PRMGraphCanvas.tsx
    │   ├── MarkContactedButton.tsx
    │   └── drawers/
    │       ├── PersonDrawer.tsx
    │       ├── InteractionDrawer.tsx
    │       └── GiftDrawer.tsx
    │
    ├── life-ops/
    │   ├── DailyTopStrip.tsx
    │   ├── MoodButtonGroup.tsx
    │   ├── EnergyButtonGroup.tsx
    │   ├── EmotionPills.tsx
    │   ├── HabitTrackerGrid.tsx
    │   ├── HabitCard.tsx
    │   ├── JournalingTabs.tsx
    │   ├── DailyDataColumn.tsx
    │   ├── DailyAutoJoinFeed.tsx
    │   ├── TrendsGrid.tsx
    │   ├── CorrelationMatrix.tsx
    │   ├── WorkoutCard.tsx
    │   ├── WorkoutForm.tsx
    │   ├── CareerTimeline.tsx
    │   ├── CareerNode.tsx
    │   ├── HabitConfigForm.tsx
    │   ├── ArchiveListItem.tsx
    │   └── drawers/
    │       ├── WorkoutDrawer.tsx
    │       └── HabitDrawer.tsx
    │
    ├── settings/
    │   ├── ProfileForm.tsx
    │   ├── AppearanceControls.tsx
    │   ├── BentoLayoutEditor.tsx
    │   ├── ShortcutTable.tsx
    │   ├── DataImportWizard.tsx
    │   ├── DataExportPanel.tsx
    │   ├── BackupHistoryList.tsx
    │   ├── IntegrationCard.tsx
    │   └── AIUsagePanel.tsx
    │
    └── auth/
        └── LoginCard.tsx
```

---

## 3. Shared Primitives (L1 — 모든 도메인에서 재사용)

### 3.1. `<GlassCard>`

- **Path**: `components/shared/GlassCard.tsx`
- **Purpose**: 프로젝트 전체의 기본 카드 표면. 유리 + 고도 계층 자동 처리.
- **Props**:
  ```ts
  interface GlassCardProps {
    variant?: 'default' | 'elevated';
    elevation?: 'l0' | 'l1' | 'l2' | 'l3';
    interactive?: boolean;
    priority?: 'hero' | 'primary' | 'secondary';
    as?: keyof JSX.IntrinsicElements;
    className?: string;
    children: React.ReactNode;
  }
  ```
- **Tokens**: `.glass`, `.glass-elevated`, `elevation-l{n}`, `shadow-{md|lg}`, `shadow-glow`
- **Motion**: `interactive=true` → hover glow transition 200ms
- **A11y**: `as="button"` 시 `focus-visible:ring-2`
- **Used On**: 전 화면 (카드·패널·위젯 기본)

### 3.2. `<Tag>`

- **Path**: `components/shared/Tag.tsx`
- **Purpose**: 도메인 의미 색상 기반 Pill.
- **Props**:
  ```ts
  interface TagProps {
    variant: 'priority' | 'energy' | 'status' | 'dunbar' | 'neutral' | 'custom';
    value: string;          // 'P1' | 'hyper_focus' | 'todo' | 'layer_5' ...
    size?: 'sm' | 'md';
    icon?: LucideIcon;
    removable?: boolean;
    onRemove?: () => void;
  }
  ```
- **Tokens**: `color-domain-*`, `radius-xl(999)`
- **색상 매핑**:
  | variant | value | 토큰 |
  |---|---|---|
  | priority | P1/P2/P3 | `color-domain-priority-{p1-p3}` |
  | energy | hyper_focus/normal/routine | `color-domain-energy-{*}` |
  | dunbar | 5/15/50/150 | `color-domain-dunbar-{*}` |
  | status | todo/in_progress/review/done/blocked | `color-feedback-*` + `color-text-muted` |
- **A11y**: `role="status"` (읽기 전용) / `<button>` (removable)
- **Used On**: TaskCard, PersonCard, Drawer 메타 블록 등 전 화면

### 3.3. `<BentoGrid>` + `<BentoCard>`

상세는 [`02_DESIGN_SYSTEM.md §5.6`](./02_DESIGN_SYSTEM.md) 참조. 요지:

- **반응형**: `base=12`(모바일 단일열) → `md` 이상에서 기획 span 적용
- **priority**: `hero` | `primary` | `secondary` 로 시각 계층 자동 적용
- **Used On**: `/dashboard`, `/life-ops/{date}`, `/settings/appearance` (레이아웃 에디터)

### 3.4. `<Heatmap>`

- **Path**: `components/shared/Heatmap.tsx`
- **Purpose**: GitHub 스타일 연간 Heatmap.
- **Props**:
  ```ts
  interface HeatmapProps {
    data: Array<{ date: string; value: number }>;  // ISO date
    year?: number;                                  // default: current
    maxValue?: number;                              // 스케일 정규화용
    onCellClick?: (date: string, value: number) => void;
    tooltipFormatter?: (date: string, value: number) => string;
    colorScale?: [string, string, string, string, string]; // 5단계
  }
  ```
- **기본 색상 스케일**: `surface-raised → brand-accent` (5단계 HSL 보간)
- **Motion**: 셀 hover 120ms `ease-out`
- **A11y**: 각 셀 `aria-label="2026-04-22: 3건"`
- **Used On**: `/dashboard` (StreakHeatmapWidget), `/life-ops` (Calendar), `/life-ops/meditations`, `/life-ops/diaries` 연간 기록 뷰

### 3.5. `<Sparkline>`

- **Path**: `components/shared/Sparkline.tsx`
- **Purpose**: 축 없는 미니 라인 차트.
- **Props**:
  ```ts
  interface SparklineProps {
    data: number[];
    height?: number;   // default 36
    color?: string;    // default: color-brand-accent
    showDot?: boolean; // 마지막 데이터 점
    trend?: 'up' | 'down' | 'flat'; // 색상 자동
  }
  ```
- **Used On**: BrainEnergyGauge, DailyDataColumn, TrendsGrid

### 3.6. `<NetworkGraph>`

- **Path**: `components/shared/NetworkGraph.tsx`
- **Purpose**: 노드·엣지 기반 그래프 (react-force-graph-2d 래퍼).
- **Props**:
  ```ts
  interface NetworkGraphProps<N = NodeData, E = EdgeData> {
    nodes: N[];
    edges: E[];
    getNodeColor?: (n: N) => string;
    getNodeLabel?: (n: N) => string;
    getEdgeWidth?: (e: E) => number;
    onNodeClick?: (n: N) => void;
    enableMinimap?: boolean;
    enableSearch?: boolean;
    filterTypes?: string[];
  }
  ```
- **Used On**: `/vault/zettels/graph` (ZettelGraphCanvas), `/prm/graph` (PRMGraphCanvas), `/prm` Drawer (PersonRelationsMini — 간소화 버전)

### 3.7. `<ZenEditor>` (Tiptap 래퍼)

- **Path**: `components/shared/editor/ZenEditor.tsx`
- **Purpose**: 프로젝트 전역 유일 에디터. @/[[/# 지원, 자동 저장.
- **Props**:
  ```ts
  interface ZenEditorProps {
    content: JSONContent | null;
    mode?: 'development' | 'writing' | 'zettel' | 'journal';
    placeholder?: string;
    autoSaveKey?: string;                    // localStorage 백업 키
    debounceMs?: number;                     // default 1000
    ownerType: 'task' | 'zettel' | 'daily_log' | 'media' | 'interaction';
    ownerId: string;
    onSave: (content: JSONContent) => Promise<void>;
    onMentionInsert?: (mention: MentionNode) => void;
    readOnly?: boolean;
    maxWidth?: 'prose' | 'full';             // prose=680px
    showWordCount?: boolean;
  }
  ```
- **Extension 구성**:
  - StarterKit (heading, bold, italic, code, lists...)
  - PersonMention (`@`)
  - EntityMention (`[[`)
  - TagMention (`#`)
  - SlashCommand (`/`)
  - Placeholder
  - CharacterCount
- **Motion**: 포커스 모드 (writing): 현재 문단 이외 40% opacity, 150ms 트랜지션
- **A11y**: 툴바 hidden by default, `Cmd+/`로 조회
- **Used On**: Task workspace, Zettel detail, Daily Log journal, Media review

### 3.8. `<DrawerShell>` + sub components

- **Path**: `components/shared/drawer/DrawerShell.tsx`
- **Purpose**: 모든 Drawer의 공통 쉘. URL `?detail=` 감지 + 애니메이션 + 포커스 트랩.
- **Props**:
  ```ts
  interface DrawerShellProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    side?: 'right' | 'left';
    width?: number;                          // default 480
    stacked?: boolean;                       // 2번째 Drawer 겹치기
    children: React.ReactNode;
  }
  ```
- **Sub-components**:
  - `<DrawerHeader title, subtitle, actions />`
  - `<DrawerTabs tabs, value, onChange />`
  - `<DrawerScrollArea />`
  - `<DrawerFooter />`
- **Motion**: slide-in `spring(180, 26)`, 260ms
- **Used On**: SideDrawerHost가 모든 `?detail={type}:{id}` 라우팅

### 3.9. `<EmptyState>`

- **Path**: `components/shared/EmptyState.tsx`
- **Purpose**: 데이터 없는 리스트/그리드 자리의 온보딩 플레이스홀더.
- **Props**:
  ```ts
  interface EmptyStateProps {
    icon?: LucideIcon | string;
    title: string;
    description?: string;
    cta?: { label: string; onClick: () => void; hotkey?: string };
    illustration?: 'zettel' | 'person' | 'task' | 'habit' | 'generic';
  }
  ```
- **Motion**: illustration float 3s ease-in-out infinite (prefers-reduced-motion 자동 비활성)
- **Used On**: 모든 리스트·그리드 화면

### 3.10. `<SkeletonBlock>`

- **Path**: `components/shared/SkeletonBlock.tsx`
- **Props**:
  ```ts
  interface SkeletonBlockProps {
    variant?: 'text' | 'card' | 'avatar' | 'row' | 'heatmap' | 'sparkline' | 'editor';
    count?: number;
    className?: string;
  }
  ```
- **Tokens**: `color-surface-raised → color-border-default` pulse
- **Motion**: `skeleton-pulse` 1.5s infinite
- **Used On**: 모든 Suspense fallback

### 3.11. `<FilterBar>`

- **Path**: `components/shared/FilterBar.tsx`
- **Purpose**: 상단 필터·검색·정렬·Save View 집합 컴포넌트.
- **Props**:
  ```ts
  interface FilterBarProps {
    searchPlaceholder?: string;
    filters: FilterConfig[];                 // 드롭다운 필터 정의
    sortOptions?: SortOption[];
    savedViews?: SavedView[];
    onChange: (state: FilterState) => void;  // URL 동기화
    rightSlot?: React.ReactNode;             // 추가 버튼
  }
  type FilterConfig =
    | { kind: 'select'; key: string; label: string; options: {value: string; label: string; icon?: string}[] }
    | { kind: 'multi'; key: string; label: string; options: any[] }
    | { kind: 'date-range'; key: string; label: string }
    | { kind: 'tag'; key: string; label: string };
  ```
- **URL 동기화**: `?filter={json}&q=&sort=&view=`
- **Used On**: `/action-hub/{id}` (Kanban), `/action-hub/{id}/list`, `/vault/zettels`, `/vault/media`, `/prm`, `/life-ops/workouts`

### 3.12. `<ViewSwitcher>`

- **Path**: `components/shared/ViewSwitcher.tsx`
- **Props**:
  ```ts
  interface ViewSwitcherProps {
    views: Array<{ key: string; label: string; icon: LucideIcon }>;
    current: string;
    onSwitch: (key: string) => void;
  }
  ```
- **URL 동기화**: `?view=kanban|calendar|list|graph|map`
- **Motion**: 전환 시 220ms 크로스페이드 (FramerMotion `LayoutGroup`)
- **Used On**: `/action-hub/{id}` Kanban↔Calendar↔List, `/vault/media`, `/vault/places`, `/vault/assets`

### 3.13. `<DataGrid>`

- **Path**: `components/shared/DataGrid.tsx` (TanStack Table 래퍼)
- **Props**:
  ```ts
  interface DataGridProps<T> {
    data: T[];
    columns: ColumnDef<T>[];
    enableColumnResize?: boolean;
    enableColumnReorder?: boolean;
    enableInfiniteScroll?: boolean;
    onRowClick?: (row: T) => void;
    emptyState?: React.ReactNode;
    density?: 'compact' | 'comfortable';
  }
  ```
- **Used On**: `/action-hub/{id}/list`, `/vault/assets` (table toggle), `/life-ops/workouts`

### 3.14. `<TagInput>`

- **Path**: `components/shared/TagInput.tsx`
- **Purpose**: 태그 자동완성 + 생성. `taggings` 테이블과 연동.
- **Props**:
  ```ts
  interface TagInputProps {
    ownerType: string;
    ownerId: string;
    value: Tag[];
    onChange: (tags: Tag[]) => void;
    max?: number;
    suggestions?: Tag[];                     // 자주 쓴 태그 상단
  }
  ```
- **Used On**: TaskDrawer, ZettelDrawer, MediaDrawer 등

### 3.15. `<DatePicker>`, `<FileDropzone>`, `<UserAvatar>`, `<KeyHint>`

- **DatePicker**: Radix Popover + calendar. 단일/범위 모드.
- **FileDropzone**: R2 signed URL 업로드 + 미리보기 + 프로그레스.
- **UserAvatar**: 이니셜 (dunbar 색) or 이미지. `size: 'xs' | 'sm' | 'md' | 'lg'`.
- **KeyHint**: 키보드 단축키 뱃지 (예: `<KeyHint combo="mod+k" />`).

---

## 4. Shell Components (전역)

### 4.1. `<AuthGuard>`

- **Path**: `components/shell/AuthGuard.tsx`
- **Purpose**: 로그인 세션 검증. 미로그인 시 `/login` 리다이렉트.
- **Server Component**: Lucia 세션 쿠키 검증 후 `<AuthContext>` 주입.
- **Used On**: `app/(app)/layout.tsx`

### 4.2. `<GlobalNav>` (GNB)

- **Path**: `components/shell/GlobalNav.tsx`
- **Purpose**: 좌측 64px 고정 네비. 5도메인 + 유틸 3개 + 로고.
- **Structure**:
  ```
  Logo · Dashboard · ActionHub · Vault · PRM · LifeOps
  ─ spacer ─
  CommandPaletteButton · QuickCaptureButton · UserMenu
  ```
- **Props**: `{ activeDomain: DomainKey }` (path로부터 derived)
- **Tokens**: `color-surface-base/60` + `backdrop-blur-xl` + `border-r border-border-subtle`
- **아이콘 상태**:
  - default: `color-text-muted`
  - hover: `color-text-primary`
  - active: `color-brand-accent` + 좌측 2px 세로 바 + subtle glow
- **Motion**: 활성 바 layoutId 애니메이션 (FramerMotion `<motion.div layoutId="active-domain-indicator">`)
- **A11y**: 각 항목 `aria-label`, 활성 항목 `aria-current="page"`, Tooltip 우측 표시
- **Hotkeys**: `g d/a/v/p/l/s` (Navigation scope)
- **모바일**: `<768px` 시 하단 탭바로 전환 (별도 컴포넌트 `<MobileTabBar>` 렌더)
- **Used On**: `app/(app)/layout.tsx`

### 4.3. `<LocalNav>` (LNB)

- **Path**: `components/shell/LocalNav.tsx`
- **Purpose**: 도메인별 2단계 메뉴. 접기/펴기 + Zen Mode 자동 숨김.
- **Props**:
  ```ts
  interface LocalNavProps {
    domain: DomainKey;
    collapsed: boolean;
    onToggle: () => void;
  }
  ```
- **하위 컴포넌트**:
  - `<LocalNavHeader title, onToggle />`
  - `<LocalNavSection label>` (아코디언)
  - `<LocalNavItem icon, label, href, badge?, active>`
  - `<LocalNavFooter>` (도메인별 퀵 액션)
- **도메인별 구성**: [`01_INFORMATION_ARCHITECTURE.md §3.2`](./01_INFORMATION_ARCHITECTURE.md) 참조. 각 도메인별 메뉴 트리는 `constants/localnav/{domain}.ts` 에 선언.
- **상태**: Zustand `useShell.lnbCollapsed` + localStorage 영속화
- **Motion**: collapse 시 220ms width transition (220px → 0)
- **A11y**: 아코디언 `aria-expanded`, 키보드 Tab 순서 논리적
- **Used On**: `app/(app)/layout.tsx`

### 4.4. `<Breadcrumb>`

- **Path**: `components/shell/Breadcrumb.tsx`
- **Purpose**: 48px sticky 헤더 내 좌측. 경로 계층 표시.
- **Props**: 자동 pathname parsing. override용 `items?: Crumb[]` 옵션.
- **규칙**:
  - 도메인은 이모지 + 이름
  - 중간 5개 초과 시 `...` 드롭다운
  - 마지막(현재)은 `color-text-primary` + 비클릭
- **Zen Mode**: 호버 시에만 표시 (`opacity-0 hover:opacity-100`)
- **Used On**: 모든 `(app)` 페이지 상단

### 4.5. `<CanvasTransition>`

- **Path**: `components/shell/CanvasTransition.tsx`
- **Purpose**: 페이지 전환 크로스페이드 래퍼.
- **Motion**: 180ms `ease-in-out`, FramerMotion `AnimatePresence`
- **Used On**: `(app)/layout.tsx` `{children}` 감싸기

### 4.6. `<SideDrawerHost>`

- **Path**: `components/shell/SideDrawerHost.tsx`
- **Purpose**: URL `?detail={type}:{id}` 감지 → 해당 Drawer 컴포넌트 동적 로드.
- **타입별 매핑**:
  ```ts
  const DRAWER_MAP = {
    person: () => import('@/features/prm/drawers/PersonDrawer'),
    task: () => import('@/features/action-hub/drawers/TaskDrawer'),
    zettel: () => import('@/features/vault/drawers/ZettelDrawer'),
    media: () => import('@/features/vault/drawers/MediaDrawer'),
    place: () => import('@/features/vault/drawers/PlaceDrawer'),
    interaction: () => import('@/features/prm/drawers/InteractionDrawer'),
    gift: () => import('@/features/prm/drawers/GiftDrawer'),
    workout: () => import('@/features/life-ops/drawers/WorkoutDrawer'),
    habit: () => import('@/features/life-ops/drawers/HabitDrawer'),
  };
  ```
- **Stack**: 최대 2개 Drawer 동시 (`?detail=person:x,task:y`)
- **Used On**: `(app)/layout.tsx`

### 4.7. `<CommandPalette>`

- **Path**: `components/shell/CommandPalette.tsx`
- **Purpose**: `Cmd+K` 전역 검색·액션 팔레트.
- **Props**: 상태 전역 (Zustand `useCommandPalette`).
- **레이아웃**: cmdk 기반, 화면 상단 20% 중앙, width 680px, `.glass-elevated elevation-l3 + shadow-glow`
- **섹션**:
  1. 즉시 이동
  2. 최근 항목 (localStorage LRU 20)
  3. 검색 결과 (인물 3 / 지식 3 / 작업 3 / 미디어 3 / 장소 2)
  4. 액션 (새 Task/Zettel/Person)
- **접두사 모드**: `>` (액션) / `@` (사람) / `[[` (엔티티) / `#` (태그) / `?` (치트시트)
- **Hotkeys**: `↑↓` 이동, `Enter` 열기, `Cmd+Enter` 새 탭, `Cmd+Shift+Enter` Drawer, `Tab` 섹션 점프
- **Used On**: `(app)/layout.tsx` 항상 마운트

### 4.8. `<QuickCaptureModal>`

- **Path**: `components/shell/QuickCaptureModal.tsx`
- **Purpose**: `Cmd+Shift+N` AI 라우팅 캡처.
- **Props**: Zustand `useQuickCapture` (open, context).
- **구조**:
  - 제목 `빠른 입력` + 현재 컨텍스트 뱃지
  - auto-grow textarea (max 8줄)
  - 하단: `Enter` 보내기, `Cmd+D` 도메인 강제 선택 Popover
- **Flow**: POST `/api/capture` → confidence ≥ 0.7 자동 생성 (Toast + action) / < 0.7 Inbox 저장
- **Offline**: IndexedDB `pending_captures` 큐 fallback
- **Motion**: slide-down from top 220ms
- **A11y**: `aria-modal`, focus trap, `Esc` 닫기
- **Used On**: `(app)/layout.tsx`

### 4.9. `<HotkeyCheatsheet>`

- **Path**: `components/shell/HotkeyCheatsheet.tsx`
- **Trigger**: `?` 키
- **Props**: Zustand `useHotkeyDialog`
- **내용**: 카테고리별 단축키 표 (Global / Navigation / Creation / Context)
- **Used On**: `(app)/layout.tsx`

### 4.10. `<NotificationBell>`

- **Path**: `components/shell/NotificationBell.tsx`
- **Purpose**: GNB User Menu 내부에 오버레이. 최신 10개 알림 + unread count.
- **Data**: `notifications` 테이블 SWR (폴링 60s)
- **Kinds**: `hit_them_up` / `birthday` / `weekly_review_ready` / `system`
- **Action**: 클릭 시 해당 엔티티 Drawer 오픈
- **Used On**: GlobalNav UserMenu

---

## 5. Dashboard 화면 컴포넌트

### 5.1. 화면: `/dashboard` — Home Brief

**Component Tree**:
```
<DashboardPage>
  └─ <DashboardGrid userLayout={preferences.bento}>
       ├─ <TodaysAnchorWidget>           span=12×1
       ├─ <ActiveTasksWidget>             span=8×3
       ├─ <HitThemUpWidget>               span=4×3
       ├─ <StreakHeatmapWidget>           span=8×2
       ├─ <BrainEnergyGauge>              span=4×2
       ├─ <RecentZettelsWidget>           span=6×2
       ├─ <UpcomingBirthdaysWidget>       span=6×2
       └─ <QuoteOfDayWidget>              span=12×1
```

**데이터 소스 (RSC fetch)**: `getDailyLog(today)`, `listNeedsContact()`, `listTasks({dueBefore:tomorrow})`, `getAllHabitsHeatmap`, `listZettels({limit:5, sort:'updated'})`, `getHealthTrend('sleepHours', 7)`, `listPeople({birthdayWithin: 30})`, `getRandomPermanentZettel()`

---

### 5.2. `<DashboardGrid>`

- **Path**: `components/features/dashboard/DashboardGrid.tsx`
- **Purpose**: `<BentoGrid>` 래퍼 + 레이아웃 재배치 + 위젯 숨김 상태.
- **Props**:
  ```ts
  interface DashboardGridProps {
    userLayout: Record<WidgetKey, { span: Span; rows: number; hidden: boolean; order: number }>;
    children: React.ReactNode;  // 위젯들
  }
  ```
- **Edit Mode**: `?edit=1` 쿼리 시 드래그 핸들 노출 + 재배치 → `updateDashboardLayout` mutation
- **Used On**: `/dashboard`, `/settings/appearance` (재사용)

### 5.3. `<TodaysAnchorWidget>` (`priority="hero"`)

- **Path**: `components/features/dashboard/widgets/TodaysAnchorWidget.tsx`
- **Props**: `{ date: string; dailyLog: DailyLog | null }`
- **내용**:
  - 날짜 + 요일 + 인사말 (시간대별 다름: 아침/오후/저녁/심야)
  - Mood 5개 원클릭 `<MoodButtonGroup compact>`
  - Energy 5개 원클릭 `<EnergyButtonGroup compact>`
  - 오늘의 의도 한 줄 input (`daily_logs.intention`)
- **Optimistic**: Mood/Energy 클릭 즉시 반영, 실패 시 롤백
- **Motion**: Mood 버튼 클릭 시 하단 파티클 200ms
- **A11y**: 각 Mood 버튼 `aria-label="기분 3점"`

### 5.4. `<ActiveTasksWidget>` (`priority="primary"`)

- **Path**: `components/features/dashboard/widgets/ActiveTasksWidget.tsx`
- **내용**: P1 상단, Hyper Focus 보라 테두리, 체크박스 (Optimistic)
- **Props**: `{ tasks: Task[]; onToggle: (id) => Promise<void> }`
- **Row 컴포넌트**: `<ActiveTaskRow>` (TaskCard와 별개, 미니 버전)
- **내부 정렬**: P1 → dueAt asc → hyperFocus first
- **Empty**: "오늘은 몰입할 Task가 없네요. [+] 만들기"

### 5.5. `<HitThemUpWidget>` (`priority="primary"`)

- **Path**: `components/features/dashboard/widgets/HitThemUpWidget.tsx`
- **내용**: 카드 스택 (Tinder 스타일). Top 5.
- **각 카드**: `<PersonCard compact />` + `[연락 완료]` 버튼
- **Action**: 버튼 클릭 → `markContacted(personId)` + Optimistic 슬라이드 아웃
- **Empty**: "모두에게 연락을 마쳤어요 🎉"

### 5.6. `<StreakHeatmapWidget>`

- **Path**: `components/features/dashboard/widgets/StreakHeatmapWidget.tsx`
- **내용**: `<Heatmap>` 1년 (통합 habits 기준). 우상단: 최장 스트릭 뱃지.
- **Props**: `{ heatmapData: Array<{date, value}>; bestStreak: number }`
- **인터랙션**: 셀 클릭 → `/life-ops/{date}` 이동

### 5.7. `<BrainEnergyGauge>`

- **Path**: `components/features/dashboard/widgets/BrainEnergyGauge.tsx`
- **내용**:
  - 원형 게이지 (0–100), 오늘의 에너지
  - 하단 `<Sparkline data={last7Days} />`
- **색상**: hyperfocus=보라 / normal=하늘 / routine=초록

### 5.8. `<RecentZettelsWidget>`

- **Path**: `components/features/dashboard/widgets/RecentZettelsWidget.tsx`
- **내용**: 5개 리스트, 각 행: 타입 아이콘 + 제목 + 태그 + `timeago(updatedAt)`
- **Click**: Drawer (`?detail=zettel:{id}`)

### 5.9. `<UpcomingBirthdaysWidget>`

- **Path**: `components/features/dashboard/widgets/UpcomingBirthdaysWidget.tsx`
- **내용**: 30일 내 생일, D-day 역순
- **각 행**: 아바타 + 이름 + D-day + `[선물 제안]` CTA (→ QuickCapture에 `domain=gift` 프리필)

### 5.10. `<QuoteOfDayWidget>`

- **Path**: `components/features/dashboard/widgets/QuoteOfDayWidget.tsx`
- **내용**: 영구 메모 중 랜덤 한 줄. `font-display` (serif).
- **Data**: `getRandomPermanentZettel()` (날짜 기반 seeded random)
- **Motion**: 초기 fade-up 600ms

### 5.11. Loading / Empty

- Loading: 각 위젯 `<SkeletonBlock variant="card" />`로 독립 Suspense
- Empty (첫 방문): `<OnboardingChecklist>` 컴포넌트로 대체
  - Path: `components/features/dashboard/OnboardingChecklist.tsx`
  - Zettel 1 / Person 1 / Habit 1 생성 유도 3스텝

---

## 6. Action Hub 화면 컴포넌트

### 6.1. 화면: `/action-hub` — Project Landing

**Component Tree**:
```
<ActionHubLandingPage>
  ├─ <Tabs value={filter}>   (All / Project / Area / Archived)
  ├─ <FilterBar />
  └─ <ProjectGrid>
       └─ <ProjectCard />  × N
```

#### `<ProjectCard>`
- **Path**: `components/features/action-hub/ProjectCard.tsx`
- **Props**: `{ project: Project; onOpen: (id) => void }`
- **내용**:
  - 아이콘 + 제목 + 카테고리 `<Tag>`
  - 원형 진척률 (SVG `stroke-dasharray`)
  - 남은 P1 수 `<Tag variant="priority" value="P1" />`
  - 다음 마감 D-day
  - 최근 활동 `timeago(lastTaskUpdatedAt)`
- **Motion**: 호버 시 `glass-interactive` glow

### 6.2. 화면: `/action-hub/inbox`

**Component Tree**:
```
<InboxPage>
  ├─ <InboxHeader count />
  └─ <InboxList>
       └─ <InboxItemRow />  × N
```

#### `<InboxItemRow>`
- **Path**: `components/features/action-hub/InboxItemRow.tsx`
- **Props**: `{ capture: QuickCapture; aiSuggestion: RouteSuggestion }`
- **내용**:
  - 좌: 원문 텍스트 (truncate 2줄)
  - 중: AI 제안 domain 뱃지 + confidence %
  - 우: `[수락] [수정] [삭제]` 버튼 3개
- **수정 클릭**: inline dropdown (domain 변경) + 핵심 필드 미니 폼

### 6.3. 화면: `/action-hub/{projectId}` — Kanban (기본)

**Component Tree**:
```
<ProjectKanbanPage>
  ├─ <ProjectHeader>                       (제목, 진척률, 메타)
  ├─ <FilterBar />
  ├─ <ViewSwitcher views={[kanban,calendar,list]} />
  └─ <KanbanBoard>
       ├─ <KanbanColumn status="backlog">
       │    └─ <TaskCard />
       ├─ <KanbanColumn status="in_progress">
       ├─ <KanbanColumn status="review">
       ├─ <KanbanColumn status="done">
       └─ <KanbanColumn status="blocked">
```

#### `<KanbanBoard>`
- **Path**: `components/features/action-hub/KanbanBoard.tsx`
- **Props**: `{ projectId; tasks; onMove: (taskId, to, index) => Promise<void> }`
- **DnD**: `@dnd-kit/core` + `@dnd-kit/sortable`
- **Optimistic**: onMove 즉시 반영 + 실패 시 롤백
- **Motion**: 드래그 중 그림자 상승 + 60% opacity 원본

#### `<KanbanColumn>`
- **Path**: `components/features/action-hub/KanbanColumn.tsx`
- **Props**: `{ status; title; color; tasks; onAddTask }`
- **헤더**: 상태명 + 카운트 + `[+]` 버튼
- **스크롤**: 컬럼 내부 세로, 자동 스크롤 (뷰포트 가장자리 80px)

#### `<TaskCard>`
- **Path**: `components/features/action-hub/TaskCard.tsx`
- **Props**: `{ task: Task; compact?: boolean; onOpen; onCheckToggle }`
- **내용**:
  - 제목 (2줄 clamp)
  - `<Tag variant="priority">` + `<Tag variant="energy">`
  - D-day (D-3 이하 `color-feedback-warning`, 초과 `color-feedback-danger`)
  - 아바타 스택 (linked people, 최대 3 + overflow)
  - 체크리스트 프로그레스 (n/m)
  - 드래그 핸들 (좌측 6px 수직 그립)
- **Motion**: 호버 glow, 클릭 시 bounce(0.95)
- **Click**: shift+클릭 → 다중 선택 / 일반 클릭 → Drawer / Cmd+클릭 → 전체화면 라우트

### 6.4. 화면: `/action-hub/{projectId}/calendar`

```
<ProjectCalendarPage>
  ├─ <ProjectHeader />
  ├─ <ViewSwitcher />
  └─ <TaskCalendar>
```

#### `<TaskCalendar>`
- **Path**: `components/features/action-hub/TaskCalendar.tsx`
- **Props**: `{ tasks; onCreate(date); onMove(taskId, newDate) }`
- **구현**: 월/주/일 뷰. 날짜 셀에 `<TaskCard compact />` 나열.
- **DnD**: 날짜 → 날짜 드래그로 `updateTask({startAt, dueAt})`

### 6.5. 화면: `/action-hub/{projectId}/list`

```
<ProjectListPage>
  ├─ <ProjectHeader />
  ├─ <ViewSwitcher />
  └─ <TaskDataGrid>   (DataGrid 래퍼)
```

#### `<TaskDataGrid>`
- **Path**: `components/features/action-hub/TaskDataGrid.tsx`
- **Columns**: 체크 / 제목 / 상태 / Priority / Energy / Due / Assignees / Tags / UpdatedAt
- **Bulk Actions**: Shift+클릭 선택 → 상단 바에 `[상태변경] [Priority변경] [삭제]`

### 6.6. 화면: `/action-hub/{projectId}/tasks/{taskId}` — Zen Workspace

**Component Tree** (Deep Work Mode, LNB 자동 숨김):
```
<TaskWorkspacePage>
  ├─ <ZenHeader task />                   (Breadcrumb + Zen 토글)
  └─ <ResizablePanels layout="30/70">
       ├─ <TaskMetaPanel task>
       │    ├─ <InlineTitleEdit />
       │    ├─ <Tag variant="priority" />   (클릭 cycle)
       │    ├─ <Tag variant="energy" />
       │    ├─ <StatusToggle />
       │    ├─ <DatePicker mode="range" />     (Start / Due)
       │    ├─ <LinkedPeopleList />            (@mention 추가/삭제)
       │    ├─ <LinkedZettelsList />           ([[ ]] 추가)
       │    ├─ <TaskChecklistPanel />
       │    ├─ <TaskAttachments />
       │    └─ <AuditLogAccordion />
       └─ <ZenEditor mode={task.kind === 'writing' ? 'writing' : 'development'} />
```

**Split View** (Cmd+\): 우측 에디터 50/50 분할 → `<SidekickPanel>` 등장 (Zettel/Person 검색).

#### `<TaskChecklistPanel>`
- **Path**: `components/features/action-hub/TaskChecklistPanel.tsx`
- **Props**: `{ taskId; items: Checklist[]; onToggle; onReorder; onAdd; onDelete }`
- **상단**: 프로그레스 바 (n/m)
- **DnD**: 세로 정렬 → `reorderChecklists`
- **Optimistic**: 토글·정렬 즉시 반영

#### `<SidekickPanel>`
- **Path**: `components/features/action-hub/SidekickPanel.tsx`
- **내용**: 탭 (Zettel 검색 / Person 검색 / Recent)
- **Click 결과**: 에디터 커서 위치에 `[[ ]]` or `@` 삽입

#### `<TaskMetaPanel>`, `<InlineTitleEdit>`, `<StatusToggle>`, `<LinkedPeopleList>`, `<LinkedZettelsList>`, `<TaskAttachments>`, `<AuditLogAccordion>`, `<ZenHeader>`
각각 작은 컴포넌트. Props는 해당 섹션 데이터만 받음. 패턴 동일 (props-driven + mutation callback).

---

## 7. The Vault 화면 컴포넌트

### 7.1. 화면: `/vault/zettels` — 3단 Split View

**Component Tree**:
```
<VaultZettelsPage>
  └─ <ResizablePanels layout="320/flex/280">
       ├─ <ZettelList>          (좌측 320)
       ├─ <ZenEditor mode="zettel" />   (중앙 유동)
       └─ <BacklinkPanel />     (우측 280)
```

#### `<ZettelList>`
- **Path**: `components/features/vault/ZettelList.tsx`
- **Props**: `{ activeId; onSelect }`
- **구성**:
  - 상단: `<Tabs>` (Fleeting / Literature / Permanent / MOC)
  - 검색 입력 (FTS5, 200ms debounce)
  - `<TagInput>` 필터
  - 카드 리스트: `<ZettelCard compact />`
- **Sort**: updatedAt desc (기본), 정렬 드롭다운 제공

#### `<ZettelCard>`
- **Path**: `components/features/vault/ZettelCard.tsx`
- **Props**: `{ zettel; compact?; onSelect }`
- **내용**:
  - 타입 아이콘 + 제목
  - 한 줄 요약 (첫 60자)
  - 태그 (최대 3개 + overflow)
  - `timeago(updatedAt)`
- **Motion**: 선택 시 좌측 2px `brand-accent` 바

#### `<BacklinkPanel>`
- **Path**: `components/features/vault/BacklinkPanel.tsx`
- **Props**: `{ zettelId }`
- **구성**:
  - 상단: "이 메모를 참조하는 N개"
  - 각 항목: 제목 + 호버 시 컨텍스트 스니펫 Popover
  - 하단: "관련 제안" (semanticSearchZettels 결과 5개)

#### `<PromoteZettelButton>`
- **Path**: `components/features/vault/PromoteZettelButton.tsx`
- **조건**: `zettel.type === 'fleeting'` 일 때만 노출
- **Action**: `promoteZettel(id)` → 편집 필드 Modal (type=literature/permanent 선택)

### 7.2. 화면: `/vault/zettels/graph`

**Component Tree**:
```
<ZettelGraphPage>
  ├─ <GraphControls>          (필터, 검색, 줌)
  └─ <ZettelGraphCanvas>      (<NetworkGraph> 래퍼)
```

#### `<ZettelGraphCanvas>`
- **Path**: `components/features/vault/ZettelGraphCanvas.tsx`
- **Props**: `{ nodes; edges; onNodeClick; depth }`
- **노드 색상**: type별 (fleeting=회색, literature=파랑, permanent=골드, MOC=보라)
- **엣지 두께**: 링크 빈도
- **Click**: Drawer (`?detail=zettel:{id}`)
- **Minimap**: 우하단 고정

### 7.3. 화면: `/vault/zettels/{id}` — 딥링크

Split View의 중앙 패널만 전체 화면. `<ZenEditor>` + 상단에 `<ZettelHeader>` + 하단 Accordion으로 `<BacklinkPanel>` 접기.

### 7.4. 화면: `/vault/media` — Masonry Gallery

**Component Tree**:
```
<VaultMediaPage>
  ├─ <FilterBar />              (Type / Status / Genre / 정렬)
  ├─ <ViewSwitcher />           (Masonry / Grid / List)
  └─ <MediaMasonry>
       └─ <MediaCard />
```

#### `<MediaCard>`
- **Path**: `components/features/vault/MediaCard.tsx`
- **Props**: `{ media; onOpen }`
- **내용**:
  - 커버 (16:9 영상 / 2:3 도서·게임)
  - 제목, 크리에이터, 평점 (⭐ 0.5 단위)
  - 상태 `<Tag>`
- **Hover**: Glass overlay + 빠른 액션 (상태 변경 Popover / Drawer 열기)

#### `<MediaMasonry>`
- **Path**: `components/features/vault/MediaMasonry.tsx`
- **구현**: CSS `columns: 2/3/4/5` responsive
- **Virtualization**: react-virtuoso (≥100개 항목)

#### `<MediaCreateModal>`
- **Path**: `components/features/vault/MediaCreateModal.tsx`
- **Trigger**: 우상단 `+` 버튼
- **구성**:
  - URL 붙여넣기 → `enrichMediaFromSource()` → 자동 채움 (OG 파싱 + AI)
  - 수동 입력 폼 (mediaType, 제목, 크리에이터, 장르...)

### 7.5. 화면: `/vault/media/{id}`

Drawer 또는 전체 페이지. 내용:
- 커버 + `<Gallery>` (스크린샷 attachments)
- 메타 그리드 (장르/플랫폼/크리에이터/출시년도)
- `<RatingSlider>` (1~5, 0.5 단위)
- `<ZenEditor mode="writing">` 긴 리뷰
- `<LinkedZettelsList>`, `<RecommenderList>` (Person 멘션)

### 7.6. 화면: `/vault/assets`

**Component Tree**:
```
<VaultAssetsPage>
  ├─ <FilterBar />
  ├─ <ViewSwitcher views={[masonry, table]} />
  └─ (Masonry) <AssetCard /> × N  | (Table) <DataGrid />
```

#### `<AssetCard>`
- **Path**: `components/features/vault/AssetCard.tsx`
- **내용**: 이미지 + 이름 + 카테고리 `<Tag>` + 가격 + 취득일

### 7.7. 화면: `/vault/places`

**Component Tree**:
```
<VaultPlacesPage>
  └─ <ResizablePanels layout="flex/400">
       ├─ <PlaceMap places />        (Mapbox or Leaflet)
       └─ <PlaceList>
            └─ <PlaceCard />
```

#### `<PlaceCard>`
- **Path**: `components/features/vault/PlaceCard.tsx`
- **내용**: 장소명 + 주소 + 방문 횟수 + 최근 방문
- **Action**: 방문 기록 추가 → Interaction도 함께 생성 (Companion Person optional)

---

## 8. PRM 화면 컴포넌트

### 8.1. 화면: `/prm` — Card Grid

**Component Tree**:
```
<PRMPage>
  ├─ <PersonFilterTabs />           (All / Hit Them Up / Favorites / Dunbar 5,15,50,150)
  ├─ <FilterBar />                  (그룹, 검색)
  └─ <PersonGrid>
       └─ <PersonCard />
```

#### `<PersonCard>`
- **Path**: `components/features/prm/PersonCard.tsx`
- **Props**: `{ person; compact?; onOpen }`
- **내용**:
  - `<UserAvatar size="md" />` (이니셜 or 사진)
  - 이름 + 닉네임
  - Dunbar Layer 점 (왼쪽 상단)
  - 그룹 `<Tag>` × 2 (overflow +N)
  - `<PersonHealthBar>` (다음 연락 D-day)
  - 생일 7일 내: 🎂 뱃지 우상단
- **Motion**: cadence 초과 시 테두리 `color-feedback-danger` pulse 2.5s infinite

#### `<PersonHealthBar>`
- **Path**: `components/features/prm/PersonHealthBar.tsx`
- **Props**: `{ lastContactedAt; cadenceDays }`
- **구현**: `<Progress>` 0-100%. 100% 초과 시 빨강.
- **Tooltip**: "다음 연락 +3일"

#### `<PersonFilterTabs>`
- **Path**: `components/features/prm/PersonFilterTabs.tsx`
- **탭**: All / 🚨 Hit Them Up / ⭐ Favorites / Dunbar 5 / 15 / 50 / 150

### 8.2. Drawer: `<PersonDrawer>` (`?detail=person:{id}`)

**Component Tree**:
```
<PersonDrawer>
  ├─ <DrawerHeader>
  │    ├─ UserAvatar size="lg"
  │    ├─ 이름 + 메타 (Dunbar Layer, Groups)
  │    ├─ 통계: 🎁 N / 📅 N / ✅ N
  │    └─ Actions: [연락했음] [+ Interaction] [+ Gift]
  ├─ <DrawerTabs tabs={[Timeline, Info, Relations]} />
  └─ <DrawerScrollArea>
       [Timeline] <PersonTimelineFeed personId />
       [Info]     <PersonInfoForm person />
       [Relations] <PersonRelationsMini personId />
```

#### `<PersonTimelineFeed>`
- **Path**: `components/features/prm/PersonTimelineFeed.tsx`
- **Data**: Interactions + Gifts + Tasks(linked) + Zettels(linked) 병합 정렬 (occurredAt/createdAt desc)
- **무한 스크롤**: react-virtuoso
- **Row**: `<TimelineItem kind="interaction|gift|task|zettel" />`

#### `<TimelineItem>`
- **Path**: `components/features/prm/TimelineItem.tsx`
- **Variant별 시각**:
  - interaction: 💬 아이콘 + type 뱃지
  - gift: 🎁 + direction(주/받) + 금액
  - task: ✅ + 상태 + 링크
  - zettel: 📝 + 발췌 1줄
- **인라인 편집**: 호버 시 `...` 드롭다운 → 편집/삭제

#### `<PersonInfoForm>`
- **Path**: `components/features/prm/PersonInfoForm.tsx`
- **필드**: 이메일·전화·생일(D-day)·주소·SNS·핵심가치·자유 메모 (`<ZenEditor mode="zettel">`)
- **검증**: Zod schema

#### `<PersonRelationsMini>`
- **Path**: `components/features/prm/PersonRelationsMini.tsx`
- **내용**: 미니 Force Graph (이 인물 중심, 1-hop)
- **하단**: `[+ 관계 추가]` 버튼 → Modal

#### `<MarkContactedButton>`
- **Path**: `components/features/prm/MarkContactedButton.tsx`
- **Action**: `markContacted(id)` + 햅틱 80ms + Toast "연락 기록됨"

### 8.3. 화면: `/prm/graph`

**Component Tree**:
```
<PRMGraphPage>
  ├─ <GraphControls filterByGroup />
  └─ <PRMGraphCanvas>
```

#### `<PRMGraphCanvas>`
- **노드 색**: 그룹별 클러스터링
- **엣지 두께**: 상호작용 횟수 (network_edges.weight)

### 8.4. 화면: `/prm/gifts` — 선물 보드

**Component Tree**:
```
<GiftsPage>
  ├─ <Tabs value={direction}>   (준 것 / 받은 것)
  ├─ <FilterBar />              (만족도, 연간 필터)
  ├─ <GiftBoard>
  │    └─ <GiftCard />
  └─ <YearlyGiftSummary />      (연간 지출 합계, 상단 카드 1개)
```

#### `<GiftCard>`
- **Path**: `components/features/prm/GiftCard.tsx`
- **내용**: 이미지 + 수령자/선물자 아바타 + 이름/기회 + 금액 + 만족도 ⭐

---

## 9. Life Ops 화면 컴포넌트

### 9.1. 화면: `/life-ops/{date}` — Daily Command Center

**Component Tree** (4행 구성):
```
<DailyLogPage>
  ├─ <DailyTopStrip date>
  │    ├─ <DateNav prev today next />
  │    ├─ <MoodButtonGroup />
  │    ├─ <EnergyButtonGroup />
  │    └─ <EmotionPills />
  ├─ <HabitTrackerGrid>
  │    └─ <HabitCard />                 × N
  ├─ <ResizablePanels layout="50/50">
  │    ├─ <JournalingTabs>             (일기 / 묵상 / 감사)
  │    │    └─ <ZenEditor mode="journal" />
  │    └─ <DailyDataColumn>
  │         ├─ <SleepSparkline data={14days} />
  │         ├─ <DeepWorkTotal today />
  │         ├─ <WorkoutTodayCard />
  │         └─ <AISummaryButton />
  └─ <DailyAutoJoinFeed date>          (오늘의 모든 도메인 이벤트)
```

#### `<DailyTopStrip>`
- **Path**: `components/features/life-ops/DailyTopStrip.tsx`
- **Hotkeys**: `←`/`→` 전/다음날, `t` 오늘, `1-5` Mood 즉시 설정

#### `<MoodButtonGroup>` / `<EnergyButtonGroup>`
- **Path**: `components/features/life-ops/MoodButtonGroup.tsx`, `EnergyButtonGroup.tsx`
- **Props**: `{ value: 1-5 | null; onChange; compact? }`
- **UI**: 5개 이모지/색상 원형 버튼
- **Motion**: 클릭 시 하단 파티클 (SVG) 200ms + Bounce
- **Optimistic**: 즉시 반영

#### `<EmotionPills>`
- **Path**: `components/features/life-ops/EmotionPills.tsx`
- **Props**: `{ value: string[]; onChange; options }`
- **UI**: `<Tag removable>` 토글 방식

#### `<HabitTrackerGrid>`
- **Path**: `components/features/life-ops/HabitTrackerGrid.tsx`
- **Props**: `{ habits: Habit[]; todayLogs: HabitLog[] }`
- **Grid**: 반응형 (2/3/4/5 columns)

#### `<HabitCard>`
- **Path**: `components/features/life-ops/HabitCard.tsx`
- **Props**: `{ habit; todayValue; onUpdate }`
- **Types**:
  - boolean: 체크박스
  - number: inline 숫자 입력 (예: 물 2잔)
  - scale: 1-5 버튼
- **우측**: Streak 🔥 + 일수
- **Motion**: 체크 시 glow + 햅틱 80ms

#### `<JournalingTabs>`
- **Path**: `components/features/life-ops/JournalingTabs.tsx`
- **Tabs**: `📔 일기` / `🙏 묵상` / `🙏 감사`
- **Editor**: `<ZenEditor mode="journal">`
- **묵상 탭 상단**: "본문 말씀" 인풋 (daily_logs.meditation_verse)

#### `<DailyDataColumn>`
- **Path**: `components/features/life-ops/DailyDataColumn.tsx`
- **하위**: `<SleepSparkline>`, `<DeepWorkTotal>`, `<WorkoutTodayCard>`, `<AISummaryButton>`

#### `<AISummaryButton>`
- **Action**: `generateDailySummary(date)` → Toast + 결과를 Journal 탭에 append 제안

#### `<DailyAutoJoinFeed>`
- **Path**: `components/features/life-ops/DailyAutoJoinFeed.tsx`
- **내용**: Tasks completed today / Zettels created/edited / Interactions occurredAt today / Gifts
- **스타일**: 좌측 시간바 + 우측 카드 (TimelineItem 재사용)

### 9.2. 화면: `/life-ops/trends`

**Component Tree**:
```
<TrendsPage>
  └─ <TrendsGrid>
       ├─ <ScatterPlot title="Mood × Sleep" />
       ├─ <ScatterPlot title="Energy × Workout" />
       ├─ <StackedBar title="Habit 달성률" />
       ├─ <LineChart title="Deep Work 주간 추이" />
       └─ <CorrelationMatrix variables />
```

#### `<CorrelationMatrix>`
- **Path**: `components/features/life-ops/CorrelationMatrix.tsx`
- **내용**: 변수 × 변수 피어슨 상관계수 Heatmap
- **셀 호버**: 산포도 미니 Popover

### 9.3. 화면: `/life-ops/habits`

```
<HabitsPage>
  ├─ <Tabs value={active}>    (활성 / 비활성)
  ├─ <HabitConfigList>
  │    └─ <HabitCard config drag />
  └─ <HabitConfigForm>         (우상단 + 버튼 Modal)
```

#### `<HabitConfigForm>`
- **Fields**: 제목, 아이콘, 타입(boolean/number/scale), 스케줄 (요일 체크박스), 타겟 값

### 9.4. 화면: `/life-ops/workouts`

```
<WorkoutsPage>
  └─ <ResizablePanels layout="flex/400">
       ├─ <WorkoutCalendar />
       └─ <WorkoutList>
            └─ <WorkoutCard />
```

#### `<WorkoutCard>` / `<WorkoutForm>`
- **Card**: 날짜, 카테고리 `<Tag>`, 소요 시간, 강도 ⭐
- **Form Detail**: `<ZenEditor mode="writing">` (세트/무게/리듬)

### 9.5. 화면: `/life-ops/career`

```
<CareerPage>
  └─ <CareerTimeline>           (수직 타임라인)
       └─ <CareerNode />         × N
```

#### `<CareerNode>`
- **내용**: 조직 로고 + 역할 + 기간 + 성과 하이라이트 + 배지
- **Motion**: scroll-into-view 시 fade-up (stagger 50ms)

### 9.6. 화면: `/life-ops/meditations` & `/life-ops/diaries`

```
<MeditationsArchivePage> (diaries도 동일 구조)
  ├─ <YearlyHeatmap data />       (언제 얼마나 썼는지)
  ├─ <SearchBar FTS5 />
  └─ <ArchiveList>
       └─ <ArchiveListItem date snippet />
```

---

## 10. Settings 화면 컴포넌트

### 10.1. `/settings` — Profile

```
<SettingsProfilePage>
  └─ <ProfileForm>                 (사진 업로드, 표시 이름, 언어, 타임존, 비번 변경)
```

#### `<ProfileForm>`
- **Fields**: `<FileDropzone accept="image/*">`, displayName, locale, timezone
- **PasswordSection**: 현재 비번 + 새 비번 + 확인

### 10.2. `/settings/appearance`

```
<AppearancePage>
  ├─ <ThemeSelector value={dark|light|system} />
  ├─ <GlassOpacityControl />       (§7.2 of DESIGN_SYSTEM)
  ├─ <FontScaleSlider />
  └─ <BentoLayoutEditor>           (드래그 재배치, 위젯 숨김)
```

#### `<BentoLayoutEditor>`
- **Path**: `components/features/settings/BentoLayoutEditor.tsx`
- **구현**: `<DashboardGrid edit>` 재사용 + 하단 `<WidgetLibrary>` (숨겨진 위젯 목록)

#### `<GlassOpacityControl>`
- **옵션**: `full` / `low` / `off`
- **반영**: `document.documentElement.setAttribute('data-glass-opacity', value)` + localStorage

### 10.3. `/settings/shortcuts`

```
<ShortcutsPage>
  └─ <ShortcutTable>               (카테고리별 / 커스텀 바인딩)
```

### 10.4. `/settings/data`

```
<DataSettingsPage>
  ├─ <DataImportWizard>
  │    ├─ Step 1: 업로드 (CSV / Notion zip)
  │    ├─ Step 2: 매핑 UI
  │    ├─ Step 3: 미리보기
  │    └─ Step 4: 실행 + 진행률
  ├─ <DataExportPanel>             (JSON / Markdown, ZIP 다운로드)
  └─ <BackupHistoryList>           (R2 최근 30일, 복원 버튼)
```

### 10.5. `/settings/integrations`

```
<IntegrationsPage>
  ├─ <IntegrationCard service="anthropic" />
  ├─ <IntegrationCard service="cloudflare" />
  ├─ <IntegrationCard service="notion" />
  └─ <CronManualTrigger />         (개발용 "지금 실행" 버튼)
```

### 10.6. `/settings/ai`

```
<AISettingsPage>
  ├─ <FeatureToggleList />         (AI 기능 on/off 목록)
  ├─ <AIUsagePanel />              (월 사용량, ai_conversations 집계)
  └─ <ConfidenceThresholdSlider />  (라우팅 confidence 임계값)
```

---

## 11. 인증 & 에러 화면

### 11.1. `/login`

```
<LoginPage>
  └─ <GlassCard priority="hero">
       └─ <LoginCard>
            ├─ <Logo animated />           (등대 + 빛 애니메이션, Fade-Up)
            ├─ 이메일 · 비밀번호
            └─ [로그인] 버튼 + 첫 로그인 안내 텍스트
```

### 11.2. `not-found.tsx`

- 로고 + "길을 잃으셨나요?" + `[대시보드로]` CTA

### 11.3. `error.tsx`

- 로고 + "등대에 문제가 생겼습니다" + 에러 ID (복사 가능) + `[재시도]` 버튼

---

## 12. 컴포넌트 × 화면 매트릭스 (Quick Lookup)

AI 에이전트가 "이 화면에 뭐가 들어가야 하지?"를 역방향 조회할 때 사용.

| 화면 | 핵심 Feature 컴포넌트 | 공용 Primitive |
|---|---|---|
| `/login` | `<LoginCard>` | `<GlassCard>`, `<Logo>` |
| `/dashboard` | `<DashboardGrid>`, 8개 Widget | `<BentoGrid>`, `<Heatmap>`, `<Sparkline>` |
| `/action-hub` | `<ProjectCard>` | `<FilterBar>`, `<Tabs>`, `<EmptyState>` |
| `/action-hub/inbox` | `<InboxItemRow>` | — |
| `/action-hub/{id}` | `<KanbanBoard>`, `<KanbanColumn>`, `<TaskCard>` | `<ViewSwitcher>`, `<FilterBar>` |
| `/action-hub/{id}/calendar` | `<TaskCalendar>` | `<ViewSwitcher>`, `<FilterBar>` |
| `/action-hub/{id}/list` | `<TaskDataGrid>` | `<DataGrid>`, `<ViewSwitcher>` |
| `/action-hub/{id}/tasks/{taskId}` | `<TaskMetaPanel>`, `<TaskChecklistPanel>`, `<SidekickPanel>` | `<ZenEditor>`, `<ResizablePanels>`, `<DatePicker>` |
| `/vault/zettels` | `<ZettelList>`, `<BacklinkPanel>`, `<PromoteZettelButton>` | `<ZenEditor>`, `<ResizablePanels>`, `<TagInput>` |
| `/vault/zettels/graph` | `<ZettelGraphCanvas>` | `<NetworkGraph>` |
| `/vault/zettels/{id}` | `<ZettelHeader>` | `<ZenEditor>` |
| `/vault/media` | `<MediaMasonry>`, `<MediaCard>`, `<MediaCreateModal>` | `<FilterBar>`, `<ViewSwitcher>` |
| `/vault/media/{id}` | `<Gallery>`, `<RatingSlider>` | `<ZenEditor>` |
| `/vault/assets` | `<AssetCard>` | `<DataGrid>`, `<ViewSwitcher>` |
| `/vault/places` | `<PlaceMap>`, `<PlaceCard>` | `<FilterBar>` |
| `/prm` | `<PersonCard>`, `<PersonFilterTabs>`, `<PersonHealthBar>` | `<FilterBar>`, `<UserAvatar>` |
| `/prm/graph` | `<PRMGraphCanvas>` | `<NetworkGraph>` |
| `/prm/gifts` | `<GiftBoard>`, `<GiftCard>`, `<YearlyGiftSummary>` | `<Tabs>`, `<FilterBar>` |
| `/prm/{id}` (Drawer) | `<PersonTimelineFeed>`, `<TimelineItem>`, `<PersonInfoForm>`, `<PersonRelationsMini>`, `<MarkContactedButton>` | `<DrawerShell>`, `<Tabs>` |
| `/life-ops/{date}` | `<DailyTopStrip>`, `<MoodButtonGroup>`, `<EnergyButtonGroup>`, `<HabitTrackerGrid>`, `<HabitCard>`, `<JournalingTabs>`, `<DailyDataColumn>`, `<DailyAutoJoinFeed>` | `<ZenEditor>`, `<Sparkline>`, `<ResizablePanels>` |
| `/life-ops/trends` | `<TrendsGrid>`, `<CorrelationMatrix>` | Recharts wrappers |
| `/life-ops/habits` | `<HabitConfigList>`, `<HabitConfigForm>` | `<Tabs>`, DnD |
| `/life-ops/workouts` | `<WorkoutCalendar>`, `<WorkoutCard>`, `<WorkoutForm>` | `<ZenEditor>`, `<DataGrid>` |
| `/life-ops/career` | `<CareerTimeline>`, `<CareerNode>` | — |
| `/life-ops/meditations` | `<YearlyHeatmap>`, `<ArchiveListItem>` | `<Heatmap>`, FTS 검색 |
| `/life-ops/diaries` | 동상 | 동상 |
| `/settings` | `<ProfileForm>` | `<FileDropzone>` |
| `/settings/appearance` | `<BentoLayoutEditor>`, `<GlassOpacityControl>` | `<BentoGrid>` |
| `/settings/shortcuts` | `<ShortcutTable>` | `<KeyHint>` |
| `/settings/data` | `<DataImportWizard>`, `<DataExportPanel>`, `<BackupHistoryList>` | `<FileDropzone>` |
| `/settings/integrations` | `<IntegrationCard>`, `<CronManualTrigger>` | — |
| `/settings/ai` | `<AIUsagePanel>`, `<ConfidenceThresholdSlider>` | — |

---

## 13. 상태별 컴포넌트 패턴 (Loading / Empty / Error)

### 13.1. Loading

모든 페이지 `loading.tsx`는 `<SkeletonBlock>` 조합.

| 화면 타입 | 스켈레톤 구성 |
|---|---|
| Dashboard (Bento) | `<SkeletonBlock variant="card" count={8} />` (Bento 8개 칸) |
| Kanban | 5개 column × 3개 card skeleton |
| List/Grid | `<SkeletonBlock variant="row" count={10} />` |
| Editor 화면 | 좌: `variant="row" × 8`, 우: `variant="editor"` |
| Detail (Drawer) | 헤더 + 탭 + 본문 3개 row |

### 13.2. Empty

| 화면 | title | description | cta |
|---|---|---|---|
| Dashboard (첫 방문) | "Light House에 오신 걸 환영해요" | 3단계 체크리스트 | "시작하기" |
| Action Hub 프로젝트 | "첫 프로젝트를 만들어볼까요?" | — | `[+ 새 프로젝트]` (c p) |
| Inbox | "처리할 항목이 없어요 ✨" | "Quick Capture로 아이디어를 쏟아보세요" | `[빠른 입력]` (Cmd+Shift+N) |
| Kanban column | (컬럼별) "여기는 비어있어요" | — | `[+]` |
| Zettel list | "첫 번째 원석을 던져보세요" | "생각은 쓰는 순간 보석이 됩니다" | `[+ 새 Fleeting]` (Cmd+N) |
| Media | "아직 기록한 작품이 없어요" | — | `[+ 추가]` |
| PRM | "첫 인물을 추가해보세요" | — | `[+ 새 인물]` (c n) |
| Gifts | "준/받은 선물을 기록해보세요" | — | `[+ 선물]` |
| Habits | "첫 습관을 만들어보세요" | — | `[+ 새 습관]` |
| Workouts | "운동 기록이 없어요" | — | `[+ 운동]` (w) |
| Heatmap | (비어있을 때 셀 회색, 메시지 없음) | | |

### 13.3. Error

모든 페이지 `error.tsx`:
- 로고 + 메시지 + `[재시도]` + 에러 ID 복사 버튼
- Drawer 내부 에러: 인라인 `<DrawerErrorState onRetry />`

### 13.4. Offline 인디케이터

- `navigator.onLine === false` 감지 시 `<OfflineBanner>` 상단 고정
- 하단 `<PendingSyncBadge>` — IndexedDB 큐 개수 표시

---

## 14. Motion 매핑 (화면 → 적용 모션)

| 화면 | 적용 모션 (최소 2–3개) |
|---|---|
| `/login` | Logo Glow Pulse + LoginCard Fade-Up + Button Bounce |
| `/dashboard` | Widget Stagger Fade-Up(50ms) + Widget Hover Glow + CTA Glow Pulse |
| `/action-hub/{id}` | Kanban Card Bounce(클릭) + Drag Shadow + Column Fade-Up |
| Task Workspace | Editor Focus Dim + Meta Panel Slide-In + Autosave Pulse |
| Zettel Split | 리스트 선택 Indicator Slide + Graph Node Hover + Backlink Fade |
| Zettel Graph | Node 진입 Spring + Edge Fade |
| `/prm` | Card Pulse(cadence 초과) + Drawer Slide-In + Timeline Fade-Up Stagger |
| `/life-ops/{date}` | Mood Button Particle + Habit Check Glow + Streak 🔥 Bounce |
| `/vault/media` | Masonry Card Fade-Up + Hover Overlay Fade |
| Settings Bento Editor | Drag Shadow + Drop Snap + Layout Shift(Framer) |

---

## 15. 반응형 컴포넌트 규칙

### 15.1. Breakpoint별 주요 변형

| 화면 | < 640 (sm) | 640-1023 (md) | ≥ 1024 (lg) |
|---|---|---|---|
| Dashboard Bento | 1열 쌓임 | 6열 | 12열 (기본) |
| Action Hub Kanban | 컬럼 가로 스와이프 | 컬럼 스와이프 | 5컬럼 동시 |
| Task Workspace | 메타는 Bottom Sheet | Sheet | 30/70 Split |
| Vault Zettels | 리스트 페이지만 | 2단 (리스트+에디터) | 3단 Split |
| PRM Grid | 2열 + Drawer=BottomSheet | 3열 | 4-5열 + Side Drawer |
| Life Ops Daily | 세로 스크롤, 스와이프로 전/다음날 | 세로 | 4행 풀 |
| GNB | 하단 탭바 | 좌측 | 좌측 |
| LNB | Drawer 소환 | 아이콘 축소 | 풀 메뉴 |

### 15.2. 터치 환경 스케일 (모바일)

`02_DESIGN_SYSTEM §8.1` 규칙 자동 적용:
- 버튼 min-h 44px
- 입력 필드 min-h 48px
- 카드 padding 20px
- 아이콘 버튼 min 44×44px

---

## 16. 에이전트 구현 체크리스트 (컴포넌트 단위)

새 컴포넌트 생성 시 반드시 만족:

- [ ] §2 디렉토리 구조에 맞는 경로에 배치
- [ ] L0/L1/L2/L3 계층 올바른지 확인
- [ ] RSC vs Client 분기 주석 (`'use client'` 필요 시 최상단)
- [ ] Props interface 명시적으로 export
- [ ] 시맨틱 토큰만 사용 (`hsl(var(--color-*))`), 팔레트 번호 금지
- [ ] `focus-visible:ring-2` 포커스 링
- [ ] `aria-label` 필수 (아이콘 버튼)
- [ ] Reduced Motion 대응
- [ ] Loading/Empty/Error 상태 모두 처리 or 상위에서 처리 명시
- [ ] 모바일 터치 타겟 44px 이상
- [ ] Optimistic Update 패턴 (mutation 있는 컴포넌트)
- [ ] 최소 2개 Motion 적용 (엔트리 + 호버 or 엔트리 + 액션)
- [ ] Used On 섹션의 모든 화면에서 실제 조립 가능한지 검증

---

## 17. 에이전트 작업 프롬프트 템플릿

AI 에이전트에게 화면 구현을 지시할 때 사용:

```markdown
## 작업: [화면 라우트] 구현

다음 문서를 순서대로 읽고 작업해줘:

1. `Docs/05_PAGE_SPECIFICATIONS.md` — 해당 화면 스펙
2. `Docs/08_COMPONENT_SPECIFICATIONS.md` §N — 컴포넌트 트리
3. `Docs/02_DESIGN_SYSTEM.md` — 토큰·모션 규약
4. `Docs/06_INTERACTION_PATTERNS.md` — Drawer/Hotkey/Mention

### 요구사항
- 파일 경로: §2 디렉토리 구조 준수
- RSC 우선, 인터랙션 필요한 부분만 `'use client'`
- `loading.tsx` + `error.tsx` 포함
- Empty State: §13.2 테이블 참조
- Motion: §14 테이블에서 해당 화면 모션 최소 2개 구현
- 모바일 대응: §15.1 규칙
- a11y: §16 체크리스트 전부 ✅

### 금지
- 팔레트 번호 하드코딩 (`#FBBF24`)
- 기본 폰트 스택 (Inter/Roboto/Arial/system)
- 히어로에 카드·오버레이·통계 스트립
- useMemo/useCallback 무의미한 추가
- 새 디렉토리 생성 (§2 맵에 없는 경로)

### 완료 조건
- §16 체크리스트 모두 통과
- 데스크톱·모바일 스크린샷 각 1장
```

---

**다음**: 이 문서의 체크리스트(§16)로 모든 컴포넌트를 검증한 뒤, [`07_DEVELOPMENT_ROADMAP.md`](./07_DEVELOPMENT_ROADMAP.md)의 Phase에 맞춰 실제 구현에 착수한다.
