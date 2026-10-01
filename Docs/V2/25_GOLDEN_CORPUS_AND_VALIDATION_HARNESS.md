# 25. Golden Corpus and Validation Harness

> 상태: fixture·평가·release gate 확정, 실제 private source 선정 전  
> 기준일: 2026-08-12

## 1. 목적

기획의 품질은 문서 수가 아니라 실제 자료를 넣었을 때 원본을 잃지 않고 다시 찾을 수 있는지로 판단한다. 이 문서는 [01_GOLDEN_CORPUS_AND_RECALL_SCENARIOS.md](./01_GOLDEN_CORPUS_AND_RECALL_SCENARIOS.md)를 실행 가능한 test harness로 바꾼다.

검증을 네 층으로 분리한다.

1. deterministic unit/contract test
2. fake-provider integration test
3. private golden corpus model evaluation
4. desktop·mobile usability and privacy test

AI score가 높아도 source loss, user overwrite, privacy leak가 있으면 release할 수 없다.

## 2. Fixture security and repository layout

```text
apps/web/
  tests/
    unit/v2/
    contract/v2/
    integration/v2/
    e2e/v2/
    fixtures/sanitized/             # git에 포함 가능
    fixtures/contracts/             # invalid JSON, MIME, archive fixtures
tools/v2-eval/
  schemas/
  scorers/
  reports/
.private/golden-corpus/              # gitignore, local only
  manifest.yaml
  sources/
  expected/
  model-runs/
```

규칙:

- 실제 글·사진·녹취는 `.private/golden-corpus` 밖으로 복사하지 않음
- git에는 synthetic 또는 철저히 익명화한 fixture만 포함
- manifest의 source path는 relative path, report에는 case ID와 metric만 기록
- screenshot에 제3자의 이름·연락처가 있으면 corpus 작성 단계에서 별도 private redaction derivative를 만들되 original hash는 원본 검증용으로만 보존
- CI는 sanitized suite만 실행
- private suite는 local 또는 승인된 private environment에서 수동 실행
- model request/response body는 report에 넣지 않고 필요하면 7일 ephemeral debug 정책 사용

## 3. Initial 20-case corpus

실제 source를 다음 slot에 하나씩 배정한다. 너무 잘 정리된 예시만 고르지 않는다.

| ID | 자료 | 핵심 검증 |
| --- | --- | --- |
| GC-01 | 짧은 식당 리뷰 text | 장소·메뉴·4.5/5·데이트 추천, user rating 보존 |
| GC-02 | 음식 사진 + 짧은 note | image와 평가 분리, food/place 후보 |
| GC-03 | 과거 place row가 섞인 기록 | 방문 event와 place entity 분리 |
| GC-04 | 영화 감상평 | 작품 resolution, 감독·배우 external citation |
| GC-05 | game title photo + review | OCR title, work identity, user assessment |
| GC-06 | 드라마/애니메이션 비교 글 | 복수 work entity와 relation |
| GC-07 | 독후감 | book identity, quote와 commentary 분리 |
| GC-08 | 책 한 줄 촬영 | OCR region, page uncertainty, 원본 회귀 |
| GC-09 | 묵상 | topic index, high-risk inference 제한 |
| GC-10 | 장문 essay | Markdown, headings, multiple theme retrieval |
| GC-11 | 시 | 줄바꿈·문장부호 원형 보존, 과도 구조화 방지 |
| GC-12 | 습작/미완성 글 | draft status, AI가 완결된 글로 만들지 않음 |
| GC-13 | workout app screenshot | 날짜·거리·시간·심박 typed measurement |
| GC-14 | 다른 형식의 운동 기록 | unknown/new type과 dynamic field candidate |
| GC-15 | 논쟁 screenshot | 발화자 후보, 주장과 사실 구분, privacy |
| GC-16 | 2인 녹취 | speaker uncertainty, event date, timecode |
| GC-17 | 여러 날짜·인물의 긴 녹취 | document/event split proposal, no false certainty |
| GC-18 | 흥미로운 web scrap + commentary | external source와 사용자 생각 분리 |
| GC-19 | 명시값과 외부값이 충돌하는 기록 | precedence, dispute presentation |
| GC-20 | 처음 보는 혼합 bundle | unclassified fallback, source loss 0 |

privacy variant는 GC-09, 15, 16을 복제한 `normal/sensitive/restricted` projection fixture로 만든다. offline, duplicate, quota는 동일 source를 쓰는 transport scenario이지 20개의 의미 corpus slot을 소비하지 않는다.

## 4. Expected result authoring

model을 실행하기 전에 사람이 expected result를 작성한다.

