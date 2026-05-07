# 04. Property Control UI/UX Refactor Plan

작성일: 2026-05-03  
상태: Phase 6 원본 컬럼 정리 핵심 흐름 완료, 고급 presentation 옵션 대기  
대상: Light House 전체 도메인의 속성, 컬럼, 원본 레코드 표시/편집 경험

## 0. 진행 기록

### 2026-05-03

- `PropertyDefinition`, `PropertyGroupDefinition` 기반의 TypeScript property registry를 추가했다.
- zettel의 타입, 문서 종류, 상태, 카테고리, 태그, 별칭, 검토, 출처 속성을 registry로 옮겼다.
- media, people, daily, project의 핵심 속성 정의 초안을 registry에 추가했다.
- `PropertyPanel`을 추가하고 `ZettelPropertiesPanel`의 내부 렌더링을 공통 컴포넌트로 교체했다.
- `SourcePropertyInspector`를 추가하고 `ZettelSourcePropertiesPanel`의 원본 속성 적용 UI를 공통 컴포넌트 기반으로 교체했다.
- `/vault/zettels`에서 실제 zettel 선택 후 속성 패널 렌더링과 브라우저 콘솔을 확인했다.
- media 속성 registry를 확장하고, media drawer의 수작업 필드들을 `PropertyPanel`로 교체했다.
- media drawer에도 `SourcePropertyInspector`를 붙여 원본 속성 적용 경로를 zettel 외 도메인에서 검증하기 시작했다.
- media 기본 saved view와 필터 라벨을 한국어 제품 언어로 정리했다.
- `/vault/media?detail=media:{id}`에서 media drawer 속성 패널 렌더링과 브라우저 콘솔을 확인했다.

### 2026-05-04

- habits, workouts, career를 property registry의 정식 entity type으로 추가했다.
- 습관, 운동, 커리어 생성 화면의 직접 input 묶음을 공통 `PropertyPanel` 기반 속성 입력으로 교체했다.
- 습관/운동/커리어 목록과 상세 화면에 `PropertyPanel` 기반 속성 편집 패널을 붙였다.
- `/api/life-ops/habits/[habitId]/properties`, `/api/life-ops/workouts/[workoutId]/properties`, `/api/life-ops/career/[careerId]/properties`를 추가해 canonical 속성을 한 번에 저장하게 했다.

## 1. 목적

Light House는 Notion 기반 자료를 보존하면서 canonical 데이터 모델로 재분류하는 시스템이다. 이 구조 자체는 맞지만, 현재 UI는 원본 속성, canonical 속성, 저장된 뷰, 필터, 컬럼 표시가 화면마다 다르게 구현되어 있다. 그 결과 사용자는 "이 속성이 어디서 왔는지", "어떤 속성을 수정해야 하는지", "목록에서 어떤 컬럼을 볼지", "가져온 지저분한 컬럼을 어떻게 숨기거나 매핑할지"를 매번 새로 배워야 한다.

이 문서는 zettel만 고치는 것이 아니라 전체 시스템에서 컬럼과 속성을 보여주고 컨트롤하는 공통 방법을 정의한다. 구현에 바로 들어가기 전에 현재 구조의 강점과 단점을 정리하고, 단계별 리팩토링 계획을 세운다.

## 2. 현재 시스템 진단

### 2.1 데이터 모델

| 영역 | 현재 상태 | 판단 |
| --- | --- | --- |
| Source Layer | `source_documents`, `source_document_properties`, `source_document_relations`가 원본 레코드, 원본 속성, 원본 관계를 보존한다. | 강점이다. 원본을 버리지 않는 구조는 유지해야 한다. |
| Canonical Layer | `zettels`, `media_logs`, `people`, `daily_logs`, `projects`, `tasks` 등 도메인 테이블이 제품용 필드를 가진다. | 도메인별 편집에는 좋지만, 속성 UI 정의가 각 화면에 흩어져 있다. |
| View Layer | `saved_views`가 `domain`, `scope`, `filter_state`, `sort_state`, `view_key`를 저장한다. | 필터와 정렬은 저장하지만 컬럼 표시, 필드 순서, 밀도, 패널 레이아웃은 저장하지 못한다. |
| Review/QA | `migration_review_items`, `entity_links`, source relations가 변환 검토 근거를 담는다. | 데이터는 있으나 사용자가 속성 매핑을 다루는 워크벤치가 아직 부족하다. |

핵심 결론은 "원본 보존은 이미 좋고, 속성 제어 계층이 없다"이다. 지금 필요한 것은 새 도메인 테이블을 급하게 늘리는 것이 아니라, 기존 source/canonical/view 레이어 위에 속성 정의와 표시 정책을 올리는 일이다.

### 2.2 UI 컴포넌트

| 컴포넌트/화면 | 현재 역할 | 문제 |
| --- | --- | --- |
| `SourceDocumentPanel` | 연결된 원본 레코드와 원본 속성을 보여준다. | `Record Properties` 같은 영어 라벨이 남아 있고, 주요 속성 목록이 하드코딩되어 있다. 타입도 vault mock에 묶여 있어 전역 컴포넌트로 보기 어렵다. |
| `SourceTracePanel` | 원본 속성, relation, canonical mapping, review item을 감사 화면으로 보여준다. | QA에는 유용하지만 일반 사용자의 속성 편집 경험과 분리되어 있다. 일부 테이블 헤더가 영어이고, 관계 확정 뒤 fallback으로 reload를 사용한다. |
| `ZettelPropertiesPanel` | zettel 쓰기/읽기에서 canonical 속성을 한국어 그룹으로 편집한다. | 좋은 방향이지만 zettel 전용이다. 같은 Field/Section/Chip/Select 패턴이 media, people, daily에 재사용되지 않는다. |
| `ZettelSourcePropertiesPanel` | 가져온 속성을 zettel 필드로 적용한다. | 원본 속성 매핑 UX의 파일럿으로 좋다. 그러나 target 목록, 추론, normalizer가 zettel에만 묶여 있다. |
| `FilterBar` | 검색, select, multi, tag, sort를 공통 처리한다. | 필터에는 범용성이 있으나 컬럼 선택, 필드 표시, 저장된 뷰 편집과 연결되어 있지 않다. |
| `SavedViewTabs` | 저장된 뷰를 탭으로 보여준다. | onSelect가 없는 경우 Link 기반 이동이 발생한다. 모든 도메인에서 즉시 전환, 편집, 복제, 컬럼 저장을 같은 UX로 제공하지 않는다. |
| Media/People/Daily/Action 화면 | 각 화면이 자체 `Field`, `select`, `input`, `SourceDocumentPanel`을 만든다. | 속성 접근 방식, 라벨, 타입 처리, 원본 표시 위치가 도메인마다 다르다. |

