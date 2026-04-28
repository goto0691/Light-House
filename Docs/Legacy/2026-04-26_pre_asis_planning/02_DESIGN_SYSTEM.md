# 🎨 Design System

> **선행 문서**: [`01_INFORMATION_ARCHITECTURE.md`](./01_INFORMATION_ARCHITECTURE.md)
> **대상**: Frontend 에이전트 (GPT-5.4 / Claude Code)
> **철학**: "Calm, deep, glassy" — 시선을 빼앗지 않고 데이터에 집중하게 만드는 어두운 유리.
> **AI 사용 원칙**: 이 문서는 AI 에이전트가 컨텍스트 없이도 일관된 UI 코드를 생성할 수 있도록 의도(Intent)와 제약(Constraint)을 함께 명시한다.

---

## 0. AI 에이전트 작업 헌장 (Agent Working Charter)

> **AI 에이전트가 이 프로젝트에서 UI를 빌드하기 전 반드시 숙지해야 할 하드 룰.**
> 이 섹션은 GPT-5.4, Claude Code 등 모든 프론트엔드 에이전트에게 적용된다.

### 0.1. 빌드 전 3단계 워크시트

AI 에이전트는 코드 생성 전에 다음 세 항목을 먼저 작성(내부 추론)해야 한다:

1. **비주얼 테시스(Visual Thesis)**: 이 UI의 분위기·재질·에너지를 한 문장으로. (예: "차분한 딥 글래스 위에 골드 액센트가 신호처럼 빛나는")
2. **콘텐츠 플랜(Content Plan)**: `Hero → Support → Detail → Final CTA` 구조 확인. 각 섹션의 단일 목적 명시.
3. **인터랙션 테시스(Interaction Thesis)**: 최소 2–3개의 의도적 모션 아이디어. (예: "카드 진입 시 fade-up, 호버 시 glow 강화, 버튼 클릭 시 ripple")

### 0.2. 레이아웃 하드 룰

| 규칙 | 내용 |
|---|---|
| **One Composition** | 첫 뷰포트는 하나의 컴포지션으로 읽혀야 함. 대시보드 제외. |
| **Brand First** | 브랜드/제품명은 Hero급 시그널. 내비 텍스트나 아이브로우로 밀리면 안 됨. |
| **Brand Test** | 내비 제거 후 다른 브랜드로 보이면 → 브랜딩 재강화 필요. |
| **Full-Bleed Hero** | 랜딩·프로모 히어로는 edge-to-edge가 기본. 인셋·사이드 패널·플로팅 블록 금지. |
| **Hero Budget** | 첫 뷰포트 = 브랜드 + 헤드라인 1 + 서포팅 문장 1 + CTA 1 + 지배적 이미지 1. 통계·일정·주소·프로모 금지. |
| **No Hero Overlays** | 히어로 미디어 위에 분리된 배지·칩·스티커·콜아웃 박스 금지. |
| **Cards by Exception** | 카드 기본 사용 금지. 히어로에 카드 절대 금지. 테두리·그림자 제거해도 UX에 지장 없으면 카드가 아님. |
| **One Job Per Section** | 섹션당 목적 1개, 헤드라인 1개, 서포팅 문장 최대 1개. |
| **Typography Limit** | 서체 종류 최대 2개, 액센트 컬러 1개. |
| **Motion as Hierarchy** | 모션은 존재감·위계 강화용. 장식 노이즈 금지. 의도적 모션 최소 2–3개 구현. |
| **Color Direction** | CSS 변수 정의 필수. 보라-흰색 기본값·다크 모드 편향 금지. |
| **No Generic Stacks** | Inter·Roboto·Arial·system-ui 기본 폰트 스택 지양. 표현력 있는 폰트 선택. |
| **Responsive Guarantee** | 데스크톱·모바일 양쪽 정상 동작 필수. |

### 0.3. React 패턴 규칙

- `useEffectEvent`, `startTransition`, `useDeferredValue` — 팀이 사용 시 선호.
- `useMemo` / `useCallback` — 이미 사용 중이 아니면 기본 추가 금지. React Compiler 가이드 준수.
- 기존 디자인 시스템 내 작업 시 확립된 패턴·구조·비주얼 언어 유지 (예외 규칙).

### 0.4. 리트머스 체크 (완성 전 자가 점검)

- [ ] 첫 화면에서 "Light House" 브랜드가 명확히 보이는가?
- [ ] 강력한 비주얼 앵커(이미지/영상)가 있는가?
- [ ] 헤드라인만으로 이 페이지의 목적을 이해할 수 있는가?
- [ ] 각 섹션이 하나의 역할만 수행하는가?
- [ ] 카드가 정말 필요한가? (인터랙션 컨테이너가 맞는가?)
- [ ] 모션이 위계를 개선하는가? (장식인가 기능인가?)
- [ ] 모바일에서도 터치 타겟이 충분히 큰가? (44px 이상)

### 0.5. GPT-5.4 특화 함정 회피 (AI-Made Look 방지)

> **핵심 원칙**: GPT-5.4는 시각적으로 완성도 높은 UI를 생성하지만, 학습 데이터의 **중앙값**에 수렴하는 경향이 있다. "AI가 만든 티"가 나는 UI는 다음 5가지 패턴 중 하나 이상을 갖고 있다. 반드시 점검할 것.

| 함정 | 증상 | 회피법 |
|---|---|---|
| **Purple-on-White Bias** | 보라색 그라디언트 + 흰 배경이 자동 생성됨 | Light House는 **Dark base + Gold accent**. 보라는 `color-domain-energy-hyperfocus` 전용. 다른 맥락에 보라 금지. |
| **Dark Mode Bias** | 요구하지 않아도 무조건 다크테마로 시작 | 다크가 기본이지만 `data-theme='light'`도 반드시 동작 확인. 라이트 모드 스크린샷 필수 첨부. |
| **Excessive Shadow/Blur** | `shadow-2xl`, `blur-3xl` 과도 적용 | `--shadow-sm/md/lg` 토큰만 사용. `backdrop-filter`는 §3.2 허용 범위 준수. |
| **Generic Font Stack** | `font-sans: Inter, Roboto, system-ui` | `font-display: 'Noto Serif KR'`, `font-sans: 'Pretendard Variable'`. §2.1 필수. |
| **Symmetric Perfection** | 모든 카드 같은 크기, 완벽한 격자 | Bento Grid의 `priority: hero/primary/secondary`로 의도적 비대칭 사용. |
| **Over-Decorated Hero** | 히어로에 배지·통계·이벤트 리스팅 추가 | §0.2 "Hero Budget" 준수. 히어로 = 브랜드+헤드라인1+서포팅1+CTA1+이미지1만. |
| **Icon Row Clutter** | 섹션마다 아이콘 3–4개 나열 | 아이콘 행은 기능적 표시일 때만. 장식 아이콘 금지. |
| **Placeholder Imagery** | Unsplash·Pexels stock photo 반사적 사용 | 실제 데이터·스크린샷·일러스트 사용. 없으면 Empty State 디자인. |
| **Default Card Everywhere** | 모든 콘텐츠를 카드로 감싸기 | §0.2 "Cards by Exception". 카드는 인터랙션 컨테이너일 때만. |
| **Motion Overload** | 스크롤마다 fade-in, 모든 요소 애니메이션 | §6.3 "동시 루프 애니메이션 3개 미만". 의도적 2–3개만. |

**자가 진단 프롬프트 (AI 에이전트용)**:
```
내가 방금 생성한 UI가 다음 중 해당되는지 검사:
1. 보라색이 hyperfocus 맥락 외에 등장하는가?
2. 히어로에 브랜드 외 추가 정보(통계·일정·배지)가 있는가?
3. 3개 이상의 요소가 동시에 애니메이션 되는가?
4. 같은 크기 카드가 균일하게 배치되어 있는가 (의도적 비대칭 없음)?
5. Inter/Roboto/system-ui가 폰트 스택에 있는가?
하나라도 YES면 수정.
```

---

## 1. 디자인 토큰 (CSS Variables)

`apps/web/src/styles/globals.css` 루트에 정의. **Tailwind v4의 `@theme` 디렉티브와 연동**.

> **AI 에이전트에게**: 토큰 이름은 시맨틱(Semantic) 네이밍을 사용한다. `color-primary-500` 같은 팔레트 인덱스가 아닌, `color-button-default`처럼 역할과 목적을 설명하는 이름을 써야 AI가 문맥 없이도 일관된 코드를 생성할 수 있다.

### 1.1. 시맨틱 네이밍 원칙

```
[scope]-[role]-[state?]
```

| 패턴 | 예시 | 의미 |
|---|---|---|
| `color-{role}` | `color-surface-base` | 기본 배경 서피스 |
| `color-{role}-{state}` | `color-button-hover` | 버튼 호버 상태 색상 |
| `color-text-{role}` | `color-text-muted` | 보조 텍스트 |
| `color-feedback-{type}` | `color-feedback-danger` | 시스템 피드백 (에러/성공 등) |
| `color-brand-{signal}` | `color-brand-accent` | 브랜드 신호 색상 |
| `color-domain-{concept}` | `color-domain-priority-p1` | 도메인 특화 의미 색상 |

**금지 네이밍**:
- ~~`--color-500`~~ (팔레트 번호는 의미 없음)
- ~~`--blue-dark`~~ (색상명은 테마 변경 시 거짓말)
- ~~`--var1`~~ (약어·임시명 금지)

### 1.2. 컬러 팔레트 (시맨틱 토큰 체계)

