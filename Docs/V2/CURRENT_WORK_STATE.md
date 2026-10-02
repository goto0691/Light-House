# 현재 작업 상태 · 재개 진입점

## V2 최종 완성 재개 · 2026-10-03 KST

사용자가 V2를 끝까지 완성하도록 요청했다. 작업 브랜치는 `codex/v2-completion-local`, 시작 소스는 `7a5d771`이다. 동기화 때 보존한 stash와 기존 환경 파일은 유지한다. 아래 과거 인계의 완료 구현을 다시 시작하지 않고 50번 완료표의 실제 잔여 작업을 진행한다.

- root: 통합 소스·현재 상태/50번·최종 증거, Next/브라우저/typegen/build 및 긴 workerd/D1 회귀의 단일 실행 소유자.
- `video_review`: 영상 항목 판단 기능을 동결했고 실제 SQLite에서 드러난 반복 복원·ID 충돌/idempotency 결함을 최소 보완한다. `restore-bundle-v1.ts` 파일 소유권은 root의 polymorphic FK 보완 후 해당 agent로 이관했다.
- `eval_observations`: 제품 export에서 관측을 수집하는 adapter, 승인된 query와 실제 검색 plan 연결, 격리 SQLite의 실제 저장·검색·export replay. Next 산출물과 원격 자원은 사용하지 않는다.
- `release_audit`: root 승인 범위의 cutover freshness/recorded-evidence 최소 보완을 마쳤고 승인·collector 독립 리뷰 및 원격 준비의 읽기 전용 확인을 맡는다.
- 사용자는 기존 Notion 백업을 사용하고 정답 작성을 위임했다. `.private/golden-corpus`의 정확 원문 20개와 source-grounded 정답을 독립 검토했다. `assistant_reviewed`/사용자 위임 20개를 사람 승인 0개와 구별하며 proof·원문·규칙 hash를 확인한다. 텍스트 baseline이고 기존 다중매체20개 slot coverage나 외부 사실·실제 AI 품질을 검증했다고 주장하지 않는다. 위임 context proof binding을 추가하는 동안 gate를 다시 확인한다.
- 설정된 실제 모델의 합성 S1 텍스트와 공개 S4 영상 각 1회는 HTTP503 `provider_server`/`video_provider_busy`였다. S1 원문 저장·읽기·검색은 유지됐고 이미지 단계는 실행하지 않았다. 개인 자료는 공급자에게 전송하지 않았다.
- `bindings:check`는 Windows checkout의 생성 선언 CRLF 때문에 처음 실패했다. 같은 의미의 LF 재생성과 `.gitattributes` 고정 후 최종 exit0, `db:check` exit0. 현재 Chromium은 설치됐으며 새 browser/full suite/Worker build 결과는 아직 미확인이다.

실행 핸들과 최종 검사 결과는 확인되는 작업 경계에서 갱신한다. 원격 migration/배포/cutover와 실제 기기 gate는 구체적인 준비 결과를 바탕으로 처리하며 이 문서의 과거 승인 기록만으로 새 원격 작업을 실행하지 않는다.

### 통합 검증 checkpoint · 2026-10-03 00:55 KST

- 영상 항목 판단·nonresumable 반복 복원·cutover freshness 계약은 로컬 `bb44d48`에 보존했다. root의 영상 브라우저 최종10/10 PASS/exit0(43.2초), 실제 desktop/mobile screenshot·axe·overflow·복사·재시도/권한 경로를 확인했다. 최초 새 spec6개 실패는 route 등록 순서가 local API mock을 우회한 것으로, `fallback()` 수정 후 전부 통과했다.
- 독립 검토가 실제 `/api/v2/restores/import`의 resumable workflow에도 owner collision 뒤 repeat 결함을 재현했다. 해당 `resumable-restore-v2.ts`와 신규 public workflow 시험은 `release_audit`가 root 승인으로 최소 보완 중이다. 실행 중이던 전체 Vitest `69736`은 수정 전 불완료 실행으로 exit1 중단했고 PASS로 계산하지 않는다. 종료 후 해당 vitest 프로세스0을 확인했다. 완료 후 단일 고정 소스로 전체를 다시 실행한다.
- 전체 Playwright `96412`/root는 현재 진행 중이다. write1/AI0 local dev와 합성 API 대역이며 실제 공급자·실기기·원격 저장을 대신하지 않는다. Next dev/typegen/build의 다른 실행 소유자는 없다.
- root 통합 도구 검사: Node71/71 + 격리 replay5/5 PASS/skip0/exit0. web·evaluator·replay·cutover 전체 타입 exit0. app 전체 lint 오류0/기존 경고80, evaluator/cutover 오류0; 최종 통합 lint 추가 실행 `24651` 확인 중이다.
- 실제 Notion20개 private replay는 capture/getRecord/retrieval/resumable export→ZIP→collector/evaluator를 실행해 source hash20/20, 제목 top1 19/20·top10 20/20을 확인했다. type/typed 추출·live/Worker는 미측정이며 evaluator는 blocked/promotion=false이다. 최종 commit identity로 새 출력 실행을 남겼다.
- 원격에는 SELECT만 보냈다. ledger 로컬41/적용18/pending23/unexpected0, schema metadata144테이블/전체11,176행, R2목록1,534개/4,033,625bytes를 private 폴더에 보존했다. bookmark GET도 성공했다. R2 ETag를 SHA로 간주하거나 이 목록을 검증된 복구 백업으로 승격하지 않는다. V1 8파일은 컬럼이 이미 일치해 ledger 누락 가능성이 높고, V2 0018–0032 정확15파일과 분리해 독립 검토 중이다. 원격 table/ledger/R2 객체를 쓰거나 migration/deploy한 적 없다.
- `inventory-d1.ts`/`inventory-r2.ts`의 tsx 실행에서 `import.meta.dirname`이 비어 실패했다. 지원되는 `fileURLToPath(import.meta.url)` 기반 경로로 바꾼 뒤 실제 read-only 원격 inventory 두 실행이 exit0으로 끝났다. `wrangler migrations list`는 내부에서 migration table 초기화를 하므로 엄밀한 read-only 감사에 사용하지 않았다.

