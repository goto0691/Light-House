# 20. Icon and View Extension Contract

> 상태: 기획 결정 확정, coded registry 검증 전  
> 기준일: 2026-08-12

## 1. 목적

Light House의 type과 template은 계속 늘어난다. 그러나 AI가 새 유형을 발견할 때마다 임의 icon, React page, CSS를 만들게 하면 디자인 일관성, 접근성, migration, fallback이 무너진다.

이 문서는 다음을 확정한다.

1. AI와 사용자가 선택할 수 있는 안정된 semantic icon catalog
2. 코드 없이 조합하는 collection·record view preset
3. 명백한 가치가 있을 때만 Codex가 추가하는 repo-local context module
4. 모든 확장이 실패해도 generic UI로 돌아가는 fallback

핵심 원칙:

> AI는 등록된 표현을 선택·제안하고, Codex는 검증된 scaffold로 표현을 확장한다. 둘 다 실행 중 임의 UI 코드를 활성화하지 않는다.

## 2. 확장 계층

```text
Level 0  Generic fallback
         unknown type도 list + fields + body로 표시

Level 1  View preset · data/config only
         layout, fields, sort, group, module order 조합

Level 2  Context module · repo code
         map, cover, workout chart, transcript timeline

Level 3  Dedicated route · exceptional
         generic shell로 해결할 수 없는 독립 workflow만
```

대부분의 확장은 Level 1로 끝내고, Level 2는 재사용 가치가 있는 module만 허용한다. Level 3는 MVP·private beta 범위에서 만들지 않는다.

## 3. Icon Catalog

### 3.1 안정 key와 renderer 분리

DB와 AI는 `MapPin`, `Dumbbell` 같은 library component 이름을 저장하지 않는다. stable semantic key를 저장하고 code catalog가 실제 renderer에 매핑한다.

```ts
type IconDefinition = {
  iconKey: string;                  // type.workout
  renderer: {
    kind: "lucide" | "custom_asset";
    name: string;                   // Activity
  };
  labelKo: string;
  tags: string[];
  allowedContexts: Array<"type" | "template" | "saved_view">;
  status: "active" | "retired";
  version: number;
};
```

`lucide-react`를 v1 renderer로 사용하지만 semantic key가 library 변경을 흡수한다. `custom_asset`은 v1에서 읽기만 예약하고 실제 업로드·SVG sanitization은 이후로 미룬다.

### 3.2 Catalog 분리

- `ActionIconCatalog`: 검색, 저장, 닫기, 편집 같은 제품 action. code-owned이며 AI 선택 불가.
- `SemanticIconCatalog`: type, template, saved view의 인지 단서. AI가 허용된 key 안에서 후보 제안 가능.
- `CustomIconCatalog`: 사용자가 추가한 검증 자산. v1 이후.

### 3.3 v1 semantic seed · 44 intents

```text
generic
  type.unknown, type.document, type.collection, type.template, type.event

writing
  type.note, type.essay, type.poem, type.meditation, type.journal, type.quote, type.conversation, type.transcript

media
  type.book, type.movie, type.series, type.animation, type.game, type.music, type.podcast, type.exhibition

place-and-food
  type.place, type.restaurant, type.cafe, type.food, type.travel, type.visit, type.lodging

activity-and-wellness
  type.workout, type.running, type.walking, type.cycling, type.hiking, type.swimming, type.sleep, type.health

people-time-capture
  type.person, type.group, type.meeting, type.calendar, type.photo, type.audio, type.web_clip, type.screenshot
```

seed는 유형 enum이 아니다. icon intent 목록이며 새 type은 기존 intent를 재사용한다. icon 하나를 type마다 새로 만들지 않는다.

### 3.4 Binding과 상속

`type_presentation_profiles`가 의미 type과 presentation을 분리한다.

```ts
type TypePresentationProfile = {
  typeDefinitionId: string;
  iconKey?: string;
  accentRole: "neutral" | "primary" | "warm";
  defaultCollectionPresetKey?: string;
  defaultRecordPresetKey?: string;
  version: number;
  source: "system" | "ai_suggested" | "user";
};
```

결정 순서:

1. 해당 type의 사용자 override
2. 해당 type profile
3. 가장 가까운 active parent type profile
4. object kind 기본 icon
5. `type.unknown`

