# 🎨 Design System

> **선행 문서**: [`01_INFORMATION_ARCHITECTURE.md`](./01_INFORMATION_ARCHITECTURE.md)
> **대상**: Frontend 에이전트
> **철학**: "Calm, deep, glassy" — 시선을 빼앗지 않고 데이터에 집중하게 만드는 어두운 유리.

---

## 1. 디자인 토큰 (CSS Variables)

`apps/web/src/styles/globals.css` 루트에 정의. **Tailwind v4의 `@theme` 디렉티브와 연동**.

### 1.1. 컬러 팔레트

```css
@layer base {
  :root {
    /* === Neutral (Dark 기본) === */
    --background: 222 20% 7%;           /* #0E1116 — 딥 차콜 */
    --background-elevated: 222 16% 11%; /* #161A22 — 카드 배경 */
    --foreground: 210 20% 96%;          /* #F1F4F7 — 메인 텍스트 */
    --muted: 222 12% 18%;
    --muted-foreground: 215 15% 62%;
    --border: 220 14% 20%;
    --border-subtle: 220 14% 14%;

    /* === Brand / Accent === */
    --primary: 38 96% 62%;              /* #FBBF24 — 등대 골드 (Light House의 빛) */
    --primary-foreground: 222 20% 7%;

    /* === Semantic === */
    --success: 142 71% 45%;             /* #22C55E */
    --warning: 38 92% 58%;              /* #F59E0B */
    --danger: 0 84% 60%;                /* #EF4444 */
    --info: 199 89% 48%;                /* #0EA5E9 */

    /* === Domain-Specific Accents (Tag 색상) === */
    --priority-p1: 0 84% 60%;           /* 빨강 */
    --priority-p2: 38 92% 58%;          /* 주황 */
    --priority-p3: 215 15% 55%;         /* 회색 */

    --energy-hyperfocus: 271 91% 65%;   /* 보라 */
    --energy-normal: 199 89% 48%;       /* 하늘 */
    --energy-routine: 142 71% 45%;      /* 초록 */

    --dunbar-5: 0 84% 60%;              /* 핵심 = 빨강 */
    --dunbar-15: 38 92% 58%;            /* 친밀 = 주황 */
    --dunbar-50: 199 89% 48%;           /* 정기 = 파랑 */
    --dunbar-150: 215 15% 55%;          /* 지인 = 회색 */

    /* === Glass === */
    --glass-bg: 222 20% 12% / 0.55;     /* 유리 기본 */
    --glass-border: 220 15% 40% / 0.18;
    --glass-highlight: 210 40% 96% / 0.08;

    /* === Elevation (그림자) === */
    --shadow-sm: 0 1px 2px 0 hsl(222 30% 3% / 0.4);
    --shadow-md: 0 4px 12px -2px hsl(222 30% 3% / 0.5);
    --shadow-lg: 0 16px 40px -8px hsl(222 30% 3% / 0.6);
    --shadow-glow: 0 0 24px hsl(38 96% 62% / 0.18);

    /* === Radius === */
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-xl: 20px;
  }

  /* Light 모드 (선택적 지원) */
  :root[data-theme='light'] {
    --background: 210 20% 98%;
    --background-elevated: 0 0% 100%;
    --foreground: 222 20% 12%;
    --muted: 220 14% 94%;
    --muted-foreground: 215 15% 42%;
    --border: 220 14% 88%;
    --glass-bg: 210 40% 98% / 0.6;
    --glass-border: 220 15% 60% / 0.2;
  }
}
```