## Windows 로컬 개발 재개 · 2026-10-02

사용자가 현재 프로젝트 폴더에서 V2 개발을 이어가기 위해 GitHub 소스 동기화를 요청했다. 원격에는 별도 V2 브랜치 없이 V2가 `main`에 통합되어 있다. 기존 로컬 `460e058`에서 원격 `7a5d771221d7398c1d8e88fb5d4ecca8eeb24ea1`까지 7개 커밋을 정상 fast-forward했고, 최종 원격 조회도 같은 HEAD를 확인했다.

- 미커밋 작업 43개 파일(추적 파일 변경과 새 파일 포함)은 `stash@{0}` / `73a8f184160644c6c9d0f36050bca3ec5410aa57`, 이름 `codex/pre-v2-sync-2026-10-02-local-work`로 보존했다. 최신 V2 소스에 다시 적용하지 않았으며 필요하면 별도 복원·비교한다. 기존 `.env.local`도 보존했다.
- Node `24.11.1`, npm `11.7.0`에서 `npm ci --no-audit --no-fund` exit0. lockfile 기준 의존성 설치를 완료했다.
- `npm exec --workspace @light-house/web -- next typegen` exit0. 첫 타입 검사는 이전 로컬 native 페이지를 참조하는 오래된 `.next/dev/types` 때문에 실패했다. 해당 생성 캐시를 `.codex/pre-v2-sync-2026-10-02-dev-types`로 옮겨 보존한 뒤 최종 root `npm run typecheck`(web + evaluator) exit0을 확인했다. 제품 코드와 검사 기준은 변경하지 않았다.
- 이 로컬 대화가 현재 폴더의 후속 개발·공유 생성물 실행 자원을 맡는다. 종료 확인 시 이 작업 폴더의 Node/workerd/esbuild 프로세스는 0개다. 개발 서버는 실행하지 않았다. 이 상태 문서 외에는 소스 변경이 없다.
- 이번 검증 범위는 Git 동기화·의존성 설치·라우트 타입 생성·전체 타입 검사다. 전체 회귀·브라우저·Worker build·실제 AI·원격 migration·배포는 이번 요청에서 실행하지 않았다.

다음 작업은 사용자의 후속 V2 개발 요청을 이 체크아웃에서 진행한다. 기존 기능별 잔여 작업과 운영 gate는 아래 인계 기록과 [50번 완료표](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)를 따른다. 과거 실행 핸들이나 전체 회귀를 자동으로 재시작하지 않는다.

## Vercel 배포 수정 · 2026-10-02

`e4f4bae`를 GitHub main에 정상 fast-forward push했다. 해당 Vercel Production 배포는 Next 설정의 무조건 Cloudflare 개발 초기화가 `/wrangler.toml`을 읽으려 하며 실패했다. 프로젝트는 `apps/web`, Node `24.x`, `npm install`, `npm run build`다.

Vercel의 `VERCEL=1` 환경에서는 Cloudflare 개발 초기화를 건너뛰도록 Next 설정만 수정했다. 로컬 개발 및 Worker 빌드의 초기화 옵션과 원격 binding 금지는 유지한다. 합성 config 실행에서 기존 오류를 재현하고 Vercel·일반 로컬·명시 `VERCEL=0` 세 경로를 확인했다. 실제 자동 배포 결과는 새 커밋으로 별도 확인하며, 이 수정이 원격 D1 migration 또는 V2 운영 전환을 승인하지 않는다.

