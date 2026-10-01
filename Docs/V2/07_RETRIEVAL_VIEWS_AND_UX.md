# 07. Retrieval, Views, and Core UX

## 1. 목표

V2의 가치는 구조화 자체가 아니라 다시 찾는 데 있다. 저장된 데이터는 네 가지 방식으로 회수한다.

1. 정확한 구조 필터
2. 전문 검색
3. 관계·사건 탐색
4. 의미 검색

자연어 검색은 이 네 방식을 조합하는 query planner다. 벡터 유사도만으로 모든 질문에 답하지 않는다.

## 2. 기본 정보 구조

### 전역 내비게이션

```text
전역 목적지
보관함        모든 기록과 내 목록
탐색          장소·작품·인물·사건·주제의 연결
확인할 내용   사용자 판단이 필요한 고영향 항목

전역 action
새 기록       무엇이든 입력
검색           키워드·자연어·정밀 검색

utility
처리 상태      업로드·OCR·분석·색인
설정           AI·데이터·보안·내보내기
```

기존 Dashboard, Action Hub, Vault, PRM, Life Ops의 5대 도메인은 V2 기본 내비게이션으로 사용하지 않는다.

Desktop은 왼쪽 sidebar와 상단 OmniSearch, mobile은 `보관함 · 검색 · 새 기록 · 탐색 · 더보기` bottom navigation을 사용한다. Template, 내 목록, 처리 상태, 설정은 별도 1차 목적지가 아니라 Library 하위 또는 mobile `더보기`에서 접근한다. 자세한 route와 responsive 규칙은 [15_INFORMATION_ARCHITECTURE_AND_RESPONSIVE_NAVIGATION.md](./15_INFORMATION_ARCHITECTURE_AND_RESPONSIVE_NAVIGATION.md)를 따른다.

### 기본 진입 화면

Dashboard 대신 `/library`, 사용자 UI의 `보관함 > 모든 기록`을 기본으로 한다. 최근 기록은 기본 정렬이며 별도 Home widget 화면을 만들지 않는다. `새 기록`은 sidebar 또는 mobile bottom navigation에서 어디서나 연다.

## 3. Capture UX

### 입력 화면

- 빈 텍스트 영역
- 이미지 붙여넣기
- 파일·오디오 추가
- 여러 첨부 순서 변경
- 저장 버튼
- 저장 버튼 가까이의 `저장 후 AI 정리` toggle
- 본문보다 앞서지 않는 `도움받아 쓰기` 진입점

`빈 기록`은 별도의 선택 chip이 아니라 기본 상태이며 진입 즉시 본문에 focus한다. 사용자가 `도움받아 쓰기`에서 템플릿을 선택한 경우에만 core cue 3~5개와 선택 필드를 assistance rail 또는 bottom sheet에 표시한다. 템플릿은 분류를 강제하지 않으며 [12_ADAPTIVE_CAPTURE_TEMPLATES.md](./12_ADAPTIVE_CAPTURE_TEMPLATES.md)의 공란·AI 보완 규칙을 따른다.

### 저장 직후

```text
원본 저장 완료
AI가 정리 중입니다.

[원문 열기] [백그라운드 처리 보기]
```

사용자는 즉시 다른 화면으로 이동하거나 앱을 닫을 수 있다.

### 처리 완료 요약

```text
장소 방문·리뷰로 정리했습니다.

모모식당 연남점
방문일  2026-08-10
평점    4.5 / 5
메뉴    가지튀김
추천    데이트, 조용한 대화

주소와 지점 정보를 확인했습니다.
[상세] [수정] [원본]
```

## 4. Document Detail

상세 화면은 탭으로 글을 가르지 않고 본문과 구조 정보를 동시에 담는 범용 레코드 골격을 사용한다.

### Main

- 제목과 본문
- 첨부 이미지
- 집필·사건 날짜
- 핵심 필드 최대 6개
- 관련 글

### 접을 수 있는 Inspector