```css
@layer base {
  :root {
    /* ===================================================
       SURFACE — 배경·표면 계층
       AI: 컴포넌트 배경에는 반드시 surface 토큰을 사용할 것
    =================================================== */
    --color-surface-base: 222 20% 7%;           /* #0E1116 — 최하단 배경 */
    --color-surface-raised: 222 16% 11%;        /* #161A22 — 카드·패널 배경 */
    --color-surface-overlay: 222 14% 15%;       /* Modal·Drawer 표면 */
    --color-surface-sunken: 222 22% 5%;         /* 입력 필드 내부 */

    /* ===================================================
       TEXT — 텍스트 계층
       AI: 본문=text-primary, 메타=text-muted, 비활성=text-disabled
    =================================================== */
    --color-text-primary: 210 20% 96%;          /* #F1F4F7 — 메인 텍스트 */
    --color-text-secondary: 215 18% 75%;        /* 부제목·설명 */
    --color-text-muted: 215 15% 62%;            /* 메타·타임스탬프 */
    --color-text-disabled: 215 10% 38%;         /* 비활성 텍스트 */
    --color-text-inverse: 222 20% 7%;           /* 밝은 배경 위 텍스트 */

    /* ===================================================
       BORDER — 경계선 계층
    =================================================== */
    --color-border-default: 220 14% 20%;
    --color-border-subtle: 220 14% 14%;
    --color-border-focus: 38 96% 62%;           /* 포커스 링 색상 */
    --color-border-strong: 220 14% 30%;

    /* ===================================================
       BRAND — 브랜드 신호
       AI: 브랜드 강조에만 사용. 남발 금지.
    =================================================== */
    --color-brand-accent: 38 96% 62%;           /* #FBBF24 — 등대 골드 */
    --color-brand-accent-fg: 222 20% 7%;        /* 골드 위 텍스트 */
    --color-brand-accent-subtle: 38 96% 62% / 0.12; /* 배경 틴트 */

    /* ===================================================
       INTERACTIVE — 인터랙티브 요소
       AI: 버튼·링크·토글 등 사용자 액션 요소에 적용
    =================================================== */
    --color-interactive-default: 38 96% 62%;
    --color-interactive-hover: 38 96% 72%;
    --color-interactive-active: 38 96% 52%;
    --color-interactive-disabled: 215 10% 30%;
    --color-interactive-focus-ring: 38 96% 62% / 0.6;

    /* ===================================================
       FEEDBACK — 시스템 상태 피드백
       AI: 에러=danger, 주의=warning, 완료=success, 정보=info
    =================================================== */
    --color-feedback-success: 142 71% 45%;      /* #22C55E */
    --color-feedback-warning: 38 92% 58%;       /* #F59E0B */
    --color-feedback-danger: 0 84% 60%;         /* #EF4444 */
    --color-feedback-info: 199 89% 48%;         /* #0EA5E9 */

    /* 피드백 배경 틴트 (인라인 알림 배경) */
    --color-feedback-success-subtle: 142 71% 45% / 0.12;
    --color-feedback-warning-subtle: 38 92% 58% / 0.12;
    --color-feedback-danger-subtle: 0 84% 60% / 0.12;
    --color-feedback-info-subtle: 199 89% 48% / 0.12;

    /* ===================================================
       DOMAIN — 도메인 특화 의미 색상
       AI: 비즈니스 로직과 연결된 색상. 임의로 변경 금지.
    =================================================== */
    --color-domain-priority-p1: 0 84% 60%;      /* 긴급 */
    --color-domain-priority-p2: 38 92% 58%;     /* 중요 */
    --color-domain-priority-p3: 215 15% 55%;    /* 일반 */

    --color-domain-energy-hyperfocus: 271 91% 65%;
    --color-domain-energy-normal: 199 89% 48%;
    --color-domain-energy-routine: 142 71% 45%;

    --color-domain-dunbar-5: 0 84% 60%;         /* 핵심 관계 */
    --color-domain-dunbar-15: 38 92% 58%;       /* 친밀 관계 */
    --color-domain-dunbar-50: 199 89% 48%;      /* 정기 연락 */
    --color-domain-dunbar-150: 215 15% 55%;     /* 지인 */

    /* ===================================================
       GLASS — 유리 레이어 토큰
    =================================================== */
    --color-glass-bg: 222 20% 12% / 0.55;
    --color-glass-border: 220 15% 40% / 0.18;
    --color-glass-highlight: 210 40% 96% / 0.08;

    /* ===================================================
       ELEVATION — 깊이·그림자
       다크 모드: 그림자 + 표면 밝기 조합으로 고도 표현
    =================================================== */
    --shadow-sm: 0 1px 2px 0 hsl(222 30% 3% / 0.4);
    --shadow-md: 0 4px 12px -2px hsl(222 30% 3% / 0.5);
    --shadow-lg: 0 16px 40px -8px hsl(222 30% 3% / 0.6);
    --shadow-glow: 0 0 24px hsl(38 96% 62% / 0.18);

    /* 다크 모드 고도 표면 밝기 (IBM Carbon 패턴) */
    --elevation-l0-lightness: 7%;   /* base */
    --elevation-l1-lightness: 11%;  /* raised (+4%) */
    --elevation-l2-lightness: 15%;  /* overlay (+4%) */
    --elevation-l3-lightness: 19%;  /* modal (+4%) */

    /* ===================================================
       RADIUS
    =================================================== */
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-xl: 20px;

    /* ===================================================
       SPACING — 모바일 스케일 팩터
    =================================================== */
    --spacing-touch-scale: 1;       /* 데스크톱: 1x */
  }

  /* ===================================================
     Light 모드 오버라이드
  =================================================== */
  :root[data-theme='light'] {
    --color-surface-base: 210 20% 98%;
    --color-surface-raised: 0 0% 100%;
    --color-surface-overlay: 0 0% 100%;
    --color-surface-sunken: 210 14% 95%;

    --color-text-primary: 222 20% 12%;
    --color-text-secondary: 222 14% 35%;
    --color-text-muted: 215 15% 42%;
    --color-text-disabled: 215 10% 65%;

    --color-border-default: 220 14% 88%;
    --color-border-subtle: 220 14% 93%;

    --color-glass-bg: 210 40% 98% / 0.6;
    --color-glass-border: 220 15% 60% / 0.2;

    --elevation-l0-lightness: 98%;
    --elevation-l1-lightness: 100%;
    --elevation-l2-lightness: 100%;
    --elevation-l3-lightness: 100%;
  }

  /* ===================================================
     모바일 터치 스케일 (≤768px)
     Adobe Spectrum 2026 패턴: 컴포넌트·타이포 1.25x 확대
  =================================================== */
  @media (max-width: 768px) {
    :root {
      --spacing-touch-scale: 1.25;
    }
  }
}
```

### 1.3. Tailwind 매핑

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        // Surface
        'surface-base': 'hsl(var(--color-surface-base))',
        'surface-raised': 'hsl(var(--color-surface-raised))',
        'surface-overlay': 'hsl(var(--color-surface-overlay))',
        'surface-sunken': 'hsl(var(--color-surface-sunken))',

        // Text
        'text-primary': 'hsl(var(--color-text-primary))',
        'text-secondary': 'hsl(var(--color-text-secondary))',
        'text-muted': 'hsl(var(--color-text-muted))',
        'text-disabled': 'hsl(var(--color-text-disabled))',

        // Brand
        'brand-accent': 'hsl(var(--color-brand-accent))',
        'brand-accent-fg': 'hsl(var(--color-brand-accent-fg))',

        // Interactive
        'interactive': 'hsl(var(--color-interactive-default))',
        'interactive-hover': 'hsl(var(--color-interactive-hover))',

        // Feedback
        success: 'hsl(var(--color-feedback-success))',
        warning: 'hsl(var(--color-feedback-warning))',
        danger: 'hsl(var(--color-feedback-danger))',
        info: 'hsl(var(--color-feedback-info))',

        // Legacy aliases (하위 호환)
        background: 'hsl(var(--color-surface-base))',
        'bg-elev': 'hsl(var(--color-surface-raised))',
        foreground: 'hsl(var(--color-text-primary))',
        border: 'hsl(var(--color-border-default))',
        primary: {
          DEFAULT: 'hsl(var(--color-brand-accent))',
          fg: 'hsl(var(--color-brand-accent-fg))',
        },
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
--font-display: 'Noto Serif KR', 'Source Serif 4', serif;  /* Hero·Landing 전용 */
--font-sans: 'Pretendard Variable', system-ui, sans-serif;  /* UI 기본 */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;      /* 코드, ID */
```

> **AI 에이전트에게**: Inter·Roboto·Arial·system-ui 기본 스택 사용 금지. Pretendard는 한글·영문 혼용 UI에 최적화된 가변 폰트(100–900). Hero 헤드라인에는 `font-display`(serif)를 사용해 브랜드 감성을 강화한다.

- **Noto Serif KR / Source Serif 4**: Hero 헤드라인 + Zen Writing Mode 본문
- **Pretendard**: 일반 UI 텍스트 (한글 최적)
- **JetBrains Mono**: 코드, ULID, 타임스탬프

### 2.2. 타입 스케일 (데스크톱 기준)

| 토큰 | 데스크톱 크기/행간 | 모바일 크기/행간 | Weight | 용도 |
|---|---|---|---|---|
| `text-display` | 48px / 56px | 40px / 48px | 700 | Hero, Landing 헤드라인 |
| `text-h1` | 30px / 40px | 26px / 36px | 600 | 페이지 제목 |
| `text-h2` | 24px / 32px | 22px / 30px | 600 | 섹션 제목 |
| `text-h3` | 20px / 28px | 18px / 26px | 600 | 카드 제목 |
| `text-h4` | 16px / 24px | 16px / 24px | 600 | 위젯 제목 |
| `text-body-lg` | 16px / 26px | 18px / 28px | 400 | Zen Mode 본문 |
| `text-body` | 14px / 22px | 15px / 23px | 400 | 본문 기본 |
| `text-caption` | 12px / 16px | 13px / 17px | 400 | 메타, 타임스탬프 |
| `text-micro` | 11px / 14px | 12px / 15px | 500 | 뱃지, 태그 |

> **모바일 스케일 규칙 (Adobe Spectrum 2026 패턴)**
> - `text-body` 이상: 모바일에서 약 1.1–1.25x 확대 (가독성·터치 환경)
> - 터치 타겟 최소 44×44px 보장

```css
/* 모바일 타이포그래피 오버라이드 */
@media (max-width: 768px) {
  .text-display { font-size: 40px; line-height: 48px; }
  .text-h1      { font-size: 26px; line-height: 36px; }
  .text-body    { font-size: 15px; line-height: 23px; }
  .text-body-lg { font-size: 18px; line-height: 28px; }
}
```

### 2.3. Zen Mode 본문 규칙

- 폰트: `font-display` (serif)
- 너비: `max-w-prose` (≈65ch)
- 행간: 1.75
- 문단 간격: 1.25em
- 첫 글자 들여쓰기: 없음 (현대 웹 스타일)
- 모바일: `text-body-lg` 기준으로 자동 확대 적용

---

## 3. Glassmorphism 규약

> **AI 에이전트에게**: `backdrop-filter`는 GPU 가속이 필요하다. 텍스트가 포함된 UI에 과도한 블러 효과를 적용하면 WCAG 명도 대비 4.5:1을 위반하기 쉽다. 아래 허용 범위를 엄격히 준수할 것.

### 3.1. 유리 레이어 클래스 (공식 정의)

```css
/* globals.css */