첫 수정 `7052292`의 실제 Vercel webpack 컴파일은 성공했다. 다음 TypeScript 단계가 앱 밖의 테스트 전용 `tools/v2-eval`·`packages/db/schema` 및 `drizzle-orm`을 찾지 못했다. Vercel 전용 `tsconfig.vercel.json`으로 앱 런타임 소스·생성된 라우트 타입을 계속 strict 검사하며, 기존 `tsconfig.json`과 전체 `npm run typecheck`의 테스트 검사 범위는 유지한다. 타입 오류 무시 옵션은 사용하지 않는다.

후속 `ca11942`는 테스트 전용 타입 오류를 해소했으나 전용 include에서 Cloudflare의 생성된 `worker-configuration.d.ts`를 빠뜨려 `DB`·`ARCHIVE_ASSETS` 타입을 찾지 못했다. 해당 선언 파일을 Vercel 검사 입력에 명시해 기존 binding 타입을 유지한다.

## main 게시 통합 · 2026-10-01

사용자가 main commit/push와 기존 Vercel 자동 배포를 승인했다. 실제 원격 `460e058`의 22개 커밋을 보존하는 3-way 통합은 `e8317ce`, V2 fixture migration 선택 보완은 `89dffda`다. [84번](./84_MAIN_INTEGRATION_EVIDENCE.md)에 출처와 운영 경계를 기록한다.

- 원격의 Notion·출처/속성 매핑·zettel·readmodel/모바일 UI를 보존했다. V2 cutover guard와 shared service worker 충돌은 검증 후 해결했다
- 통합 경계44 PASS, migration 선택 RED→GREEN 및 3개 schema 적용 순서23 PASS, tools36 PASS, typegen/typecheck·bindings/db exit0
- 전체 lint 오류0/경고80(통합된 legacy UI 포함). 변경된 fixture 추가 lint 오류0
- 통합 safe Worker build exit0, audited_files7484/secret_hits0. 이후 변경은 fixture/검증 script와 문서뿐이며 runtime/build 입력은 동일하다
- 첫 통합 전체 실행은 fixture setup 오류 확인 후 **exit130으로 중단한 불완료 실행**이다. 최종 고정 소스 `89dffda1f230075f8d09cea5797e78fcd61d1658`의 단일 전체 회귀는 **174/174파일·3545/3545시험 PASS, 오류0, exit0, 1919.81초**로 10:01 UTC에 종료했다
- 소스 변경·build/test 자원 소유자는 cloud 통합 작업이다. 최종 증거와 증분 bundle로 정상 main push를 이어간다. 이후 문서 갱신은 위 검증 소스의 앱 runtime·검사·migration·dependency를 바꾸지 않는다
- local production server에서 login/sw/manifest200, routes OFF의 V2 capture404를 확인하고 종료했다. 실행 중인 검사나 개발 서버는 없다. 브라우저 interaction은 이번 통합 결과로 주장하지 않는다
- 확인한 Vercel 주소: `https://light-house-inky.vercel.app/login` (게시 전 HTTP200). Cloudflare Worker 배포·원격 D1 migration·유료 서비스·실제 AI/개인 자료 gate는 이번 자동 배포 승인에 포함되지 않는다

## 현재 인계 · 2026-10-01 Cloud Linux

사용자 승인으로 `71ec611`의 sanitized V2 소스를 dot cloud에서 이어받았다. 전체 목표는 계속 **active**이며 원격 push·migration·배포·실제 공급자 호출을 하지 않았다. [82번](./82_CLOUD_LINUX_COMPLETION_EVIDENCE.md)에 기준 소스, 변경, 검증 범위와 운영 gate를 기록한다. 아래 09-28 기록은 이전 환경의 역사 증거다.

