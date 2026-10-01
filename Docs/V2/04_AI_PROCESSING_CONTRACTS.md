# 04. AI Processing Contracts

## 1. 목표

AI 처리의 품질은 프롬프트 문장보다 역할 분리, 입출력 계약, 서버 검증에서 결정된다. 모델이 바뀌어도 정본 데이터 계약은 유지되어야 한다.

### 확정 모델 역할

| 역할 | 기본 모델 | 책임 |
| --- | --- | --- |
| Analyzer | `gemini-3.6-flash` | 텍스트·이미지 이해, OCR, 유형·필드·개체·사건·관계 제안, 의미 색인 |
| Grounded Enricher | `gemini-3.5-flash-lite` | Google Search·Maps 기반 개체 식별과 저비용 외부 사실 보강 |
| Validator | 서버 코드 | 타입·단위·레지스트리·권한·충돌 검증, 최종 commit |

공식 모델 정보와 가격은 변경될 수 있으므로 모델 문자열은 역할별 환경설정으로 둔다.

```env
GEMINI_MAIN_MODEL=gemini-3.6-flash
GEMINI_GROUNDED_MODEL=gemini-3.5-flash-lite
```

참고:

- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/pricing

## 2. 처리 단계

```text
S0 persist source
S1 normalize attachments
S2 analyze with 3.6
S3 validate and reconcile registry
S4 enrich selected entities with 2.5
S5 merge facts and commit knowledge objects
S6 build search and view projections
S7 present result or review queue
```

### S0는 동기, 나머지는 비동기

사용자가 저장 완료를 기다리는 조건은 원본 저장뿐이다. AI 처리 완료는 후속 상태로 표시한다.

## 3. Analyzer 입력 계약

3.6 Flash에는 다음을 전달한다.

```yaml
contract_version: analysis-v1
analysis_target:
  kind: capture_bundle | document_revision
  target_id: CAPTURE_OR_REVISION_ID
  document_id: OPTIONAL_DOCUMENT_ID
capture:
  id: CAPTURE_ID
  captured_at: ISO_DATETIME
  timezone: Asia/Seoul
  user_note: 원문
sources:
  - source_item_id: SRC_1
    kind: text
    raw_text: 원문
  - source_item_id: SRC_2
    kind: image
    mime_type: image/png
    binary_part_ref: part-1
registry_context:
  candidate_types: 관련성이 높은 기존 유형 요약
  candidate_fields: 관련성이 높은 기존 필드 요약
  unit_registry: 필요한 단위 정의
user_context:
  locale: ko-KR
  current_date: YYYY-MM-DD
  preferences: 최소한의 관련 설정
template_context:
  template_version_id: 선택한 경우에만
  expected_roles: [primary_document, subject_entity, experience_event]
  inputs:
    - item_key: user_rating
      state: unanswered
      allowed_ai_operations: [extract_from_capture]
```

전체 레지스트리를 매 호출에 넣지 않는다. 텍스트 검색·임베딩·상위 종류를 이용해 관련 후보만 전달한다.

템플릿은 분석 가설이지 분류 명령이 아니다. Analyzer는 실제 원본과 맞지 않으면 다른 유형·객체 구조를 제안할 수 있다. `withheld`와 `not_applicable` item은 추출·추론·외부 보강 대상에서 제외한다.

## 4. Analyzer 출력 계약 `AnalysisEnvelope v1`

최상위 구조는 고정하되 유형 key와 필드 후보는 개방형으로 둔다.

```json
{
  "contract_version": "analysis-v1",
  "capture_id": "01...",
  "analyzed_revision_id": null,
  "language": "ko",
  "bundle_summary": "한강 달리기 운동 기록",
  "document_proposals": [],
  "entity_proposals": [],
  "event_proposals": [],
  "relation_proposals": [],
  "field_proposals": [],
  "semantic_index": {},
  "enrichment_requests": [],
  "review_items": [],
  "warnings": []
}
```

기존 문서를 재분석할 때는 `analysis_target.kind=document_revision`과 불변 revision ID를 전달하고 결과의 `analyzed_revision_id`에 같은 ID를 기록한다. 현재 문서 revision이 달라지면 이 결과는 `stale`이며 새 본문에 그대로 적용하지 않는다.

### `document_proposals`