### 1.2. Tailwind 매핑

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        'bg-elev': 'hsl(var(--background-elevated))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        primary: { DEFAULT: 'hsl(var(--primary))', fg: 'hsl(var(--primary-foreground))' },
        // ... 이하 동일
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        glow: 'var(--shadow-glow)',
      },
    },
  },
};
```

---

## 2. 타이포그래피

### 2.1. 폰트 스택

```css
--font-sans: 'Pretendard Variable', 'Inter', system-ui, -apple-system, sans-serif;
--font-serif: 'Noto Serif KR', 'Source Serif 4', serif;   /* Zen Mode 본문 전용 */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;    /* 코드, ID */
```

- **Pretendard**: 한글 최적, 가변 폰트 (100–900)
- **Inter**: 영문/숫자 가독성
- **Noto Serif KR**: Zen Writing Mode의 본문 (소설, 에세이, 일기)

### 2.2. 타입 스케일

| 토큰 | 크기 / 행간 | Weight | 용도 |
|---|---|---|---|
| `text-display` | 48 / 56 | 700 | Hero, Landing |
| `text-h1` | 30 / 40 | 600 | 페이지 제목 |
| `text-h2` | 24 / 32 | 600 | 섹션 제목 |
| `text-h3` | 20 / 28 | 600 | 카드 제목 |
| `text-h4` | 16 / 24 | 600 | 위젯 제목 |
| `text-body` | 14 / 22 | 400 | 본문 기본 |
| `text-body-lg` | 16 / 26 | 400 | Zen Mode 본문 |
| `text-caption` | 12 / 16 | 400 | 메타, 타임스탬프 |
| `text-micro` | 11 / 14 | 500 | 뱃지, 태그 |

### 2.3. Zen Mode 본문 규칙

- 폰트: `font-serif`
- 너비: `max-w-prose` (≈65ch)
- 행간: 1.75
- 문단 간격: 1.25em
- 첫 글자 들여쓰기: 없음 (현대 웹 스타일)

---

## 3. Glassmorphism 규약

### 3.1. 유리 레이어 클래스 (공식 정의)

```css
/* globals.css */
.glass {
  background: hsl(var(--glass-bg));
  border: 1px solid hsl(var(--glass-border));
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  box-shadow:
    inset 0 1px 0 0 hsl(var(--glass-highlight)),
    var(--shadow-md);
}

.glass-elevated {
  background: hsl(222 18% 16% / 0.7);
  backdrop-filter: blur(32px) saturate(160%);
  border: 1px solid hsl(var(--glass-border));
  box-shadow:
    inset 0 1px 0 0 hsl(var(--glass-highlight)),
    var(--shadow-lg);
}

/* 호버 시 약한 발광 */
.glass-interactive {
  transition: background 200ms ease-out, box-shadow 200ms ease-out;
}
.glass-interactive:hover {
  background: hsl(222 18% 18% / 0.75);
  box-shadow: inset 0 1px 0 0 hsl(var(--glass-highlight)), var(--shadow-md), var(--shadow-glow);
}
```

### 3.2. 사용 계층

| 계층 | 클래스 | 용도 |
|---|---|---|
| **L0** | `bg-background` | 최하단 배경 (노이즈 텍스처 선택) |
| **L1** | `.glass` | GNB, LNB, 일반 카드 |
| **L2** | `.glass-elevated` | Modal, Drawer, Command Palette |
| **L3** | `.glass-elevated + shadow-glow` | 포커스 상태 |

### 3.3. 배경 텍스처 (선택)

Dashboard 배경 노이즈: SVG feTurbulence 기반 `<Noise />` 컴포넌트를 body 직속에 고정. opacity 3%.

---

## 4. 아이코노그래피

- **라이브러리**: Lucide React (단일 출처)
- **크기**: 14 / 16 / 20 / 24 / 32
- **Stroke Width**: 1.5 (기본), 2 (강조)
- **색상**: `currentColor` 상속

이모지는 데이터(사용자가 입력한 태그/상태) 전용. UI 크롬에는 사용 금지.

---

## 5. 공통 컴포넌트 카탈로그

Shadcn/ui를 기반으로 커스터마이징. 아래는 **Light House 전용 확장 컴포넌트**.

### 5.1. `<GlassCard>`

```tsx
interface GlassCardProps {
  variant?: 'default' | 'elevated';
  interactive?: boolean;
  children: React.ReactNode;
  className?: string;
}
```
- `.glass` 또는 `.glass-elevated` 자동 적용
- interactive=true면 호버 상호작용 클래스 추가

### 5.2. `<Tag>` (Pill)

```tsx
interface TagProps {
  variant: 'priority' | 'energy' | 'status' | 'dunbar' | 'neutral';
  value: string; // 'P1', 'hyper_focus', 'todo', etc.
  size?: 'sm' | 'md';
}
```
- 라운드 999px
- 색상은 `value`에 따라 자동 매핑
- 테두리 1px + 반투명 배경 (ex: P1 → `bg-danger/15 border-danger/40 text-danger`)

### 5.3. `<Drawer>` (Side Drawer)

```tsx
interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'right' | 'left';
  width?: number; // 기본 480px
  children: React.ReactNode;
}
```
- Radix Dialog 기반
- Framer Motion으로 슬라이드 인 (220ms, spring)
- 백드롭: `bg-black/40 backdrop-blur-sm`
- Body `.glass-elevated` 적용

### 5.4. `<CommandPalette>`

- cmdk 라이브러리 래퍼
- 중앙 상단 20% 지점 등장, 최대 너비 680px
- 섹션: **이동 / 생성 / 검색 결과 / 최근 항목**
- Empty: "엔터로 Quick Capture"

### 5.5. `<ZenEditor>`

- Tiptap 래퍼
- 최대 너비 680px, 중앙 정렬
- 툴바는 슬래시 커맨드(`/`)로만 호출 (상시 노출 없음)
- 포커스 모드: 스크롤에 따라 현재 문단만 100% 밝기, 나머지 40%

### 5.6. `<BentoGrid>` + `<BentoCard>`

```tsx
<BentoGrid columns={12} gap="md">
  <BentoCard span={{ base: 12, md: 8 }} rows={2}>...</BentoCard>
  <BentoCard span={{ base: 12, md: 4 }}>...</BentoCard>