- 구현 완료: cross-Capture manual source의 개인 분석 과잉 차단, S2 성공 분석 후 관찰 저장 재시도, S5 작성일·정렬 방향 표시, 고정 로컬 글꼴 기반 Linux build, private manifest schema/hash/realpath gate
- 로컬 `cloud-v2-completion`에 의미별 commit을 보존했다. import `fda539b`는 원래 `71ec611` Git history의 대체물이 아니다
- 변경/인접 결합 회귀 9파일127 PASS, tools4 PASS, 최초 lint 오류0/경고34·typegen/typecheck·bindings/db exit0
- Linux safe Worker build exit0, audited_files6711/secret_hits0. 실제 Next HTTP 렌더와 네 글꼴 자산200도 확인했다
- 최종 typegen/typecheck·lint(오류0/기존 경고34)·bindings/db·Linux safe Worker build exit0. **최종 고정 소스 전체 Vitest172파일3528시험 PASS/오류0/exit0(1986.36초)**. source `6b8be40556b326a8c413f902fc73ec7eecf24816`. 초기 worker OOM 2건도 보완 후 export9/9·restore-upload7/7이 포함된 단일 전체 실행으로 재확인했다
- 최종 package의 local Worker 기동·검색 화면200도 확인했다. fixture 날짜2026-08-11이며 운영2026-08-12와의 완전한 runtime parity는 미확인이다
- 개발 서버는 종료했다. 이번 환경의 Chromium IPC/localhost 미리보기 제한으로 Playwright는 미확인이다. 과거 브라우저 PASS를 현재 결과로 옮기지 않는다
- S5 결정: 2026-10-01 사용자가 민감 기록의 유형·필드 이름을 Google Gemini 검색 해석에 활용하도록 승인했다. 제목·본문·실제값·entity 이름·restricted 범위로 확대하지 않는다. 실제 호출이나 자격 증명 전달은 새로 수행하지 않았다
- **G01 후속 완료:** 별도 worktree의 오프라인 기록 평가/비교 기반을 검토 후 통합했다([83번](./83_PRIVATE_EVALUATOR_FOUNDATION.md)). evaluator32개, migration4개 포함 tools36개, 기존 manifest25개 PASS. root typecheck와 전체 lint도 최종 exit0(기존 app 경고34, evaluator 경고0). app source/package/tests는 위 고정 소스 이후 변경하지 않았다. 자유·의미 규칙과 미채점 rubric은 unknown/review required로 남겨 허위 promotion PASS를 막는다
- 실행 중인 검사·개발 서버는 없다. 소스·patch·검증 기록은 Library 코드 checkpoint에 보존한다. 재개 시 실제 프로세스 상태는 도구로 다시 확인한다
- 다음: 안전한 실행 자격 증명과 승인된 실제 자료가 준비되면 설정 모델 S1/S4·S5 품질 및 private20/20 평가를 실행한다. 실제 관측 수집 adapter와 자유 규칙/사람 rubric 기준은 별도 후속이다. 브라우저/실기기 확인과 대상별 원격 migration·배포·백업/복원·cutover는 승인과 환경 확인 뒤 진행한다. 종료된 전체 suite를 의미 없이 중복 실행하지 않는다

기존 backlog의 S2 관찰 재시도, personalSourceFence 과잉 차단, S5 written_at 표시와 오프라인 기록 비교 기반을 보완했다. 영상 노트 항목별 확인/거절, 실제 관측 수집·의미 품질 판정, 운영 예산과 실기기 검증은 남는다. 원문·자격 증명·원격 자원은 변경하지 않았다.

## 현재 인계 · 2026-09-28

사용자가 이 세션(Claude Code, Opus 5.5)에 **중단 지점부터 이어서 마지막까지 완성**하라고 지시하고 **Gemini 재호출을 승인**했다. 그래서 76번의 Astra 동결 파일(`gemini-role-gateways.ts`, `gemini-wire-schema.ts`, `analysis-envelope-v1.ts`, `verify-s1-live-synthetic.ts`)도 이번 세션이 사용자 지시에 따라 수정했다. 이 세션이 주 구현과 Next/workerd/browser/typegen/build 실행 자원의 소유자였다. S5는 병렬 agent 1개가 구현했고, root가 governor 적용 지시·독립 검토·브라우저 실행을 맡았다. agent는 종료됐다.

### 사용자 시나리오 상태

| 시나리오 | 상태 | 근거 |
| --- | --- | --- |
| S0 처리 상태 화면 | 사용 가능(로컬) | [75번](./75_GLOBAL_PROCESSING_STATUS.md). 일일 한도 재개 시각 표시 |
| S1 글·이미지 분석 → Record/Review → 검색 | **실제 Gemini로 동작 확인(진단 모델)** · 설정 모델 1회 확인 남음 | [77번 후속](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md). HTTP 400 원인은 `maxItems`, 수정 완료. 글·이미지 실제 성공, 근거 인용 재정렬 |
| S2 반복 기록 템플릿 제안 | 코드 연결·합성 검증(선행 결과 유지) | [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md). 실제 분석 성공이 가능해져 실사용에서 관찰이 쌓인다 |
| S3 일반 웹 수집 | 사용 가능(로컬, 운영자 허용 호스트) · SNS 자동 수집은 사용자 결정 | [79번](./79_S3_PUBLIC_WEB_COLLECTION.md). 회귀 닫음 |
| S4 YouTube 영상 구간 근거 | **실제 Gemini로 동작 확인(진단 모델)** · 설정 모델 1회 확인 남음 | [80번](./80_S4_YOUTUBE_VIDEO_ANALYSIS.md) |
| S5 자연어 리콜 | 사용 가능(로컬, 합성 공급자) · 실제 해석 품질 미확인 | [81번](./81_S5_NATURAL_LANGUAGE_RECALL.md) |
| 원격 배포·migration·운영 전환·결제 | 사용자·운영 결정 | 아래 '사용자 결정' |

### 이번 세션의 주요 수정

