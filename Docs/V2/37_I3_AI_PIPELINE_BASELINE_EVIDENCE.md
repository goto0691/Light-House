# 37. I3 AI Pipeline 구현 근거

> 상태: I3 coded implementation 완료 · live Gemini 및 human-approved private corpus는 최종 release gate로 유지  
> 검증일: 2026-08-12

## 구현 결과

### 분석과 근거 조사

- `migrations/0008_v2_ai_processing.sql`: outbox, lease job, run telemetry, immutable analysis proposal
- `AnalysisEnvelope v1`: JSON Schema와 semantic validator를 함께 적용
- source ID, evidence offset, canonical registry key, value type, 고유 temp ID를 서버에서 검증
- `social_high_risk` 값을 AI가 accepted로 제출하면 전체 결과를 거부
- 사용자가 수정한 revision보다 늦게 도착한 결과는 `stale`로 보존하고 current knowledge로 승격하지 않음
- main analyzer는 Gemini 3.6 역할만 사용하며 grounded 2.5를 fallback으로 사용하지 않음
- run telemetry에는 hash, version, token, latency, 오류 코드만 저장하고 원문과 provider raw payload를 저장하지 않음
- `migrations/0009_v2_grounded_enrichment.sql`: `place|work|book|game` 공개 개체만 별도 grounded job으로 생성
- grounded prompt에는 정규화한 entity kind, query, requested fields만 넣고 전체 문서 본문을 전달하지 않음
- HTTPS citation이 하나도 없거나 결과 크기 제한을 넘으면 grounded result를 커밋하지 않음
- revision이 바뀐 grounded 결과 역시 `stale`이며 accepted fact로 자동 승격하지 않음

### 역할별 runtime governor

- `migrations/0010_v2_ai_runtime_governor.sql`: `main_analyzer`와 `grounded_enricher`의 상태를 분리
- D1 probe lease로 동시 runner 중 한 실행만 provider를 호출
- provider timeout/unavailable 연속 실패 시 throttle 후 circuit open
- quota exhausted는 해당 역할만 일시 중단하고 다른 역할과 source 저장은 계속 허용
- cooldown이 끝난 뒤 성공한 probe만 상태를 `healthy`로 복구
- governor가 job claim 전에 동작하므로 pause 중 attempt가 증가하지 않음

### Registry reconcile과 knowledge commit

- `migrations/0011_v2_adaptive_knowledge.sql`: type/field definition, type assignment, typed property, evidence, Review item
- 새 유형과 필드는 DDL이 아니라 사용자별 registry candidate 행으로 생성
- 동일 정의의 사용 객체가 3개가 되면 `candidate → observed`; `active`와 navigation 노출은 자동 처리하지 않음
- 직접 text evidence가 있는 low-risk accepted 값만 `source_class=user_explicit`, `review_status=accepted`로 커밋
- autobiographical AI 해석과 social high-risk 주장은 `proposed`로 제한
- 기존 current accepted 값과 다른 추출은 `disputed`와 `value_conflict` Review로 분리
- `user_locked`와 기존 accepted 값은 AI가 update 또는 supersede하지 못함
- stale analysis는 type assignment와 property를 하나도 만들지 않음
- grounded 자연어 답변은 citation과 함께 조사 결과로만 보존하며 구조화되지 않은 내용을 property로 자동 투영하지 않음

## 검증 결과

`processing-pipeline.test.ts`의 실제 workerd D1 계약 11건이 통과했다.

- outbox → lease job → run → validated proposal → knowledge commit
- 20개 runner 경쟁에서 provider call 1회, proposal 1개
- citation 없는 external result commit 0건
- 고위험 accepted proposal commit 0건
- 고위험 해석은 proposed + Review로만 저장
- user-locked 5점과 AI 추출 4.5점 충돌 시 5점 유지, 4.5점 disputed
- provider 장애 중 source read 유지와 retry schedule
- 3회 연속 provider 실패 뒤 shared circuit open, 성공 probe 뒤 복구
- quota pause 중 provider call 0, job attempt 증가 0
- stale result의 property/type assignment 0건

전체 회귀 결과:

- TypeScript typecheck 통과
- Drizzle schema/migration consistency 통과
- Vitest 14 files, 82 tests 통과
- Next.js production build 통과, V2 page/API route 포함
- production dependency audit: 취약점 0건

## 남은 외부 release gate

- 실제 `GEMINI_API_KEY`로 3.6 structured와 2.5 grounded probe 실행
- human-approved private corpus expected 결과 확정 및 전체 gate 실행
- Cloudflare 배포 환경의 D1/R2/cron smoke test

이 항목들은 코드 경계를 막지 않으므로 다음 구현 단계로 진행하되, private cutover 전에는 반드시 다시 검증한다.
