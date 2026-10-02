# Windows V2 통합 후보 · 2026-10-03

현재 Windows 작업 폴더에서 GitHub `main`의 `7a5d771`을 동기화한 뒤 V2 잔여 구현과 검증을 진행했다. 작업 브랜치는 `codex/v2-completion-local`이다. 기존 로컬 작업 43개 파일은 `codex/pre-v2-sync-2026-10-02-local-work` stash로 보존했고 환경 파일도 유지한다. 이 문서의 로컬 결과는 원격 운영과 실기기 완료 판정과 구별한다.

## 1. 이번 변경

- 영상 분석의 요약·구간·음성·화면 글자·제한 항목별 확정/기각을 API와 Record에 연결했다. 현재 원문/revision/분석 identity·소유자·restricted 재인증·CAS와 요청 재생을 검사한다. 원래 AI 응답은 유지하며 사용자 판단이 반영된 복사와 AI 원본 복사를 구분한다.
- 일반 복원과 실제 공개 API의 resumable 복원 모두에서 owner 충돌 뒤 반복 import가 이전 검증 매핑을 재사용하도록 보완했다. 이전 성공 batch·원문 hash·현재 canonical target·소유자 일치가 모두 필요하며 다른 owner, 실패/rollback, 바뀐 대상은 재사용하지 않는다. 실제 SQLite 공개 workflow 20개와 별도 첨부 ZIP의 두 번 반복 복원을 확인했다. 첨부 포함 진단은 checked-in 시험의 개수에 합산하지 않는다.
- cutover는 최신 exact build/corpus의 recorded evidence와 실제 승인 proof를 검사한다. 수동 boolean, 미래/오래된 시각, 미채점 평가를 통과로 취급하지 않는다.
- Notion 백업 원문에 근거한 20개 expected를 만들고 독립 검토했다. 사용자 위임과 사람 승인을 별도 상태로 저장하며 proof가 원문·규칙·위임 context에 결합된다.
- 실제 capture/getRecord/retrieval/resumable export를 격리 SQLite/R2에서 실행하는 private replay와 product collector를 연결했다. 승인된 literal query와 실제 검색 plan의 일치도 확인한다. expected의 유형/필드 정답을 제품 결과로 주입하지 않는다.
- Windows inventory 실행 경로와 LF 생성 선언/fixture 차이를 보완했다. 실제 UI 검사에서 드러난 긴 필드의 DOM commit 전 포커스 경합과 좁은 화면의 정렬 라벨 대비를 수정했고 붙여넣기 spec은 쓰기 flag 가정 대신 명시적 오프라인 조건을 사용한다.
- Worker는 운영 호환성 날짜를 지원하는 최소 Wrangler 4.122.0으로 고정했다. 정확한 오프라인 HTML 응답과 기존 설치의 캐시 갱신을 배포 설정·shared service worker에 연결했다.

## 2. 현재 검증 범위

각 실행의 최종 exit와 이후 변경의 영향을 함께 기록한다. 전체 실행의 실패를 부분 재검증의 exit0으로 덮어쓰지 않는다.