### 2.3 기존 Docs와의 정합성

기존 문서들은 이미 Source Layer, Canonical Layer, View Layer 방향을 제시한다. 특히 `01_TO_BE_SCHEMA_BLUEPRINT.md`는 원본 속성을 버리지 말고 source properties로 보존하라고 하고, `02_TO_BE_UI_UX_SPECIFICATION.md`는 Source Inspector, RecordTable, column visibility를 언급한다.

이번 기획은 그 방향을 더 구체화한다. 핵심은 "원본 레코드를 보존하되, 사용자에게는 canonical-first UI를 제공하고, 원본 속성은 인스펙터와 매핑 워크벤치에서 통제하게 한다"이다.

## 3. 주요 문제점

1. Canonical 속성과 원본 속성이 시각적으로 섞인다.

   현재 어떤 화면에서는 canonical 필드가 본문 옆에 있고, 어떤 화면에서는 원본 속성이 같은 카드 안에 나온다. 사용자는 "수정 가능한 내 속성"과 "보존된 원본 증거"를 구분하기 어렵다.

2. 속성 정의가 화면마다 하드코딩되어 있다.

   zettel의 문서 종류, 상태, 출처 신뢰도, media의 상태/타입, people의 관계 상태와 친밀도 등이 각 컴포넌트 안에 흩어져 있다. 라벨 번역, 옵션, 정렬, 표시 여부를 한곳에서 통제하지 못한다.

3. 지저분한 원본 컬럼을 숨기거나 매핑하는 전역 방법이 없다.

   `source_document_properties`는 모든 원본 속성을 보존하지만, 어떤 속성이 중요하고 어떤 속성이 노이즈인지 사용자가 전역으로 표시/숨김/매핑하지 못한다.

4. 저장된 뷰가 "조회 조건"까지만 기억한다.

   현재 `saved_views`는 검색어, 필터, 정렬을 저장한다. 하지만 사용자가 기대하는 saved view는 보이는 컬럼, 컬럼 순서, density, pin, 그룹, 상세 패널 레이아웃까지 포함한다.

5. zettel에만 좋은 패턴이 먼저 생겼다.

   zettel 읽기/쓰기에는 속성 패널, 원본 속성 적용, 저장된 뷰 편집 흐름이 생기고 있다. 그러나 media, people, daily, projects는 같은 원칙을 공유하지 않아 시스템 전체 일관성이 떨어진다.

6. 쓰기 화면에서 속성 접근이 안정적이지 않다.

   글을 쓰거나 레코드를 편집할 때 속성이 화면 안에 묻히거나 도메인마다 다른 위치에 있다. "본문/내용"과 "속성"의 역할 분리가 일관적이지 않다.

7. 불필요한 전환과 애니메이션이 화면 신뢰도를 낮춘다.

   뷰 전환, 목록 선택, 관계 확정, 저장 후 반영 같은 작업은 즉시 상태 갱신이 우선이다. 장식적 hover/transition이나 full reload는 데이터 관리 도구에서는 피로감을 만든다.

## 4. 제품 원칙

### 4.1 Canonical First, Source Always Available

일반 화면의 기본값은 canonical 속성이다. 사용자가 실제로 수정하고 앞으로 사용할 필드가 먼저 보여야 한다. 원본 속성은 삭제하거나 감추는 것이 아니라 "원본 인스펙터"에서 언제든 확인하고 적용/매핑할 수 있게 한다.

### 4.2 속성은 데이터가 아니라 제품 언어로 보여준다

Notion 컬럼명, legacy export 필드명, source database 이름은 증거로는 중요하지만 기본 UI 언어가 되어서는 안 된다. 사용자에게는 "문서 종류", "상태", "출처 신뢰도", "다음 검토일", "관계", "태그"처럼 제품 언어로 보이고, 원본명은 보조 정보로 둔다.

### 4.3 모든 도메인은 같은 속성 문법을 쓴다

zettel, media, people, daily, project, task, asset, place는 서로 다른 내용이지만 속성 UI 문법은 공유해야 한다.

- 텍스트: 한 줄 또는 여러 줄
- 선택: 단일 select, segmented control
- 다중 선택: chip input
- 날짜: date input + 원본 날짜 표시
- 숫자/점수: stepper 또는 slider
- 관계: relation picker + evidence
- URL: 링크 열기와 입력을 분리
- 원본 속성: read-only value + canonical apply

### 4.4 저장된 뷰는 화면 상태를 기억한다

저장된 뷰는 필터와 정렬만이 아니라 목록 컬럼, 컬럼 순서, density, pin, 그룹 상태까지 기억해야 한다. "기본 뷰"는 복제해서 편집 가능하게 하고, 사용자가 만든 뷰는 이름/조건/컬럼을 모두 수정할 수 있어야 한다.

### 4.5 즉시 전환, 최소 애니메이션

목록 선택, 탭 전환, saved view 전환, 필터 조정은 reload 없이 client state와 URL history로 처리한다. 애니메이션은 상태 이해에 필요한 곳에만 둔다.

필요한 micro interaction:

- 저장/실패/삭제 완료 toast
- relation resolve 후 행 상태 변화
- loading skeleton 또는 pending opacity
- 포커스 링, 선택 상태, hover affordance

줄일 micro interaction:

- 카드마다 반복되는 장식적 scale/translate
- 데이터가 바뀌지 않는데 발생하는 과한 transition
- 탭 전환마다 full page navigation처럼 느껴지는 움직임
- 중요하지 않은 badge/카드의 과도한 hover 효과

## 5. 제안 아키텍처

### 5.1 Property Registry

먼저 DB 마이그레이션을 바로 추가하지 말고 TypeScript registry로 시작한다. 안정화 후 DB 테이블로 승격한다.

```ts
type PropertyDefinition = {
  key: string;
  entityType: "zettel" | "media" | "person" | "daily_log" | "project" | "task" | "asset" | "place";
  field: string;
  label: string;
  description?: string;
  group: "identity" | "classification" | "status" | "dates" | "relations" | "source" | "review" | "domain";
  valueType: "text" | "longText" | "select" | "multiSelect" | "date" | "number" | "boolean" | "url" | "relation";
  options?: Array<{ value: string; label: string }>;
  defaultVisibleInList?: boolean;
  defaultVisibleInDetail?: boolean;
  editable?: boolean;
  sourceAliases?: string[];
};
```

역할:

- 도메인별 canonical 필드의 한국어 라벨과 타입을 한곳에서 관리한다.
- `PropertyPanel`, `PropertyField`, `ColumnControl`, `SourcePropertyInspector`가 같은 정의를 사용한다.
- zettel에 이미 있는 option/normalizer를 registry 기반으로 옮긴다.
- media, people, daily, projects가 각자 `Field`를 만들지 않게 한다.

### 5.2 Source Property Mapping Registry

원본 속성은 보존하되, 사용자에게는 매핑 상태를 제공한다.

```ts
type SourcePropertyMapping = {
  sourceType: string;
  sourceDatabase?: string;
  sourcePropertyName: string;
  sourcePropertyType?: string;
  targetEntityType: string;
  targetPropertyKey?: string;
  status: "mapped" | "ignored" | "needs_review";
  confidence?: number;
  normalizer?: string;
};
```

초기에는 코드/JSON config로 두고, 이후 `property_mappings` 테이블을 검토한다.

사용자가 할 수 있어야 하는 일:

- 원본 컬럼을 canonical 속성에 매핑
- 노이즈 컬럼을 숨김 처리
- 같은 이름의 원본 컬럼을 여러 source database에서 다르게 처리
- confidence가 낮은 매핑을 검토
- 원본 값을 특정 레코드에 1회 적용하거나, 같은 규칙으로 batch 적용

### 5.3 View Column Config

저장된 뷰는 다음 UI 상태를 가져야 한다.

```ts
type ViewPresentationState = {
  columns: Array<{
    propertyKey: string;
    width?: number;
    pinned?: "left" | "right";
    visible: boolean;
  }>;
  density: "comfortable" | "compact";
  groupBy?: string;
  detailLayout?: "reader" | "drawer" | "split";
};
```

초기 구현은 `saved_views.sort_state.presentation` 또는 `filter_state.presentation`에 임시 저장할 수 있다. 다만 장기적으로는 `saved_view_columns` 또는 `view_column_configs` 테이블이 더 명확하다.

### 5.4 공통 컴포넌트

| 컴포넌트 | 역할 |
| --- | --- |
| `PropertyPanel` | 도메인별 canonical 속성을 그룹으로 보여주고 편집한다. |
| `PropertyField` | registry의 `valueType`에 따라 input/select/chip/date/relation을 렌더링한다. |
| `PropertyRail` | 쓰기/상세 화면의 우측 속성 레일. 모바일에서는 drawer/accordion으로 전환한다. |
| `SourcePropertyInspector` | 원본 속성을 mapped/unmapped/hidden으로 나눠 보여주고, canonical apply를 제공한다. |
| `ColumnControl` | 목록/테이블에서 컬럼 표시, 순서, pin, density를 편집한다. |
| `SavedViewManager` | 모든 도메인에서 기본 뷰 복제, 이름 변경, 조건 덮어쓰기, 컬럼 저장, 삭제를 제공한다. |
| `RelationField` | 사람, zettel, media, project, place 등의 관계 선택/생성/해제를 통일한다. |
| `SourceBadge` | 원본 레코드 존재, mapping confidence, review 상태를 짧게 보여준다. |

## 6. UX 설계

### 6.1 목록 화면

목록 화면은 기본적으로 다음 구조를 쓴다.

1. `SavedViewTabs`
2. `FilterBar`
3. `ColumnControl`
4. `RecordList` 또는 `RecordTable`
5. 선택 시 오른쪽/아래 상세 패널

기본 원칙:

- 처음부터 상세를 강제로 열지 않는다. 목록이 먼저 보이고, 사용자가 선택하면 상세가 열린다.
- 저장된 뷰를 바꿔도 reload 없이 목록 상태가 즉시 바뀐다.
- 컬럼 설정은 뷰에 저장된다.
- 모바일에서는 table 대신 list item/card로 전환하되, 표시할 핵심 속성은 같은 column config에서 가져온다.

### 6.2 상세/쓰기 화면

상세와 쓰기는 같은 정보 구조를 공유한다.

| 영역 | 역할 |
| --- | --- |
| Main Body | 글, 리뷰, 설명, 본문, 노트처럼 길게 쓰는 내용 |
| Property Rail | 상태, 분류, 날짜, 태그, 관계, 출처 같은 구조화 속성 |
| Source Inspector | 원본 레코드와 원본 속성 확인/적용 |
| Context Rail | 관계 지도, backlinks, 연결 근거 |

쓰기에서 속성 접근을 쉽게 하기 위한 정책:

- 데스크톱에서는 속성 레일이 sticky로 유지된다.
- 모바일에서는 상단의 "속성" 버튼으로 drawer를 연다.
- 필수/자주 쓰는 속성은 상단 compact group에 둔다.
- 원본에서 가져온 값이 있으면 해당 필드 아래에 "원본 값 적용" affordance를 제공한다.
- source inspector는 기본 접힘 상태지만, 가져온 속성이 많은 레코드에서는 "검토 필요 n개"를 표시한다.

### 6.3 원본 속성 인스펙터

원본 속성은 다음 4개 그룹으로 보여준다.

| 그룹 | 설명 |
| --- | --- |
| Applied | 이미 canonical 필드에 반영된 속성 |
| Suggested | 매핑 후보가 있고 적용 가능한 속성 |
| Unmapped | 아직 의미를 판단하지 못한 원본 속성 |
| Hidden/Noise | 보존은 하지만 일반 UI에서 숨기는 속성 |

각 행의 기본 정보:

- 원본 속성명
- 번역/표준 라벨 후보
- 원본 타입
- 값
- 매핑 대상
- confidence
- 작업: 적용, 매핑 변경, 숨김, 검토 항목 생성

### 6.4 컬럼 컨트롤

컬럼 컨트롤은 모든 collection 화면에서 동일해야 한다.

사용자 작업:

- 컬럼 표시/숨김
- 순서 변경
- 좌측 pin
- compact/comfortable density 선택
- 현재 뷰에 저장
- 다른 뷰로 복제

컬럼 후보는 다음 순서로 제안한다.

1. 해당 도메인의 canonical 기본 속성
2. relation count, tag, source status 같은 공통 속성
3. source property 중 사용자가 표시 허용한 속성
4. debug/source-only 속성은 advanced 모드에서만 표시

## 7. 도메인별 적용 방향

### 7.1 Zettel / Library

현재 가장 앞서 있는 파일럿이다.

해야 할 일:

- `ZettelPropertiesPanel`을 `PropertyPanel`로 추출한다.
- `ZettelSourcePropertiesPanel`을 `SourcePropertyInspector`로 일반화한다.
- zettel 문서 종류/상태/출처 신뢰도/검토 주기 옵션을 registry로 옮긴다.
- 저장된 뷰 관리에 column config를 붙인다.
- 목록/상세 split 구조는 유지하되, property rail이 다른 도메인과 같은 컴포넌트를 쓰게 한다.

### 7.2 Media

현재 media는 타입, 상태, creator, platform, genre, rating, dates를 drawer 내부 Field로 직접 렌더링한다.

해야 할 일:

- game/screen/book 공통 필드와 타입별 필드를 registry로 분리한다.
- `mediaType`별로 보이는 속성 그룹을 다르게 한다.
- media saved view에 컬럼 설정을 추가한다.
- 원본 media 컬럼을 Source Inspector로 검토하고 batch mapping 가능하게 한다.

### 7.3 People / PRM

현재 person drawer는 이름, 그룹, 상태, Dunbar layer, 친밀도, 연락 주기, 생일, 연락처를 직접 Field로 렌더링한다.

해야 할 일:

- 사람 identity/contact/relationship/memory/source 그룹을 정의한다.
- 관계 상태, layer, intimacy, contact cadence를 typed field로 만든다.
- SourceDocumentPanel을 Source Inspector로 대체한다.
- Person 360의 source lens와 property rail을 연결한다.

### 7.4 Daily / Life Ops

daily는 journal, meditation, gratitude, entries, source document가 혼재한다.

해야 할 일:

- daily_log와 daily_log_entry의 속성 정의를 분리한다.
- entry kind에 따라 보이는 필드를 바꾼다.
- 날짜, 기분, 에너지, 사람 언급, source review 상태를 컬럼으로 제어한다.
- 본문성 텍스트와 구조화 속성을 명확히 분리한다.

### 7.5 Projects / Tasks

project/task는 상태, 중요도, 에너지, due date, 관계가 action workflow와 연결된다.

해야 할 일:

- project/task 공통 property definition을 만든다.
- Kanban column과 saved view column을 구분한다.
- task drawer도 PropertyRail을 사용한다.
- source relation evidence를 task relation field와 연결한다.

### 7.6 Assets / Places / Career / Workouts / Gifts

보조 도메인은 한 번에 깊게 리팩토링하지 않는다. registry 기반 read-only property display부터 붙이고, 이후 편집 필드를 교체한다.

## 8. 단계별 실행 계획

### Phase 0. 인벤토리 고정

목표: 현재 필드를 잃지 않고 registry 초안을 만든다.

- schema의 canonical 필드를 도메인별 목록으로 정리한다.
- source property 이름 빈도를 추출한다.
- 현재 화면의 하드코딩 옵션을 수집한다.
- 영어 라벨과 source-specific 라벨 목록을 만든다.

완료 기준:

- 도메인별 canonical property list가 존재한다.
- 원본 속성 상위 노이즈/중요 컬럼 목록이 존재한다.
- 어떤 화면이 어떤 속성을 보여주는지 추적 가능하다.

### Phase 1. TypeScript Property Registry

목표: DB 변경 없이 UI 정의를 한곳으로 모은다.

- `apps/web/src/lib/properties/`에 registry 타입과 도메인 정의를 추가한다.
- zettel option/label/normalizer를 registry로 이동한다.
- media/person/daily/project의 핵심 필드를 read-only registry로 등록한다.

완료 기준:

- zettel 속성 라벨과 옵션이 registry에서 나온다.
- 다른 도메인도 최소한 표시용 definition을 가진다.

### Phase 2. 공통 PropertyPanel 파일럿

목표: zettel에서 검증된 속성 패턴을 공통 컴포넌트로 바꾼다.

- `PropertyPanel`, `PropertyField`, `PropertySection`을 만든다.
- zettel 쓰기 화면을 공통 컴포넌트로 교체한다.
- 기존 UI와 기능이 동일하게 동작하는지 확인한다.