- **Gemini:** 응답 스키마 `maxItems` 제거(400 원인). 429를 분당/일일로 구분하고, 일일 한도면 태평양 자정까지 governor가 멈춘다. 한도 거절은 시도 횟수를 소모하지 않는다(무료 20회/일 소진 뒤 작업이 영구 정지되던 결함). 요청하지 않은 `source_extractions`는 버리고, 근거는 `quote`로 재정렬한다(validator `analysis-semantic-v3`).
- **S4 신규:** 공개 YouTube 명시 분석, 불변 AI 노트 source + `api` snapshot, SQL 출처 증명(위조 RED 확인), 표시·검색 라벨, lab 화면·시험.
- **S5 신규(agent):** 해석 route·카탈로그·검증·UI, 공유 governor.
- **기존 회귀 수정:**
  - 기록 API 읽기 경합 404→409(09-23 S1 이후 회귀).
  - 링크 표시의 0031 이전 스키마 가드.
  - 0032 누락 fixture 12개.
  - 0032로 늘어난 복원·내보내기 시험 2건의 제한 시간 조정(측정 184s/171s, 단정 불변).
  - 내보내기 용량 단정을 "사용자 동작 1회" 기준으로 변경.
  - ESLint 설정이 `.cjs` fixture에서 멈추던 문제.

### 최종 검사 (2026-09-28~29 KST)

| 검사 | 결과 |
| --- | --- |
| 전체 vitest `npm run test --workspace @light-house/web -- --maxWorkers=1` | 168파일 3,454개 중 **3,451 PASS / 3 FAIL**(6,227초). 3건은 0032 fixture·용량 단정·제한 시간이었다. 수정 뒤 해당 2파일 전체 재실행 **11/11 PASS**(545초). 단일 전체 재실행은 하지 않았다 |
| `npm run test:tools` | 4 PASS |
| 전체 lint `eslint .` | 오류 0 / 경고 34(기존 기준선) |
| `next typegen` + typecheck | exit0 |
| `npm run build:worker` | exit0, audited_files=6700, secret_hits=0(Windows OpenNext 경고만) |
| 전체 Playwright(desktop+mobile, 기본 flag) | **845 PASS / 51 SKIP / 0 FAIL**(896개, 35.3분). skip은 한 화면 크기 전용 lab 시험과 flag 조건이다. 그중 `FLAG_V2_WRITE=1` 대상 4 spec을 따로 실행해 **36 PASS**, cutover capture·library 전용 실행 **각 1 PASS** |
| 실제 Gemini | 진단 모델 `gemini-3.1-flash-lite`: S1 글·이미지 성공, S4 영상 성공. 설정 모델 `gemini-3.6-flash`: 400 원인 수정 뒤 스키마 수용 확인, 전체 경로 실행은 일일 한도로 보류 |

**살아 있는 실행 핸들:** 없음. 2026-09-29 00:24 KST에 port 3100 listener 0, workerd 0을 확인했다. 임시 진단 스크립트와 임시 시험 사본은 삭제했다.

### 다음 작업

1. 설정 모델 한도 초기화 뒤(태평양 자정 ≈ 한국 16:05 이후) 다음을 각 1회 실행한다.
   - `npm exec --workspace @light-house/web -- tsx scripts/verify-s1-live-synthetic.ts --live`
   - `npm exec --workspace @light-house/web -- tsx scripts/verify-s4-live-youtube.ts --live`
2. 사용자 결정을 받은 뒤 운영 작업을 진행한다: 원격 D1 migration 0006–0032 적용 상태 확인·적용, Worker 배포, 실기기 확인.
3. backlog(비차단):
   - S2 관찰 저장 일시 오류의 내구성 재시도
   - `personalSourceFence()` 불필요 차단
   - S5 `written_at` 정렬 표시
   - 영상 노트 항목 단위 확인/거절

### 사용자 결정 (2026-09-29)

- **Gemini 무료 등급 유지.** 개인 단독 사용으로 충분하다. 상용화 때 다시 검토한다. 일일 한도가 소진되면 다음 초기화까지 자동으로 대기한다.
- **Threads·Instagram은 URL 보관 + 직접 붙여넣기·첨부.** 서버 수집은 운영자 허용 목록에 넣거나 리다이렉트로 거쳐도 `threads.com/.net`, `instagram.com`, `instagr.am`, `cdninstagram.com`, `fbcdn.net`을 차단한다(`public-web-fetch.ts`, 시험 40 PASS). 모델 요청에는 URL 열람 도구가 없고, 파일 URL은 YouTube 정규 주소만 보낸다.
- **git:** 사용자 지시로 커밋했다(브랜치 `v2-completion`).
- **남은 결정:**
  - 원격 D1 migration(0006–0032)·Worker 배포·`V2_PUBLIC_WEB_ALLOWED_HOSTS` 지정·AI flag 활성화
  - S5 카탈로그에 sensitive 라벨 포함 여부

## 이전 인계 · 2026-09-23 (역사 기록)

