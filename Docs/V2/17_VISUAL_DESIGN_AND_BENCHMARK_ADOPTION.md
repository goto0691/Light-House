# 17. Visual Design Direction and Benchmark Adoption

> 상태: 방향성 확정, token·high-fidelity prototype 검증 전  
> 기준일: 2026-08-12

## 1. 목적

이 문서는 2026년 웹·웹앱 디자인 흐름과 실제 지식·집필 제품의 장점을 Light House V2의 시각 문법과 컴포넌트 계약으로 바꾼다. 벤치마크 제품 하나를 복제하지 않고 과업별로 장점을 분리해 흡수한다.

핵심 방향은 다음과 같다.

> 따뜻한 편집형 워크벤치: 글쓰기 화면은 편집물처럼 차분하고, 보관함은 전문 도구처럼 빠르며, AI는 전면의 캐릭터가 아니라 출처가 보이는 구조화 계층으로 동작한다.

이 문서의 결정은 다음 문서에 구체화된다.

- 작성: [10_AUTHORING_AND_DOCUMENT_LIFECYCLE.md](./10_AUTHORING_AND_DOCUMENT_LIFECYCLE.md)
- 레코드·AI 필드: [11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md](./11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md)
- 컴포넌트: [13_COMPONENT_ARCHITECTURE_AND_INTERACTIONS.md](./13_COMPONENT_ARCHITECTURE_AND_INTERACTIONS.md)
- 심리적 안전: [14_PSYCHOLOGICAL_UI_UX_SPEC.md](./14_PSYCHOLOGICAL_UI_UX_SPEC.md)
- IA·반응형: [15_INFORMATION_ARCHITECTURE_AND_RESPONSIVE_NAVIGATION.md](./15_INFORMATION_ARCHITECTURE_AND_RESPONSIVE_NAVIGATION.md)
- visual token·layout 수치: [18_DESIGN_SYSTEM_VISUAL_BASELINE.md](./18_DESIGN_SYSTEM_VISUAL_BASELINE.md)

## 2. 트렌드 판단

브랜드·마케팅 사이트의 3D, 실험적 navigation, 대형 모션, maximalism을 업무용 개인 아카이브에 그대로 적용하지 않는다. Light House는 다음 흐름만 선택적으로 채택한다.

- desktop-class web app
- component-driven layout
- editorial typography와 human craft
- 기능적 motion과 즉시 반응
- 접근성·keyboard-first interaction
- AI가 click 수를 줄이되 근거·통제권을 유지하는 intent-based interaction

배제하거나 제한할 것:

- 3D·WebGL 장식
- 전면적 Liquid Glass와 높은 transparency
- 모든 영역을 card로 나누는 Bento layout
- 실험적·숨겨진 navigation
- AI를 뜻하는 보라색 gradient와 sparkle 남용
- chat-first interface
- 장식적 scroll animation과 자동 전환
- 사용자가 예측할 수 없는 navigation 개인화

## 3. 벤치마크 채택 매트릭스

| 제품 | 장점 | Light House 채택 | 채택하지 않는 것 |
| --- | --- | --- | --- |
| Linear | 목록을 떠나지 않는 Peek, command search, 빠른 keyboard 이동 | `RecordPeekPane`, 결과 선택 preview, Space·화살표·Esc 계약 | 기술 제품의 차가운 시각 톤, hidden-only shortcut |
| Readwise Reader | 평면 Library 위의 강력한 filtered view, keyboard reading, 본문 옆 annotation | `ViewDisplayMenu`, `SaveViewAction`, `EvidenceGutter`, 검색 근거 이동 | 읽을거리 triage 중심 IA |
| Capacities | object·property·template·multi-view, 문맥이 보이는 backlink, object dashboard | `MentionContextCard`, `RelatedViewModule`, 양방향 relation context | 쓰기 전에 type을 고르는 흐름, type sidebar 폭증 |
| Tana | 같은 데이터의 여러 view state, pinned field, live query, optional field | field 우선순위가 있는 `FacetBar`, view별 display state, 안정 field table edit | outline-first UI, 사용자가 schema를 관리해야 하는 흐름 |
| Craft | Markdown shortcut, selection toolbar, focus mode, Quick Open, block link | `SelectionToolbar`, intent-based slash menu, Focus Mode, quick-open result group | 문서 안 card 장식 남용, 본문보다 강한 material 효과 |
| mymind | 저장 먼저·정리 나중, visual memory, Serendipity, Top of Mind | `VisualMemoryGrid`, opt-in `RediscoveryDeck`, 사용자 고정 목록 | 자동 분류를 설명하지 않는 black box, 장문·구조 기능 축소 |