완료 기준:

- zettel 속성 편집이 공통 컴포넌트로 동작한다.
- 기존 저장/수정/검토 필드가 회귀하지 않는다.

### Phase 3. SourcePropertyInspector 일반화

목표: zettel 전용 원본 속성 적용 UI를 전역화한다.

- `ZettelSourcePropertiesPanel`의 display, type formatting, target selection, apply flow를 분리한다.
- target 후보는 registry의 `sourceAliases`와 mapping config로 추론한다.
- media/person/daily에서도 같은 inspector를 표시한다.

완료 기준:

- zettel 외 최소 1개 도메인에서 원본 속성 적용이 가능하다.
- 원본 속성 표시 라벨이 한국어 우선으로 정리된다.
- 숨김/검토/적용 상태를 구분해서 보여준다.

### Phase 4. ColumnControl과 Saved View 확장

목표: 저장된 뷰가 컬럼 상태까지 기억하게 한다.

- `ColumnControl`을 만든다.
- library/zettel 목록에 먼저 적용한다.
- `saved_views` payload에 presentation state를 저장한다.
- 기본 뷰는 복제해서 편집 가능하게 유지한다.

완료 기준:

- 사용자가 zettel 목록 컬럼을 표시/숨김/순서 변경할 수 있다.
- 현재 컬럼 상태를 저장된 뷰에 저장하고 다시 불러온다.
- 뷰 전환 시 reload 없이 반영된다.

### Phase 5. 도메인 확산

목표: media, people, daily, projects의 속성 UI를 같은 문법으로 맞춘다.

권장 순서:

1. Media
2. People
3. Daily
4. Projects/Tasks
5. Assets/Places/Career/Workouts/Gifts

완료 기준:

- 각 도메인의 주요 상세/쓰기 화면이 `PropertyPanel` 또는 `PropertyRail`을 사용한다.
- 각 도메인의 collection 화면에 `ColumnControl`이 있다.
- source document 표시는 `SourceDocumentPanel` 대신 `SourcePropertyInspector`/`SourceTracePanel` 역할로 정리된다.

### Phase 6. Mapping Workbench

목표: 지저분한 source 컬럼을 전역으로 정리한다.

- source database별 property 목록을 보여준다.
- mapped/ignored/needs_review 상태를 편집한다.
- 낮은 confidence 매핑을 검토한다.
- batch apply를 지원하되 원본 데이터는 절대 삭제하지 않는다.

완료 기준:

- 사용자가 원본 컬럼을 전역적으로 숨기거나 canonical 필드에 매핑할 수 있다.
- mapping 변경은 이후 새 import와 기존 source inspector에 반영된다.
- migration review item과 연결된다.

## 9. 데이터 마이그레이션 제안

초기에는 DB 마이그레이션보다 코드 registry를 우선한다. 이후 실제 사용 패턴이 안정되면 아래 테이블을 검토한다.

| 후보 테이블 | 목적 |
| --- | --- |
| `property_definitions` | 사용자/워크스페이스 단위로 속성 라벨, 타입, 그룹, 표시 정책을 저장 |
| `source_property_mappings` | source property에서 canonical property로 가는 매핑 규칙 저장 |
| `saved_view_columns` | saved view별 컬럼 표시, 순서, pin, width 저장 |
| `property_layouts` | 상세/쓰기 화면의 속성 그룹 순서, 접힘 상태, density 저장 |

단, source preservation 테이블은 유지한다. 원본 속성은 삭제하지 않고 표시/매핑 정책만 별도 저장한다.

## 10. 수용 기준

이 리팩토링은 다음 조건을 만족해야 한다.

- 모든 주요 canonical 필드는 property definition을 통해 라벨, 타입, 그룹이 결정된다.
- zettel뿐 아니라 media, people, daily, project/task에서도 같은 속성 패널 문법을 쓴다.
- 저장된 뷰는 필터, 정렬, 컬럼 표시 상태를 함께 저장한다.
- 기본 뷰는 직접 수정 대신 복제해서 편집 가능한 뷰로 만들 수 있다.
- 원본 속성은 Source Inspector에서 mapped/suggested/unmapped/hidden으로 구분된다.
- 일반 UI는 제품 언어를 사용하고, 원본/Notion식 컬럼명은 보조 정보로만 노출한다.
- 목록 선택, 뷰 전환, 필터 조정, relation resolve는 full reload 없이 반영된다.
- 장식적 micro interaction보다 데이터 상태 변화와 피드백이 우선된다.

## 11. 리스크와 방지책

| 리스크 | 방지책 |
| --- | --- |
| 과도한 추상화로 각 도메인 특성이 사라짐 | registry는 공통 렌더링을 위한 메타데이터로 한정하고, 도메인별 override를 허용한다. |
| DB 마이그레이션이 너무 빨라짐 | TypeScript registry 파일럿 후 실제 사용 패턴이 확인되면 테이블화한다. |
| 원본 속성을 실수로 덮어씀 | source layer는 read-only 보존 원칙을 유지하고, apply는 canonical 필드에만 patch한다. |
| saved view payload가 비대해짐 | 초기에는 presentation state를 제한된 shape으로 저장하고, 커지면 별도 table로 분리한다. |
| 컬럼 설정 UI가 복잡해짐 | 기본 모드는 표시/숨김/순서만 제공하고, pin/width/source property는 advanced로 둔다. |
| source property 수가 많아 성능 저하 | 상위 속성만 기본 로드하고, raw value 검색/전체 목록은 lazy fetch한다. |

## 12. 바로 다음 작업