사용자가 **GPT-6 Sol Ultra로 주 구현을 이전하고 Astra Ultra는 핵심 결정·독립 검토를 전담**하도록 지정했다. [76번 분담/인계](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)가 현재 실행 순서다. 현재 Sol 대화가 사용자가 선택한 기존 프로젝트 폴더의 주 구현·Next/workerd/browser/typegen/build 실행 자원 소유자다. S0–S2 인계 배치 뒤 사용자 지시를 받은 Astra가 **S3 공개 웹·Threads·Instagram 수집**을 이번 Sol 배치로 지정했다. 완료 시 Sol은 기존 Astra 작업 `019fef82-eb62-7fc1-87ce-19e13227b4e4`에 완료·미완료·필수 판단과 파일 소유권을 다시 보고한다. Astra는 그 보고를 받아 후속 S3 잔여→S4→S5 순서를 판단·지시하며, Sol은 임의로 다른 배치·새 goal·자동화·원격 배포를 시작하지 않는다.

### 이번 S3 실행 소유권

- **Sol:** S3 공개 URL 수집·저장·API/UI·관련 시험·S3 기능 문서 한 개와 이 상태 문서. 공유 Next/workerd/browser/typegen/build 생성물·서버도 Sol이 단독 관리한다. 기존 수동 스크랩/프롬프트 정리본은 다시 만들지 않는다.
- **Astra:** Gemini HTTP 400 호환성 진단/수정, `apps/web/src/lib/v2/ai/gemini-role-gateways.ts`, 공급자용 새 schema helper, 관련 gateway/schema 시험, `apps/web/scripts/verify-s1-live-synthetic.ts`, [77번](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md). canonical analysis envelope, safe JSON schema, model routing, env도 Sol이 수정하지 않는다. 합성 실호출은 **누적 3/3 소진**, 추가 호출 금지다. Astra 변경 파일은 현재 동결이며 공유 생성물은 Sol이 소유한다.
- **현재 상태:** [79번](./79_S3_PUBLIC_WEB_COLLECTION.md)의 정확 호스트 허용 공개 웹 텍스트 수집·불변 저장·Record 표시/복사를 구현하고 합성 HTTP/SQLite33 PASS, Workerd D1 7 PASS, desktop/mobile browser4 PASS, typecheck exit0을 확인했다. 기존 링크 회귀·Worker build 최종 확인을 진행 중이다. SNS와 임의 공개 도메인 자동 확보는 미완료로 분리한다. S3는 Gemini 성공의 선행 조건을 두지 않는다.

현재 [75번](./75_GLOBAL_PROCESSING_STATUS.md) S0는 관련 로컬 SQL/API/SSR/브라우저 검증을 닫았다. [77번](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md) S1은 로컬 연결과 합성 대역 검증을 마쳤지만 실제 Gemini 합성 글은 누적 3회 모두 실패했고 최신 안전 분류는 HTTP 400 `invalid_request`다. 마지막 요청 호환성 보정과 wire 대역 검사 뒤에도 원인은 미확정이다. [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md) S2는 합성 SQLite/브라우저에서 제안·선택·새 Capture를 검증했고 후속 상태 전이 CAS 경합도 수정했다. S3의 일부 공개 웹 수집은 구현·검증 중이며 SNS 자동 확보·S4 영상·S5 자연어 리콜/전체 통합은 남는다. 완료한74번과 Astra 지침 조사를 다시 시작하지 않는다.

34951/51389/8676은 종료됐다. 선행 S0는 순수·SQLite·API176 PASS, SSR·Workerd5 PASS, desktop/mobile browser40 PASS와 마지막 링크 변경 범위2 PASS였다. 선행 S1은 계약/단위226 PASS, desktop/mobile 자료 UI4 PASS·Record 모듈2 PASS였고, 교차 Capture P1 수정 후 관련 처리 3파일43 PASS·보강 회귀2 PASS였다. Astra의 이번 S1 공급자 wire 관련75 PASS·scoped lint/typecheck exit0이었으나 합성 글 마지막 실호출도 HTTP400/exit1, 누적3/3이다. S2 최신 상태 전이 경합은 수정 전3 FAIL을 재현하고 수정 후 FK ON SQLite14 PASS·scoped lint exit0, 공유 typecheck exit0을 확인했다. S2 desktop/mobile browser2 PASS는 선행 결과다. 처리 pipeline 인접 범위를 함께 실행한 이전 결과는 8 PASS/15 SKIP이었다. 실행 범위가 겹치므로 시험 수를 합산하지 않는다. 상세 명령·범위는75·77·78·79번에 있다. 아래74번 PASS를75번 증거로 재사용하지 않는다.

**진행 보고 방식:** 과거 55%는 11영역 동등가중 점수일 뿐 현재 코드 구현률이 아니다. 사용자 시나리오별 사용 가능/연결·검증 중/미구현/운영 확인을 보고한다. 전체 목표 범위는 유지하며 이 문서는 goal 상태나 실제 실행 모델을 변경하지 않는다.

## 완료한 선행 단위의 기록

### 2026-09-23 S0–S2 인계 결과