```json
{
  "temp_id": "doc-1",
  "source_item_ids": ["src-1", "src-2"],
  "split_reason": null,
  "suggested_title": "한강 5km 달리기",
  "title_source": "ai_generated",
  "body_strategy": "preserve_user_text",
  "written_at": null,
  "type_assignments": [
    {
      "type_key": "workout_log",
      "label": "운동 기록",
      "role": "primary",
      "registry_action": "propose_new",
      "parent_type_key": "personal_log",
      "definition": "사용자가 수행한 운동 결과와 경험을 기록한 문서",
      "confidence": 0.98,
      "evidence_refs": []
    }
  ]
}
```

`registry_action` 허용값:

- reuse
- alias_candidate
- child_candidate
- propose_new
- unresolved

### `entity_proposals`

```json
{
  "temp_id": "entity-1",
  "entity_kind": "place",
  "mention": "모모식당",
  "canonical_name_candidate": "모모식당",
  "aliases": [],
  "resolution_status": "external_required",
  "disambiguation_hints": {
    "area": "연남동",
    "mentioned_menu": "가지튀김"
  },
  "confidence": 0.91,
  "evidence_refs": []
}
```

### `event_proposals`

```json
{
  "temp_id": "event-1",
  "event_type_key": "place_visit",
  "occurred_at_start": "2026-08-10",
  "date_precision": "day",
  "participants": [],
  "location_entity_temp_id": "entity-1",
  "confidence": 0.96,
  "evidence_refs": []
}
```

상대 날짜는 capture timezone과 기준일로 정규화하고, 원 표현을 evidence에 남긴다.

### `field_proposals`

```json
{
  "owner_temp_id": "event-1",
  "field_key_candidate": "distance",
  "label": "거리",
  "definition": "운동 중 이동한 총 거리",
  "registry_action": "reuse",
  "data_type": "measurement",
  "value": 5.02,
  "unit": "km",
  "source_class": "image_ocr",
  "confidence": 0.99,
  "evidence_refs": [
    {
      "source_item_id": "src-2",
      "locator_kind": "image_region",
      "locator": {"x": 0.12, "y": 0.18, "width": 0.31, "height": 0.09},
      "quote": "5.02 km"
    }
  ]
}
```

### `relation_proposals`

```json
{
  "subject_temp_id": "doc-1",
  "predicate_key": "about",
  "object_temp_id": "entity-1",
  "source_class": "user_context",
  "confidence": 0.97,
  "evidence_refs": []
}
```

### `semantic_index`

```json
{
  "themes": ["운동", "성취", "컨디션 개선"],
  "emotions": ["힘듦", "만족"],
  "keywords": ["한강", "5km", "달리기"],
  "abstract": "지난주보다 좋은 컨디션으로 한강 5km를 완주한 기록",
  "notable_passages": []
}
```

주제와 감정은 `ai_inferred`이며 원문 사실과 분리한다.

`emotions`는 사용자가 직접 명시한 감정과 모델이 해석한 감정을 같은 배열에 섞지 않는다. 각 항목은 `source_class`, `evidence_refs`, `claim_risk`를 가져야 하며 AI 해석은 기본 검색 색인에는 사용할 수 있어도 사용자 사실·인물 profile·알림 문구로 투영하지 않는다.

### `enrichment_requests`

```json
{
  "request_id": "enrich-1",
  "entity_temp_id": "entity-1",
  "provider_role": "maps_grounding",
  "query": "연남동 모모식당 가지튀김",
  "requested_fields": ["canonical_name", "branch_name", "address", "coordinates", "business_category"],
  "freshness": "current",
  "required": true,
  "reason": "장소 지점 식별"
}
```

## 5. Analyzer가 하지 않는 일

- DB table 또는 column 이름 확정
- DDL 생성·실행
- 외부 사실을 모델 기억만으로 확정
- 사용자 수정값 덮어쓰기
- 이미지에서 보이지 않는 맛·의도·관계를 사실로 기록
- 개체 후보가 여러 개인데 임의 선택
- 원문을 교정본으로 대체
- 직접 인용이나 사용자 확인 없이 감정·의도·동기·성격·관계 상태·인과·약속·합의·결정을 accepted fact로 만듦
- 여러 기록의 반복 표현만으로 사용자나 타인의 영구적 성격 label을 생성

### 고위험 주장 commit invariant

다음 `claim_risk`를 서버 validator가 모델 confidence보다 먼저 적용한다.