secondary type icon은 일반 collection row에 추가하지 않는다. primary type icon 하나와 text label만 사용한다.

### 3.5 Template와 saved view

- template은 연결된 primary type icon을 기본 상속한다.
- template icon override는 picker에서 입력 목적이 type과 다를 때만 허용한다.
- `generated_draft`의 icon은 trial presentation이며 `이 템플릿 유지` 전에는 사용자 설정으로 확정하지 않는다.
- saved view는 `icon_key`를 가질 수 있으나 query membership과 무관한 presentation metadata다.
- legacy free-text icon과 emoji는 import 때 semantic key로 map하고, 실패하면 fallback과 migration warning을 사용한다.

### 3.6 AI icon proposal

AI에는 현재 type 정의와 관련 있는 catalog 일부만 전달한다.

```json
{
  "suggestions": [
    {"icon_key": "type.running", "reason": "거리와 페이스를 기록하는 달리기 유형"},
    {"icon_key": "type.workout", "reason": "상위 운동 기록과 같은 계열"}
  ]
}
```

- 최대 3개 후보
- catalog에 없는 key는 서버 reject
- candidate type은 icon 때문에 active가 되지 않음
- 반복 사용만으로 template icon override를 확정하지 않음
- AI가 SVG, emoji, URL, color, animation을 생성하지 않음

## 4. View Preset Registry

### 4.1 Collection과 Record를 분리

```ts
type CollectionViewPreset = {
  presetKey: string;
  targetObjectKinds: Array<"document" | "entity" | "event">;
  targetTypeKeys?: string[];
  layout: "list" | "cards" | "visual" | "timeline" | "map" | "calendar" | "table";
  sort: unknown[];
  groupBy?: string;
  visibleFieldKeys: string[];
  density: "compact" | "standard" | "comfortable";
  version: number;
  status: "candidate" | "active" | "archived";
};

type RecordViewPreset = {
  presetKey: string;
  targetObjectKind: "document" | "entity" | "event";
  targetTypeKeys?: string[];
  mainVariant: "document" | "entity_overview" | "event_overview";
  moduleKeys: string[];
  inspectorSectionKeys: string[];
  version: number;
  status: "candidate" | "active" | "archived";
};
```

View preset은 허용된 renderer와 module key만 조합한다. JSX·CSS·query SQL을 포함하지 않는다.

### 4.2 적용 우선순위

Collection:

```text
saved view display state
→ user type preference
→ most-specific primary type preset
→ parent type preset
→ object-kind generic list
```

Record:

```text
explicit user display preference
→ most-specific primary type preset
→ parent type preset
→ object-kind generic record
```

- secondary type은 호환 module을 제안할 수 있지만 main variant를 자동 교체하지 않는다.
- authored document는 body가 항상 첫 번째다. type module은 본문 아래 또는 Inspector에 둔다.
- entity·event는 main 영역에 최대 2개 prominent module만 둔다.
- 같은 data requirement의 module은 deduplicate한다.
- data가 없으면 빈 장식 module을 만들지 않는다.

### 4.3 v1 preset seed

| family | collection default | optional layout | record module |
| --- | --- | --- | --- |
| authored writing | list | timeline | body first, related writing |
| review | list | table | rating summary, assessed target |
| place | list | map | map, visit timeline |
| media work | list | visual | cover, work facts, related reviews |
| workout | table | timeline | metrics, trend chart, route if present |
| conversation | timeline | list | participants, transcript timeline, evidence |

이 preset은 전용 page가 아니라 generic renderer와 module의 조합이다.

## 5. Context Module Registry

### 5.1 Code manifest

Level 2 module은 repo code와 manifest를 함께 가진다.

```ts
type ContextModuleDefinition = {
  moduleKey: string;                // workout.metrics.v1
  presentationKind: string;
  supportedObjectKinds: string[];
  supportedTypeKeys?: string[];
  requiredFieldKeys?: string[];
  requiredRelationKeys?: string[];
  privacyBehavior: "inherit" | "no_sensitive_preview" | "restricted_blocked";
  desktopVariant: "inline" | "side" | "full_width";
  mobileVariant: "inline" | "sheet" | "full_page";
  version: number;
};
```

