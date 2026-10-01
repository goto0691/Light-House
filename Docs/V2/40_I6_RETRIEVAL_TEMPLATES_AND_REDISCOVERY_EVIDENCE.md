# 40. I6 Retrieval, Adaptive Templates, Rediscovery 구현 근거

> 상태: I6 coded implementation 완료 · private corpus 및 실제 배포 환경 검증은 별도 release gate  
> 검증일: 2026-08-12

## 구현 결과

### 검색과 저장된 뷰

- migration 0014에 문서 제목·본문·원문·개체를 합성하는 FTS5 인덱스와 동기화 trigger를 추가했다.
- `query-plan-v1`은 전체 텍스트, 유형, 속성, 개체, 날짜, 정렬, 개수만 허용하는 고정 DSL이다. 임의 SQL은 입력할 수 없으며 날짜와 열거형을 의미 수준에서 검증한다.
- 3글자 이상은 FTS를, 짧은 한국어는 parameterized `LIKE` fallback을 사용한다.
- 검색 결과는 포함 이유와 semantic icon을 제공한다. `sensitive`·`restricted` 기록의 snippet은 반환하지 않으며, `restricted` 기록은 유효한 최근 재인증 grant 없이는 결과 자체에서 제외한다.
- 저장된 뷰는 검색 조건과 표시 설정을 분리한다. 생성 시 자동 pin하지 않고 사용자가 명시적으로 고정하며 최대 5개만 sidebar에 노출한다.
- `/v2/search`, `/v2/library/views`, `/v2/library/views/[viewId]`와 대응 API를 구현했다.

### 적응형 Capture Template

- migration 0015에 template, immutable version, source link, capture session, typed input value, pattern observation을 추가했다.
- template 정의는 exact-key 계약이며 입력 종류, blank state, AI 허용 작업, field binding을 검증한다.
- `answered`, `unanswered`, `unknown`, `not_applicable`, `withheld`를 구분한다. `withheld`와 `not_applicable` 값은 AI 입력 권한을 제거한다.
- 동반자·긍정성·중요성·의도·동의를 앞서 가정하는 질문은 prompt safety lint가 거부한다.
- 입력값은 Capture source transaction 안에서 원문 근거, `user_explicit`, `accepted`, `user_locked` 속성으로 함께 저장된다. AI는 이를 덮어쓸 수 없다.
- 자동 발견 template은 서로 다른 3일에 작성된 3개 이상의 기록 근거가 있어야 `generated_draft`가 된다. 자동 활성화·고정·navigation 생성은 금지하며, 사용자의 `try` 또는 `keep` 선택 뒤에만 이용된다.
- 빈 Capture가 언제나 첫 경로다. `도움받아 쓰기`를 선택한 경우에만 desktop side rail 또는 mobile bottom sheet를 연다. 공란 완료율이나 필수 입력 표현은 사용하지 않는다.
- Review와 운동 system template, Template Library·상세·상태 전이 API, offline checkpoint·restore·sync를 구현했다.

### 탐색과 다시 보기

- `/v2/explore`에서 유형, 사용자가 승인한 개체 관계, 월별 timeline으로 기록을 탐색한다.
- migration 0016에 다시 보기 consent와 표시·열기·숨기기 event를 추가했다.
- 다시 보기는 기본 비활성이다. 일반 기록 opt-in 뒤에만 후보를 만들고, 민감 기록은 별도의 두 번째 opt-in이 필요하다.
- `restricted` 기록은 설정과 무관하게 항상 제외한다. `sensitive` 기록은 snippet을 반환하지 않는다.
- 최근 30일 이내 기록과 최근 30일 동안 표시 또는 숨긴 기록은 다시 후보로 내지 않는다.
- `/v2/explore/rediscovery`와 preferences/events API를 구현했다.

## 검증 결과

- `npm.cmd test`: 21 files, 112 tests 통과
- `npm.cmd run test:e2e`: 46 cases 중 적용 가능한 30건 통과, 의도된 project/device 16건 skip
- `npm.cmd run build`: Next.js production build 통과, 72개 static page 생성
- `npm.cmd run typecheck`: 통과
- `npm.cmd run db:check`: `Everything's fine`
- deterministic recall baseline: 10개 정제 시나리오 모두 기대 기록을 top 10 안에서 회수해 10/10, 100%를 기록했다. 본문·제목·OCR·유형·별점·개체·날짜·다중 단어·짧은 한국어 경로를 포함한다.
- recall 검증은 `restricted` 기록의 잘못된 포함을 별도 fatal 조건으로 검사한다.
- template contract, source transaction, user-locked precedence, generated-draft 비활성, neutral prompt lint, rediscovery consent·민감·restricted 경계를 unit/contract/E2E로 검증했다.
- 검색·template·탐색 lab fixture에서 desktop/mobile horizontal overflow와 주요 interaction을 검증했다.

## 의도적으로 포함하지 않은 것

- embedding은 현재 deterministic FTS와 typed filter가 목표 recall 기준을 충족하므로 넣지 않았다. private corpus에서 의미 검색의 측정 가능한 추가 이득이 확인될 때만 보조 후보 생성기로 도입한다.
- AI가 template JSX, renderer code, SQL, icon URL을 생성하거나 실행하는 경로는 없다.
- 다시 보기는 알림·자동 Home feed로 확장하지 않았다.

## 남은 외부 release gate

- private 20건 source와 사람 승인 expected hash가 아직 채워지지 않았다. `npm.cmd run eval:private:validate` 결과는 구조 유효, 20 slots, 5 expected drafts, 0 ready이며 `readyForPrivateEvaluation=false`다. 따라서 private recall 통과를 주장하지 않는다.
- 실제 Cloudflare Auth·D1·R2 환경에서 검색·template Capture·rediscovery route를 end-to-end로 재검증해야 한다.
- Windows·Android 실제 기기, screen reader, 키보드·IME, 사용자 관찰로 template이 기억 회상을 돕는지와 입력 부담을 늘리지 않는지 확인해야 한다.