| 사용자 시나리오 | 현재 상태 | 근거·한계 |
| --- | --- | --- |
| 저장 기록의 분석 진행을 desktop/mobile에서 확인 | 사용 가능(로컬 합성·SQLite·Workerd·브라우저 검증) | [75번](./75_GLOBAL_PROCESSING_STATUS.md). 저장과 분석 분리, 현재 입력별 상태, owner/restricted, 실패·경합 표시. 실제 개인 자료/원격 운영 확인은 별도다. |
| 글·이미지에서 AI 제안·근거를 Record/Review에 저장하고 검색 | 코드 연결·검증 중 | [77번](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md). 합성 이미지 대역 전체 연결과 실제 SQLite 보안 경계는 통과. 실제 Gemini 글 3회는 실패했고 최신 안전 분류는 HTTP400이다. 실호출 예산3/3 소진, 이미지 실호출 없음, 원문 보존. |
| 반복 기록의 자동 템플릿 제안→명시 선택→새 Capture | 코드 연결·합성 검증 중 | [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md). 3문서·3일, 비활성 초안, 동의 철회·privacy 전환 뒤 노출/승격 제한과 재분석·네 번째 기록 회복, try/keep, 새 입력을 SQLite와 desktop/mobile에서 검증. 실제 Gemini 성공은 미확인. |
| 웹/SNS 수집·영상·자연어 리콜/전체 통합 | 코드 연결·검증 중 | [79번](./79_S3_PUBLIC_WEB_COLLECTION.md)의 서버 정확 허용 호스트 공개 웹 텍스트만 구현·로컬 검증 중. 기본 허용 목록은 비어 있다. SNS 자동 원문·임의 호스트·S4 영상·S5 자연어 리콜/통합은 미구현이다. |
| 실제 계정의 제공자 접근·원격 배포/migration·운영 전환 | 사용자·운영 확인 | HTTP400의 정확 원인은 미확정이고 사용자 계정 조치를 요구할 근거는 없다. 과금 확대·모델 역할 변경·원격 자원 변경을 하지 않았다. |

Sol root가 제품 변경·공유 Next/workerd/browser/typegen 자원과 로컬 통합 검사를 소유했다. S1 agent는 별도 파일의 연결·보안 수정과 RED→GREEN 재현을 맡았다. S2 독립 읽기 검토는 과거 관찰의 AI 동의 철회 누락과, 생성된 초안의 사후 적격성·회복 누락을 찾아 root가 수정·회귀 검증했다. 검토자는 최종 SQL에 추가 필수 결함을 찾지 못했으나 테스트/브라우저/제공자를 독립 재실행하지 않았다. 기존 Astra 대화는 제품 파일을 동시에 수정하지 않았다. 최종 port3100 listener 0, workerd process 0을 확인했다.
기존 Astra 대화(019fef82-eb62-7fc1-87ce-19e13227b4e4)의 최종 검토가 분석 입력 `loadAnalysisInput()`에서 같은 owner·다른 Capture restricted source의 원문 누출 P1을 실제 SQLite로 재현했다. Sol root가 해당 SQL의 document·source·Capture 경계를 수정했다. 추가 독립 읽기 검토는 모델 입력 누출 차단을 확인했고, 새 회귀 2건은 RED→GREEN을 확인했다. 다른 Capture의 잘못 연결된 수동 source가 정상 분석을 불필요하게 차단할 수 있는 `personalSourceFence()` 경계는 비차단 후속 개선으로 남겼다. 검토 결과를 이전 작성자 PASS로 대체하지 않는다.

갱신: 2026-09-22 22:16 KST. 전체 goal은 **active**, 진행률은 **약55%**(G01–G11 동일 비중 단계 달성도,600/1100=54.55%). 시간·코드·시험 수의 비율이 아니다. 완료한 Astra 지침 정비·G06 이동성·70–74번 단위를 다시 시작하지 않는다.

## 완료한 현재 단위 · Record 맞춤 보기 경계

[74번 계약/증거](./74_RECORD_MODULE_BOUNDARIES.md)에 따라 실제 Record와 현재 workout 모듈의 개인정보·version/shape/fallback·본문 우선·정확 JSON 전송을 구현하고 검증했다.

