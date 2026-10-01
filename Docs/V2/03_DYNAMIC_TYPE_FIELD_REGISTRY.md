# 03. Dynamic Type and Field Registry

## 1. 목적

레지스트리는 알려진 유형을 나열하는 카탈로그가 아니라 새로운 자료를 받아들이면서도 데이터 의미가 무너지지 않게 하는 통제층이다.

두 극단을 피한다.

- 폐쇄 enum: 새 유형을 기존 통에 강제하거나 저장 실패
- 무제한 생성: 같은 의미의 유형·필드가 다른 이름으로 폭증

정책은 다음과 같다.

> 새 유형과 필드는 즉시 동적 값으로 사용할 수 있지만, 정식 메뉴·인덱스·전용 UX는 관찰과 검증을 거쳐 승격한다.

## 2. 레지스트리 구성

### 유형 정의

```yaml
key: workout_log
label: 운동 기록
applies_to_kind: document
parent_type: activity_log
status: observed
definition: 사용자가 수행한 신체 활동의 결과와 경험을 기록한 문서
aliases:
  - 운동일지
  - 운동 로그
origin: ai_proposed
usage_count: 3
schema_version: 2
```

icon과 기본 view는 의미 type 정의에 넣지 않고 `type_presentation_profiles`에 둔다. type 의미를 수정하지 않고도 표현을 바꾸고 부모 profile을 상속하기 위해서다.

### 필드 정의

```yaml
key: average_heart_rate
label: 평균 심박수
definition: 특정 활동 구간 전체에서 측정된 평균 심박수
data_type: measurement
canonical_unit: bpm
allowed_units: [bpm]
status: observed
aliases:
  - 평균 심박
  - 심박 평균
scopes:
  - workout_event
  - running_log
```

### 유형-필드 규칙

```yaml
type: running_log
field: distance
cardinality: one
requirement: recommended
allowed_units: [m, km, mile]
display_zone: highlight
group_key: activity_metrics
display_kind: measurement
display_order: 20
importance: primary
filterable: true
```

표현 속성은 자유 형식 UI 코드가 아니다. `display_zone`, `group_key`, `display_kind`는 서버가 허용 목록으로 검증한다. AI는 후보를 제안할 수 있지만 React 컴포넌트, HTML, CSS를 생성하지 않는다. 정의되지 않은 조합은 안전한 `facts + other + structured_fallback`으로 표시한다.

## 3. 상태 생명주기

```text
candidate → observed → active → archived
              ↘ merged
```

### Candidate

- 첫 발견
- 기존 정의와 일치하지 않음
- 데이터 저장과 검색은 가능
- 기본 탐색 메뉴에는 노출하지 않음
- AI가 만든 정의·부모·필드 후보를 보관

### Observed

- 서로 다른 기록에서 반복됨
- 의미와 필드 패턴이 어느 정도 안정됨
- Library filter·저장 뷰 조건 후보로 노출하되 navigation에는 자동 추가하지 않음
- 사용자가 정식 유지·병합·이름 변경 가능

### Active

- 사용자가 승인했거나 자동 승격 조건 충족
- 필터·정렬·입력 결과 UI에서 정식 노출
- 자주 쓰는 필드에 인덱스 또는 투영 적용
- 레지스트리 변경은 버전 증가 필요

### Archived

- 더 이상 새 배정에 사용하지 않음
- 기존 기록은 유지
- 대체 유형이 있으면 `superseded_by` 연결

### Merged

- 중복 정의가 정본 정의로 병합됨
- 과거 key와 alias는 검색·이관 호환을 위해 유지

## 4. 신규 유형 감지 절차

1. Gemini 3.6이 기존 레지스트리 요약과 입력을 비교한다.
2. 0개 이상의 기존 유형을 복수 배정한다.
3. 설명할 수 없는 구조가 있으면 새 유형 후보를 제안한다.
4. 서버가 key, label, definition, parent, 필드 패턴을 정규화한다.
5. 레지스트리에서 이름·별칭·상위 타입·의미 임베딩·필드 겹침을 검색한다.
6. 결과를 `reuse`, `alias`, `child`, `candidate`, `needs_review` 가운데 하나로 결정한다.
7. 후보라도 현재 기록에는 바로 배정할 수 있다.