## 4. Visual Direction v0.1

### 색상

| token | provisional value | 용도 |
| --- | --- | --- |
| `surface.app` | `#F6F3EC` | 앱 배경 |
| `surface.document` | `#FFFDF8` | 문서와 주요 작업면 |
| `text.primary` | `#20241F` | 본문과 주요 UI |
| `text.muted` | `#6E746B` | 보조 설명 |
| `border.subtle` | `#DED8CB` | 조용한 구분선 |
| `accent.primary` | `#2F5B45` | 선택·주 action |
| `accent.warm` | `#B47B44` | 평점·회상·부분 강조 |
| `state.warning` | 별도 contrast 검증 | 충돌·확인 필요 |
| `state.danger` | 별도 contrast 검증 | 원본 저장 실패·복구 위험 |

색은 의미를 보조할 뿐 유일한 상태 신호가 아니다. `ValueOriginMark`, selected, proposed, disputed, locked 상태는 text·shape·icon을 함께 사용한다. 위 값은 high-fidelity prototype과 WCAG contrast 검증 전 provisional이다.

### Typography

- UI와 기본 편집: `Pretendard`, system sans fallback
- 제목·인용·선택적 읽기 모드: `Noto Serif KR` 계열 검증
- 본문 기본 폭: desktop 680~760px
- 본문은 card border 안에 가두지 않음
- UI label과 metadata는 serif를 사용하지 않음
- 사용자가 읽기 모드에서 sans·serif를 선택할 수 있으나 Capture 기본값은 sans

### Shape와 elevation

- 기본 radius 8~12px 범위에서 primitive별 확정
- pill은 filter·status처럼 의미가 있을 때만 사용
- 일반 panel은 1px border를 우선하고 shadow는 floating overlay에 제한
- document canvas에는 반복 card·shadow를 사용하지 않음
- glass material은 command overlay처럼 일시적인 최상위 surface에서도 가독성 검증 후 제한적으로만 허용

### Motion

- 일반 상태 전환 120~180ms 범위에서 prototype 검증
- motion은 focus 이동, drawer 관계, 저장 상태 변화를 설명할 때만 사용
- scroll 위치와 선택 상태를 바꾸는 장식 animation 금지
- `prefers-reduced-motion`에서는 drawer·peek·reorder motion을 축소하거나 제거

### Theme

- 초기 정체성은 warm light theme
- dark theme는 token parity와 긴 글 contrast를 검증한 뒤 제공
- dark theme가 P0 prototype gate에 포함되지만 초기 브랜드 표현을 dark-first로 만들지 않음

## 5. 핵심 컴포넌트 채택

### 5.1 `RecordPeekPane`

기존 `RecordPreviewDrawer`를 대체하는 responsive composition이다.

- desktop wide: Library·Search 오른쪽 380~440px pane
- compact desktop: overlay drawer
- mobile: preview를 만들지 않고 full record route
- `Space`: 선택 record preview 고정·해제
- `Space` hold: 누르는 동안 임시 preview
- `↑/↓`: collection 선택과 preview 동기화
- `Enter`: 전체 record 열기
- `Esc`: pane을 닫고 원래 collection item으로 focus restore
- 현재 selection, scroll anchor, filter, layout을 route·view state에 보존

preview 내용:

1. 제목·주 유형·대표 날짜
2. 안전한 본문 snippet 4~6줄
3. highlight 최대 3개
4. Search에서는 `InclusionReason`
5. 관련 record 소수
6. 전체 record 열기