/* L1 — 기본 유리: GNB, LNB, 카드 */
.glass {
  background: hsl(var(--color-glass-bg));
  border: 1px solid hsl(var(--color-glass-border));
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  box-shadow:
    inset 0 1px 0 0 hsl(var(--color-glass-highlight)),
    var(--shadow-md);
}

/* L2 — 부양 유리: Modal, Drawer, Command Palette */
.glass-elevated {
  background: hsl(222 18% 16% / 0.7);
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
  border: 1px solid hsl(var(--color-glass-border));
  box-shadow:
    inset 0 1px 0 0 hsl(var(--color-glass-highlight)),
    var(--shadow-lg);
}

/* L3 — 포커스 발광 */
.glass-focused {
  background: hsl(222 18% 18% / 0.75);
  box-shadow:
    inset 0 1px 0 0 hsl(var(--color-glass-highlight)),
    var(--shadow-md),
    var(--shadow-glow);
}

/* 인터랙티브 호버 트랜지션 */
.glass-interactive {
  transition: background 200ms ease-out, box-shadow 200ms ease-out;
}
.glass-interactive:hover {
  background: hsl(222 18% 18% / 0.75);
  box-shadow:
    inset 0 1px 0 0 hsl(var(--color-glass-highlight)),
    var(--shadow-md),
    var(--shadow-glow);
}

/* =========================================================
   투명도 제어 옵션 — 접근성을 위해 사용자가 효과를 줄일 수 있음
   (prefers-reduced-transparency 미디어 쿼리 대응)
========================================================= */
@media (prefers-reduced-transparency: reduce) {
  .glass,
  .glass-elevated,
  .glass-focused {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: hsl(222 20% 13% / 0.97);
  }
}

/* JS로 제어하는 투명도 슬라이더 지원 */
:root[data-glass-opacity='low'] .glass {
  backdrop-filter: blur(8px) saturate(110%);
  background: hsl(222 20% 12% / 0.85);
}
:root[data-glass-opacity='off'] .glass,
:root[data-glass-opacity='off'] .glass-elevated {
  backdrop-filter: none;
  background: hsl(222 20% 13% / 0.97);
}
```

### 3.2. 사용 계층 및 허용 범위

| 계층 | 클래스 | 용도 | 블러 강도 | 텍스트 허용 |
|---|---|---|---|---|
| **L0** | `bg-surface-base` | 최하단 배경 (노이즈 텍스처) | — | ✅ |
| **L1** | `.glass` | GNB, LNB, 일반 카드 | blur(20px) | ✅ (고대비 보장 시) |
| **L2** | `.glass-elevated` | Modal, Drawer, Command Palette | blur(32px) | ✅ (고대비 보장 시) |
| **L3** | `.glass-focused` | 포커스 상태 | blur(32px) | ⚠️ 짧은 텍스트만 |
| **장식 전용** | SVG `feDisplacementMap` 리퀴드 글래스 | 아이콘, 장식 배경 | 굴절 효과 | ❌ **텍스트 금지** |

> **성능 제한 규칙**:
> - 모바일에서 동시 `backdrop-filter` 요소 최대 3개. 초과 시 단색 폴백 사용.
> - `feDisplacementMap` 리퀴드 글래스 효과는 장식 요소(아이콘·배경)에만 허용. 텍스트 포함 UI에 절대 사용 금지.
> - 스크롤 애니메이션과 `backdrop-filter` 동시 적용 금지 (모바일 프레임 드롭 원인).

### 3.3. 다크 모드 고도(Elevation) 계층 표현

> **배경**: 다크 모드에서 그림자만으로 깊이를 표현하는 것은 한계가 있다. IBM Carbon·Atlassian 시스템처럼 상위 계층일수록 표면 색상의 밝기(Lightness)를 높여 고도를 표현한다.

```css
/* 다크 모드 고도 계층 — 4% Lightness 단계 */
.elevation-l0 { background: hsl(222 20% var(--elevation-l0-lightness)); } /* base: 7% */
.elevation-l1 { background: hsl(222 20% var(--elevation-l1-lightness)); } /* raised: 11% */
.elevation-l2 { background: hsl(222 20% var(--elevation-l2-lightness)); } /* overlay: 15% */
.elevation-l3 { background: hsl(222 20% var(--elevation-l3-lightness)); } /* modal: 19% */
```

| 계층 | 다크 모드 표현 | 라이트 모드 표현 |
|---|---|---|
| **L0 Base** | 표면 밝기 7% + 그림자 없음 | 배경 흰색 |
| **L1 Raised** | 밝기 11% + `shadow-sm` | 배경 흰색 + `shadow-sm` |
| **L2 Overlay** | 밝기 15% + `shadow-md` + `.glass` | 흰색 + `shadow-md` |
| **L3 Modal** | 밝기 19% + `shadow-lg` + `.glass-elevated` | 흰색 + `shadow-lg` |

### 3.4. 배경 텍스처 (선택)

Dashboard 배경 노이즈: SVG `feTurbulence` 기반 `<Noise />` 컴포넌트를 body 직속에 고정. opacity 3%.

---

## 4. 아이코노그래피

- **라이브러리**: Lucide React (단일 출처 원칙. 다른 라이브러리 혼용 금지)
- **크기**: 14 / 16 / 20 / 24 / 32
- **Stroke Width**: 1.5 (기본), 2 (강조·경고)
- **색상**: `currentColor` 상속 (하드코딩 금지)

이모지는 데이터(사용자가 입력한 태그/상태) 전용. UI 크롬(네비게이션·버튼 등)에는 사용 금지.

---

## 5. 공통 컴포넌트 카탈로그

Shadcn/ui를 기반으로 커스터마이징. 아래는 **Light House 전용 확장 컴포넌트**.

### 5.1. `<GlassCard>`

```tsx
interface GlassCardProps {
  variant?: 'default' | 'elevated';
  interactive?: boolean;
  elevation?: 'l0' | 'l1' | 'l2' | 'l3';  // 다크 모드 고도 계층
  children: React.ReactNode;
  className?: string;
}
```
- `elevation` prop으로 다크 모드 고도 자동 처리 (`.elevation-l{n}` + `.glass`)
- `interactive=true`면 호버·포커스 상호작용 클래스 추가

### 5.2. `<Tag>` (Pill)

```tsx
interface TagProps {
  variant: 'priority' | 'energy' | 'status' | 'dunbar' | 'neutral';
  value: string; // 'P1', 'hyper_focus', 'todo', etc.
  size?: 'sm' | 'md';
}
```
- 라운드 999px
- 색상은 `value`에 따라 `color-domain-*` 토큰 자동 매핑
- 테두리 1px + 반투명 배경 (예: P1 → `bg-[color-domain-priority-p1/15] border-[color-domain-priority-p1/40] text-[color-domain-priority-p1]`)

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
- Framer Motion 슬라이드 인 (220ms, `spring(180, 26)`)
- 백드롭: `bg-black/40 backdrop-blur-sm`
- Body: `.glass-elevated elevation-l3` 적용

### 5.4. `<CommandPalette>`

- cmdk 라이브러리 래퍼
- 중앙 상단 20% 지점 등장, 최대 너비 680px
- 섹션: **이동 / 생성 / 검색 결과 / 최근 항목**
- Empty: "엔터로 Quick Capture"
- `.glass-elevated elevation-l3` + `shadow-glow` 적용

### 5.5. `<ZenEditor>`

- Tiptap 래퍼
- 최대 너비 680px, 중앙 정렬
- 툴바는 슬래시 커맨드(`/`)로만 호출 (상시 노출 없음)
- 포커스 모드: 스크롤에 따라 현재 문단만 100% 밝기, 나머지 40%

### 5.6. `<BentoGrid>` + `<BentoCard>`

```tsx
interface BentoGridProps {
  columns?: number;     // 기본 12
  gap?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

interface BentoCardProps {
  span: {
    base: number;       // 모바일: 항상 12 (full-width)
    sm?: number;        // ≥640px
    md?: number;        // ≥768px
    lg?: number;        // ≥1024px
  };
  rows?: number;
  priority?: 'hero' | 'primary' | 'secondary'; // 시각적 계층
  children: React.ReactNode;
}
```

**반응형 브레이크포인트 로직**:

| 브레이크포인트 | 동작 |
|---|---|
| `base` (< 640px) | 모든 카드 `col-span-12` (단일 열). 모바일에서 깔끔한 단일 열 레이아웃. |
| `sm` (640–767px) | 카드 최대 2열. 큰 카드(span ≥ 8)는 여전히 full-width. |
| `md` (768–1023px) | 기획된 span 적용 시작. |
| `lg` (≥ 1024px) | 완전한 벤토 레이아웃. |

**시각적 계층화 (Color Hierarchy)**:

> 정보 위계에 따라 가장 중요한 카드에 가장 높은 색상 대비를 부여.

| priority | 배경 | 테두리 | 그림자 | 텍스트 대비 |
|---|---|---|---|---|
| `hero` | `elevation-l2` + `glass-elevated` | `color-brand-accent/30` | `shadow-lg + shadow-glow` | `text-primary` (최고 대비) |
| `primary` | `elevation-l1` + `glass` | `color-border-default` | `shadow-md` | `text-primary` |
| `secondary` | `elevation-l0` | `color-border-subtle` | `shadow-sm` | `text-secondary` |

```tsx
// 사용 예시
<BentoGrid columns={12} gap="md">
  {/* Hero 카드: 가장 중요한 메시지, 최고 대비 */}
  <BentoCard span={{ base: 12, md: 8 }} rows={2} priority="hero">
    <TodayFocusWidget />
  </BentoCard>