```yaml
case_id: GC-01
source_hashes: ["sha256:..."]
must_create:
  documents: 1
  entities:
    - kind: place
      resolution: candidate_or_better
  events:
    - kind: visit
must_preserve:
  - exact_user_rating: { value: 4.5, scale_max: 5 }
  - recommendation_context_contains: date
must_not_assert:
  - exact_address_without_citation
  - companion_person
acceptable_variants:
  primary_type: [place_review, dining_note]
required_evidence:
  - target: user_rating
    locator_kind: text_span
recall_queries:
  - query: "별점 4점 이상인 식당"
    expected_in_top: 10
severity_overrides:
  user_rating_overwrite: fatal
```

expected result는 exact string match만 강요하지 않는다. 의미상 허용 가능한 type alias, entity candidate 상태, date precision을 명시한다.

## 5. Test stack

Phase 1에서 다음을 dev dependency로 도입한다.

- Vitest: domain·validator·projector unit/contract
- Playwright: desktop/mobile route, offline, upload, privacy E2E
- `@axe-core/playwright`: 접근성 자동 검사
- Wrangler/Miniflare local D1·R2: repository integration
- fake Gemini gateway: deterministic failure·retry·schema fixture

real Gemini 호출은 일반 `test` command에 포함하지 않는다. `eval:private`로 분리하고 model·prompt·schema version과 비용/usage를 report에 기록한다.

권장 scripts:

```json
{
  "test": "vitest run",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:e2e": "playwright test",
  "eval:private": "tsx tools/v2-eval/run.ts",
  "eval:compare": "tsx tools/v2-eval/compare.ts"
}
```

실제 package와 Cloudflare local runtime 호환은 implementation spike에서 lockfile로 확정한다.

## 6. Deterministic suite

### Domain invariants

- property row 하나에 typed value 하나만 존재
- user_locked와 user_explicit precedence
- social_high_risk accepted gate
- revision immutability와 stale run
- type/field registry reconcile
- template unanswered/unknown/not-applicable 구분
- icon/preset fallback

### Source and storage

- capture idempotency
- D1 batch rollback injection
- attachment reservation/verify/commit
- checksum·MIME·size reject
- orphan cleanup과 shared reference purge
- export path traversal reject

### Presentation and privacy

- normal/sensitive/restricted snapshot
- unlock 전 restricted serialization이 empty contract인지 확인
- Rediscovery restricted exclusion
- sensitive snippet and notification redaction
- missing module이 generic renderer로 fallback
- provenance label과 evidence link

## 7. Fake-provider integration scenarios

모든 stage에서 다음 response를 주입한다.

- valid structured output
- invalid JSON
- valid JSON, invalid schema
- unknown registry key flood
- evidence out of bounds
- timeout before body
- timeout after provider accepted
- 429 with/without retry-after
- 500/503
- grounded result without citation
- partial attachment failure
- late response for stale revision

검증은 화면 error message뿐 아니라 DB의 partial write, duplicate, job transition을 확인한다.

## 8. AI quality scoring

기존 16점 rubric을 자동·수동 metric으로 해체한다.

| 항목 | metric | 목표 |
| --- | --- | ---: |
| source preservation | byte/text hash equality | 100% |
| user explicit values | exact typed value recall | 100% |
| must-create object | micro recall | ≥ 0.90 |
| forbidden assertion | critical false assertion count | 0 |
| type assignment | accepted alias precision/recall | ≥ 0.85 / 0.85 |
| entity resolution | correct or candidate-safe | ≥ 0.90 |
| evidence text span | expected quote coverage | ≥ 0.90 |
| image region | target overlap, human review | ≥ 0.70 |
| external claims | citation coverage | 100% |
| recall scenario | expected object top-10 | ≥ 0.90 |
| provenance | correct source class | ≥ 0.95 |

전체 평균만으로 통과하지 않는다. case별 기존 13/16 기준과 fatal gate를 함께 적용한다.

## 9. Severity

### Fatal — 즉시 release block

- source text/bytes loss or mutation
- user explicit·locked value overwrite
- wrong entity 자동 확정으로 다른 작품·장소와 병합
- restricted payload unlock 전 전송·cache·snippet 노출
- high-risk social inference 자동 accepted
- export/restore source hash mismatch
- duplicate retry로 canonical object가 중복 생성

### Major — promotion block

- required evidence 없음
- external accepted claim citation 없음
- recall top-10 반복 실패
- template 질문이 사건·감정을 전제
- sensitive record unexpected rediscovery
- AI failure가 source save failure처럼 표시

### Minor

- non-critical label, ordering, optional metadata 누락
- generic renderer로는 열리지만 specialized module 정렬 실패

## 10. Recall evaluation

query set은 자연어와 구조 filter를 함께 가진다.