| claim risk | 예 | 자동 commit |
| --- | --- | --- |
| `low` | 명시 평점, 날짜, 거리, 작품명 | 직접 evidence가 있으면 가능 |
| `autobiographical` | 사용자의 감정, 방문 목적, 관계에 대한 자기 서술 | 사용자 직접 표현만 가능; AI 해석은 proposed |
| `social_high_risk` | 타인의 의도·성격, 관계 상태, 갈등 원인, 합의·약속 | 직접 발언 evidence가 있어도 사용자 확인 전 proposed |

`social_high_risk` 값은 Highlight, 인물 profile, 자동 타임라인, 알림, 자연어 답변의 확정 문장에 사용하지 않는다. 직접 인용과 `AI 해석`을 함께 보여주는 제안으로만 전달한다.

## 6. Registry Reconciliation

서버는 Analyzer 결과를 commit하기 전에 다음 순서로 정리한다.

1. JSON Schema 검증
2. 임시 ID 참조 무결성 검증
3. data type과 value 일치 검사
4. 단위 레지스트리 검사·정규화
5. 기존 유형·필드 후보 검색
6. alias·merge·new candidate 판정
7. 사용자 잠금값과 충돌 검사
8. 외부 조사 필요 항목 분리
9. 수용·제안·거부 목록 작성

Validator는 AI 신뢰도만으로 수용하지 않는다. 근거 존재, 타입 유효성, 충돌 여부를 함께 본다.

## 7. Grounded Enricher 입력 계약

2.5 Flash에는 필요한 개체와 필드만 전달한다. 개인 원문 전체를 재전송하지 않는다.

```json
{
  "contract_version": "enrichment-v1",
  "request_id": "enrich-1",
  "provider_role": "maps_grounding",
  "entity_kind": "place",
  "query": "연남동 모모식당 가지튀김",
  "hints": {
    "area": "연남동",
    "mentioned_menu": "가지튀김"
  },
  "requested_fields": ["canonical_name", "branch_name", "address", "coordinates", "business_category"],
  "known_candidates": []
}
```

`provider_role`:

- search_grounding
- maps_grounding
- search_and_maps

## 8. Grounded Enricher 출력 계약

```json
{
  "contract_version": "enrichment-v1",
  "request_id": "enrich-1",
  "resolution": "resolved",
  "selected_candidate": {
    "canonical_name": "모모식당 연남점",
    "external_id": "...",
    "match_confidence": 0.97,
    "selection_reason": "지역과 메뉴 단서 일치"
  },
  "alternative_candidates": [],
  "facts": [
    {
      "field_key": "address",
      "value": "서울 ...",
      "data_type": "short_text",
      "source_url": "https://...",
      "source_title": "...",
      "verified_at": "2026-08-11T00:00:00Z",
      "confidence": 0.99
    }
  ],
  "unresolved_fields": [],
  "warnings": []
}
```

`resolution`:

- resolved
- multiple_candidates
- not_found
- insufficient_evidence
- provider_error

후보가 여러 개면 서버는 임시 개체를 유지하고 review item을 만든다.

## 9. 값 병합 우선순위

모든 필드에 하나의 전역 우선순위를 기계적으로 적용하지 않는다. 먼저 같은 의미의 값인지 확인하고, 필드의 권위 유형에 따라 결정한다.

### 사용자 경험·평가·개인 측정

```text
user_locked
> user_explicit
> image_ocr / transcript_extract / exif
> user_context
> external_grounded
> calculated
> ai_inferred
```

### 작품·장소 등 외부 개체의 공식 메타데이터

```text
user_locked
> user_confirmed
> external_grounded
> user_explicit
> ai_inferred
```

우선순위가 낮은 값도 의미가 다르거나 서로 다른 시점의 값이면 함께 보관한다.

```text
user_rating: 4.5 / 5
external_rating: 4.2 / 5
```

## 10. 호출 최적화

### 기본 규칙

- 캡처당 3.6 분석 1회를 기본으로 한다.
- JSON 검증 실패 또는 저신뢰 영역만 부분 재호출한다.
- 2.5 조사는 DB에 없는 개체 또는 만료된 변동 필드에만 호출한다.
- 한 캡처에 같은 개체가 여러 번 나오면 조사 요청을 합친다.
- 배치 이관은 레코드별이 아니라 고유 개체별로 조사한다.