1. `apps/web/src/lib/properties/`에 property registry 타입과 zettel/media/person/daily/project 초안 정의를 만든다.
2. zettel 옵션과 라벨을 registry로 옮긴다.
3. `ZettelPropertiesPanel`을 `PropertyPanel` 기반으로 교체한다.
4. `ZettelSourcePropertiesPanel`을 `SourcePropertyInspector`로 추출한다.
5. zettel 목록에 `ColumnControl`을 붙이고 saved view에 presentation state를 저장한다.
6. media drawer를 두 번째 적용 대상으로 삼아 zettel 전용 설계가 아닌지 검증한다.
7. source mapping workbench는 파일럿 2개 도메인 이후 구현한다.

이 순서가 좋은 이유는 현재 zettel이 이미 가장 많은 UX 개선을 품고 있기 때문이다. zettel을 공통 컴포넌트의 출발점으로 삼되, media에서 바로 검증해 "zettel에만 맞는 추상화"가 되는 것을 막는다.

## 13. 진행 기록

### 2026-05-03

완료:

- `PropertyPanel`, `SourcePropertyInspector`, property registry 타입을 만들고 zettel 쓰기/읽기 속성 UI를 공통 컴포넌트로 교체했다.
- zettelkasten 읽기 화면은 목록을 먼저 보여주고 선택 시 본문을 여는 구조로 바꾸었고, 뷰/필터/선택 전환은 URL 상태를 `router.replace`로 갱신해 full reload 없이 반영되도록 정리했다.
- zettel 목록에 컬럼 표시/숨김/순서 변경과 저장된 뷰 편집 흐름을 붙였다.
- media drawer에 공통 속성 패널과 원본 속성 inspector를 적용했고, media 목록/기본 뷰의 영어 라벨을 한국어 제품 언어로 정리했다.
- people/person 도메인에 property registry를 추가하고 PRM drawer의 기본 정보 입력을 공통 `PropertyPanel`로 교체했다.
- PRM drawer와 원본 Notion 속성 영역에 `SourcePropertyInspector`를 붙여 이름, 그룹, 상태, 연락 주기, 생일, 연락처, 메모류를 canonical 속성으로 직접 적용할 수 있게 했다.
- PRM 목록, 필터, 저장 뷰, 선물/그래프/연락 필요 패널, 공통 태그의 주요 영어 표시값을 한국어 라벨로 정리했다.
- task 도메인에 property registry와 task form/payload 헬퍼를 추가했다.
- Action Hub task drawer와 task workspace의 상태, 우선순위, 에너지, 마감일을 공통 `PropertyPanel`로 편집하고 `/api/action-hub/tasks/[taskId]/properties`에서 한 번에 저장할 수 있게 했다.
- Action Hub 보드/목록/캘린더/Inbox의 상태 필터, 컬럼명, 메타 라벨, 링크 전환을 한국어 라벨과 `scroll: false` 기반 전환으로 정리했다.
- project 도메인에 별도 property registry를 추가하고, registry의 기존 inline project 정의가 실제 데이터 필드와 어긋나 있던 부분을 제거했다.
- Action Hub project snapshot/mock/server 모델에 상태, 설명, 목표일을 노출하고 `/api/action-hub/projects/[projectId]/properties`에서 canonical project 속성을 저장할 수 있게 했다.
- project 속성 패널을 칸반, 목록, 캘린더 뷰에 공통으로 붙이고 편집 중인 로컬 입력이 스냅샷 갱신에 덮이지 않도록 dirty 상태를 보호했다.
- Action Hub 프로젝트 홈, 카드, 헤더의 종류/상태/카운트/전환 라벨을 한국어 제품 언어로 정리하고 필터 해제 시 상태가 남지 않도록 수정했다.
- 공통 `FilterBar`의 saved view 라벨을 `뷰`로 바꾸고 불필요한 uppercase/tracking 스타일을 걷어내 한국어 필터 라벨이 과장되어 보이지 않게 했다.
- daily 도메인에 별도 property registry를 추가하고 registry의 임시 inline daily 정의를 실제 필드 중심 정의로 교체했다.
- Life Ops daily log에 공통 `PropertyPanel` 기반 일일 속성 패널을 붙여 기분, 에너지, 감정, 수면, 딥워크, 일기, 묵상, 감사를 한 번에 편집할 수 있게 했다.
- `/api/life-ops/logs/[date]/properties`와 `updateLifeOpsDailyProperties`를 추가해 daily log와 health metric 속성을 한 번에 저장하고, 부분 payload가 기존 값을 지우지 않도록 보존 로직을 넣었다.
- daily source document 속성을 `SourcePropertyInspector`로 적용할 수 있게 하고, 원본 속성/일일 기록/저널/데이터 컬럼 주변의 영어 라벨과 과한 uppercase 스타일을 한국어 제품 언어로 정리했다.
- 공통 `CollectionColumnControls`를 추가해 collection 카드/목록에서 표시할 속성을 선택하고 순서를 조정할 수 있는 기반을 만들었다.
- media collection에 표시 속성 컨트롤을 붙이고, 선택한 표시 속성 순서를 saved view의 `sortState.columns`에 저장/업데이트/복제할 수 있게 했다.
- media saved view 전환을 `SavedViewTabs`의 client-side 선택으로 바꿔 탭 클릭 시 full reload 없이 카드 목록과 표시 속성이 바로 바뀌도록 정리했다.
- daily/project default saved view 라벨을 한국어로 바꾸고, project 기본 뷰의 오래된 `importance`/`brainEnergy` 기준을 현재 project status 기준으로 정리했다.
- saved view 생성/업데이트/식별 로직을 `saved-view-client` 헬퍼로 분리해 media, people, daily entries가 같은 저장 뷰 편집 문법을 쓰게 했다.
- PRM collection에 표시 속성 컨트롤을 붙여 닉네임, 즐겨찾기, 상태, 레이어, 그룹, 소개, 연락 주기, 상호작용, 마지막 연락, 생일, 선물/태스크 수, 원본 속성을 saved view별로 조정할 수 있게 했다.
- PRM saved view 전환을 client-side 선택으로 바꾸고, 기본 뷰는 편집본 생성, 저장된 뷰는 현재 표시 속성/검색/그룹 조건으로 업데이트할 수 있게 했다.
- daily entries archive를 client collection으로 전환하고, 본문은 기본 목록에서 바로 펼치지 않으며 사용자가 `본문` 표시 속성을 켠 뒤 개별 카드에서 열어보는 구조로 정리했다.
- daily entries collection에 종류/날짜/감정/사건/본문 말씀/태그/사람/원본 속성/본문/배경 표시 속성을 붙이고, 선택 상태를 saved view의 `sortState.columns`에 저장하도록 했다.
- `SavedViewTabs`와 PRM 필터 탭의 과한 letter spacing을 줄이고, 링크 기반 탭도 `scroll={false}`로 맞춰 뷰 전환의 새로고침 체감을 낮췄다.
- `source-mapping` registry 유틸을 추가해 원본 속성명을 도메인별 `sourceAliases`와 비교하고 `적용 후보`, `검토 필요`, `숨김/노이즈`로 분류할 수 있게 했다.
- `SourcePropertyInspector`를 단일 원본 속성 목록에서 적용 후보/검토 필요/숨김 그룹 UI로 바꾸고, 숨김 그룹은 접힌 상태에서 원본 보존과 수동 매핑을 함께 지원하게 했다.
- zettel, media, person, daily log의 원본 속성 표시/추론을 각 컴포넌트의 정규식 목록 대신 property registry 기반 판정으로 연결했다.
- Notion 시스템 ID, 편집자, 수정 시각, 삭제/보관 플래그, public/api URL 같은 원본 메타데이터는 canonical alias가 없을 때 숨김/노이즈로 낮춰 보여주도록 했다.