- `Facts`: 유형, 필드 값, 사용자 평가, AI 주제·색인, 외부 사실
- `Connections`: 관련 개체·사건·문서와 정확한 언급 문맥
- `Sources`: 원문 span, 이미지 영역, 녹취 타임코드, 외부 URL, 계산식
- `History`: revision, 값 이력, AI 실행·스키마 버전

일반 사용에서는 본문과 핵심값만 보인다. confidence 숫자는 반복하지 않지만 사용자 입력이 아닌 값에는 의미적 출처 label을 표시한다. desktop에서는 `EvidenceGutter`가 field와 원문 span·이미지 영역·녹취 timecode를 양방향으로 연결하고, mobile에서는 full-screen `EvidenceViewer`를 연다. `Connections`의 `MentionContextCard`는 관련 제목만 나열하지 않고 source record의 직접 문맥과 relation origin을 보여준다. 상세 컴포넌트와 AI 필드 배치는 [11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md](./11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md)를 따른다.

## 5. 개체 상세

### 장소

- 현재 기본 정보
- 내가 방문한 사건 타임라인
- 방문별 사진·메뉴·평가
- 관련 글
- 외부 정보 확인 시각

### 작품

- 작품 메타데이터
- 관람·플레이·독서 사건
- 리뷰·에세이·인용
- 시간에 따른 평가 변화

### 인물

- 사용자가 확인한 이름·별칭
- 함께한 사건
- 대화·녹취
- 사용자가 확인한 약속·결정
- 관련 글

인물 화면은 AI가 추론한 성격, 의도, 관계 상태를 누적 profile로 만들지 않는다. AI가 발견한 관계 패턴은 기간과 근거 기록 수를 한정한 `AI 해석`으로만 제안한다.

### 사건

- 언제·어디서·누구와
- 관련 원문과 첨부
- 평가·결정·후속 사건
- 근거

## 6. 검색 계층

### Layer 1. Typed Filter

가장 정확하고 설명 가능한 검색이다.

```text
event.type = place_visit
property.user_rating >= 4
event.occurred_at between ...
```

### Layer 2. Relation Traversal

```text
Person --participated_in--> Event
Event --occurred_at--> Place
Document --about--> Work
```

### Layer 3. Full-text Search

- 사용자 본문
- raw/normalized OCR
- 녹취
- 제목·요약
- 개체 이름·별칭

### Layer 4. Semantic Search

- 주제·정서·개념
- 정확한 단어가 기억나지 않는 질의
- 비슷한 글과 관련 글

구조 조건을 만족한 결과 안에서 의미 점수를 적용하는 방식을 우선한다.

## 7. 자연어 Query Plan

자연어를 SQL로 직접 생성하지 않고 고정된 중간 계약으로 변환한다.

```json
{
  "intent": "list",
  "target_object_kind": "document",
  "type_filters": ["game_review"],
  "entity_filters": [
    {"kind": "work", "subtype": "game"}
  ],
  "event_filters": [],
  "property_filters": [
    {"field": "user_rating", "operator": "exists"}
  ],
  "relation_filters": [
    {"predicate": "assesses", "target_kind": "work"}
  ],
  "date_filter": null,
  "full_text": null,
  "semantic_query": null,
  "sort": [{"field": "written_at", "direction": "desc"}],
  "limit": 50,
  "confidence": 0.96
}
```

서버는 허용된 filter·operator만 실행한다.

### 날짜 해석

“작년”, “군대에 있을 때”, “최근” 같은 표현은 다음 순서로 처리한다.

1. 정확한 캘린더 범위
2. 사용자가 정의한 생애 기간·프로젝트 기간
3. 관련 사건 범위
4. 의미 검색 보조

## 8. 자동 목록 정의

### 내가 방문한 장소

```text
target: place entity
condition: related place_visit event exists
sort: latest visit desc
```

장소가 글에 언급되기만 한 경우는 제외한다.

### 리뷰를 남긴 게임

```text
target: game entity
condition:
  related review document exists
  OR user_rating exists
  OR explicit evaluation fields exist
sort: latest assessment desc
```

표지 사진만 올린 게임은 제외한다.

### 독후감

```text
target: document
condition:
  type includes book_review OR reading_reflection
  related work subtype = book
exclude:
  quotation_only = true
```

