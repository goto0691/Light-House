# S1 글·이미지 분석과 저장·리콜 연결

2026-09-23. 상태: 로컬 연결·대역 검증 완료, 실제 Gemini 분석 성공은 미확인. 범위는 [76번 인계](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 S1이다. 실제 앱의 자동 분석 flag나 모델 역할은 바꾸지 않았다.

## 사용자 흐름과 수정

- Capture는 원문/첨부를 먼저 저장한다. 분석 runner는 owner·MIME·크기·hash를 확인한 R2 bytes를 입력으로 보내고, OCR/전사 텍스트를 별도 불변 source로 저장한다. 필드·근거 제안은 Record와 Review에서 원본과 구분하며, 검색의 source match는 정확 위치로 열린다.
- Review 페이지에 유효한 restricted 재인증을 전달하고, 상세 projection 뒤 전체 목록을 다시 읽는다. 선택/비선택 제목과 건수를 최신 owner·privacy로 만들고 선택 기록은 현재 privacy/revision이 그대로일 때만 표시한다. 근거의 `원본 위치로`는 해당 Record의 source anchor로 이동한다.
- Record와 정확 검색 위치에서 OCR/전사 source를 사용자 원문처럼 부르지 않는다. AI 추출 표지는 실제 성공한 analyze run/job, 같은 capture의 원본 첨부, committed reservation, MIME에 맞는 extraction 종류, 결정적 source ID를 확인한 경우에만 붙는다. 사용자 Capture의 예약된 provenance metadata는 입력에서 거절한다.
- Record source 목록은 같은 owner·capture·현재 privacy/revision/version을 묶고 반환 직전 정책을 다시 확인한다. 실제 SQLite FK ON에서 재현된 다른 capture의 restricted source 연결과 개인정보 변경 중 읽기 경합을 차단한다.
- Astra 최종 읽기 검토에서 분석 입력의 별도 누출을 발견했다. `loadAnalysisInput()`은 분석 job의 owner뿐 아니라 document·capture·source가 모두 같은 Capture에 속하는지 SQL에서 확인한다. 다른 Capture의 restricted 원문 링크가 정상 기록에 있어도 모델 입력에 포함되지 않는다. 문서 조회와 반환 직전 확인에도 job의 Capture 경계를 적용했다.
- Gemini gateway 오류는 SDK의 원시 오류 본문을 버리고 HTTP 상태와 고정 allowlist 원인 분류만 보존한다. 인증(401), 권한·모델 접근(403/404), 요청(400/413), 할당량(429), 서버(5xx), 통신·SDK 실패를 구분한다. 비밀값·요청 본문·원시 오류 본문을 로그·문서·클라이언트에 남기지 않는다.
- Astra 후속 작업은 공급자 요청에만 `gemini-wire-schema.ts`의 스키마 투영을 적용했다. `const`를 타입이 있는 단일 enum으로, 타입 없는 enum을 명시 타입으로, 여러 scalar 타입을 `anyOf`로 표현하고 공급자 지원 목록에 없는 문자열 길이 제약은 요청에서 제외한다. 반환값은 기존 canonical 스키마로 계속 검증한다. `analysis-envelope-v1.ts`·`safe-json-schema.ts`·`model-routing.ts`는 변경하지 않았다. 설치된 SDK의 실제 직렬화 경로는 가짜 fetch로 검사했다.
- 오류 진단은 HTTP 400/403/422의 Google `ErrorInfo`에서 사전에 정한 키·서비스 상태 코드만 추가 보존한다. 원시 메시지·metadata·알 수 없는 reason은 폐기한다. 이 정보만으로 키·계정·모델을 자동 변경하지 않는다.

## 확인 근거

| 검사 | 결과 · 해석 |
| --- | --- |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/analysis-reliability.test.ts tests/contract/v2/source-foundation.test.ts tests/contract/v2/record-location-contract.test.ts tests/contract/v2/restricted-review-resolution.test.ts tests/unit/v2/analysis-extraction-source.test.ts tests/unit/v2/record-review-evidence-link.test.ts tests/unit/v2/review-page-connections.test.ts` | 분석 입력 P1 수정 전 7파일 226 PASS, exit0. 실제 node:sqlite의 합성 이미지 bytes→대역 분석→필드·근거→Record/Review→검색·정확 위치, owner/privacy/위조 경계를 포함한다. P1 수정 후 영향받는 처리 경로의 결과는 아래 별도 행이다. |
| 보안 RED→GREEN | FK ON SQLite에서 교차 capture restricted source 누출, normal→restricted 읽기 경합, AI metadata 위조 3건을 재현했다. Review SSR에서는 선택/비선택 stale 제목 2건을 재현했다. 수정 후 위 계약 검사를 통과했다. |
| Astra가 발견한 분석 입력 P1 RED→GREEN | 실제 FK ON SQLite에서 같은 owner·다른 Capture의 restricted 원문이 `loadAnalysisInput()`과 가짜 모델 요청에 들어가는 2건을 RED로 재현했다. 같은 Capture 원문 포함·가짜 모델 성공 호출 1회·다른 Capture 원문 제외를 확인했다. `analysis-reliability`, `processing-pipeline`, `provider-invocation-lease` 3파일 43 PASS, exit0. 보강한 두 시험만 최종 재실행해 2 PASS, exit0이다. 실제 provider 호출은 없다. |
| `npm exec --workspace @light-house/web -- next typegen` / `npm run typecheck --workspace @light-house/web` | 각각 exit0. |
| P1 수정 후 `npm run typecheck --workspace @light-house/web` 및 두 변경 파일 scoped ESLint | 각각 exit0. |
| S0/S1 변경 TS·TSX·시험·live script scoped ESLint | exit0. |
| `FLAG_V2_WRITE=1`의 합성 local Playwright `v2-manual-link.spec.ts --grep "real RecordSourceMaterials"` | desktop/mobile 4 PASS, exit0. 기존 flag-off 실행의 동일 4 SKIP과 구분한다. `v2-record-modules.spec.ts --grep "real module retains original-first"`는 desktop/mobile 2 PASS였다. |
| 독립 읽기 검토 | 첫 검토에서는 Record·출처·Review 수정본의 필수 미해결을 발견하지 못했다. Astra 최종 검토가 별도 분석 입력 P1을 재현했고, 이를 수정했다. 수정 후 읽기 검토는 분석 입력의 교차 Capture 누출 차단을 확인했다. 남은 `personalSourceFence()`의 잘못 연결된 다른 Capture 수동 source에 따른 불필요 차단 가능성은 개인정보 누출과 별개이며 이번 수정 범위 밖이다. 독립 시험 실행 PASS를 뜻하지 않는다. |
| 안전한 Gemini 오류 진단 | `tests/contract/v2/gemini-role-gateways.test.ts` 18 PASS, exit0(수정 전 RED 12건). HTTP 상태별 분류·무응답/Abort·원시 오류 본문 폐기를 대역으로 검증했다. 수정 파일 lint·typecheck exit0. |
| Astra 공급자 요청 호환성·안전 진단 최종 검사 | `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/gemini-role-gateways.test.ts tests/contract/v2/gemini-wire-schema.test.ts tests/contract/v2/link-analysis-v1.test.ts` → **75 PASS, 3파일, exit0** (2026-09-23 16:12 KST). 기존 링크 요청과 canonical 스키마의 불변성, scalar 의미, 길이·타입·상수 반환 검증, 실제 SDK→가짜 fetch의 요청 본문, 오류 비밀값 제거를 포함한다. 실제 공급자 성공이나 앱 전체 suite 결과가 아니다. |
| Astra 타입·lint | `npm exec --workspace @light-house/web -- tsc --noEmit --incremental false` → exit0. helper·gateway·합성 live script·gateway 시험·wire 시험 5파일의 최종 scoped ESLint → exit0. Next/typegen/build를 실행하지 않았으며 Sol의 생성물 자원 창과 겹치지 않았다. |

## 실제 Gemini 합성 확인

초기 두 번은 `npm exec --workspace @light-house/web -- tsx scripts/verify-s1-live-synthetic.ts --live`로 실행했다. 스크립트는 메모리 SQLite와 로컬 R2 대역, 합성 글·sharp 생성 PNG, 기존 main 역할·모델 설정을 사용한다. 기본 모드는 입력당 호출 1회·최대 2회이고 첫 글 실패 시 이미지는 호출하지 않는다. 마지막 남은 한도는 새 `--text-only` 모드로 **최대 1회**만 실행했다. 비밀값·모델 출력 본문·개인 자료는 출력하거나 전송하지 않는다.

첫 합성 글은 실제 provider 호출 **1회** 후 `provider_unavailable`로 종료했다(exit1). 진단 보완 후 별도 합성 글 1회를 호출했고 HTTP **400 `invalid_request`**로 분류돼 다시 exit1이었다. 두 번째 로컬 run은 `failed`/capture `needs_review`였지만 원문·Record·검색은 유지됐다. 분석 필드·근거는 0개다. 같은 실패가 확인돼 이미지는 호출하지 않았다.

설치된 `@google/genai`는 `responseJsonSchema`를 그대로 직렬화한다. canonical 분석 스키마의 일부 표현은 [Google GenerationConfig의 지원 JSON Schema 목록](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig)과 맞지 않아 위의 공급자 전용 투영을 추가했다. nullable `[T, "null"]`는 지원되는 표현이므로 오류로 취급하지 않는다. 이 보정이 실제 HTTP 400의 원인을 해결했다는 뜻은 아니다.

보정 후 2026-09-23 16:13 KST에 `npm exec --workspace @light-house/web -- tsx scripts/verify-s1-live-synthetic.ts --live --text-only`를 실행했다. 최종 exit1, `providerCalls=1`, `maxProviderCalls=1`, HTTP **400 `invalid_request`**, allowlist `reason=null`이었다. 분석 run은 `failed`, Capture는 `needs_review`이고 원문 보존·Record 읽기·presentation·검색은 유지됐다. 필드·근거·파생 source는 각각 0개, grounding 대기 작업도 0개다. 이미지는 `not_selected`로 호출하지 않았다. **누적 실호출 3/3회이며 승인된 한도를 소진했다.**

실제 거절 이유는 여전히 미확정이다. `reason=null`은 인증 문제가 없다는 증거가 아니라 허용된 진단 코드를 얻지 못했다는 뜻이다. 키·모델·스키마 복잡성 중 무엇이 원인인지 단정하지 않는다. 모델·역할·계정·결제 설정은 변경하지 않았고, 사용자에게 계정 조치를 요구할 근거는 아직 없다. 추가 공급자 진단 호출은 기존 한도 밖이므로 수행하지 않았다.

## 남은 범위

S1은 로컬 코드 연결·합성 대역 검증 상태다. 공급자 요청 스키마 보정은 완료했으나 실제 제공자 HTTP 400과 글·이미지 분석 성공 확인은 남아 있다. 추가 실호출은 3/3 한도 때문에 중단한다. 현재 자동 분석 flag를 켜거나 원격 배포·migration·과금 확대를 수행하지 않았다. 최종 읽기 뒤 발생하는 외부 동시 변경까지 한 HTTP 응답으로 원자적으로 잠글 수는 없다. S2 자동 템플릿 연결은 [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md)에 따로 기록하고, S3 웹/Threads/Instagram 수집은 Sol이 진행 중이며 S4 영상, S5 자연어 리콜·최종 통합은 [76번](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 후속 작업으로 남는다.

## 2026-09-28 후속: HTTP 400 원인 확정과 실제 제공자 성공

사용자가 Gemini 재호출을 승인해 실제 요청으로 원인을 좁혔다. 합성·공개 입력만 보냈고 비밀값·개인 자료는 출력하거나 전송하지 않았다.

- **키·모델 정상:** 모델 목록 조회와 스키마 없는 요청은 성공했다. `gemini-3.6-flash`가 목록에 있다.
- **HTTP 400 원인 = 응답 스키마의 `maxItems`:** 분석 스키마만 붙이면 `INVALID_ARGUMENT`가 났고, 공급자 투영에서 `maxItems`(최대 300)만 빼면 같은 합성 글이 유효한 envelope로 분석됐다. `gemini-wire-schema.ts`가 이제 `maxItems`도 공급자 요청에서 뺀다. 원래 스키마 검증은 그대로 상한을 강제한다(`tests/contract/v2/gemini-wire-schema.test.ts` 16 PASS, 초과 배열 거절 시험 포함).
- **503 "high demand":** 구조화 출력 요청은 모델과 관계없이 간헐적으로 503이었다. 제품은 이미 `failed_retryable`/재시도 대기로 처리한다.
- **무료 등급 일일 한도:** 이 키는 무료 등급이며 `gemini-3.6-flash`는 **프로젝트당 하루 20회**다(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, 태평양 자정 초기화). 진단으로 오늘 한도를 소진했다.
- **일일 한도 결함 수정:** governor는 한도 초과 후 15분만 쉬고, 대기열은 한도 거절도 시도 횟수를 소모했다. 그래서 일일 한도가 소진되면 약 45분 안에 작업이 영구 `needs_review`가 됐다. 이제 다음처럼 바뀌었다.
  - 429 본문에서 **분당/일일 구분과 재시도 지연(숫자·enum)만** 보존한다. quota ID·한도값·메시지는 버린다.
  - 일일 한도면 태평양 자정 + 5분까지 governor가 멈춘다(최대 26시간).
  - 한도 거절은 시도 횟수를 소모하지 않는다(`gemini-role-gateways.test.ts`, `processing-pipeline.test.ts` quota 시험).
- **실제 응답에서 발견한 계약 결함 2건:**
  1. **글 source에 `source_extractions`:** 모델이 첨부가 아닌 글 source에도 이 항목을 채웠고, 검증기가 분석 전체를 거절했다. 요청하지 않은 추출은 저장하지 않고 경고와 함께 버린다. 첨부는 여전히 추출이 필수다. 지시문도 명확히 고쳤다.
  2. **글자 offset 오차:** 모델 offset이 틀리거나(4.5/5를 23–28로 지정) 원문 길이를 넘었다(34자 원문에 29–35). 근거에 선택 필드 `quote`를 추가하고, 서버가 **범위 검사 전에** 원문에서 인용을 찾아 offset을 다시 계산한다. 같은 인용이 여러 번 나오면 모델이 준 위치에 가장 가까운 것을 쓴다. 인용이 원문에 없으면 위치를 비우고, 자동 확정 필드는 제안으로 낮춘다. 인용이 없는 근거는 기존처럼 엄격히 검사한다. validator 버전은 `analysis-semantic-v3`이다(`tests/unit/v2/analysis-extraction-sanitize.test.ts` 7 PASS).
- **실제 Gemini 결과(진단 모델 `gemini-3.1-flash-lite`, 설정 모델의 일일 한도 소진으로 대체):** `verify-s1-live-synthetic.ts --live`에 in-process `GEMINI_MAIN_MODEL`만 바꿔 실행했다. 앱 설정은 바꾸지 않았다.
  - 수정 후 반복 실행에서 **글은 매번 succeeded**였다. 필드·근거가 저장됐고, 근거 문자열 `"4.5/5"`와 `"별점 4.5/5."`가 원문과 일치했으며, 검색으로 회수됐다.
  - **이미지:** 성공 표본에서는 OCR 파생 source에 `ORBIT`가 들어가고 필드 2개와 근거 2개가 저장됐으며 검색으로 회수됐다. 나머지는 공급자 503(`retry_wait`)이었다.
  - 재정렬을 검증 뒤에 두었던 중간 단계에서는 이미지 `needs_review`도 관찰됐다. 순서를 바꾼 뒤 같은 진단 4회에서는 재현되지 않았다.
- **남은 확인:** 설정 모델 `gemini-3.6-flash`로 같은 스크립트를 한도 초기화 후 1회 실행한다. 무료 하루 20회는 개인 실사용 분석량보다 적을 수 있어, 유료 등급이나 모델 역할 조정은 사용자 결정이다.
- 관련 기존 회귀: `record-recovery-policy.test.ts` `after_record` 1건은 09-23 S1의 `getRecord()` 반환 직전 재확인 때문에 읽는 도중 변경이 404가 된 기존 회귀였다. API route가 기록이 남아 있으면 409 `record_changed_during_read`를 주도록 고쳤다(21 PASS).