### 5.2 `OmniSearch` quick open과 command result

하나의 overlay 안에서 결과를 구분한다.

1. 최근·고정·자주 연 기록
2. 기록·개체·사건
3. 저장 뷰·template·setting destination
4. `새 기록`, `현재 보기를 저장` 같은 명령
5. 전체 검색으로 이동

선택 결과는 `RecordPeekPresentation` 또는 destination preview를 오른쪽에 보여준다. 모바일 `/search`는 full page이며 preview 대신 결과 route를 연다. 자연어 질의를 chat transcript로 만들지 않는다.

### 5.3 `ViewDisplayMenu`와 `SaveViewAction`

Library와 Search에서 다음 표시 상태를 한 곳에서 조절한다.

- layout
- sort
- group
- visible fields
- density
- date axis

active filter가 있으면 `현재 조건을 내 목록으로 저장`을 노출한다. 저장된 view는 자동 pin하지 않으며 사용자가 별도로 sidebar pin을 선택한다. 같은 query라도 layout별 display state를 보존한다.

### 5.4 `EvidenceGutter`와 `EvidencePeek`

desktop document margin에 원문·이미지·녹취·외부 출처 anchor를 조용히 표시한다.

- `FieldRow` 선택 → 해당 source span·image region·timecode highlight
- evidence anchor 선택 → 관련 Inspector field 강조
- Search match와 evidence origin은 다른 shape·label 사용
- 편집 모드에서는 기본 접힘
- mobile은 full-screen `EvidenceViewer`
- sensitive·restricted는 `previewPolicy`가 허용한 경우에만 표시

`EvidencePopover`는 짧은 요약을 유지하고, source로 이동하는 동작은 `EvidencePeek`가 담당한다.

### 5.5 `MentionContextCard`와 `RelatedViewModule`

`Connections`는 관련 제목 목록이 아니라 정확한 문맥을 보여준다.

`MentionContextCard`:

- source record 제목·날짜
- 직접 언급 또는 사건 문맥 1~3줄
- relation predicate
- user-linked·source-extracted·AI-interpreted origin
- 원문 위치로 이동
- 관계 수정·제거

`RelatedViewModule`:

- entity·event 상세에 방문, 관련 글, 사진, 함께한 사람 같은 collection projection을 배치
- module별 list·timeline·visual grid 등 허용된 layout 사용
- server `RecordPresentation`이 module을 결정하고 사용자는 접기·순서·개인 view preference만 바꿈
- MVP에서 사용자가 object dashboard schema를 직접 설계하지 않음

### 5.6 `SelectionToolbar`와 intent-based slash menu

`MarkdownCaptureEditor`와 `MarkdownDocumentEditor`가 공유한다.

선택 toolbar:

- 굵게·기울임·highlight
- heading·quote
- URL·내부 record·entity link
- 선택 영역을 새 기록으로 만들기
- image caption·alt text

slash menu는 raw block name보다 사용자 의도를 우선한다.

```text
/제목  /인용  /이미지  /파일  /표
/기록 연결  /사람 연결  /장소 연결  /떠올림 단서
```

Focus Mode는 sidebar·Inspector를 숨기되 save state를 유지하고, 종료 후 cursor·selection·scroll을 복원한다.

### 5.7 `VisualMemoryGrid`

image-rich collection에서만 제공하는 `RecordCardGrid` variant다.

- 원본 image ratio 유지
- title·date는 항상 보이고 type·secondary action은 hover와 keyboard focus에서 추가 표시
- 음식·책·게임·운동 screenshot을 같은 crop으로 강제하지 않음
- OCR text를 image 위에 덮지 않음
- matching image region은 작은 accessible marker로 표시
- 기본 `/library` layout은 list로 유지

### 5.8 `RediscoveryDeck`

`탐색 > 다시 보기`의 opt-in module이다. 전역 Home·notification을 만들지 않는다.