## 5. 유형 비교 규칙

단순 문자열 유사도가 아니라 다음 신호를 조합한다.

| 신호 | 예시 |
| --- | --- |
| 정의 유사도 | 운동 일지와 운동 기록 |
| 부모 유형 | 달리기 기록은 운동 기록의 하위 유형 |
| 필드 겹침 | 거리·시간·심박 필드 공유 |
| 사건 종류 | 둘 다 workout event 생성 |
| 대상 종류 | 영화 리뷰와 게임 리뷰는 대상 유형이 다름 |
| 사용자 의도 | 리뷰와 단순 상태 기록은 다름 |

### 합치지 말아야 할 예

- 영화 `runtime`과 사용자의 `watch_duration`
- 게임의 공식 `playtime_estimate`와 사용자의 `played_duration`
- 식당의 `external_rating`과 `user_rating`
- 대화가 일어난 `conversation_date`와 대화에서 언급한 과거 사건일

## 6. 신규 필드 감지 절차

1. Gemini가 label, definition, data type, unit, value, 근거를 제안한다.
2. 서버가 필드 key를 직접 채택하지 않고 canonicalization을 수행한다.
3. 기존 필드의 key, alias, definition, 단위 차원, scope를 비교한다.
4. `reuse`, `alias`, `specialize`, `candidate`, `reject`로 결정한다.
5. 새 후보도 typed property로 저장한다.

### Canonicalization 예

```text
운동 시간
걸린 시간
소요시간
elapsed time
→ duration
```

하지만 `duration` 하나로 모든 시간 개념을 합치지 않는다. scope와 definition을 확인한다.

```text
workout.duration        실제 운동 지속 시간
media.runtime           작품의 공식 길이
visit.wait_duration     장소 대기 시간
conversation.duration   대화 지속 시간
```

표시명은 같아도 canonical key는 의미 단위로 분리할 수 있다.

## 7. 단위 레지스트리

측정값은 숫자와 단위를 분리하고 기준 단위로 정규화한다.

| 차원 | 허용 예 | 기준 |
| --- | --- | --- |
| length | m, km, mile | m |
| duration | ms, second, minute, hour | ms |
| mass | g, kg, lb | g |
| heart_rate | bpm | bpm |
| energy | kcal, kJ | kcal |
| pace | sec/km, sec/mile | sec/km |
| currency | KRW, USD 등 | 원값 + 통화 |
| rating | 4.5/5, 9/10 | 원척도 + 정규화 비율 |

환산값은 `calculated` 출처로 저장하고 원래 숫자·단위 근거를 유지한다.

## 8. 자동 승격 정책

MVP 기본값은 설정 가능하게 둔다.

### 유형 `candidate → observed`

다음 중 하나:

- 서로 다른 캡처 3건 이상에서 높은 신뢰도로 반복
- 사용자가 “유형으로 유지” 선택
- 기존 데이터 이관에서 명시된 안정된 분류

### 유형 `observed → active`

다음 조건을 모두 만족하거나 사용자가 직접 승인:

- 서로 다른 캡처 5건 이상
- 미해결 중복 후보 없음
- 골든 코퍼스에서 치명 오류 없음
- 적어도 하나의 실용적인 뷰 또는 필터가 있음

### 필드 승격

- 여러 객체에서 반복
- 데이터 타입과 단위가 안정
- 사용자 수정률이 허용 범위 이하
- 필터·정렬·표시에 실제 가치가 있음

한 번만 등장해도 중요한 필드는 사용자가 즉시 고정할 수 있다.

## 9. 사용자 개입

사용자에게 매번 스키마 질문을 하지 않는다. 다음 상황에만 확인을 제안한다.