### 특정 인물과 있었던 사건

```text
target: event
condition: person participated_in event
sort: occurred_at asc
```

### 운동 기록

```text
target: event or document
condition: type descends from activity/workout
available facets: activity_type, date, duration, distance, heart_rate
```

## 9. Saved View DSL

저장 뷰는 UI 상태 문자열이 아니라 검증 가능한 query plan으로 저장한다.

```json
{
  "view_key": "date_places",
  "name": "데이트하기 좋은 장소",
  "icon_key": "type.place",
  "target": {"kind": "entity", "type": "place"},
  "where": [
    {"event_exists": {"type": "place_visit", "location_is_target": true}},
    {"property_contains": {"field": "recommended_for", "value": "date"}}
  ],
  "sort": [{"field": "user_rating", "direction": "desc"}],
  "display": {
    "layout": "cards",
    "group_by": null,
    "visible_fields": ["user_rating", "latest_visit"],
    "density": "comfortable"
  }
}
```

현재 `saved_views.filter_state` 기반은 V2 DSL 저장소로 확장할 수 있다.

query 조건과 display state는 구분한다. 같은 query를 list·visual grid·timeline으로 보아도 membership은 같으며, view별 layout·sort·group·visible field·density 상태를 보존한다. active filter가 있으면 `SaveViewAction`으로 `현재 조건을 내 목록으로 저장`할 수 있다. 저장만으로 sidebar pin이 생기지 않으며 pin은 별도 사용자 action이다.

`icon_key`는 membership과 무관한 presentation metadata다. AI와 사용자는 semantic catalog 안에서만 선택하며 unknown key는 saved view를 깨뜨리지 않고 generic collection icon으로 대체한다. type별 기본 collection·record preset과 context module 계약은 [20_ICON_AND_VIEW_EXTENSION_CONTRACT.md](./20_ICON_AND_VIEW_EXTENSION_CONTRACT.md)를 따른다.

## 10. Collection interaction과 display state

### `ViewDisplayMenu`

Library와 Search에서 다음 항목을 한 menu에서 조절한다.

- layout: list, cards, visual, timeline, map, calendar, table 가운데 현재 결과가 지원하는 것
- sort와 group
- visible field
- density
- timeline·calendar의 date axis

현재 type의 active field와 사용자가 자주 사용하는 stable field를 먼저 보여주고 candidate field 전체를 toolbar에 나열하지 않는다. stable field의 table inline edit는 private beta 이후 허용하며 `AI 해석`, `proposed`, `disputed`, high-risk field는 Review나 `FieldEditorSheet`에서만 수정한다.

### `RecordPeekPane`

desktop Library·Search는 collection을 떠나지 않고 선택 record를 읽는다.

- `Space`: preview 고정·해제
- `Space` hold: 누르는 동안 임시 preview
- `↑/↓`: 선택과 preview 동기화
- `Enter`: full record route
- `Esc`: preview close와 collection focus restore
- Search에서는 `InclusionReason`을 preview 안에 표시
- selection, filter, layout·group·visible fields·density, scroll anchor를 보존

wide에서는 380~440px right pane, compact에서는 drawer, mobile에서는 full record route를 사용한다. `RecordPeekPane`은 privacy `previewPolicy`를 우회해 본문을 직접 자르지 않는다.

## 11. 신규 유형과 자동 뷰

유형 상태에 따른 노출:

```text
candidate: 원문·상세·검색에서 `새 분류`로 확인 가능
observed: Library filter 후보로 사용하되 navigation에는 표시하지 않음
active: Explore의 type facet과 저장 뷰 조건에 표시
user_pinned: `보관함 > 내 목록`에 최대 5개 바로가기
```

새 운동 기록 한 건이 곧바로 메뉴 하나를 추가하지 않는다. 신규 유형은 의미 충돌이나 병합 판단이 필요할 때만 `확인할 내용`으로 보내며, 단순 관찰·승격 후보는 별도 registry 관리 흐름에서 다룬다.

반복 검색·filter pattern에서 saved view 후보를 만들 수 있지만 `ExplainableSuggestionCard`로 근거와 예상 결과를 보여준 뒤 사용자가 저장해야 한다. 자동 생성 view는 navigation이나 sidebar에 자동 pin하지 않는다.