```yaml
- id: R-PLACE-01
  query: "데이트하러 가기 좋다고 했던 식당"
  required_ids: [GC-01_DOCUMENT]
  top_k: 10
  allowed_privacy: [normal]
  explanation_requires: [recommendation_context]
```

metric:

- top-1, top-5, top-10 hit
- false restricted/sensitive inclusion
- structured condition correctness
- result inclusion reason correctness
- evidence click → source focus 성공

semantic embedding이 없어도 FTS·field·relation baseline을 먼저 측정한다. embedding 도입은 baseline보다 실제 recall을 개선할 때만 유지한다.

## 11. Template psychology experiment

목표는 3~5개 cue가 기억을 돕는지, 오히려 글을 고정하는지 확인하는 것이다.

### 조건

- A: blank capture
- B: neutral core cue 3개
- C: neutral core cue 5개

조건 순서는 참가자별 counterbalance한다. 같은 기억을 세 번 쓰게 해 학습 효과를 만들지 않고 유사 난이도의 서로 다른 실제 경험을 배정한다.

측정:

- 첫 문장까지 시간
- 저장까지 시간
- 자발적 detail 수
- cue 밖 detail 수
- 사실과 다른 전제 수
- 빈칸 압박 self-report 1~7
- 저자성 self-report 1~7
- template을 닫거나 blank로 전환한 비율

통과 기준:

- cue 조건이 blank보다 첫 문장 시간을 악화시키지 않음
- false premise 증가 0
- cue 밖 detail이 유의미하게 감소하지 않음
- 5개가 3개보다 명확히 우월하지 않으면 3개를 기본 가설로 유지
- 어떤 결과든 blank capture는 항상 첫 경로로 유지

## 12. IA and interaction usability test

최소 5명의 실제 대상 사용자 또는 지인으로 desktop/mobile 각 핵심 task를 수행한다. owner 반복 test는 formative evidence로는 쓰되 5명 이해도 결과로 대체하지 않는다.

### tasks

1. 분류 없이 사진+note 새 기록
2. 과거 게임 리뷰 찾기
3. 방문 장소만 모아보기
4. AI가 넣은 감독 정보의 근거 확인
5. 잘못된 entity 수정
6. template 없이 자유 글로 전환
7. sensitive 기록의 재노출 설정 이해
8. restricted 기록 잠금·해제
9. offline draft와 source commit 차이 설명
10. export 생성과 범위 확인

목표:

- capture 저장 success ≥ 90%
- Library/search core task success ≥ 85%
- source commit과 AI complete 구분 100%
- AI provenance 의미 구분 ≥ 80%
- restricted unlock 전 내용 노출 0
- 잘못된 메뉴 진입 후 회복 가능 ≥ 90%

## 13. Visual and accessibility matrix

- 320, 390, 768, 1180, 1440 px
- light/dark
- 200% zoom
- keyboard only
- Korean IME composition
- screen reader naming and live status
- reduced motion
- list density normal/compact
- body 5만 자
- 10k·100k generated record query fixture

snapshot diff는 보조이며 focus order, scroll recovery, evidence round-trip은 Playwright assertion으로 검증한다.

## 14. Report format

```text
V2 Validation Report
- build SHA
- schema/migration version
- model role config
- prompt/schema/registry versions
- sanitized suite result
- private corpus aggregate and per-case severity
- recall metrics
- UX sample and task success
- privacy invariant result
- performance observations
- known limitations
- decision: pass | conditional | fail
```

private report의 실패 예시는 source 내용을 복사하지 않고 case ID, expected rule, actual normalized code만 표시한다.

## 15. Promotion gates

### Source Foundation → AI alpha

- deterministic suite 100%
- idempotency·rollback·privacy fatal 0
- sanitized E2E green

### AI alpha → private beta

- 20-case expected result를 사람이 먼저 작성
- fatal 0, major unresolved 0
- case 평균 ≥ 13/16
- recall top-10 ≥ 90%
- model rollback drill 성공

### private beta → default V2

- 새 capture 2주 source loss 0
- export/restore round-trip 성공
- representative legacy dry-run 성공
- core usability target 충족
- accessible keyboard/mobile flow 통과

## 16. First implementation tasks

1. `.private/golden-corpus`와 sanitized fixture 경계 생성
2. 20 slot manifest template 생성
3. fake Gemini gateway와 invalid response fixture
4. Vitest domain invariant suite
5. local D1/R2 repository integration harness
6. Playwright normal/sensitive/restricted serialization test
7. private evaluator and comparison report
8. 실제 20건 expected result 작성 후 real model baseline 실행

실제 corpus 선정 전 model prompt를 최적화하지 않는다. 보기 좋은 demo 세 건에 맞춘 prompt는 이 제품의 다양한 기록을 대표하지 못한다.
