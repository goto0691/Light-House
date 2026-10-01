# 18. Design System Visual Baseline

> 상태: A+ visual direction 확정, coded interaction QA 전  
> 기준일: 2026-08-12

## 1. 목적과 정본 우선순위

이 문서는 Light House V2의 첫 구현에서 사용할 시각적 기준을 고정한다. 생성 이미지는 화면의 분위기와 정보 위계를 공유하기 위한 reference이며, 수치·상태·접근성의 정본은 이 문서다.

대안 B·C와 비교 review는 [19_DESIGN_ALTERNATIVES_AND_REVIEW.md](./19_DESIGN_ALTERNATIVES_AND_REVIEW.md)를 따른다. 최종 방향은 A+이며 이 문서가 implementation baseline이다.

A+의 조합 규칙:

- A의 warm ivory, forest green, 본문 중심 계층을 기반으로 유지
- B의 `88px` standard·`72px` compact row, tabular date, command hint, selected/focus 분리, field column alignment 채택
- C의 Korean serif는 Record Detail title·읽기 mode·긴 인용에만 선택 적용
- B의 blue primary theme, C의 oxblood primary action·동적 record 순번은 사용하지 않음

충돌 시 우선순위:

1. 데이터·privacy·interaction contract
2. 이 Design System 문서
3. component specification
4. 생성된 raster concept

이미지 안의 오탈자, 임의 icon, 잘못 생성된 spacing을 그대로 구현하지 않는다.

## 2. Canonical Visual References

### Library와 Record Peek

![Library와 Record Peek](./assets/light-house-library-peek-concept-v01.png)

검증 목적:

- 조밀한 목록과 380~440px Peek가 동시에 유지되는가
- warm document surface와 quiet chrome이 구분되는가
- 선택 row, 사용자 본문, 외부 정보의 위계가 맞는가
- sidebar가 type taxonomy가 아니라 안정된 과업을 보여주는가

### Record Detail, Editing, Evidence

![Record Detail과 Evidence](./assets/light-house-record-evidence-concept-v01.png)

검증 목적:

- body가 gutter와 Inspector보다 우선하는가
- field와 source를 양방향으로 이해할 수 있는가
- selection toolbar가 글쓰기 흐름을 방해하지 않는가
- AI 해석과 외부 정보가 사용자 본문을 압도하지 않는가

### Mobile Capture Flow

![Mobile Capture Flow](./assets/light-house-mobile-capture-flow-concept-v01.png)

검증 목적:

- 이미지와 메모를 분류 없이 바로 저장할 수 있는가
- template assistance가 기존 글을 가리지 않고 선택적으로 열리는가
- source commit과 background AI processing이 분리되어 보이는가
- 공란·AI 대기 상태가 실패나 미완성으로 느껴지지 않는가

## 3. 확정한 시각 성격

이름은 `따뜻한 편집형 워크벤치`다.

- 편집물의 따뜻함: ivory surface, 긴 글에 맞는 행간, 장식 없는 여백
- 전문 도구의 속도: 조밀한 목록, 분명한 focus, keyboard-first Peek
- 증거 기반 AI: sparkle가 아니라 origin label과 source navigation
- 조용한 구조: border와 alignment로 구분하고 shadow·card를 남발하지 않음
- 인간의 저자성: 사용자 문장과 명시값이 가장 강하고 AI 해석은 가장 낮음

## 4. Foundation Tokens

### Color

| semantic token | value | 사용 |
| --- | --- | --- |
| `surface.app` | `#F6F3EC` | 전역 app background |
| `surface.document` | `#FFFDF8` | editor, reading surface |
| `surface.panel` | `#FBF9F3` | sidebar, Inspector, sheet |
| `surface.hover` | `#F0F1EB` | hover |
| `surface.selected` | `#E8EEE9` | selected row·source |
| `text.primary` | `#20241F` | 본문·title·주 label |
| `text.secondary` | `#50574F` | metadata·helper |
| `text.muted` | `#6E746B` | 낮은 우선순위 설명 |
| `border.subtle` | `#DED8CB` | section·row separator |
| `border.strong` | `#A8A99F` | active control outline |
| `accent.primary` | `#2F5B45` | primary action·selected edge |
| `accent.primaryHover` | `#244A38` | hover·pressed |
| `accent.warm` | `#B47B44` | rating·회상 강조 |
| `state.info` | `#3E6252` | 중립 processing·정보 |
| `state.warning` | `#8A5A18` | 충돌·확인 필요 |
| `state.danger` | `#9B3D32` | source 저장 실패·복구 위험 |
| `state.success` | `#2F5B45` | source commit 완료 |

규칙:

- origin 종류를 색만으로 구별하지 않고 항상 text label을 사용한다.
- `AI 해석` 전용 보라색·gradient·sparkle token을 만들지 않는다.
- danger는 공란이나 AI 무응답에 사용하지 않는다.
- dark theme는 위 semantic token과 1:1 대응을 만든 뒤 별도 visual QA를 통과해야 한다.

### Typography

기본 font stack:

```css
font-family: Pretendard, "Noto Sans KR", system-ui, -apple-system, sans-serif;
```

읽기 모드에서만 사용자가 serif를 선택할 수 있다.

```css
font-family: "Noto Serif KR", Georgia, serif;
```

| role | size / line-height | weight |
| --- | --- | ---: |
| Record title | `32 / 42px` | 650 |
| Page title | `26 / 34px` | 650 |
| Section title | `18 / 26px` | 600 |
| Body large | `18 / 31px` | 400 |
| Body | `16 / 27px` | 400 |
| UI default | `14 / 21px` | 450 |
| UI strong | `14 / 21px` | 600 |
| Metadata | `13 / 19px` | 450 |
| Origin label | `12 / 18px` | 500 |

- long-form body의 desktop measure는 `680~760px`다.
- 본문은 16px 미만으로 내리지 않는다.
- label은 12px 미만으로 내리지 않는다.
- 한글 자간은 기본값을 우선하고 title에서만 최대 `-0.02em`을 허용한다.

### Spacing, Size, Shape

- base grid: `4px`
- spacing scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`
- desktop page gutter: `24~32px`
- mobile page gutter: `16px`
- touch target: 최소 `44×44px`
- icon: 기본 `18px`, navigation `20px`, stroke `1.75px`
- icon renderer: 기존 dependency인 `lucide-react`를 사용하되 DB·AI에는 library 이름이 아닌 semantic `icon_key`를 저장한다. filled/outlined style을 한 화면에서 섞지 않는다.
- type·template·saved view의 상속·fallback은 [20_ICON_AND_VIEW_EXTENSION_CONTRACT.md](./20_ICON_AND_VIEW_EXTENSION_CONTRACT.md)를 따른다.
- control radius: `8px`
- panel·sheet radius: `12px`
- small chip radius: `6px`; 의미 없는 pill 금지
- border: 기본 `1px solid border.subtle`
- shadow: popover·dialog·temporary overlay에만 사용

### Focus

모든 interactive element는 색 변화와 별개로 외곽 focus를 가진다.

```css
box-shadow:
  0 0 0 2px #FFFDF8,
  0 0 0 4px #2F5B45;
