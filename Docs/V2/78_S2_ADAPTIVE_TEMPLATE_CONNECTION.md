# S2 반복 기록에서 선택적 템플릿 제안까지

2026-09-23 최초 기록, 2026-10-01 관찰 재시도 보완. 상태: 실제 처리 경로 연결·합성 SQLite/desktop/mobile 검증과 내구성 관찰 재시도 구현 완료. 최초 검증 당시 실제 Gemini 분석은 HTTP 400으로 미확인이었으며, 이후 실제 공급자 상태는 [77번](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md)의 후속 기록을 따른다. 아래 2026-10-01 재시도 검증에는 실제 공급자 호출을 사용하지 않았다. 범위는 [76번 인계](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 S2다.

## 연결한 사용자 흐름

- `/api/v2/processing/run`이 분석 runner에 템플릿 관찰기를 전달한다. runner는 `completeAnalysis()`가 최신 revision의 성공 결과를 저장한 **뒤에만** 관찰한다. 실패·stale 결과는 관찰하지 않으며, 관찰 오류는 별도 `patternObservation: "failed"`로 반환하고 성공한 분석을 실패·Gemini 재호출로 바꾸지 않는다.
- 관찰기는 저장된 성공 job/run, owner·Capture, `ai_enabled=1`, 현재 revision, legacy visibility, `normal` privacy를 다시 확인한다. 이번 run에서 실제 저장된 저위험·accepted 필드 3개 이상의 canonical key와 값 종류만 사용한다. 기록 날짜는 Capture의 `captured_at`을 저장된 사용자 시간대로 계산한다.
- 서명은 반복 구조 키의 해시다. 생성 정의에는 합성 원문·필드 값·AI 제목/요약/label을 복사하지 않는다. 질문은 고정된 중립 문구 또는 항목 번호이고 허용된 `primary_document.fieldKey` binding만 넣는다. 기본값은 넣지 않는다. 기존 system seed와 같은 구조의 중복 제안도 막는다.
- `observePattern()`은 같은 사용자·서명·문서를 한 번만 센다. 같은 문서의 새 revision을 재분석하면 기존 관찰의 revision을 현재 것으로 갱신하므로 3문서 기준에서 사라지거나 중복 계수되지 않는다. 집계와 게시 SQL은 현재 active·`normal` 문서 및 현재 AI 동의가 켜진 원본 Capture만 센다. 관찰 후 동의를 철회한 기록도 즉시 기준에서 빠진다. **서로 다른 3문서·3일** 뒤에도 템플릿은 `generated_draft`이며 자동 활성화·고정되지 않는다.
- 아직 사용자가 선택하지 않은 `ai_derived` 자동 초안은 읽기·선택 전이 때 현재 버전의 출처 링크에서 적격 3문서·3일을 다시 확인한다. 동의 철회·restricted 전환·새 revision 때문에 부족해지면 Library/API에서 숨기고 `try`/`keep` 저장 시점에도 차단한다. 이후 같은 구조의 네 번째 적격 기록이나 기존 기록의 성공적인 재분석이 들어오면 현재 버전에 새 출처 링크를 추가해 다시 제안한다. 과거 링크와 버전 정의는 보존한다. 사용자가 이미 선택한 `trial`/`active`의 사후 정책은 이 자동 초안 제한에 포함하지 않았다.
- Template Library의 자동 초안에서 사용자가 `이번에 사용`을 선택하면 `trial`로 바뀌고 새 Capture에 빈 입력 구조가 열린다. `계속 사용`은 별도의 명시 선택이다. 새 Capture의 사용자가 쓴 본문과 입력값은 원본·사용자 잠금 속성으로 함께 저장된다. 작성 중인 다른 Capture를 강제로 바꾸지 않는다.
- 상태 전이는 읽은 template의 `status`·`current_version_id`·고정값을 UPDATE 조건에서 다시 비교한다. 다른 요청이 먼저 dismiss/archive/새 버전 저장을 끝내면 오래된 `try`/`keep`은 `template_transition_invalid`로 충돌하고, 닫힌 template을 다시 활성화하지 않는다. 미선택 자동 초안의 출처 적격성도 같은 UPDATE 문에서 검사한다.

## 최종 확인

| 검사 | 결과와 범위 |
| --- | --- |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/s2-analysis-template-flow.test.ts tests/contract/v2/retrieval.test.ts tests/contract/v2/legacy-projection-read-visibility.test.ts -t "S2 completed analysis\|keeps generated patterns inactive\|template learning\|generated template publication\|same-pattern insert race"` | 15 PASS/15 SKIP, exit0. 신규 FK ON SQLite 흐름 11건과 기존 생성·게시 원자성/race/legacy visibility 4건이다. 실제 Capture commit→dispatch→가짜 분석 저장→관찰→3일/3문서→초안→try/keep→새 Capture 입력·저장, 같은 run 재호출·새 revision, restricted/동의 철회, failed/stale, 관찰 예외, 사후 노출·전이 경합·재분석·네 번째 기록 회복을 확인했다. 가짜 provider만 사용했다. 신규 파일 단독 실행도 11 PASS/exit0이었다. 처리 pipeline의 인접 경로 2건을 함께 실행한 앞선 범위는 8 PASS/15 SKIP이었다. |
| PowerShell에서 `$env:FLAG_V2_WRITE='1'` 설정 후 `npm exec --workspace @light-house/web -- playwright test tests/e2e/v2-s2-template-flow.spec.ts` | desktop/mobile 2 PASS, exit0. 실제 Capture 컴포넌트에서 비자동 표시, 사용자 선택한 trial 구조, 빈 값, 직접 입력, 모바일 도움 패널 닫기, 저장 요청을 확인했다. 이 브라우저 시험의 template API와 commit 응답은 합성 대역이다. Library 목록·상태 전이 저장소는 FK ON 계약 시험으로 확인했고 Library SSR 화면 자체의 새 브라우저 시험은 수행하지 않았다. |
| `npm exec --workspace @light-house/web -- next typegen`; `npm run typecheck --workspace @light-house/web`; 변경 TS/TSX·시험·script scoped ESLint | 각 exit0. |

첫 브라우저 실행은 desktop의 배열 전체 비교가 미입력 항목을 예상하지 못했고, mobile은 열린 입력 도움 패널이 저장 버튼을 가렸다(2 FAIL). 시험을 실제 사용자 동작에 맞춰 패널 닫기와 입력 항목 포함 검증으로 고친 뒤 desktop/mobile 2 PASS였다. 시험 시간을 늘리거나 클릭 강제 옵션을 쓰지 않았다.

### 후속 전이 경합 보완 · 2026-09-23

FK ON SQLite에서 읽기 직후 경쟁 요청이 `dismiss`/`archive`하거나 현재 버전을 교체하는 세 사례를 먼저 추가했다. 수정 전 선택 실행은 **3 FAIL/11 SKIP, exit1**이고 세 사례 모두 오래된 `try`/`keep`이 성공했다. 전이 UPDATE에 읽은 상태·버전·고정값 CAS를 넣고 기존 동의 철회 경합에 restricted 변경도 보강했다. 마지막 변경 뒤 `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/s2-analysis-template-flow.test.ts`는 **14 PASS, exit0**이었다(2026-09-23 16:24 KST). 정상 `try`→`keep`과 사후 적격성·회복 시험을 포함한다.

변경한 repository·시험 두 파일의 scoped ESLint는 exit0이었다. 중간 공유 체크아웃 typecheck는 동시 진행 중인 S3 파일 두 곳의 오류로 exit2였고, 해당 오류를 수정한 뒤 `npm run typecheck --workspace @light-house/web`을 다시 실행해 **exit0**을 확인했다. 이 후속 수정은 원격 실행·Gemini 호출을 하지 않았다.

## 내구성 관찰 재시도 · 2026-10-01

### 저장·복구 경계

- 신규 `analysis-pattern-retry.ts`가 성공한 `v2_processing_jobs`·`v2_processing_runs`와 같은 run의 `validated` proposal을 내구성 원장으로 사용한다. 분석 commit 직후 프로세스가 중단되거나 관찰·receipt 저장이 실패해도 다음 처리 실행이 누락된 관찰을 다시 찾는다. main 분석의 상태·attempt·provider 호출은 바꾸지 않는다.
- 기존 운영용 `v2_idempotency_records`의 owner-scoped operation `template_pattern.observe_analysis.v1`, key `runId`, payload hash `inputHash`에 완료·실패 receipt를 기록한다. 원문·제목·필드 값·공급자 오류 내용은 복사하지 않는다. 고정 오류 코드 `template_pattern_observation_failed`와 시도 수·다음 시각만 남긴다. 새 migration·테이블·canonical export 형식 변경은 없다. 이 운영 receipt는 canonical 백업에 포함하지 않으며, 복원된 성공 원장은 같은 출처 검사를 통과할 때 안전하게 다시 관찰한다.
- 선택 조회와 개별 실행·성공 receipt replay에서 owner, Capture, input/output hash, 성공 run, validated proposal, 현재·분석 revision, 정상 revision 소속, active 문서, `normal` privacy, 현재 AI 동의, legacy visibility를 확인한다. 실제 관찰은 기존 observer/repository의 current-run 필드와 쓰기 시점 출처 검사를 다시 사용한다. 동의 철회·restricted 전환·다른 revision의 원장을 관찰 권한으로 쓰지 않는다.
- 복구는 HTTP 호출당 최대 3 run이다. 실패는 1분부터 지수 backoff하고 최대 1시간 간격으로 계속 재시도한다. 기존 5분 cron 때문에 실제 재시도는 다음 처리 실행 시점이다. 실패 항목이 backoff 중에는 후속 run을 막지 않고, 정상 `skipped`도 완료 receipt를 기록한다. 다른 hash와 충돌한 receipt 및 손상된 terminal receipt는 재사용·덮어쓰기하지 않고 sweep에서 제외하므로 나머지 작업의 슬롯을 막지 않는다.
- 관찰 INSERT 뒤 템플릿 게시가 실패해도 receipt가 완료되지 않으므로 게시까지 다시 수행한다. 문서/서명 고유 키와 기존 원자적 게시 SQL이 중복 관찰·템플릿을 막는다. 병렬 실패가 먼저 저장된 성공 receipt를 503으로 되돌릴 수 없도록 UPSERT를 제한한다. 사용자가 선택한 `trial`/`active`·`dismissed`·`archived`의 상태·버전·출처 링크는 복구로 바꾸지 않는다.
- `wrangler.toml`의 `*/5 * * * *` → `custom-worker.ts`의 `scheduled()` → `runV2ScheduledJobs()`가 인증 헤더를 넣은 **POST `/api/v2/processing/run`**을 실행한다. 이 기존 경로 앞부분에 복구 sweep을 연결했다. quota로 main governor가 멈춰도 복구는 공급자 호출 없이 실행된다. sweep 전체 오류도 별도 `patternObservationRetries.outcome='failed'`로 격리한다.

### 로컬 검증과 비용

| 검사 | 결과와 범위 |
| --- | --- |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/s2-analysis-pattern-retry.test.ts tests/contract/v2/scheduled-jobs.test.ts` | **34 PASS, exit0**. 최종 신규 29건은 FK ON 실제 Node SQLite·합성 provider·직접 HTTP route 호출이다. 관찰 전 중단, 관찰 후 모든 receipt 쓰기 실패, 세 번째 관찰 뒤 게시 실패, backoff와 후속 run 진행, 충돌/손상 receipt 뒤 정상 run, 지연 실패/성공 경합, owner/Capture/hash/run/proposal/revision/legacy/privacy/consent, 사용자 template 선택 보존, quota pause·HTTP 인증·오류 격리·복구 3+main 3을 확인했다. 기존 cron 5건은 POST/인증/안정된 실행 순서를 확인했다. |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/s2-analysis-pattern-retry.test.ts tests/contract/v2/s2-analysis-template-flow.test.ts tests/contract/v2/link-analysis-request.test.ts tests/contract/v2/link-worker-budget-observation.test.ts` | **63 PASS, exit0**. 이 실행은 신규 시험이 22건이던 중간 시점이고 기존 S2 14건·link HTTP 23건·호출 계측 4건을 포함한다. 이후 충돌 receipt 필터와 추가 경계 시험은 바로 위 최종 34건에서 확인했다. 두 실행의 수치를 더하지 않는다. |
| 변경 helper·route·신규 시험 scoped ESLint | **exit0**. Next route guide를 읽었으며 typegen/typecheck·전체 회귀·Worker build는 통합 실행 소유자의 별도 검증 범위다. |

첫 실행은 신규 22건+기존 S2 14건 중 34 PASS/2 FAIL이었다. 두 실패는 신규 시험 fixture가 잘못된 Capture를 선택하고 governor의 존재하지 않는 열 이름을 사용한 문제였다. fixture 수정 뒤 해당 범위를 모두 통과했고 검증 조건·timeout은 낮추지 않았다.

idle sweep은 후보 SELECT 1회를 추가한다(스키마 cold probe는 별도). 새 분석의 성공 관찰 callback은 기존 관찰 외 자격/receipt 조회 2회+receipt 쓰기 1회를 추가한다. 복구 3개와 신규 main 분석 3개를 함께 실행한 합성 fixture는 **D1 binding 164회, SQL 329문, batch 23회**, provider 호출 정확히 3회였다. 한 batch 안 SQL을 각각 binding 호출로 세지 않았다. 복구는 provider의 기존 3-job 한도를 늘리지 않지만 DB 작업 예산은 증가한다. 이 계측은 Worker CPU·네트워크·원격 D1 한도 증명이 아니며, 운영 환경의 호출 한도 확인은 별도 gate다.

## 한계와 다음 순서

관찰 저장 일시 오류의 내구성 누락은 위 로컬 복구 경로로 보완했다. 실제 개인 기록에서 관찰이 쌓이는 품질·원격 cron 실행·배포 환경의 DB/CPU 예산은 이번 합성 검증에 포함하지 않았다. 원격 배포·migration·legacy cutover·서비스/과금 확대·실제 Gemini 호출은 수행하지 않았다. S1–S5 전체 통합·운영 상태는 [현재 상태](./CURRENT_WORK_STATE.md)와 [전체 완료표](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)를 따른다.