## 12. Review Queue

확인 필요 항목은 종류별로 나눈다.

- 개체 후보 선택
- OCR 숫자 충돌
- 날짜 불명확
- 문서 분할 제안
- 신규 유형·필드 승격
- 기존 유형·필드 병합
- 외부 정보 충돌
- 낮은 신뢰도 값
- 처리 실패 재시도

우선순위:

1. 잘못 연결되면 다른 데이터에 영향을 주는 개체 식별
2. 사용자 명시값과 충돌하는 값
3. 검색 목록에 영향을 주는 날짜·유형
4. 스키마 정리
5. 장식적 메타데이터

## 13. 수정과 학습

사용자가 값을 수정하면 다음을 수행한다.

1. 새 `user_locked` 값 생성
2. 이전 AI 값을 superseded로 표시
3. 수정 원인 선택은 선택 사항
4. 비슷한 오류가 반복되면 레지스트리·프롬프트 개선 후보 생성
5. 다른 기록에 자동 적용하기 전 사용자에게 범위를 확인

한 번의 수정이 근거 없이 전체 데이터에 전파되지 않는다.

## 14. 결과 설명

각 검색 결과는 왜 포함되었는지 짧게 설명할 수 있어야 한다.

```text
포함 이유:
- 2025-04-12 방문 기록이 있음
- 사용자 평점 4.5
- ‘데이트하기 좋다’고 직접 작성함
```

의미 검색 결과라면 일치 주제나 문장 근거를 보여준다.

결과 설명은 card를 과밀하게 만들지 않는다. 일반 Library에서는 숨기고 Search card·`RecordPeekPane`에서 우선 표시한다. 결과에 사용된 비사용자 값은 origin을 유지하며 설명을 선택하면 관련 field 또는 evidence로 이동한다.

## 15. 안전한 재발견

재발견은 별도 Home이나 notification feed가 아니라 `탐색 > 다시 보기`의 opt-in `RediscoveryDeck`으로 제공한다.

```text
2년 전 오늘 남긴 게임 감상

이 기록을 보여준 이유
- 최근 비슷한 주제의 글을 작성함
- 2024년 이후 열어보지 않음

[열기] [나중에] [다시 보여주지 않기]
```

규칙:

- 한 번에 record 하나
- normal record만 기본 대상
- sensitive는 사용자가 resurfacing을 별도 허용한 경우에만 포함
- restricted는 항상 제외
- 사람의 감정·의도·성격·관계 해석을 조건이나 reason으로 사용하지 않음
- reason을 항상 표시
- dismiss한 record·reason 조합을 재제안하지 않음
- 자동 알림과 강제 회고 prompt를 만들지 않음

이미지가 충분한 collection은 `VisualMemoryGrid`를 선택할 수 있다. 원본 ratio를 유지하고 OCR text를 image 위에 덮지 않으며 기본 `/library`는 list를 유지한다. `요즘 자주 보는 기록`은 새 dashboard가 아니라 사용자가 직접 pin하는 saved view다.

## 16. 빈 상태와 실패 상태

- 아직 유형이 없어도 `모든 기록`은 동작
- 외부 보강 대기 중에도 사용자 글은 표시
- 검색 인덱스 장애 시 DB 기본 검색 fallback
- 의미 검색 장애 시 구조·FTS 결과 유지
- 뷰 계산 실패 시 정의와 오류를 표시하고 정본 데이터는 유지

## 17. Export UX

내보내기는 다음 묶음을 제공한다.

```text
export.zip
├── documents/*.md
├── metadata/*.json
├── attachments/originals/*
├── entities.json
├── events.json
├── relations.json
├── registry/types.json
├── registry/fields.json
├── templates/definitions.json
└── manifest.json
```

Markdown에는 사람이 읽을 수 있는 front matter와 관련 원본 파일 경로를 포함한다.
템플릿은 문서의 정본이 아니므로 별도 JSON으로 내보내며 각 문서 metadata에는 사용한 template version ID만 기록한다.