```

collection row는 외곽 ring과 왼쪽 `3px` selected edge를 함께 사용할 수 있다. focus를 `outline: none`으로 제거하지 않는다.

## 5. Layout Metrics

### Wide Library · 1180px 이상

```text
224 sidebar | main min 560 | Peek clamp(380, 28vw, 440)
top utility 64
collection toolbar 72
default row 88
```

- Peek를 열어 main이 520px보다 좁아지면 overlay drawer로 전환한다.
- Library 기본 density는 `standard 88px`; `compact 72px`, `comfortable 104px`를 허용한다.
- row는 card shadow 없이 separator로 이어진다.

### Wide Record Detail

```text
64 rail | Evidence 220~240 | fluid center | Inspector 320~360
body measure 680~760
top utility 64
```

- Evidence와 Inspector가 동시에 열려 body measure가 640px 미만이면 Evidence를 overlay Peek로 바꾼다.
- 편집 시작 시 Evidence와 Inspector는 기본 닫힘이다.
- reading·review task에서만 user preference를 복원한다.

### Compact · 768~1179px

- navigation `64px` rail
- Peek·Inspector·Evidence는 persistent column이 아니라 drawer·overlay
- 본문과 collection은 최소 `16px` side gutter 유지
- 최대 두 개의 overlay를 겹치지 않는다.

### Mobile · 320~767px

- top app bar `56px`
- bottom navigation `64px + safe area`
- content gutter `16px`
- bottom sheet 최대 높이 `calc(100dvh - 56px)`
- Capture save action은 keyboard visual viewport 위에 유지
- record preview를 별도로 만들지 않고 full route 사용

## 6. Component Visual Contracts

### Navigation

- filled primary는 `새 기록` 하나만 사용한다.
- 현재 route는 pale selected surface, leading edge, weight 변화로 표시한다.
- nested saved view는 bullet 또는 indent를 사용하되 card로 만들지 않는다.
- navigation count는 Review의 high-impact item에만 허용한다.

### Collection Row

우선순위:

1. title
2. user snippet
3. type·date
4. user highlights
5. origin-aware derived highlights

- metadata chip은 최대 3개다.
- selected와 keyboard focus는 별도 상태지만 동시에 표현 가능해야 한다.
- image가 없는 record를 placeholder illustration로 채우지 않는다.

### `RecordPeekPane`

- pane header와 close는 sticky
- 본문 excerpt 4~6줄
- user explicit field가 external·AI field보다 먼저
- footer keyboard hint는 desktop에만 표시
- sensitive·restricted는 `previewPolicy` projection만 렌더링

### Editor와 Selection Toolbar

- document surface에 외곽 card border를 두지 않는다.
- toolbar는 selection 위 `8px` 간격에 배치하고 본문을 가리지 않으면 아래로 flip한다.
- toolbar action은 text 또는 검증된 icon+label로 제공한다.
- Focus Mode는 body measure를 바꾸지 않고 주변 chrome만 숨긴다.

### Evidence와 Inspector

- selected field와 source는 같은 pale surface를 공유하지만 연결은 label·focus로도 설명한다.
- `원문에서 추출`, `이미지에서 읽음`, `외부 출처`, `AI 해석`은 inline text다.
- Inspector section은 border separator를 사용하고 반복 card를 사용하지 않는다.
- exact backlink는 title, date, context 1~3줄, origin을 보여준다.

### Mobile Capture

- title field보다 body와 attachment가 먼저다.
- `일반`과 `AI 정리 켜짐`은 상단에서 항상 확인 가능하다.
- assistance는 bottom sheet이며 본문·첨부·scroll을 보존한다.
- 공란은 neutral placeholder이고 error border를 사용하지 않는다.
- receipt는 source commit을 먼저 말하고 AI processing은 neutral progress로 분리한다.

## 7. 공통 상태 문법

| 상태 | 표현 |
| --- | --- |
| hover | `surface.hover`, cursor, action reveal |
| focus | 이중 focus ring과 semantic focus order |
| selected | `surface.selected`, leading edge, text weight |
| pressed | accent 또는 neutral surface 한 단계 진하게 |
| disabled | opacity만 낮추지 않고 원인 helper 제공 |
| loading | layout을 유지하는 inline progress; skeleton 남용 금지 |
| source committed | check + 저장 시각 |
| AI processing | neutral spinner + 원본 저장 완료 문구 |
| proposed | `확인 필요` text + action |
| disputed | `서로 다른 근거` text + evidence access |
| locked | lock icon + `내가 고정함` |
| error | source loss·복구 위험에만 danger |

## 8. Motion

- 기본 duration: `140ms`; drawer·sheet: `180ms`
- easing: 진입 `cubic-bezier(0.2, 0.8, 0.2, 1)`, 종료 `ease-in`
- Peek는 collection과 공간 관계를 설명하는 이동만 사용한다.
- 저장 완료는 confetti·scale bounce 없이 text와 check state로 표현한다.
- `prefers-reduced-motion`에서는 transform을 제거하고 opacity 또는 즉시 전환한다.
- animation 때문에 focus target과 scroll anchor가 변하지 않아야 한다.

## 9. Raster 시안에서 의도적으로 수정할 부분

- 생성 이미지의 모든 한국어·icon은 실제 component에서 정확한 copy와 `lucide-react` icon으로 교체한다.
- Library 시안의 row 높이는 실제 기본값 `88px`로 더 조밀하게 만든다.
- mobile receipt의 bottom navigation은 route 복귀가 필요한 경우에만 유지하고 source commit 순간에는 focus를 receipt action에 둔다.
- rating의 amber star는 사용자 평점에만 사용하고 AI confidence에는 사용하지 않는다.
- food image는 예시 attachment일 뿐 장소 record의 필수 cover가 아니다.

## 10. Coded Prototype Gate

다음 세 prototype을 같은 token과 component primitive로 구현한다.

1. Wide Library + `RecordPeekPane` + `ViewDisplayMenu`
2. Record Detail + editor selection + `EvidenceGutter` + Inspector
3. Mobile image Capture + assistance sheet + source commit receipt

통과 조건:

- 320·768·1180·1440px에서 overflow와 가려짐 없음
- light theme AA contrast; focus indicator 식별 가능
- keyboard로 Peek, evidence, editor, sheet 완료
- 한국어 IME composition 중 global shortcut 오작동 0건
- Peek·Evidence·mode 전환 뒤 selection·scroll·focus 복원
- normal·sensitive·restricted projection snapshot 통과
- source commit과 AI processing을 사용자 5명 중 5명이 올바르게 구분
- raster 시안과 달라도 이 문서의 정보 위계와 상태 문법을 유지

이 gate를 통과하면 Design System을 `v1`로 승격하고, 이후 화면은 새 시각 방향 탐색이 아니라 같은 primitive의 조합으로 구현한다.