- 서버가 실제 DB privacy/owner/canonical/legacy를 읽는다. sensitive 모듈은 빈 데이터의 redacted DTO, restricted 모듈은 재인증 뒤에도 생략한다. 허용된 본문/기본 필드 읽기는 유지한다.
- 연결된 restricted 기록의 제목과 제3 restricted 원문의 인용을 차단한다. 최종 한 SQL snapshot에서 관계/evidence identity와 source/capture/document 권한을 다시 확인한다. 같은 ID의 target 교체·늦은 privacy 변경·다른 owner/손상 canonical을 시험했다.
- 설치된 preset/module만 허용하고 전체 JSON 깊이32/노드10000·불변 복제·중복/renderer/evidence를 검사한다. 모듈 오류는 개별 catchError/Suspense로 격리한다. 본문/일반 필드는 계속 보인다.
- 실제 Record/Review는 권한 검사가 끝난 JSON 문자열을 client에 전달한다. Flight의 null prototype 거부와 own __proto__ 소실을 재현하고 exact encode/decode·실제 lab browser에서 원래 키 보존을 확인했다. 정본 DB/백업은 바꾸지 않았다.
- 빈 boolean을 '아니요'로 단정하지 않는다. 320px/긴 값·출처·키보드 근거·고정 개인정보 안내·색상 대비·긴 값 옆 태그 정렬을 보완했다.
- 원문·자격 증명·Gemini 역할·원격 자원은 그대로다. 직전 탐색/목록의 증거는 [73번](./73_COMPLETE_CATALOG_DISCOVERY.md)에 보존한다.

## 최종 검사와 실행 핸들

| 실행 | 최종 결과와 범위 |
| --- | --- |
| module_contract_audit 21:59:33 | 순수120+기존3+actual Flight9=132 PASS,exit0,6.85초 |
| module_privacy_audit89629 | 실제 SQL/SSR63+기존 정책12=75 PASS,exit0,21.45초 |
| root20196 | actual 격리 workerd/D1 module5+processing17+legacy6=28 PASS,exit0,213.81초 |
| root41234 | 최종 browser42 PASS/4 SKIP,exit0,1.3분. module36/기존 내구성6 |
| root95372 / root37733+62246 | 최종 타입 exit0 / 변경 TS15파일 lint 및 마지막 시험 변경 lint exit0 |

서로 다른 서버/계약/SQL/transport 검사235개(132+75+28)다. 중간 결과/재실행을 더하지 않는다. browser4 SKIP은 기존 capture 쓰기 flag off의2개 시험×desktop/mobile이다. 전체 suite·Worker build·실제 개인 자료/제공자·실기기 검증은 아니다.

초기 RED·시험 harness 수정·브라우저 색상 대비 실패 및 보완은74번에 보존했다. 기준/timeout을 낮추지 않았다. 최종4화면을 다시 렌더해 시각 확인했다. [manifest](./evidence/74-record-modules-hashes.json)는 source/test17개+화면4개+실패 관찰 요약1개를 고정한다. 최종 검사 후 제품/시험 변경은 없다.

**살아 있는 root 실행 핸들은 없다.** dev94277도 의도적인 Ctrl+C(exit1)로 종료했다. 22:13:09 KST port3100 listener0/workerd0을 확인했다. 다음 실행 때 실제 생존 여부를 다시 확인한다. 기본 git diff --check exit0이며 기존 CRLF 안내는 임의 개행 변환으로 처리하지 않았다.

마지막 대조: manifest22개 hash 불일치0·문서4개 로컬 링크96개 누락0. README6행의 기존 Markdown 줄바꿈 공백2개는 의미가 있어 유지하고 일반 후행 공백과 구분했다. 독립 read-only 문서 감사도 수치/범위/핸들/다음 작업의 모순을 발견하지 못했다.

## 74번 당시 소유권 · 역사 기록

- root: 계약·registry/D1·실제 route/공통 연결·Next/workerd/browser/type 실행 창·문서/최종 검사.
- module_contract_audit: 독립 순수/Flight 위험 시험. 완료·동결.
- module_privacy_audit: 실제 SQL/SSR 권한·근거·경합 시험과 읽기 감사. 완료·동결.
- module_fallback_ui: 모듈 UI/fixture/브라우저 시험. 완료·동결. 이후 root가 역할 기반 locator와 대비 specificity·태그 정렬을 보완했다.
- 문서의 agent 이름만 보고 실행 중으로 가정하지 않는다. 실제 도구에서 확인하며 한 파일의 작성자는 한 명이다.

## 다음 구체 작업

1. 실제 Gemini HTTP400의 요청 호환성 원인을 좁힌다. `responseJsonSchema`의 미지원 키/복잡도는 강한 후보지만 미확정이다. 실호출은 누적2/3회이고 이번 배치에서는 더 호출하지 않았다. 이미지 실호출·분석 성공·품질은 미확인이다.
2. S2 관찰 저장 자체의 일시 오류는 분석 성공을 보존하지만 해당 관찰을 누락시킬 수 있다. 내구성 재시도와 사용자가 이미 선택한 `trial`/`active` 템플릿의 사후 출처 정책은 후속 결정/개선이다. [76번](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 S3 웹/Threads/Instagram 원문 수집→S4 영상 구간 근거→S5 자연어 리콜·최종 통합은 별도 배치로 남긴다.
3. 전체 범위와 운영 경계는50번에 유지한다. 원격 배포/migration/cutover·과금 확대·모델 역할 변경은 이번 실행에서 하지 않았다.

이번 단위는 완료했지만 전체 goal은 완료가 아니다. 승인되지 않은 배포/migration/cutover/과금 확대는 수행하지 않았다.