</BentoGrid>
```
- 12-column grid
- 카드는 `.glass` 기본
- `react-grid-layout`으로 드래그 재배치 (설정 페이지에서 on/off)

### 5.7. `<Heatmap>` (GitHub-style)

- 7×53 그리드 (1년)
- 셀 크기 11×11px, 간격 2px
- 색상 스케일: `bg-muted → primary`의 5단계
- 호버 시 Tooltip (날짜 + 값)

### 5.8. `<Sparkline>`

- 높이 36px, 너비 가변
- Recharts `<LineChart>` 축 없이 렌더링
- 최근 7/30일 데이터

### 5.9. `<NetworkGraph>`

- `react-force-graph-2d`
- 노드: 아바타 이미지 또는 이모지
- 엣지: 두께로 친밀도/빈도 표현
- 배경: 다크 그라디언트, 노드 호버 시 주변 흐리게

### 5.10. `<Breadcrumb>`, `<Tabs>`, `<Tooltip>`, `<Toast>`, `<Dialog>`, `<DropdownMenu>`

→ Shadcn 표준 설치, `.glass` 변형 추가.

---

## 6. 애니메이션 규약

### 6.1. 타이밍

| 목적 | Duration | Easing |
|---|---|---|
| 호버 반응 | 150ms | `ease-out` |
| 패널 확장/축소 | 220ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| Drawer / Modal | 260ms | spring(180, 26) |
| 페이지 전환 | 180ms | `ease-in-out` |
| Micro-interaction (햅틱) | 80ms | `linear` |

### 6.2. 금지 사항

- 500ms 이상 지연되는 애니메이션
- 깜빡이는 네온 (접근성)
- 우연한 Layout Shift (CLS 방지)

### 6.3. Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

---

## 7. 접근성 (WCAG AA 기준)

- **명도 대비**: 모든 텍스트 4.5:1 이상, 큰 글자 3:1 이상
- **포커스 링**: `focus-visible:ring-2 ring-primary/60 ring-offset-2 ring-offset-background`
- **키보드 네비**: Tab 순서 논리적, Skip Link 제공
- **스크린리더**: 모든 아이콘 버튼에 `aria-label`
- **컬러 독립성**: 상태는 색+아이콘+텍스트 3중 표현 (예: P1 = 빨강 + 🚨 + "P1")

---

## 8. 레이아웃 여백 규칙 (8pt Grid)

- 기본 단위: **4px** (스케일: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96)
- 섹션 간 간격: 24–32px
- 카드 내부 패딩: 16–20px
- 페이지 좌우 여백: 32px (xl), 24px (lg), 16px (md)

---

## 9. Asset 가이드 (이미지/파일)

- **R2 업로드 규칙**: `user/{userId}/{domain}/{yyyy}/{mm}/{ulid}.{ext}`
- **이미지 변형**: Cloudflare Images
  - Thumbnail: 120×120 (cover)
  - Card: 400×300 (cover)
  - Detail: 1200×1200 (contain)
  - Original: 무변형 (다운로드용)
- **아바타 기본**: 이니셜 + `--dunbar-{layer}` 색상 배경

---

## 10. 디자인 리뷰 체크리스트 (PR 머지 전)

- [ ] `.glass` 클래스 사용 시 `.glass-elevated` 중첩 안 함
- [ ] 텍스트 명도 대비 4.5:1 확인
- [ ] Focus 링 표시됨
- [ ] Reduced Motion 대응
- [ ] 다크/라이트 양쪽 스크린샷 첨부
- [ ] 이모지는 데이터 전용(크롬에 금지)

---

**다음**: [`03_DATABASE_SCHEMA.md`](./03_DATABASE_SCHEMA.md)에서 전체 Drizzle 스키마를 확정한다.