| 검사 | 결과 |
| --- | --- |
| 도구 전체 | 최종 pin/Node 타입 보완 뒤 단일 실행 Node78/78(새 정규화7개 포함) + 격리 replay5/5 + private-live12/12, 합계95 PASS, skip0, exit0 |
| 타입 | web/evaluator/replay/private-live/cutover 모두 exit 0 |
| lint | 최종 통합 및 생성 wrapper/normalizer 전용 exit0, app 오류0/기존 경고80, evaluator/cutover 오류0 |
| bindings/db | 최종 exit 0 |
| 영상 판단 UI | desktop/mobile 10/10 PASS, axe/overflow/복사/재시도/권한 확인 |
| 첫 전체 브라우저 | 877 PASS/21 SKIP/6 FAIL, exit 1, 36.3분. 세 실패 유형을 보완한 뒤 아래 최종 실행 |
| 최종 전체 브라우저 | `f718743`의 UI 소스, 883 PASS/21 SKIP/실패0, exit 0, 30.5분. 이후 Worker 배포 설정·shared SW 변경은 별도 native Worker/Chrome 검사로 확인 |
| Capture 전환 flag | 별도 desktop profile 1/1 PASS, exit 0, 11.9초. legacy write 차단·V2 인증 도달 확인 |
| Library 전환 flag | 별도 desktop profile 1/1 PASS, exit 0, 12.7초. default flag에 따른 루트 이동 확인 |
| 전체 Vitest | 공개 resumable 보완 뒤177파일/3,604시험 실행: 3,598 PASS/6 FAIL, exit1, 5,897.67초. 실패는 Windows symlink 권한5개와 license CRLF1개 |
| Windows 실패 보완 | validator·앱 runtime 불변. Windows junction으로 실제 canonical escape/inside 검사를 유지하고 license LF 고정 후 실패2파일전체24/24 PASS, exit0, 1.50초. 나머지175파일/3,580시험은 위 전체 실행의 PASS 유지 |
| 새 pin의 관련 회귀 | 프로젝트 Wrangler4.122.0 기본 workerd에서 Worker 설정/shared SW/secret audit·실제 D1 source commit/R2 attachment·resumable restore6파일34/34 PASS, exit0, 1,045.84초. 이전 전체 suite를 새 engine의 단일 전체 PASS로 재표기하지 않음 |
| secret-safe Worker | Node24.19.0·프로젝트 Wrangler4.122.0 최종 build exit0, 환경2개 가림/복원·7,505파일 감사·secret hit0. build-only flag 없이 config 초기화·compiled env3종 빈 객체 확인 |
| 로컬 Worker package | 운영 날짜8/12·프로젝트 기본 workerd1.20260811.1·Node compat·exact HTML 설정, HTTP8개+실제Chrome2시나리오 PASS/exit0. native D1/R2, capture/manifest, fresh offline, 기존307캐시→v3/초안 전체행·ID 보존 확인. AI/write0·cron없음·합성 local binding |

모든 브라우저 검사는 로컬 Chrome/Pixel 7 에뮬레이션과 합성 API fixture다. 실제 Android 설치/OS Share와 원격 DB/R2 결과를 대신하지 않는다. 전체 Vitest는 실제 local workerd/D1 회귀를 포함하지만 원격 계정 한도를 증명하지 않는다.

### Windows와 운영 Worker 설정에서 확인한 결함

기본 Node 24.11.1은 이 한글 경로에서 recursive `cpSync`가 파일을 복사하지 않고 성공으로 돌아왔고 recursive `rmSync` 진단은 native 비정상 종료로 끝났다. ASCII 경로·개별 파일 복사와 분리해 실제 synthetic sentinel로 재현했다. 프로젝트의 [파일 시스템 사전 검사](../../apps/web/scripts/worker-filesystem-preflight.mjs)는 같은 Node executable의 격리 자식에서 복사·정확 바이트·정리 후 실제 부재를 확인한다. timeout/비정상 종료/자식 시작 오류를 고정 오류로 거절하며 build lock 획득·환경 파일 읽기/가림·산출물 변경 전에 실행한다. credential 없는 system/path allowlist를 사용한다. 이전 Node의 의도된 거절은 exit1·기존 산출물 유지·build lock 없음·환경 파일2개 유지로 확인했다.

검증된 Node 24.19.0을 이 작업의 PowerShell PATH에만 우선 배치하고 각 명령 뒤 원래 PATH로 복귀했다. 사용자 전역 Node 설정을 바꾼 결과가 아니며 특정 버전 문자열만 보고 파일 시스템 검사를 생략하지 않는다. 독립 진단의 synthetic TEMP 디렉터리5개는 파일을 삭제하지 않는 이동으로 ignored 증거 폴더에 보존했다.