- 기존 유형 두 개와 거의 동일한 신규 후보
- 필드 의미가 비슷하지만 단위나 scope가 충돌
- 정식 메뉴로 승격할 가치가 있는 반복 유형
- 사용자 수정이 반복되어 AI 규칙이 잘못된 것으로 보임

사용 가능한 액션:

- 유형 유지
- 기존 유형에 병합
- 부모 유형 변경
- 표시명 변경
- 필드 별칭 추가
- 필드 숨기기
- AI 자동 배정 금지
- 정식 목록에 고정
- semantic icon 선택·변경
- 기본 collection·record preset 선택

## 10. 스키마 버전

레지스트리 정의를 바꾸면 버전을 증가시킨다.

```text
running_log v1
  distance, duration

running_log v2
  distance, duration, average_pace, average_heart_rate
```

기존 데이터는 생성 당시 버전을 유지한다. 새 버전으로 재분석할 때는 새로운 `property_value`를 만들고 이전 값을 `superseded`로 연결한다.

## 11. 재처리 정책

재처리 대상:

- 유형·필드 병합으로 canonical key가 변경됨
- 프롬프트·모델 개선으로 치명 오류가 해결됨
- 새 외부 개체 식별자가 추가됨
- 사용자가 “이와 비슷한 기록도 다시 정리” 요청

재처리하지 않는 것:

- 사용자 잠금값
- 원본 OCR
- 외부 사실의 과거 스냅샷
- 사용자가 거부한 유형 배정

## 12. 메뉴와 뷰 폭증 방지

레지스트리의 모든 유형을 내비게이션에 표시하지 않는다.

| 상태 | 검색 | 자동 컬렉션 | 내비게이션 | 전용 UI |
| --- | --- | --- | --- | --- |
| candidate | 가능 | 숨김 | 없음 | 없음 |
| observed | 가능 | 후보 | 없음 | 일반 카드 |
| active | 가능 | 노출 | 사용자 고정 시 | 필요할 때만 |
| archived | 기존만 | 숨김 | 없음 | 없음 |

전용 UI는 유형 승격과 별개의 결정이다. 운동 기록이 active여도 초기에는 일반 필드 카드와 필터만으로 충분할 수 있다.

icon과 view도 유형 승격과 별개다. candidate는 parent 또는 `type.unknown` icon과 generic preset으로 즉시 표시된다. active type만 사용자가 선택한 presentation profile을 정식 기본값으로 사용할 수 있으며, icon 선택이 navigation pin이나 전용 module을 자동 생성하지 않는다.

범용 화면과 AI 필드의 실제 배치 규칙은 [11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md](./11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md)를 따른다. 레지스트리의 모든 값은 서버의 `Presentation Projector`를 거친 후 화면에 전달한다.

semantic icon, view preset, context module, Codex 확장 계약은 [20_ICON_AND_VIEW_EXTENSION_CONTRACT.md](./20_ICON_AND_VIEW_EXTENSION_CONTRACT.md)를 따른다.

## 13. 레지스트리 최소 시드

완전한 유형 목록은 만들지 않지만 처음부터 필요한 상위 문법은 시드한다.

### 객체 상위 종류

- document
- entity
- event

### 문서 상위 유형

- authored_writing
- review
- personal_log
- conversation_source
- reference_clip
- creative_work
- unclassified

### 개체 상위 유형

- person
- place
- work
- organization
- concept
- physical_item
- fictional_entity
- unresolved_entity

### 사건 상위 유형

- visit
- consumption
- activity
- conversation
- creation
- decision
- life_event
- unresolved_event

장소 리뷰, 달리기 기록, 독후감 같은 구체 유형은 이 상위 문법 아래에서 발견·시드할 수 있다.

## 14. 실패 안전성

레지스트리 분석이 실패하면 다음 최소 결과를 저장한다.

```text
document type: unclassified
processing status: needs_review 또는 failed_retryable
raw source: preserved
searchable text: available
```

어떤 레지스트리 오류도 원본 저장 트랜잭션을 롤백하지 않는다.