검증:

- `npm run typecheck --workspace @light-house/web`
- `npm run lint --workspace @light-house/web`
- `git diff --check`

다음:

- saved view 편집 UI를 이름 변경, 삭제, 기본 뷰 지정까지 다루는 전역 `SavedViewManager`로 승격한다.
- source mapping workbench에서 이 registry 판정을 사용자별 저장 규칙으로 승격한다.
- assets/places/gifts처럼 아직 얕게 남아 있는 보조 도메인에 read-only property display를 먼저 붙인다.

### 2026-05-04

완료:

- `habit`, `workout`, `career` entity type과 도메인별 property registry를 추가해 습관/운동/커리어도 같은 속성 정의 체계를 쓰게 했다.
- `HabitPropertyForm`, `WorkoutPropertyForm`, `CareerPropertyForm` 헬퍼를 추가해 생성/수정 payload 정규화를 도메인 컴포넌트 밖으로 분리했다.
- 습관, 운동, 커리어 생성 화면을 공통 `PropertyPanel` 기반 입력으로 바꾸어 쓰기 단계에서도 설명, 스케줄, 기간, 강도 같은 속성에 바로 접근할 수 있게 했다.
- 습관/운동/커리어 목록 카드와 운동/커리어 상세 화면에 속성 편집 패널을 붙이고, 링크 이동은 `scroll={false}`로 맞춰 새로고침처럼 느껴지는 전환을 줄였다.
- `updateLifeOpsHabitProperties`, `updateWorkoutProperties`, `updateCareerEntryProperties`와 각 properties API route를 추가해 부분 payload가 기존 값을 지우지 않도록 보존하면서 canonical 속성을 저장한다.
- 커리어 분류 필터와 태그 표시를 업무/학습/섬김 한국어 라벨로 정리했다.
- zettel 화면 안에 있던 저장 뷰 편집 UI를 공통 `SavedViewManager`로 추출했다.
- `saved-view-client`에 삭제와 도메인/스코프별 재조회 헬퍼를 추가해 각 화면이 직접 fetch shape를 반복하지 않게 했다.
- media, PRM, daily entries collection의 저장 뷰 조작을 `SavedViewManager`로 연결해 기본 뷰 편집본 생성, 저장된 뷰 이름 변경, 현재 조건 덮어쓰기, 기본 뷰 지정, 삭제를 같은 패널에서 다루게 했다.
- media/PRM/daily entries의 빠른 저장 버튼 묶음을 `뷰 관리` 패널로 정리해 필터 바의 버튼 밀도를 낮췄다.

검증:

- `npm run typecheck --workspace @light-house/web`
- `npm run lint --workspace @light-house/web`
- `git diff --check`
- `/life-ops/habits`, `/life-ops/workouts`, `/life-ops/career` HTTP 200
- `/vault/media`, `/prm`, `/life-ops/entries`, `/vault/zettels` HTTP 200

다음:

- source mapping workbench에서 registry 기반 suggested/unmapped/hidden 판정을 사용자별 저장 규칙으로 승격한다.
- assets/places/gifts처럼 아직 얕게 남아 있는 보조 도메인에 read-only property display를 먼저 붙인다.

추가 완료:

- `/settings/data/source-mapping`에 원본 컬럼 정리 workbench를 추가했다.
- `source_document_properties`를 source database, canonical entity type, document role, property name/type 기준으로 집계하고 property registry alias와 비교해 `적용 후보`, `검토 필요`, `숨김/노이즈`로 분류한다.
- workbench에서 검색, 판정 상태, 낮은 신뢰도, 원본 DB, 엔티티, 문서 역할 필터를 즉시 적용하고, 표시 컬럼도 공통 `CollectionColumnControls`로 조정할 수 있게 했다.
- `sources/qa` 저장 뷰를 한국어 기본 뷰로 정리하고, source workbench에서도 `SavedViewTabs`와 `SavedViewManager`로 이름 변경, 현재 조건 덮어쓰기, 기본 뷰 지정, 삭제, 편집본 생성을 지원하게 했다.
- `source_property_mappings` 테이블과 API route를 추가해 원본 컬럼을 사용자별로 `mapped`, `needs_review`, `hidden` 규칙으로 저장할 수 있게 했다.
- 데이터 설정 화면과 설정 로컬 내비게이션에서 원본 컬럼 정리 화면으로 들어갈 수 있게 연결했다.
- 기존 `/settings/data`의 데이터 상태/연결 상태/중복 미디어 주요 라벨을 한국어 제품 언어로 정리했다.
- workbench 규칙 판정 로직을 `source-property-mapping-rules` 유틸로 분리해 서버 집계와 클라이언트 패널이 같은 매핑 우선순위를 쓰게 했다.
- `SourcePropertyInspector`가 전역 원본 컬럼 규칙을 읽어 zettel/media/person의 원본 속성 적용 후보, 검토 필요, 숨김/노이즈 그룹과 기본 적용 대상을 같이 반영하게 했다.
- read-only `SourceDocumentPanel`도 registry와 전역 규칙 기반 그룹 표시로 바꿔 daily log, daily entry, backlink source panel에서 같은 한국어 판정과 숨김 그룹을 사용하게 했다.
- `asset`, `place`, `gift` entity type의 property registry를 추가해 자산, 장소, 선물도 한국어 라벨/그룹/원본 alias를 같은 체계에서 관리하게 했다.
- 공통 `PropertySummary`를 추가해 편집 API가 아직 없는 얕은 도메인에서도 canonical 속성을 제품 언어로 읽을 수 있게 했다.
- 자산/장소/선물 목록 카드와 상세 화면에 `PropertySummary`를 적용하고, 선물 작성 폼은 공통 `PropertyPanel` 기반으로 교체해 대상 인물, 방향, 날짜, 반응, 메모를 한곳에서 입력하게 했다.
- 자산/선물 카드의 장식적 interactive glow를 제거하고, 자산/장소/선물 주변의 남은 영어 라벨과 로컬 내비게이션 라벨을 한국어로 정리했다.
- 자산과 장소 snapshot 타입/쿼리를 DB의 실제 canonical 필드까지 확장하고, `/api/vault/assets/[assetId]/properties`, `/api/vault/places/[placeId]/properties`를 추가했다.
- 자산/장소 상세 화면을 공통 `PropertyPanel` 저장 흐름으로 승격해 취득 정보, 상태, 지도 링크, 방문 정보, 평점, 메모를 같은 속성 문법으로 편집하게 했다.
- 자산/장소 속성 패널에도 `SourcePropertyInspector`를 연결해 전역 원본 컬럼 규칙과 registry alias를 기준으로 원본 값을 canonical 필드에 적용할 수 있게 했다.
- 원본 컬럼 workbench에서 `검토`로 표시한 컬럼은 matching source document에 `migration_review_items`를 생성하고, 이후 `매핑` 또는 `숨김`으로 확정하면 열린 리뷰 항목을 `applied`/`dismissed`로 닫도록 연결했다.
- source mapping workbench summary와 row에 열린 리뷰 항목 수를 표시해 원본 컬럼 정리와 migration review backlog가 분리되어 보이지 않게 했다.
- `EntityContextShell`이 관계 확정 후 내부 bundle 상태를 즉시 갱신하도록 바꿔 source trace fallback의 `window.location.reload()` 경로를 제거했다.
- Source Trace의 주요 섹션 라벨, 테이블 헤더, canonical 생성 옵션을 한국어 제품 언어로 정리했다.
- 자산 collection을 `AssetsClient`로 전환해 분류/상태 필터, 표시 속성 컨트롤, 저장 뷰 편집/복제/삭제/기본값 지정, saved view별 `sortState.columns` 저장을 지원하게 했다.
- 장소 collection에 분류/메모 필터, 표시 속성 컨트롤, 저장 뷰 관리 패널을 붙이고, 메모 textarea는 `장소 메모` 표시 속성이 켜진 뷰에서만 노출되도록 정리했다.
- 선물 보드에 방향/반응 필터, 표시 속성 컨트롤, 저장 뷰 관리 패널을 붙이고, 선물 카드가 saved view의 표시 속성 순서를 따르도록 바꿨다.
- 자산/장소/선물 기본 saved view를 `DEFAULT_SAVED_VIEWS`에 추가해 저장된 사용자 뷰가 없어도 한국어 기본 탭과 편집본 생성 흐름을 제공한다.
- 원본 컬럼 workbench에 `빈 값 적용` batch apply를 추가했다. 매핑된 원본 컬럼 값을 기존 source document의 canonical entity에 일괄 반영하되, 기본값은 이미 채워진 canonical 필드를 덮어쓰지 않는다.
- batch apply는 property registry의 타입과 옵션을 기준으로 select/date/number/boolean/multiSelect 값을 정규화하고, 관계형/태그형처럼 아직 안전한 직접 적용 대상이 아닌 속성은 서버에서 차단한다.
- batch apply 성공 시 열린 source property review item을 `applied`로 닫고, workbench summary와 행별 적용 결과를 즉시 갱신한다.

추가 검증:

- `npm run db:apply-migration -- migrations/0013_source_property_mappings.sql --apply --continue-existing`
- `npm run typecheck --workspace @light-house/web`
- `npm run lint --workspace @light-house/web`
- `git diff --check`
- `/settings/data/source-mapping` HTTP 200
- `/settings/data` HTTP 200
- `/vault/zettels`, `/vault/media`, `/prm`, `/life-ops` HTTP 200
- `/vault/assets`, `/vault/assets/asset-bike`, `/vault/places`, `/vault/places/place-hotteok`, `/prm/gifts`, `/prm/gifts/gift-1` HTTP 200
- `/settings/data/source-mapping`, `/vault/assets/asset-bike`, `/vault/places/place-hotteok` HTTP 200
- `git grep -n "window.location.reload\\|location.reload" -- apps/web/src` 결과 없음
- `/settings/data/source-mapping`, `/api/source-property-mappings/apply` bad request 검증

다음:

- 컬럼 pin/width/density 같은 고급 presentation 옵션은 현재 표시/숨김/순서 저장 이후의 선택 기능으로 남아 있다.