### 긴 자료

- 긴 녹취: 구간 추출 → 구간 결과 병합 → 전체 사건·인물 통합
- 여러 대화 캡처: 순서·중복 복원 → 발화 추출 → 논점 분석
- 큰 PDF: 페이지·절 단위 추출 → 문서 수준 색인

각 단계 결과에 동일한 contract와 evidence reference를 사용한다.

### 반복 기록에서 template 생성

template 생성은 매 capture의 Analyzer 호출에 섞지 않고 별도 background job으로 실행한다.

```text
document revision 확정
→ 서버가 type·field·relation·heading·attachment signature 생성
→ 기존 pattern cluster에 deterministic match
→ 생성 threshold를 넘은 cluster만 3.6 Template Drafter 호출
→ literal scrub
→ Registry Reconciler와 Template Definition validator
→ generated_draft 저장
→ 관련 Capture에서 suggested 상태로 노출
```

Gemini에는 source 문서 전문 전체를 기본 전달하지 않는다. 정규화 signature, 필요한 짧은 evidence, 기존 template 후보, registry subset만 전달한다. 기존 template과 충분히 유사하면 새 definition 대신 `revision_proposal`을 만든다. 사용자가 dismiss한 pattern signature는 다시 제안하지 않는다.

## 11. 실패와 재시도

| 실패 | 처리 |
| --- | --- |
| 3.6 timeout | 원본 유지, 지수 backoff 재시도 |
| JSON parse/schema 실패 | repair 호출 1회, 이후 needs_review |
| 2.5 quota | enrichment_pending 유지, 다음 window 재시도 |
| grounding 후보 다수 | 임시 개체 + 사용자 확인 |
| OCR 저신뢰 | 영역 crop 재분석 또는 미확정 필드 |
| registry 충돌 | 값은 proposed로 저장, 스키마 review item |
| projection 실패 | 정본 commit 유지, 인덱스 재생성 큐 |

AI 실패 때문에 source transaction을 롤백하지 않는다.

### 템플릿 공란 보완 실패

| 상황 | 처리 |
| --- | --- |
| 현재 자료에 개인 경험 근거 없음 | 공란 유지; 과거 패턴으로 추측하지 않음 |
| 사용자 form 값과 추출값 충돌 | form 값을 유지하고 Review item 생성 |
| `unknown` 외부 사실 | 허용된 경우에만 2.5 조사 |
| `withheld` / `not_applicable` | 모든 AI 보완 생략 |
| template binding이 registry와 충돌 | source 저장 유지, template repair 제안 |

템플릿과 공란의 전체 정책은 [12_ADAPTIVE_CAPTURE_TEMPLATES.md](./12_ADAPTIVE_CAPTURE_TEMPLATES.md)를 따른다.

## 12. 관측 가능성

처리 실행마다 다음을 기록한다.

- 모델과 API transport
- prompt/contract/registry 버전
- 입력·출력 token
- latency
- grounding 호출 수
- validator 수용·거부·병합 개수
- 신규 유형·필드 후보 수
- 사용자 수정으로 이어진 필드
- 재시도와 실패 원인

비용·정확도 최적화는 이 기록을 근거로 한다.

## 13. 현재 구현과의 차이

기존 `apps/web/src/lib/server/gemini.ts`는 구조화 출력과 바이너리 입력 기반은 갖췄지만 다음을 추가해야 한다.

- 역할별 모델 라우팅
- search/maps tools 전달
- grounding citation 수집
- capture bundle의 여러 part 입력
- 개방형 `AnalysisEnvelope`
- 단계·계약·레지스트리 버전 로그
- 비동기 상태와 재시도

기존 7개 domain enum 라우팅은 V2 분석 계약에서 사용하지 않는다.

## 14. API transport 원칙

Google API가 `generateContent`와 Interactions API 사이에서 진화할 수 있으므로 도메인 서비스가 특정 transport 응답에 직접 의존하지 않게 한다.

```text
GeminiTransport
├── analyze(bundle, contract)
├── enrich(request, tools)
└── embed(objects)

Domain Services
├── CaptureAnalyzer
├── RegistryReconciler
├── EntityResolver
└── KnowledgeCommitter
```

모델 또는 transport를 교체해도 내부 `AnalysisEnvelope`와 `EnrichmentEnvelope`는 유지한다.