client module은 raw EAV row나 Gemini output을 직접 읽지 않고 서버의 `PresentedModule`만 받는다.

```ts
type PresentedModule = {
  moduleKey: string;
  presentationVersion: number;
  title?: string;
  data: unknown;
  sourceLabels: string[];
  actions: Array<{ key: string; label: string }>;
  previewPolicy: "full" | "redacted" | "locked";
};
```

### 5.2 실패와 fallback

- unknown module key: module만 생략하고 generic record 유지
- projection version mismatch: module error boundary + 개발 log
- missing data: render하지 않음 또는 명시적 empty state
- sensitive: redacted projection만 전달
- restricted: 잠금 해제 전 module data를 client에 보내지 않음
- module failure가 source body, field list, export를 막지 않음

## 6. Codex 확장 workflow

개인·지인용 범위에서는 공개 plugin SDK 대신 repo-local scaffold를 사용한다.

```text
요청 또는 반복 자료 발견
→ 기존 preset 조합으로 해결 가능한지 검사
→ 불가능하고 독립 가치가 있으면 module proposal
→ scaffold에서 component + manifest + projection schema 생성
→ fixture와 privacy·responsive test
→ local feature flag
→ 사용자 확인
→ active registry 등록
```

Codex가 새 module을 만들 때 필요한 산출물:

1. module value statement
2. 기존 module로 해결할 수 없는 이유
3. manifest와 version
4. server projection schema
5. desktop·mobile·empty·loading·error state
6. normal·sensitive·restricted fixture
7. generic fallback 확인
8. export·restore 시 missing module 처리

금지:

- runtime AI가 생성한 JS·React 실행
- remote plugin script loading
- module 내부 임의 external fetch
- type별 page shell 복제
- module이 source canonical data를 직접 수정
- module key를 presentation contract 검증 없이 DB에서 실행

## 7. 전용 route 승격 조건

다음 조건을 모두 만족할 때만 Level 3를 검토한다.

1. 독립된 multi-step workflow가 있음
2. generic Record Detail과 Context Module 조합으로 task completion이 불가능함
3. 서로 다른 record 5건 이상에서 반복 가치가 확인됨
4. desktop과 mobile IA가 정의됨
5. privacy·export·fallback contract가 있음
6. 제거해도 canonical data가 손상되지 않음

`장소`, `영화`, `운동`이라는 type 이름만으로 전용 route를 만들지 않는다.

## 8. 유지보수와 배포

- icon catalog와 module registry는 app release와 함께 versioning한다.
- export는 semantic `icon_key`, preset definition, profile binding을 포함한다.
- export에 React code를 포함하지 않는다.
- restore 대상 app에 key가 없으면 fallback으로 열고 missing extension report를 만든다.
- acquaintance distribution은 동일 built artifact 안의 active module만 제공한다.
- marketplace, third-party permission model, sandboxed plugin loader는 만들지 않는다.
- 사용자의 local custom module은 source repository에서만 유지하고 공개 bundle에 자동 포함하지 않는다.

## 9. 수용 기준

- unknown type·icon·preset·module이 page crash를 만들지 않음
- catalog에 없는 AI icon key accepted 0건
- AI-generated SVG·URL·runtime code 실행 0건
- child type icon 상속과 fallback 성공 100%
- template icon이 record detail view를 결정하는 사례 0건
- secondary type이 main variant를 자동 교체하는 사례 0건
- authored document body보다 module이 먼저 오는 사례 0건
- module failure 중 source body·generic fields 열람 성공 100%
- restricted unlock 전 module payload 전송 0건
- desktop·mobile·empty·privacy fixture 없는 active module 0건
- icon-only classification으로 label을 잃는 핵심 flow 0건

## 10. 구현 순서

1. semantic `IconCatalog`와 fallback
2. `DisplayType.iconKey`와 type presentation profile projection
3. template·saved view icon binding
4. generic collection·record preset
5. `ContextModuleRegistry`와 error boundary
6. place map·media cover·workout metrics 중 corpus 가치가 확인된 module
7. Codex module scaffold와 validation script
8. export·restore extension manifest

Level 3 dedicated route와 Custom Icon upload는 이후 판단한다.