  {/* Primary 카드 */}
  <BentoCard span={{ base: 12, md: 4 }} priority="primary">
    <EnergyWidget />
  </BentoCard>

  {/* Secondary 카드 */}
  <BentoCard span={{ base: 12, sm: 6, md: 4 }} priority="secondary">
    <RelationshipWidget />
  </BentoCard>
</BentoGrid>
```

- 드래그 재배치: `react-grid-layout` (설정 페이지에서 on/off)
- 모바일 드래그: 비활성화 (터치 스크롤과 충돌 방지)

### 5.7. `<Heatmap>` (GitHub-style)

- 7×53 그리드 (1년)
- 셀 크기 11×11px, 간격 2px
- 색상 스케일: `color-surface-raised → color-brand-accent`의 5단계
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

→ Shadcn 표준 설치, `.glass` + `elevation-l{n}` 변형 추가.

---

## 6. 애니메이션 규약

> **AI 에이전트에게**: 모션은 존재감과 위계를 만들기 위한 것이지 장식 노이즈가 아니다. 모든 UI 작업에 최소 2–3개의 의도적 모션을 구현한다. 기능적 마이크로 인터랙션이 빠지면 "AI가 만든 티 나는 UI"가 된다.

### 6.1. 타이밍 시스템

| 목적 | Duration | Easing | 비고 |
|---|---|---|---|
| **즉각 피드백** | 80ms | `linear` | 버튼 눌림, 토글 |
| **호버 반응** | 150ms | `ease-out` | 색상·그림자 변화 |
| **마이크로 인터랙션** | 150–250ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bounce·Ripple·Shake |
| **패널 확장/축소** | 220ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Accordion, Collapsible |
| **Drawer / Modal** | 260ms | `spring(180, 26)` | Framer Motion |
| **페이지 전환** | 180ms | `ease-in-out` | — |
| **Hero 입장 시퀀스** | 600ms | `spring(120, 14)` | 최초 렌더 시 한 번 |

### 6.2. 기능적 마이크로 인터랙션 목록

> 아래 인터랙션은 사용자의 **불확실성을 줄이고** 행동에 즉각적인 물리적 피드백을 제공하기 위해 존재한다.

#### 6.2.1. Ripple (클릭 파문)

```tsx
// 버튼·카드 클릭 시 클릭 지점에서 파문 퍼짐
// duration: 400ms, 투명도 0 → 0.3 → 0
<RippleButton onClick={...}>
  저장하기
</RippleButton>
```
- 적용 대상: 모든 Primary Button, Interactive Card
- 색상: `color-brand-accent/30`

#### 6.2.2. Bounce (물리적 누름)

```tsx
// 버튼 클릭 시 살짝 눌리는 물리 효과
// scale: 1 → 0.95 → 1, duration: 150ms
whileTap={{ scale: 0.95, transition: { duration: 0.15 } }}
```
- 적용 대상: 모든 버튼, FAB, 아이콘 버튼
- 목적: 클릭이 인식됐음을 즉각 알림

#### 6.2.3. Shake (유효성 오류)

```tsx
// 폼 유효성 실패 시 입력 필드 흔들림
// x: [0, -6, 6, -4, 4, 0], duration: 300ms
const shakeAnimation = {
  x: [0, -6, 6, -4, 4, -2, 2, 0],
  transition: { duration: 0.3, ease: 'easeInOut' }
};
```
- 적용 대상: 에러 발생 Input, 폼 Submit 실패
- 목적: 텍스트 에러 메시지 전에 즉각적인 물리 피드백

#### 6.2.4. Pulse (로딩 스켈레톤)

```css
/* 로딩 중 콘텐츠 플레이스홀더 */
.skeleton {
  background: linear-gradient(
    90deg,
    hsl(var(--color-surface-raised)) 0%,
    hsl(var(--color-border-default)) 50%,
    hsl(var(--color-surface-raised)) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```
- 적용 대상: 카드·테이블·리스트 최초 로딩
- 목적: 콘텐츠가 오고 있음을 알림

#### 6.2.5. Fade-Up (콘텐츠 진입)

```tsx
// 카드·섹션 진입 시 아래서 위로 fade
// y: 16 → 0, opacity: 0 → 1, duration: 220ms
// stagger: 50ms (리스트 아이템)
const fadeUp = {
  hidden: { y: 16, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.22 } }
};
```
- 적용 대상: 페이지 첫 렌더, 모달 오픈, 검색 결과
- 목적: 시선 흐름 유도, 위계 강화

#### 6.2.6. Glow Pulse (브랜드 강조)

```css
/* CTA 버튼·포커스 요소 주기적 발광 */
@keyframes glow-pulse {
  0%, 100% { box-shadow: var(--shadow-glow); }
  50% { box-shadow: 0 0 40px hsl(38 96% 62% / 0.35); }
}
.glow-cta {
  animation: glow-pulse 2.5s ease-in-out infinite;
}
```
- 적용 대상: Hero CTA 버튼, 핵심 액션 버튼 1개
- 목적: 사용자 시선을 주요 액션으로 안내

### 6.3. 금지 사항

- 500ms 이상 지연되는 애니메이션
- 깜빡이는 네온 (접근성 위반)
- 우연한 Layout Shift (CLS > 0.1 금지)
- 같은 화면에서 3개 이상 동시 루프 애니메이션

### 6.4. Reduced Motion 대응

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 7. 접근성 (WCAG AA 기준)

### 7.1. 기본 요구사항

- **명도 대비**: 모든 텍스트 4.5:1 이상, 큰 글자(18px bold 이상) 3:1 이상
- **포커스 링**: `focus-visible:ring-2 ring-[color-interactive-focus-ring] ring-offset-2 ring-offset-surface-base`
- **키보드 네비**: Tab 순서 논리적, Skip Link 제공, 포커스 트랩(Modal·Drawer 내부) 구현
- **스크린리더**: 모든 아이콘 버튼에 `aria-label`, 상태 변화에 `aria-live`
- **컬러 독립성**: 상태는 색+아이콘+텍스트 3중 표현 (예: P1 = 빨강 + ⚡ + "P1")
- **터치 타겟**: 최소 44×44px (모바일)

### 7.2. 글래스 효과 접근성 제어

사용자 설정 페이지에 투명도 슬라이더 제공:

```tsx
// 설정 > 디스플레이 > 유리 효과 강도
<OpacitySlider
  label="유리 효과 강도"
  options={['full', 'low', 'off']}
  onChange={(value) => {
    document.documentElement.setAttribute('data-glass-opacity', value);
    localStorage.setItem('glass-opacity', value);
  }}
/>
```

### 7.3. AI 기반 접근성 감사(Audit) 파이프라인

> **목적**: GPT-5.4·Claude Code 등 AI를 활용해 개발 워크플로우 내에서 접근성을 1차 자동 감사. 개발자가 PR 머지 전에 실행.

#### 감사 항목 및 AI 프롬프트 템플릿

```markdown
## 접근성 감사 요청 (AI Audit Prompt)

다음 컴포넌트 코드를 WCAG AA 기준으로 감사하고 문제점을 리포트해줘:

[코드 붙여넣기]

점검 항목:
1. **명도 대비**: HSL 값 기반으로 4.5:1 비율 계산. 위반 요소 특정.
2. **키보드 내비게이션**: Tab 순서 논리성, 포커스 트랩 여부, 포커스 링 존재 확인.
3. **스크린리더**: aria-label 누락, role 오류, aria-live 필요 여부.
4. **터치 타겟**: 인터랙티브 요소 44×44px 미만 여부.
5. **애니메이션**: prefers-reduced-motion 대응 여부.
6. **Glass 효과**: backdrop-filter 사용 시 텍스트 대비 보장 여부.

결과를 [위반 항목 / 위험도(High·Med·Low) / 수정 방법] 형식으로 출력.
```

#### CI 파이프라인 통합 (권장)

```yaml
# .github/workflows/a11y-audit.yml
- name: AI Accessibility Audit
  run: |
    npx axe-cli http://localhost:3000 --tags wcag2aa
    # + 커스텀 명도 대비 스크립트 (HSL 토큰 검증)
```

---

## 8. 레이아웃 여백 규칙 (8pt Grid)

- **기본 단위**: 4px (스케일: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96)
- **섹션 간 간격**: 24–32px
- **카드 내부 패딩**: 16–20px
- **페이지 좌우 여백**: 32px (xl), 24px (lg), 16px (md)

### 8.1. 모바일 터치 스케일 규칙

| 요소 | 데스크톱 | 모바일 | 비율 |
|---|---|---|---|
| 버튼 높이 | 36px | 44px | 1.22x |
| 입력 필드 높이 | 36px | 48px | 1.33x |
| 카드 내부 패딩 | 16px | 20px | 1.25x |
| 아이콘 크기 | 16px | 20px | 1.25x |
| 섹션 간격 | 24px | 32px | 1.33x |
| 페이지 좌우 여백 | 32px (xl) | 16px | — |

```css
/* 터치 환경 컴포넌트 스케일 */
@media (max-width: 768px) {
  .btn { min-height: 44px; padding: 0 20px; }
  .input { min-height: 48px; }
  .card { padding: 20px; }
  .icon-btn { min-width: 44px; min-height: 44px; }
}
```

---

## 9. Asset 가이드 (이미지/파일)

- **R2 업로드 규칙**: `user/{userId}/{domain}/{yyyy}/{mm}/{ulid}.{ext}`
- **이미지 변형**: Cloudflare Images
  - Thumbnail: 120×120 (cover)
  - Card: 400×300 (cover)
  - Detail: 1200×1200 (contain)
  - Original: 무변형 (다운로드용)
- **아바타 기본**: 이니셜 + `color-domain-dunbar-{layer}` 색상 배경

---

## 10. 디자인 리뷰 체크리스트 (PR 머지 전)

### 10.1. 구조·레이아웃

- [ ] `.glass` 사용 시 `.glass-elevated` 중첩 안 함
- [ ] 첫 뷰포트에 Hero Budget 준수 (브랜드+헤드라인1+서포팅1+CTA1+이미지1)
- [ ] 섹션당 단일 목적 확인
- [ ] 카드가 인터랙션 컨테이너 역할인지 확인 (장식 카드 금지)

### 10.2. 토큰·색상

- [ ] 시맨틱 토큰 사용 (`color-surface-*`, `color-text-*`, `color-brand-*`)
- [ ] 팔레트 인덱스 하드코딩 금지 (`#FBBF24` 직접 사용 금지)
- [ ] 액센트 컬러 1개 초과 금지

### 10.3. 접근성

- [ ] 텍스트 명도 대비 4.5:1 확인 (AI Audit 프롬프트 실행 권장)
- [ ] Focus 링 표시됨 (`focus-visible` 동작 확인)
- [ ] Reduced Motion 대응 (`@media prefers-reduced-motion`)
- [ ] 터치 타겟 44×44px 이상 (모바일)
- [ ] Glass 효과 위 텍스트 대비 확인
- [ ] `data-glass-opacity` 옵션 정상 동작

### 10.4. 고도·다크 모드

- [ ] `elevation-l{n}` 클래스로 다크 모드 깊이 표현 확인
- [ ] 다크/라이트 양쪽 스크린샷 첨부
- [ ] 라이트 모드에서 Glass 폴백 색상 확인

### 10.5. 애니메이션

- [ ] 의도적 모션 최소 2개 구현 (Fade-Up + Ripple 또는 Bounce 등)
- [ ] 500ms 초과 루프 애니메이션 없음
- [ ] 동시 루프 애니메이션 3개 미만
- [ ] 이모지는 데이터 전용 (UI 크롬 금지)

### 10.6. 모바일

- [ ] BentoGrid: 모바일 단일 열 정상 렌더링
- [ ] 터치 스케일 적용 (버튼·입력·패딩)
- [ ] `backdrop-filter` 요소 3개 이하 (모바일)

### 10.7. AI 감사 (선택 권장)

- [ ] AI Audit 프롬프트 실행 후 High 위험도 항목 전부 수정
- [ ] axe-cli WCAG AA 통과

---

## 11. 비주얼 테시스 어휘 라이브러리 (Visual Thesis Vocabulary)

> **목적**: GPT-5.4에게 "어떤 느낌으로 만들어줘"를 말하려면 어휘가 구체적이어야 한다. 이 섹션은 Light House 맥락에서 허용된 어휘와 금지된 어휘를 고정한다.

### 11.1. Mood·Material·Energy 3축 어휘

AI 에이전트가 비주얼 테시스를 작성할 때 반드시 다음 3축에서 각 1개씩 조합:

**Mood (분위기)** — Light House 허용:
- `calm` · `contemplative` · `focused` · `quiet` · `serene` · `grounded` · `deliberate` · `introspective`

**Mood 금지** (다른 프로덕트 결):
- ~~`playful`~~ · ~~`energetic`~~ · ~~`bold`~~ · ~~`loud`~~ · ~~`whimsical`~~ · ~~`trendy`~~

**Material (재질)** — Light House 허용:
- `deep glass` · `brushed obsidian` · `tinted smoke` · `soft matte` · `refracted light` · `warm charcoal` · `lighthouse beam`

**Material 금지**:
- ~~`neon`~~ · ~~`holographic`~~ · ~~`metallic chrome`~~ · ~~`glossy plastic`~~ · ~~`pastel candy`~~

**Energy (에너지)** — Light House 허용:
- `low hum` · `steady pulse` · `signal-like` · `patient` · `anchored` · `gently breathing`

**Energy 금지**:
- ~~`explosive`~~ · ~~`dynamic`~~ · ~~`bouncy`~~ · ~~`frenetic`~~ · ~~`high-contrast drama`~~

### 11.2. Light House 공식 비주얼 테시스 (기본값)

모든 화면의 기본 테시스:

```
"A calm, deep-glass interface where a single gold signal guides
 attention like a lighthouse beam through quiet charcoal fog."

한국어: "차분하고 깊은 유리 인터페이스 위에, 고요한 차콜 안개를 가르는
        등대의 빛처럼 단 하나의 골드 시그널이 시선을 안내한다."
```

에이전트는 이 테시스에서 **표면(surface)별로 살짝 변주**할 수 있으나, 3축 중 2축 이상 벗어나면 안 된다.

### 11.3. 화면별 테시스 프리셋

에이전트는 화면 타입을 지정받으면 아래 프리셋을 시작점으로 사용:

| 표면 | Mood | Material | Energy |
|---|---|---|---|
| Dashboard | `focused` | `deep glass` | `steady pulse` |
| Zen Editor | `contemplative` | `tinted smoke` | `patient` |
| Action Hub Kanban | `deliberate` | `brushed obsidian` | `anchored` |
| PRM Card Grid | `introspective` | `warm charcoal` | `gently breathing` |
| Life Ops Daily | `grounded` | `soft matte` | `low hum` |
| Command Palette | `focused` | `refracted light` | `signal-like` |
| Login | `calm` | `lighthouse beam` | `gently breathing` |

### 11.4. 레퍼런스 협력 (Moodboard Protocol)

> **GPT-5.4는 이미지 해석 능력이 강화됨**. 레퍼런스를 이렇게 다룬다:

1. **사용자가 이미지 제공 시**: 에이전트는 이미지에서 **레이아웃 리듬·타이포 스케일·스페이싱 시스템·이미지 처리 방식** 4개를 먼저 추론해 서술.
2. **이미지 제공 없음**: 에이전트는 위 §11.3 프리셋을 시작점으로 초안 → 사용자 검토용 **자체 무드보드 코멘트** 생성 ("이 화면은 Linear의 타이포 리듬 + Raycast의 Command 패턴 + Things 3의 카드 간결함을 조합").
3. **금지 레퍼런스**: 게이밍 UI, 크립토 대시보드, 보라색 그라디언트 랜딩페이지, Vercel-클론 SaaS.

---

## 12. 내러티브 구조 라이브러리 (Narrative Structure)

> **원칙**: 페이지는 하나의 **이야기**다. Light House의 표면 타입별로 구조가 다르다.

### 12.1. Landing Page 시퀀스 (로그인 전 노출)

```
Hero          →  아이덴티티와 약속 (등대 메타포 + 한 줄 약속)
Support       →  Second Brain의 작동 원리 (제품 스크린샷)
Detail        →  5대 도메인 간단 소개 (이미지 중심, 텍스트 최소)
Social Proof  →  [Light House는 개인용 앱이므로 생략]
Final CTA     →  "시작하기" 단일 CTA
```

**Hero 허용**: 브랜드 로고 · 한 줄 헤드라인 (예: "당신의 기억을 비추는 등대") · 서포팅 문장 1 · CTA 1 · 등대 모티프 이미지 (풀블리드).

**Hero 금지**: 통계 · 기능 리스트 · 이벤트 · 사용자 후기 · 가격 · 이메일 구독 박스 · 데모 영상 자동재생.

### 12.2. Dashboard Surface (앱 진입 후 Home)

```
Top Strip     →  Today's Anchor (오늘의 브리핑)
Primary Grid  →  Bento (하나의 hero 카드 + 보조 카드 6–7개)
Secondary     →  최근 활동 피드 (선택적)
Footer Action →  Quick Capture CTA
```

**규칙**:
- Dashboard는 §0.2 "One Composition" 예외 — 여러 위젯 허용.
- 단, **단일 hero 카드**(priority="hero") 반드시 존재 → 시선의 앵커.
- 위젯 3개 초과 시 Priority 계층(hero/primary/secondary) 시각적으로 구분.

### 12.3. Directory Surface (PRM, Media, Projects 리스트)

```
Header        →  도메인 이름 + 총 개수 + 주요 액션
Filter Bar    →  탭 + 드롭다운 + 검색 (§5.11 FilterBar)
Grid/Table    →  카드 or 테이블 (ViewSwitcher)
Empty State   →  온보딩 유도 (카드 아님)
```

### 12.4. Deep Work Surface (Task Workspace, Zettel Editor)

```
Breadcrumb    →  최소 (호버 시 표시)
Split Panel   →  좌 메타 30% + 우 에디터 70% (resizable)
Toolbar       →  숨김 (slash command로 호출)
Autosave      →  subtle indicator (우상단 1px dot)
```

**규칙**: LNB 자동 collapse. 배경은 순수 `elevation-l0` (노이즈도 약화). 모션은 포커스 모드(현재 문단만 100% 밝기)만 허용.

### 12.5. Detail/Drawer Surface

```
Header        →  엔티티 타이틀 + 메타 + 액션 버튼 3개 이하
Tabs          →  3개 이하 (많으면 Accordion)
Body          →  스크롤 영역 (Timeline, Form, Content)
Footer        →  Primary Action (선택)
```

### 12.6. Utility Surface (Settings, Admin)

```
Section Header → 명확한 범주 이름 + 1줄 설명
Form/List     →  왼쪽 라벨 / 오른쪽 컨트롤 (수직 스택)
Save Indicator →  인라인 "저장됨" / "변경사항 있음"
```

**규칙**: 마케팅 카피 금지. **Utility Copy** (direction/status/action) 기본.

---

## 13. 표면별 규칙 분기 (Surface-Type Rules)

> **맥락에 따라 같은 컴포넌트라도 다르게 행동해야 한다.** 에이전트는 작업 전에 "지금 만드는 것이 어느 Surface인가"를 먼저 판단한다.

### 13.1. Surface 판단 플로우

```
[작업 시작]
  ↓
[이 화면은 로그인 전인가?]
  ├─ YES → Marketing/Landing Surface (§13.2)
  └─ NO → [사용자가 매일 쓰는 화면인가?]
       ├─ YES → [데이터 입력·편집이 주 목적인가?]
       │    ├─ YES → Deep Work Surface (§13.5)
       │    └─ NO → [리스트/그리드 조회인가?]
       │         ├─ YES → Directory Surface (§13.4)
       │         └─ NO → Dashboard Surface (§13.3)
       └─ NO → Utility Surface (§13.6)
```

### 13.2. Marketing/Landing Surface

| 항목 | 값 |
|---|---|
| 기본 폰트 | `font-display` (Noto Serif KR) |
| 배경 | full-bleed 이미지 or 그라디언트 |
| 카드 사용 | 금지 (절대) |
| 히어로 크기 | 100vh, 풀블리드 |
| CTA | 1개 (Glow Pulse 모션) |
| 카피 톤 | 감성적 · 은유적 · 짧음 |
| 예시 | `/login`, `/` (마케팅 랜딩) |

### 13.3. Dashboard Surface

| 항목 | 값 |
|---|---|
| 기본 폰트 | `font-sans` (Pretendard) |
| 배경 | `surface-base` + noise(3%) |
| 카드 사용 | 허용 (위젯) |
| 레이아웃 | Bento Grid |
| CTA | Quick Capture (항상 GNB에 고정) |
| 카피 톤 | Utility + 개인화 인사 |
| 예시 | `/dashboard`, `/life-ops/{date}` |

### 13.4. Directory Surface

| 항목 | 값 |
|---|---|
| 기본 폰트 | `font-sans` |
| 배경 | `surface-base` |
| 카드 사용 | 허용 (항목이 인터랙션 타겟) |
| 레이아웃 | Grid / Masonry / Table |
| 필터 | FilterBar 상단 고정 |
| 빈 상태 | EmptyState 일러스트 + 생성 CTA |
| 예시 | `/prm`, `/vault/media`, `/action-hub` |

### 13.5. Deep Work Surface

| 항목 | 값 |
|---|---|
| 기본 폰트 | `font-display` (writing) / `font-sans` (development) |
| 배경 | `surface-base` (노이즈 약화) |
| 카드 사용 | **금지** (패널은 OK) |
| LNB | 자동 collapse |
| 모션 | 포커스 모드만 |
| 자동 저장 | 필수 (1s debounce) |
| 예시 | Task Workspace, Zettel Detail |

### 13.6. Utility Surface

| 항목 | 값 |
|---|---|
| 기본 폰트 | `font-sans` |
| 배경 | `surface-base` |
| 카드 사용 | 구역 구분 목적만 (장식 금지) |
| 레이아웃 | 좌측 라벨 / 우측 컨트롤 |
| 카피 톤 | **Utility Copy** 전용 |
| 예시 | `/settings/*` |

### 13.7. Drawer Surface

| 항목 | 값 |
|---|---|
| 너비 | 480px (기본), 2개 스택 시 각 400px |
| 고도 | `elevation-l3` + `.glass-elevated` |
| 백드롭 | `bg-black/40 backdrop-blur-sm` |
| 포커스 | 트랩 필수 |
| 닫기 | Esc / 백드롭 클릭 / 버튼 |

---

## 14. 카피 보이스 & 톤 (Copy Voice & Tone)

> **원칙**: 카피는 **제품 언어**여야 한다. 디자인 코멘터리나 AI가 쓴 듯한 마케팅 톤 금지.

### 14.1. Light House 브랜드 보이스

- **Warm** — 차갑거나 기계적이지 않다. 사용자에게 안부를 묻는 친구.
- **Quiet** — 느낌표·강조·대문자 남발 금지.
- **Direct** — 돌려 말하지 않음. "~할 수 있도록 도와드립니다" ❌ → "시작하세요" ✅
- **Korean-first** — 한국어가 기본. 영어는 고유명사·기술용어만.

### 14.2. Product Language vs Design Commentary

**Product Language (허용)**:
- "오늘 아침, 무엇에 집중하실 건가요?"
- "이 인물에게 연락할 시간이에요."
- "3개의 아이디어가 원석 상태로 기다리고 있어요."

**Design Commentary (금지)**:
- ~~"우아한 카드 기반 레이아웃으로..."~~ (시스템이 아니라 사용자에게 말하기)
- ~~"AI 기반 스마트 라우팅 기술이..."~~ (기술 자랑 금지)
- ~~"놀라운 생산성 혁명을 경험하세요"~~ (과장 금지)

### 14.3. Utility Copy 규칙 (Direction / Status / Action)

App/Utility Surface에서는 다음 3원칙:

**Direction (방향 지시)**:
- "Cmd+K로 검색" (짧게)
- "여기를 클릭해서 시작" ❌ → "시작하기" ✅ (CTA 버튼 내부)

**Status (상태 표시)**:
- "저장됨" / "변경사항 있음" / "동기화 중"
- ~~"성공적으로 저장되었습니다!"~~ ❌ 과장
- ~~"오류가 발생했습니다. 다시 시도해주세요."~~ ❌ 길다 → "저장 실패. 다시 시도" ✅

**Action (액션)**:
- 버튼 라벨은 **동사 1개** 원칙
- "저장" / "삭제" / "연락 완료" / "원석에서 보석으로"
- ~~"지금 저장하기"~~ ❌ "저장" ✅

### 14.4. Empty State 카피 패턴

```
[제목]       감정적 · 은유적 (1줄)
[설명]       구체적 행동 힌트 (1줄)
[CTA]        동사 + 명사 (예: "첫 Zettel 쓰기")
[Hotkey]     ⌘N 또는 'c z'
```

**예시**:
- 제목: "첫 번째 원석을 던져보세요"
- 설명: "생각은 쓰는 순간 보석이 됩니다"
- CTA: "새 Fleeting" (Cmd+N)

### 14.5. 에러 카피 패턴

```
[제목]       "등대에 문제가 생겼습니다" (브랜드 메타포)
[내용]       [짧은 원인] · [다음 행동]
[에러 ID]    복사 가능 (font-mono)
[액션]       "다시 시도" · "홈으로"
```

### 14.6. 30% 규칙 (Copy Reduction)

> 카피를 30% 삭제하고도 의미가 전달되면, 계속 삭제한다. Light House는 **적게 말하는 제품**이다.

---

## 15. 이미지 & 비주얼 앵커 규칙 (Imagery Rules)

### 15.1. Real Visual Anchor 원칙

> **규칙**: 이미지는 **제품·장소·분위기·컨텍스트**를 보여줘야 한다. 추상 그라디언트와 장식 배경은 메인 비주얼로 인정하지 않는다.

| 맥락 | 허용 이미지 | 금지 |
|---|---|---|
| Landing Hero | 등대 사진·일러스트 (실제 분위기) | Unsplash 무작위, 추상 3D 렌더, 보라 그라디언트 |
| Dashboard | **이미지 없음** (데이터 중심) | 마스코트 일러스트, 스톡 포토 |
| Empty State | 심플한 라인 일러스트 (브랜드 컬러) | 3D 캐릭터, 과도한 디테일 |
| Media Detail | 실제 커버·스크린샷 | 플레이스홀더 |
| Avatar | 이니셜 + `color-domain-dunbar-*` | 기본 회색 사람 실루엣 |

### 15.2. 아바타 생성 규칙

```tsx
// 이미지 없을 때 이니셜 아바타
<UserAvatar>
  <AvatarFallback
    style={{
      background: `hsl(var(--color-domain-dunbar-${person.layer}))`,
      color: 'hsl(var(--color-brand-accent-fg))',
    }}
  >
    {person.name.slice(0, 1)}
  </AvatarFallback>
</UserAvatar>
```

### 15.3. Empty State Illustration 스펙

- **스타일**: 라인 아트 (1.5px stroke)
- **색상**: `color-text-muted` 베이스 + `color-brand-accent` 악센트 한 군데
- **크기**: 120×120 최대
- **모션**: 3s ease-in-out infinite float (±4px), reduced-motion 자동 비활성
- **주제**: 도메인 메타포 (등대·원석·별자리·나침반)

### 15.4. 금지 패턴

- ❌ Glassmorphism 카드 안에 Glassmorphism 이미지 중첩
- ❌ 히어로 이미지 위 반투명 오버레이로 텍스트 가독성 보정 (=이미지가 틀린 것)
- ❌ 3D 렌더 오브젝트 (Spline 스타일)
- ❌ 모든 아이콘을 원형 배경에 담기 (Telegram/iMessage 스타일)

---

## 16. 안티패턴 갤러리 (Anti-Pattern Gallery)

> **Before/After 형태**로 금지 패턴을 고정. 에이전트는 After 패턴만 사용.

### 16.1. 타이포그래피

| ❌ Before | ✅ After |
|---|---|
| `className="font-sans"` (시스템 폰트 fallback) | `className="font-sans"` + `--font-sans: 'Pretendard Variable'` |
| `<h1>생산성의 혁명적 변화를 경험하세요</h1>` | `<h1>기억을 비추는 등대</h1>` |
| 헤드라인 fontSize: 36px, weight: 900, letterSpacing: -0.05em | fontSize: 48px, weight: 700, letterSpacing: -0.02em (§2.2) |
| 본문 font: 14px, line-height: 1.2 | 14/22 또는 Zen mode 16/26 (§2.2) |

### 16.2. 레이아웃

| ❌ Before | ✅ After |
|---|---|
| 히어로에 통계 `[12,847 사용자 · 98% 만족]` 추가 | 히어로에는 Hero Budget만 (§0.2) |
| 카드 6개를 완벽히 균등 배치 (각 4×1) | Bento `priority: hero/primary/secondary` 비대칭 (§5.6) |
| 섹션마다 다른 배경색으로 구분 | 섹션 간 `space-y-24` 여백으로만 구분 |
| 모든 버튼에 그림자 + 그라디언트 | 1차 CTA만 `shadow-glow`, 2차는 텍스트 버튼 |

### 16.3. 색상

| ❌ Before | ✅ After |
|---|---|
| `bg-gradient-to-br from-purple-500 to-pink-500` (보라 편향) | `bg-[hsl(var(--color-brand-accent))]` (골드) |
| `text-white` (하드코딩) | `text-[hsl(var(--color-text-primary))]` |
| 상태별 색상 팔레트 번호 (`red-500`, `green-400`) | 시맨틱 토큰 (`color-feedback-danger`, `color-feedback-success`) |

### 16.4. 모션

| ❌ Before | ✅ After |
|---|---|
| 모든 섹션에 scroll-triggered fade-in | 히어로 진입 + CTA glow-pulse 2개만 (§0.2) |
| `transition-all duration-1000` | 타이밍 테이블(§6.1) 내 값 사용 |
| 로딩 시 스피너 회전 무한 | Skeleton pulse (§6.2.4) |
| 호버 시 scale(1.1) | `glass-interactive` glow + 그림자 (§3.1) |

### 16.5. 컴포넌트

| ❌ Before | ✅ After |
|---|---|
| 텍스트 단락을 카드로 감싸기 | 텍스트는 `max-w-prose`로 폭만 제한 |
| 모든 폼 필드를 개별 카드로 | `<Card>` 1개에 섹션 구분선만 |
| 네비게이션에 모든 링크 노출 (8+ 개) | GNB 5도메인 + 유틸 3개만 (§IA §2) |

---

## 17. AI 결정 트리 (Decision Trees for Agents)

> 에이전트가 모호한 상황에서 일관된 선택을 하도록 의사결정 트리 고정.

### 17.1. "이 요소는 카드여야 하는가?"

```
[요소 식별]
  ↓
[사용자가 클릭/탭 하는가?]
  ├─ NO → 카드 아님. 텍스트 블록으로 처리.
  └─ YES → [배경·테두리·그림자·라운딩 제거해도 인터랙션이 명확한가?]
       ├─ YES → 카드 아님. 링크/버튼 프리미티브 사용.
       └─ NO → [이 요소가 히어로 영역 안인가?]
            ├─ YES → 카드 절대 금지. 다른 방식으로 표현.
            └─ NO → [일관된 리스트·그리드의 항목인가?]
                 ├─ YES → <GlassCard interactive /> 사용.
                 └─ NO → 재검토. 단독 카드는 의심.
```

### 17.2. "어떤 색상 토큰을 써야 하는가?"

```
[색상 필요 맥락]
  ↓
[배경·표면인가?]
  ├─ YES → color-surface-{base|raised|overlay|sunken}
[텍스트인가?]
  ├─ YES → color-text-{primary|secondary|muted|disabled}
[시스템 피드백 (성공/경고/에러)?]
  ├─ YES → color-feedback-{success|warning|danger|info}
[브랜드 강조?]
  ├─ YES → color-brand-accent (최대 1개 액센트 규칙)
[인터랙티브 요소?]
  ├─ YES → color-interactive-{default|hover|active|disabled}
[도메인 의미 (P1, Dunbar 등)?]
  ├─ YES → color-domain-{priority|energy|dunbar}-*
[위 어느 것도 아님]
  └─ 재검토. 임의 색상 금지.
```

### 17.3. "이 모션이 필요한가?"

```
[모션 고려]
  ↓
[이 모션이 위계·존재감·상태 변화를 알려주는가?]
  ├─ NO → 추가 금지. 장식 모션은 노이즈.
  └─ YES → [이미 이 화면에 동시 루프 모션이 3개 이상인가?]
       ├─ YES → 기존 모션 통합·제거 먼저.
       └─ NO → [Duration이 500ms 미만인가?]
            ├─ NO → 250ms 이하로 조정.
            └─ YES → [§6.2의 6개 마이크로 인터랙션 중 맞는 게 있는가?]
                 ├─ YES → 해당 토큰 사용.
                 └─ NO → 커스텀 모션 → 리뷰 필요.
```

### 17.4. "이 텍스트는 뷰포트 1에 들어가야 하는가?"

```
[텍스트 블록]
  ↓
[이게 브랜드/제품명인가?] YES → 뷰포트 1 (최상단)
[이게 핵심 약속(헤드라인 1개)인가?] YES → 뷰포트 1
[이게 짧은 서포팅 문장(1개)인가?] YES → 뷰포트 1
[이게 CTA 버튼인가?] YES → 뷰포트 1
[나머지] → 뷰포트 2 이하로 이동. 절대 뷰포트 1 추가 금지.
```

### 17.5. "어떤 Elevation 계층인가?"

```
[컴포넌트 깊이 판단]
  ↓
[최하단 배경인가?] → L0 (bg-surface-base)
[기본 카드·패널인가?] → L1 (.glass + elevation-l1)
[Drawer·Modal·Popover인가?] → L2 (.glass-elevated + elevation-l2)
[포커스·드래그 중·최전면 Modal인가?] → L3 (.glass-elevated + elevation-l3 + shadow-glow)
```

---

## 18. 숨은 디테일 라이브러리 (Subtle Detail Library)

> **AI가 만든 티를 없애는 마감 디테일**. GPT-5.4가 빼먹기 쉬운 항목을 체크리스트로 고정.

### 18.1. 마이크로 디테일 20선

**타이포그래피**:
- [ ] 숫자는 `font-feature-settings: 'tnum'` (tabular nums) — 테이블·통계에서 정렬 유지
- [ ] 한글-영문 혼용 시 자동 커닝 (`word-break: keep-all; overflow-wrap: break-word;`)
- [ ] 긴 URL·코드에 `overflow-wrap: anywhere`
- [ ] 헤드라인에 `text-wrap: balance` (줄바꿈 균형)
- [ ] 본문에 `text-wrap: pretty` (마지막 줄 고아 방지)

**상태**:
- [ ] 버튼 `:disabled` 상태에 `cursor: not-allowed` + `pointer-events: none` 둘 다
- [ ] 폼 필드 `:invalid` 상태에 `color-feedback-danger` + aria-invalid
- [ ] 링크 `:visited` 상태도 정의 (다크 모드에서 보라 편향 제거)
- [ ] 체크박스·토글 `:checked` 상태에 0.15s 트랜지션
- [ ] 드롭다운 열림 시 chevron 180deg 회전 (CSS transform)

**스페이싱**:
- [ ] 버튼 내부: `padding-inline: 1.25x vertical padding` (좌우가 상하보다 넓어야 시각적으로 균형)
- [ ] 아이콘+텍스트 버튼: `gap: 0.5x font-size`
- [ ] 리스트 행 간격: `line-height + 8px` (문단보다 좁게)
- [ ] 카드 내부 패딩이 카드 반지름과 일관 (radius 14px → padding 16–20px)

**모션**:
- [ ] Skeleton pulse와 실제 데이터 fade-in 간 50ms 오버랩 (갑작스런 전환 방지)
- [ ] Drawer 닫힘 시 약간 빠르게 (220ms → 180ms) — 사용자가 기다리지 않음
- [ ] Hover 트랜지션에 `transition-delay: 75ms` — 실수 트리거 방지
- [ ] Focus ring은 트랜지션 없음 (즉시 표시 — 접근성)

**피드백**:
- [ ] 폼 저장 성공 시 체크 아이콘 200ms 표시 후 fade-out
- [ ] 복사 버튼 클릭 시 아이콘 → "복사됨" 텍스트 1.5s 후 복구
- [ ] Optimistic update 롤백 시 Toast에 "복구됨" + 원래 상태 하이라이트 pulse 1회

### 18.2. 읽기 쉬운 수치 표시

| 원시 값 | 표시 |
|---|---|
| `1234567` | `1,234,567` (`toLocaleString`) |
| `3600s` | `1시간` (relative time) |
| `2026-04-22T12:00` | `오늘 오후 12시` / `3일 전` |
| `0.847` | `85%` |
| `10485760 bytes` | `10 MB` |

### 18.3. 리스트/빈 상태 미세 룰

- 리스트 항목 1개만 있을 때 "총 1건" 아닌 **"1건"** 표시 (조사 생략)
- 빈 리스트에서 필터가 적용된 경우 vs 데이터 자체가 없는 경우 **다른 카피**
- 로딩 중에도 **지난 데이터 유지** (깜빡임 방지) — `keepPreviousData: true`

### 18.4. 터치·키보드 공존 디테일

- 터치 디바이스에서 `:hover` 지속되는 문제 → `@media (hover: hover)` 가드
- 키보드 포커스 링은 터치에서 불필요 → `:focus-visible`만 사용
- 모바일 폼에서 `inputmode` 속성 명시 (`numeric`, `email`, `search`)
- iOS 입력 시 16px 미만 폰트 → 자동 줌 발생 → **최소 16px**

---

## 19. 반복 개선 프로토콜 (Iterative Refinement Protocol)

> **GPT-5.4는 한 번에 완벽하지 않다**. 4단계 반복 구조로 품질을 올린다.

### 19.1. 4단계 개선 플로우

```
[Step 1: Initial Generation]
  → 비주얼 테시스 + 콘텐츠 플랜 + 인터랙션 테시스로 초안
  ↓
[Step 2: UX Critique]
  → "이 UI의 UX 문제점을 분석해줘" 프롬프트로 자체 비평
  ↓
[Step 3: Detail Refinement]
  → §18 숨은 디테일 라이브러리 기준으로 마감
  ↓
[Step 4: Audit]
  → §0.5 함정 체크 + §10 리뷰 체크리스트 + §7.3 AI 접근성 감사
```

### 19.2. Step 2용 자체 UX 비평 프롬프트

```markdown
방금 생성한 UI를 다음 기준으로 자체 비평해줘:

1. 시선 흐름: 사용자 눈이 어디서 시작해 어디로 이동하는가? 의도대로인가?
2. 정보 위계: 가장 중요한 것이 가장 크고 밝은가?
3. 액션 발견성: CTA가 명확히 눈에 띄는가? 2차 액션과 혼동되지 않는가?
4. 빈 상태·에러 상태: 모든 상태를 다뤘는가?
5. 모바일 사용성: 엄지로 도달 가능한가? 터치 타겟 44px?
6. 인지 부하: 섹션 수, 카드 수, 색상 수가 §0.2 한계 내인가?

자체 비평 결과를 [문제 / 영향도 / 수정안] 형식으로 5개 이하 출력.
```

### 19.3. Step 3용 마감 프롬프트

```markdown
다음을 순서대로 점검해 수정해줘:

1. §18.1 마이크로 디테일 20선 전부 체크
2. 숫자·시간·파일 크기 포맷팅(§18.2)
3. 모션이 §6.1 타이밍 테이블 내 값인지
4. 모든 텍스트가 `color-text-*` 토큰 사용 중인지
5. Hover는 `@media (hover: hover)` 가드 있는지
```

### 19.4. Step 4용 최종 감사 프롬프트

```markdown
최종 머지 전 검증:

1. §0.5 GPT-5.4 함정 10개 체크 (purple/dark bias, excessive shadow...)
2. §10 디자인 리뷰 체크리스트 전부
3. §7.3 AI 접근성 감사 실행
4. 다크/라이트 양쪽 렌더 확인
5. 모바일 375px 뷰포트 렌더 확인

하나라도 실패하면 Step 2로 돌아가라.
```

### 19.5. 언제 멈추는가?

- Step 4가 전부 통과하면 정지. 추가 "개선" 금지 (over-engineering).
- 사용자가 명시적으로 요청하지 않은 기능·스타일 추가 금지.

---

## 20. 에이전트 프롬프트 템플릿 (Agent Prompt Templates)

> **에이전트에게 작업을 시킬 때 쓰는 복사-붙여넣기 템플릿.** §17 결정 트리와 §18 디테일을 강제로 통과하게 하는 구조.

### 20.1. 컴포넌트 단위 생성 프롬프트

```markdown
## 작업: <ComponentName> 생성

### 컨텍스트
- Surface 타입: [Landing / Dashboard / Directory / Deep Work / Utility / Drawer]
- 사용 화면: [경로들]
- 데이터 shape: [TypeScript interface]

### 비주얼 테시스
- Mood: [§11.1에서 선택]
- Material: [§11.1에서 선택]
- Energy: [§11.1에서 선택]

### 인터랙션 테시스
- 엔트리 모션: [§6.2에서 1개]
- 피드백 모션: [§6.2에서 1개]
- (선택) 주기 모션: [§6.2에서 1개]

### 요구사항
1. 파일 경로: `Docs/08_COMPONENT_SPECIFICATIONS.md §2` 준수
2. Props interface 명시적 export
3. §17 결정 트리 전부 통과
4. §18.1 마이크로 디테일 20선 전부 적용
5. Loading / Empty / Error 상태 모두 처리
6. 모바일 터치 44px 보장

### 금지
- §0.5 함정 10개 전부
- §16 안티패턴 전부
- 팔레트 번호 하드코딩
- 기본 폰트 스택

### 출력
1. 컴포넌트 코드
2. 사용 예시 1개
3. 자가 점검 결과 (§19.4 체크리스트 적용)
```

### 20.2. 화면(Page) 단위 생성 프롬프트

```markdown
## 작업: [라우트] 화면 구현

### 선행 읽기
- `Docs/05_PAGE_SPECIFICATIONS.md` 해당 섹션
- `Docs/08_COMPONENT_SPECIFICATIONS.md` §N 해당 섹션
- `Docs/02_DESIGN_SYSTEM.md` §0, §11–§20

### Surface 판단 (§13.1 플로우 실행)
→ 결과: [Surface 타입]
→ 적용 규칙: [§13.x]

### 내러티브 구조 (§12)
→ Hero / Support / Detail / Final CTA 각각 명시

### 컴포넌트 트리
[`08_COMPONENT_SPECIFICATIONS.md`에서 복사]

### 구현 순서
1. Server Component (데이터 fetch)
2. Layout 골격
3. 각 하위 컴포넌트 조립
4. Loading / Empty / Error 상태
5. Motion 적용 (§14 Motion 매핑 참조)
6. 접근성 (§7)

### 완료 조건
- §19 4단계 반복 개선 전부 통과
- 데스크톱 1440 / 모바일 375 스크린샷 첨부
```

### 20.3. 리팩터링 프롬프트

```markdown
## 작업: [경로] 리팩터링

### 목적
[구체적 이유 — 성능·가독성·접근성]

### 제약
- 시각적 결과물 변경 금지 (visual diff 0)
- 기능 변경 금지
- 테스트 전부 통과 유지

### 우선순위
1. §0.5 함정 제거
2. §16 안티패턴 제거
3. §18 마이크로 디테일 추가

### 금지
- 새 기능 추가
- 범위 벗어난 파일 수정
- 주석 남발 (§Doc의 "주석 없음이 기본")
```

### 20.4. 디자인 반복 개선 프롬프트 (§19 Step 2용)

```markdown
## 작업: [컴포넌트/화면] UX 비평

다음 6개 질문으로 자체 비평:
1. 시선 흐름이 의도대로인가?
2. 정보 위계가 크기·밝기로 명확한가?
3. CTA가 2차 액션과 구분되는가?
4. 빈 상태·에러 상태 모두 다뤘는가?
5. 모바일 엄지 도달 가능 & 44px?
6. §0.2 한계 (서체 2개, 액센트 1개, 섹션 6개) 준수?

각 질문에 [OK/문제/수정안] 출력.
문제 발견 시 수정 코드 포함.
```

---

## 21. 문서 사용 가이드 (How to Use This Document)

### 21.1. 에이전트 로딩 순서

AI 에이전트는 작업 시작 시 본 문서를 **다음 순서로 읽는다**:

1. **§0** — 하드 룰·함정 (가장 먼저, 절대 규칙)
2. **§11–§13** — 비주얼 테시스 + Surface 판단 (작업 맥락 고정)
3. **§17** — 결정 트리 (모호할 때 참조)
4. **§1–§8** — 토큰·컴포넌트·모션 구현 규칙
5. **§14–§15** — 카피·이미지 규칙
6. **§18** — 마감 디테일 체크리스트
7. **§19–§20** — 반복 개선·프롬프트 템플릿
8. **§10 + §7.3** — 머지 전 감사

### 21.2. 사람(개발자) 리뷰어용

PR 리뷰 시 본 문서 체크 순서:

1. §10 리뷰 체크리스트 우선
2. §0.5 GPT-5.4 함정 확인
3. §16 안티패턴 확인
4. §18.1 마이크로 디테일 확인

### 21.3. 문서 갱신 규칙

- 새 컴포넌트 추가 → §5 카탈로그 + `08_COMPONENT_SPECIFICATIONS.md`에 동시 반영
- 새 안티패턴 발견 → §16에 Before/After 추가
- 새 디테일 발견 → §18.1에 추가 (상한 25선)

---

**다음**: [`03_DATABASE_SCHEMA.md`](./03_DATABASE_SCHEMA.md)에서 전체 Drizzle 스키마를 확정한다.