Wrangler 4.121.0의 bundled workerd는 운영 날짜 `2026-08-12`를 지원하지 않았다. 새 binary만 바꿔도 중복 `nodejs_compat` flag 때문에 시작이 거절됐다. [Wrangler 4.122.0의 공식 수정](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.122.0)은 날짜에 따른 Node 기본값과 중복 positive flag를 처리한다. 최소 pin·lockfile의 miniflare/workerd를 함께 갱신했으며 기본 workerd 1.20260811.1의 [지원 상한은 2026-08-18](https://raw.githubusercontent.com/cloudflare/workerd/v1.20260811.1/src/workerd/io/maximum-compatibility-date.txt)이다. 최종 검사는 별도 binary override 없이 설치된 프로젝트 도구와 운영 날짜·Node 설정을 사용한다.

새 generated runtime types는 Node 전역 `Buffer`·`process`·`global`의 const 선언이 설치 `@types/node`를 가리는 [upstream issue7026](https://github.com/cloudflare/workerd/issues/7026)도 재현했다. `const→var` 제안은 아직 [미병합 PR7539](https://github.com/cloudflare/workerd/pull/7539)이며 이 환경에서는 encoding 오류가 없어져도 `Buffer.from`/`process`가 any로 남았다. 프로젝트의 [생성 wrapper](../../tools/v2-release/run-wrangler-types.mjs)는 정확한3개 Node-owned 선언을 설치된 Node 타입에 위임한다. Worker의 다른 선언은 유지하고 malformed/partial/중복은 거절하며 check도 정규화된 결과를 요구한다. 앱의 비밀번호/잠금 토큰/승인 proof 처리는 변경하지 않았다. 의미 있는 가상 TypeScript 검사는 Buffer·Process의 실제 타입, 잘못된 입력의 거절, Worker 타입 보존을 확인한다.

실제 Worker의 `/offline-capture.html`이 auto HTML handling 때문에307을 거쳐 반환되던 결과도 보완했다. [공식 HTML 설정](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)에 따라 `assets.html_handling="none"`으로 exact HTML을200으로 제공한다. 기존 설치도 새 HTML을 재캐시하도록 shared SW의 shell cache를 v3로 갱신했다. 이 전환은 IndexedDB의 초안·첨부·outbox를 삭제하는 절차가 아니다. fresh install과 이전 redirected cache를 가진 동일 origin의 update는 별도 실제 Chrome 시나리오다.

## 3. 개인 자료와 실제 공급자

기존 Notion ZIP에서 정확 Markdown bytes 20개를 선택했다. 빈 운동 기록의 수치나 미완성 글의 완료 내용을 만들어 넣지 않았다. 기존 다중매체 20-slot 계획 전체 coverage와 별개인 텍스트 baseline이다. source/expected/proof/관측/report는 Git에서 제외된 `.private/golden-corpus`에만 보존한다.

- 준비 상태: source/expected/proof 일치 20/20, `assistant_reviewed`/사용자 위임 20개, 사람 승인 0개.
- 실제 로컬 제품 replay: 원문 hash 20/20, 제목 literal 검색 top1 19/20(95%), top10 20/20(100%). idempotency 재생 뒤 capture/source/document/object 각 20개다.
- 분석을 호출하지 않았으므로 primary type·typed value는 unknown 20개다. 의미/13점 rubric은 미채점이며 report는 `blocked`, `promotion_eligible=false`, `live_provider_verified=false`, `worker_runtime_verified=false`다. 보존·제목 검색 수치를 AI 품질 PASS로 바꾸지 않는다.
- 설정된 모델의 합성 S1 텍스트·공개 S4 영상·합성 질문/카탈로그의 S5 해석은 각 1회 HTTP 503으로 실패했다. S1 원문 저장/읽기/검색은 유지되며 이미지 단계는 미실행이다. 이번 실제 생성 호출은 총 3회이며 모델/과금 설정을 변경하지 않았다. 개인 자료를 Gemini에 보내지 않았다. S5 진단도 실제 main gateway와 query resolver를 사용하며 성공한 자연어 품질 확인으로 계산하지 않는다.

문서까지 포함한 최종 commit에 결합한 새 replay 출력과 source-clean 여부는 ignored `.codex/v2-completion/final-verification.json`에 기록한다. 대상 private 출력은 `.private/golden-corpus/model-runs/local-product-replay-20261003-final/`이다. 준비하는 전송 승인 요청은 `.private/golden-corpus/model-runs/private-live-approval-20261003-final.json`이며 `authorized:false`다. 이미 만든 private run을 덮어쓰지 않는다. 이 문서의 첫 replay 수치를 새로운 실제 AI 결과로 취급하지 않는다.

### 별도 원문 전송 승인을 받은 뒤 실행하는 도구

`tools/v2-eval/private-live`는 실제 S1 processing runner→native export→collector/evaluator를 실행하도록 준비했다. `npm run eval:private:live:prepare -- ...`는 현재 build/model/원문20개/hash/byte총량/private 출력/20회 상한에 결합한 **authorized:false** 요청만 만든다. 정답 작성 위임을 외부 전송 승인으로 재사용하지 않는다.

실제 실행에는 명시적 `--live`와 이 exact target에 대한 별도 사용자 전송 승인 JSON이 필요하다. 승인과 source-clean 검사는 API key 접근·provider 생성 전에 이루어지며 원격 DB/R2는 사용하지 않는다. 최대20회·입력당1회·자동재시도/모델fallback 없음·첫 오류 후 추가 호출0을 강제한다. await 경합·같은 입력·실패 중 대기 요청도 합성 경계 시험에 포함한다. 설치 SDK의 fake HTTP에서503/429 각각 요청1회와 안전한 오류 분류를 확인했다. stdout은 고정 코드/집계만 출력하고 원문·모델 결과는 private 출력에만 보존하며 자격 증명은 기록하지 않는다. 보고되지 않은 사용량·금액은 unknown이다.

초기 root 도구 전체71+5+12는 PASS였지만 key가 존재하는 환경의 독립 검사에서는 Git 자식의 부모 환경 상속 때문에11 PASS/1 FAIL이 재현됐다. Git 세 호출의 system/path allowlist와 key-present 회귀를 보완한 뒤 root 전체71+5+12 PASS·skip0·exit0을 확인했다. live12는56.12초였다. 독립 실제 Git/Node 진단에서도 credential 접근·부모 환경 열거·자식 credential 전달·network 모두0이며 focused1/1 PASS·exit0이다. 실제 private/provider 실행은0회다. 20개 분석 성공도 의미 검토 PASS가 아니며 type/typed/rubric unknown과 blocked/promotion=false를 유지한다. 자세한 명령과 승인 범위는 [도구 README](../../tools/v2-eval/private-live/README.md)에 있다.

## 4. 준비된 원격 변경 범위

대상은 기존 `DB`/`light_house_db`, `ARCHIVE_ASSETS`/`light-house-assets`, Worker `project-light-house`다. 원격에는 읽기 전용 SELECT·metadata GET·R2 목록만 실행했다.

- migration 파일 41개, remote ledger 18개, pending 23개, unexpected 0개.
- 원격 schema 144테이블/11,176행, R2 1,534개/4,033,625 bytes. 원문 행/객체 bytes를 읽은 inventory가 아니며 ETag는 SHA가 아니다.
- 구형 8파일 `0006_daily_log_people_relations.sql`–`0013_source_property_mappings.sql`은 schema에 이미 반영되어 있다. 로컬 baseline과 원격 column/default/PK, 관련 FK/index, table/index/trigger SQL을 비교했고 차이 0이다. 구형 SQL 재실행은 duplicate column으로 실패하므로 **ledger에 정확 8개 이름만 한 INSERT로 추가**하는 계획이다.
- V2 `0018_v2_legacy_migration_hardening.sql`–`0032_v2_prompt_curations.sql` 정확 15파일을 native Wrangler migration으로 적용한다. 원격의 빈 schema clone에 15/15 SQL 적용/FK 0을 확인했다. 비V2 88테이블/231 schema object의 정의 변화 0, 추가 원격 9테이블 보존이다. 빈 clone은 실제 원격 데이터 보존/복원 검증을 대신하지 않는다.
- `d1_migrations`는 UNIQUE name이고 준비한 8-row 단일 INSERT의 로컬 원자성/재실행 거절을 확인했다. 단계별 ledger 18→26→41, pending 23→15→0을 재확인한다.
- 현재 `scripts/apply-d1-migration.ts`는 trigger body를 semicolon으로 나누고 ledger를 기록하지 않으므로 이 15파일의 운영 적용 도구로 사용하지 않는다.
- private 검토 파일: `.private/release-preflight/approval-plan.json`, `legacy-ledger-repair.sql`, `release-stage.toml`. 승인된 뒤에도 fresh ledger/schema와 recovery backup을 먼저 확인해야 한다. SQL 원문·설정은 준비만 했고 실행/배포하지 않았다.
- 초기 Worker 설정은 routes/write/offline 1, AI 0, cron 없음, default library/legacy readonly 0이다. 기존 Vercel을 바꾸거나 legacy cutover·AI/예약 작업·과금 확대를 함께 승인했다고 취급하지 않는다. 실제 계정 limits/Worker 권한 검사가 먼저 필요하다.

읽기 전용 R2 `List/Get`으로 1,534개/4,033,625 bytes를 fresh `.private/recovery-copies`에 복사했다. 응답 바이트와 로컬 파일의 SHA-256/size를 대조하고 전후 key/ETag/size/수정시각 목록 일치와 별도 전체 사본 재해시를 확인했다. 결과 exit0이며 D1 호출0/원격 write0이다. HTTP/custom metadata와 원격 restore drill은 포함하지 않는다. ETag를 SHA-256으로 취급하지 않는다.

준비한 D1 native export는 실행 중 DB 조회가 잠시 중단될 수 있어 사용자 운영 승인 뒤 실행한다. FTS export가 거부되면 부분 dump로 우회하지 않는다. Time Travel bookmark 조회와 R2 바이트 사본은 검증된 D1+R2 전체 복구 백업을 뜻하지 않는다. 기존 공개 Worker의 capture/manifest와 native D1/R2 probe는 HTTP200으로 응답했다. 현재 후보의 배포가 아니며 settings API는 HTTP403이어서 정확한 binding 대상·flag·secret·build 상태는 미확인이다. 원격 D1/R2 write·migration·배포·cutover는 실행하지 않았다.

## 5. Android 실기기 확인 절차

실제 원격 후보가 정상 동작한 뒤 Android Chrome에서 다음을 확인한다. manifest의 `/v2/capture` 시작 경로와 `/share-target` multipart POST를 사용하며 공유 자료는 service worker가 IndexedDB의 local draft/outbox에 먼저 보존한다.

1. HTTPS 후보의 `/v2/capture`에서 로그인하고 Chrome 설치 메뉴로 홈 화면에 설치한다. 설치 앱으로 다시 열어 독립 창·한글 입력·뒤로가기·소프트 키보드에 가리지 않는 저장 버튼을 확인한다.
2. Chrome의 웹 링크, 갤러리의 이미지, 다른 앱의 텍스트를 OS 공유에서 Light House로 전달한다. 지원 앱이 제공한 제목/텍스트/URL/첨부가 보이며 원래 출처를 유지하는지 확인한다. 앱마다 전달하는 항목이 다를 수 있으므로 실제 전달된 항목을 기준으로 기록한다.
3. 기내 모드에서 텍스트/이미지 초안을 만든 뒤 앱을 완전히 닫았다가 다시 연다. 임시 저장/첨부가 유지되는지 확인한다. 재연결 시 서버 저장 receipt 후 같은 기록이 중복 생성되지 않아야 한다.
4. restricted 전환 시 평문 임시 저장과 자동 outbox가 제거되는지 확인하고, 재인증 없는 조회/복사를 허용하지 않는지 확인한다. 민감 자료 대신 작은 시험 입력으로 실행한다.
5. 저장 기록을 제목으로 검색하고 편집·충돌 안내·영상 항목 판단·개별 복사를 확인한다. export를 받아 별도 격리 대상에서 import/반복 import한 뒤 원문/첨부 hash와 receipt를 확인한다.
6. 기종/Android·Chrome 버전/후보 build/시각과 성공·실패 항목을 기록한다. 데스크톱 Pixel 7 에뮬레이션을 이 확인의 대체 증거로 기록하지 않는다.

원격 권한/승인, 실제 설정 모델의 성공과 의미 평가, Android 결과, 복구/운영 및 [42번](./42_I8_PRIVATE_CUTOVER_IMPLEMENTATION_AND_RELEASE_GATES.md)의 운영 기간을 충족한 뒤 전체 완료를 판정한다. 로컬 구현의 완료와 제품 전체 완료를 혼동하지 않는다.