- 한 번에 record 하나
- `열기`, `나중에`, `다시 보여주지 않기`
- surfacing reason 표시
- normal record만 기본 대상
- sensitive는 사용자가 별도 허용했을 때만, restricted는 항상 제외
- 사람의 감정·의도·성격·관계 해석을 reason이나 추천 조건으로 사용하지 않음
- dismiss한 record·reason 조합은 재제안하지 않음
- 날짜, 현재 검색 문맥, 사용자 고정 주제, 오래 열지 않음 등을 설명 가능한 조건으로 사용

`Top of Mind`에 해당하는 기능은 새 dashboard가 아니라 사용자가 직접 고정하는 `요즘 자주 보는 기록` saved view로 구현한다.

### 5.9 `ExplainableSuggestionCard`

AI가 만드는 template·saved view·type·field evolution 제안의 공통 anatomy다.

1. 무엇을 제안하는가
2. 왜 제안했는가
3. 어떤 record에서 관찰했는가
4. 적용하면 무엇이 바뀌는가
5. 한 번 사용·계속 사용·수정·관심 없음

confidence percentage와 sparkle을 품질 점수처럼 사용하지 않는다. 어떤 suggestion도 자동 active·pin·navigation 생성으로 이어지지 않는다.

## 6. IA 영향

새 전역 목적지는 만들지 않는다.

| 기능 | 위치 |
| --- | --- |
| Peek | Library·Search의 responsive preview surface |
| View display·save | Collection header |
| Evidence gutter | Record Detail body margin·Inspector |
| Context backlink | Record Inspector `Connections` |
| Visual memory | Collection layout option |
| Rediscovery | Explore의 `다시 보기` module |
| Top of Mind | user-pinned saved view |
| Suggestion | 관련 Library·Template·Registry 관리 surface |

## 7. 구현 단계

### P0 prototype

1. `RecordPeekPane`
2. preview가 결합된 `OmniSearch`
3. `ViewDisplayMenu`와 `SaveViewAction`
4. `EvidenceGutter`·`EvidencePeek`
5. `MentionContextCard`
6. `SelectionToolbar`와 Focus Mode

### P1 private beta

1. `VisualMemoryGrid`
2. `RediscoveryDeck`
3. `ExplainableSuggestionCard`를 saved view·type suggestion에 확장
4. stable field의 table inline edit
5. `RelatedViewModule` 개인 표시 설정

### 이후

- 사용자가 직접 구성하는 object dashboard
- graph canvas 중심 navigation
- 출판용 theme
- motion-rich brand experience

## 8. 수용 기준

- Peek에서 collection route·filter·scroll·focus를 잃지 않음
- keyboard와 pointer 모두 같은 preview·open 기능에 접근 가능
- filter 적용 후 2번 이하의 동작으로 saved view 생성
- 비사용자 핵심값에서 2번 이하의 동작으로 직접 evidence 확인
- backlink에서 source의 정확한 문맥으로 이동 가능
- Focus Mode 종료 후 cursor·selection·scroll 복원
- visual grid가 image 없는 record를 빈 장식 card로 만들지 않음
- Rediscovery에서 unexpected sensitive content 노출 0건
- suggestion의 자동 active·pin·navigation 생성 0건
- 320·768·1180·1440px에서 본문 우선순위 유지
- 색상 없이 focus·selected·origin·proposed·disputed 상태 구분

## 9. 공식 참고 자료

- [Linear Peek](https://linear.app/docs/peek)
- [Linear Custom Views](https://linear.app/docs/custom-views)
- [Readwise Filtered Views](https://docs.readwise.io/reader/docs/faqs/filtered-views)
- [Readwise Highlights, Tags, and Notes](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)
- [Capacities Product](https://capacities.io/product)
- [Capacities Backlinks](https://docs.capacities.io/reference/backlinks)
- [Tana Views](https://outliner.tana.inc/learn/features/views)
- [Tana Fields](https://outliner.tana.inc/learn/features/fields)
- [Craft Quick Open](https://support.craft.do/en/organize-and-find/search/quick-open)
- [Craft Links and Backlinks](https://support.craft.do/en/organize-and-find/linking)
- [mymind](https://mymind.com/)
- [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
