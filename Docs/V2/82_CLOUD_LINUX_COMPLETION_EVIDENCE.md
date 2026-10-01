# Cloud Linux 통합 보완 · 2026-10-01

이 문서는 사용자 승인에 따라 V2 구현을 이어받은 로컬 검증 기록이다. 전체 제품 완료, 실제 Gemini 품질, 원격 배포 승인 또는 실기기 검증을 뜻하지 않는다.

## 1. 기준 소스와 실행 경계

- 기준 소스: `71ec611db16ea8dd8ba625c3c541655673ff944f`의 비밀값·개인 corpus·Notion export·생성물을 제외한 정규 파일 992개
- 전달 ZIP: 2,992,982 bytes, SHA-256 `267c5a32cb381c4f424842af23fc30431669581d1711c7ef36efd9693a8c423a`
- 압축 경로 이탈과 symlink를 거부한 뒤 추출했다. 기존 `TRANSFER_MANIFEST.json`은 이 기준 소스의 기록으로 보존한다
- 과거 생성된 evidence 산출물은 전달 범위에서 제외되어 일부 역사 링크가 이 checkout에서는 열리지 않는다. 해당 과거 PASS를 새 검증의 증거로 대체하지 않는다
- 로컬 import commit: `fda539b`; 작업 branch: `cloud-v2-completion`. 원래 사용자의 Git history를 이 import commit으로 대체하지 않는다
- GitHub main `460e058`은 별도 분기다. V2를 main으로 덮어쓰거나 무검토 merge하지 않았다
- Linux, Node 24.19.0, npm workspace. 모든 데이터/공급자 시험은 합성 fixture와 격리 local D1/R2를 사용했다
- 실제 Gemini 호출, 원격 D1 migration, 배포, push, 계정·과금·자격 증명 변경은 하지 않았다

## 2. 구현 보완

### 개인 분석의 Capture 경계

`personalSourceFence()`가 document의 실제 Capture와 같은 source만 판단하도록 맞췄다. 다른 Capture의 잘못 연결된 manual source가 정상 개인 분석과 만료 작업 복구를 영구 supersede하던 두 경우를 먼저 실패 재현했다. 같은 Capture의 외부 원문 차단, owner, lease/run CAS, cross-Capture restricted 원문 제외는 유지한다.

### S2 관찰 저장 재시도

성공한 run/proposal을 내구성 원장으로, 기존 idempotency 테이블을 완료/재시도 receipt로 사용한다. 새 migration은 없다. 분석 성공 후 관찰 전 중단, 관찰 일부 저장 후 게시 실패, receipt 쓰기 실패를 다음 처리 호출에서 복구한다. 현재 revision·출처·소유자·동의·privacy를 다시 확인하고 사용자 template 선택을 보존한다. 상세는 [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md).

처리 건수 제한은 SQL 스캔 비용 제한을 뜻하지 않는다. 이미 처리한 성공 이력이 누적되면 빈 sweep도 전체 이력을 조회한다. 복구 3개와 신규 분석 3개를 결합한 합성 HTTP 계측은 binding 164회/SQL 329문이며 공급자 호출은 3회였다. 원격 D1/CPU 한도 적합 판정은 별도다.

### S5 검색 정렬

실행된 query plan의 `written_at` 및 방향을 실제 검색 폼에 표시하고 제출 시 보존한다. JSON plan이 일반 URL 파라미터보다 우선하는 경우, 잘못된 plan의 fallback, 뒤로가기와 명시적 정렬 변경을 시험에 추가했다. 2026-10-01 사용자가 민감 기록의 유형·필드 이름을 Google Gemini 검색 해석에 활용하도록 승인했다. 현재 구현의 이 범위를 확정하며 제목·본문·실제 필드값·entity 이름 전송이나 restricted 허용으로 확대하지 않는다.

### 외부 글꼴 다운로드 없는 Linux 빌드

기준 Worker build는 Google Fonts의 Noto Serif KR 다운로드에 실패했다. 같은 네 글꼴을 `@fontsource-variable/*` 5.3.0으로 고정하고 npm 자산으로 묶었다. 기존 네 CSS token과 한국어 unicode subset을 유지하고 각 OFL license를 정적 배포 자산에 포함했다. 설치 후 빌드/방문에 Google Fonts 요청이 필요하지 않다.

### Private corpus 준비 검사

잘못된 manifest/expected 스키마의 필드 접근을 차단하고, 승인 hash 목록을 중복 개수까지 정확하게 대조하며, 실제 경로가 private root를 벗어난 source/expected symlink를 거부한다. 내부 symlink와 정상 20/20 사람 승인 경계는 유지한다. 실제 corpus, expected schema, 자동 채점 의미는 바꾸지 않았다.

### Linux 시험 실행 보완

- 대형 ZIP export와 restore-upload의 전체 byte 동일성 단정을 길이와 최초 불일치 byte 검사로 바꿨다. 8 MiB 이상 배열의 deep-equality 표현이 시험 worker의 2 GiB heap을 소진하던 두 경로이며 정확성 조건은 유지한다
- `test:tools`는 `node --import tsx --test`로 같은 네 시험을 실행한다. tsx CLI의 별도 IPC socket 없이 현재 Node/Next 지원 버전에서 실행 가능하다

### 후속 G01 오프라인 평가 기반

전체 앱 회귀 뒤 [83번](./83_PRIVATE_EVALUATOR_FOUNDATION.md)의 기록 관측 evaluator·보고서 비교 CLI를 별도 branch에서 검증한 후 통합했다. 현재20/20 승인 원문 gate, 명시적인 typed/alias/ranked-ID subset, 내용 없는 보고서, unknown·fatal·미채점 rubric의 승격 차단을 제공한다. 실제 provider/검색/DB 관측을 수집하는 도구가 아니며 실품질 PASS도 만들지 않는다. 이 후속은 `apps/web/src`, 앱 package와 앱 시험을 변경하지 않는다. 기존 manifest의 YAML 경고 출력 차단2줄은 관련25개 시험으로 재확인했다.

## 3. 현재 검증 증거

| 검사 | 결과와 범위 |
| --- | --- |
| 최초 `tests/unit`만 실행 | 33파일 415 PASS. 계약 시험 제외이며 과거 전체 3,454개 결과와 다른 범위 |
| 변경/인접 최종 결합 회귀 | 9파일 127 PASS, exit 0. 개인 분석·출처 경합·S2 재시도·S2 기존 흐름·S5 SSR/계약·font assets·private manifest |
| local workerd/D1 source commit | 6 PASS, exit 0 |
| 초기 tools(G01 전) | 같은 migration4개 시험 PASS, 수정된 정규 npm 명령 exit0. 아래 G01 통합 후에는32개를 더해36개 |
| 최초 전체 lint | 오류 0 / 기존 경고 34 |
| 최초 bindings/db/typegen/typecheck | exit 0 |
| Linux Worker 최초 복구 빌드 | exit 0, audited_files=6711, secret_hits=0. 실제 secret을 이전하지 않은 환경이며 합성 secret-audit 시험은 별도 포함 |
| 실제 Next HTTP 렌더 | 검색 화면 200, 작성·경험일/오름차순 표시, CSS 2개 및 네 글꼴 자산 200. browser interaction 검증은 아님 |
| 첫 전체 Vitest | 167/169파일, 3466/3475시험 PASS, worker OOM 2건으로 exit1(2621.57초). 당시 실행은 최종 PASS가 아니며 실패 이력으로 보존 |
| 최종 고정 소스 전체 Vitest | **172파일3528시험 전부 PASS, 오류0, exit0, 1986.36초**. `6b8be40556b326a8c413f902fc73ec7eecf24816`, 2026-10-01 07:49:16–08:22:24 UTC. export9/9·restore-upload7/7 포함. 이후 문서 갱신과 별도 G01 후속 구현의 증거와 구분 |
| 최종 typegen/typecheck | exit 0. S2 새 시험의 Response.json unknown 타입 오류 2건을 보완한 뒤 재확인 |
| 최종 전체 lint/bindings/db/Worker | lint 오류0/기존 경고34, bindings/db exit0. 최종 Linux safe Worker build exit0, audited_files6711/secret_hits0 |
| G01 후속 영향 범위 | evaluator Node32 PASS·기존 migration4 포함 `test:tools`36 PASS, 기존 manifest2파일25 PASS. 별도 strict type/lint와 synthetic CLI exit2(review_required)·비교 CLI exit0(호환성만) 확인. 위3528개에 중복 합산하지 않음 |
| 실제 local Worker 기동 | 최종 package를 build-only flag 없이 실행해 검색 화면200. AI/쓰기/remote bindings off, 가짜 local D1/R2. 기존 fixture compatibility_date=2026-08-11이며 운영2026-08-12와의 정확한 parity 증거는 아님 |
| Playwright | 이번 환경에서 미실행. Chromium의 IPC socket EPERM, 제공 cloud browser의 localhost ERR_BLOCKED_BY_CLIENT 확인. 과거 845 PASS를 현재 결과로 재사용하지 않음 |

출처 fence와 S2 receipt는 별도 읽기/SQLite 경계 검토에서 추가 privacy·CAS 차단 결함을 찾지 못했다. 이는 전체 suite나 원격 runtime 통과를 대신하지 않는다.

## 4. 여전히 필요한 완료 조건

1. 위 고정 소스의 전체 회귀·대형 export 재검증·최종 Worker 검증과 후속 G01 오프라인 기반의 영향 범위 검증을 완료했다. app 전체 PASS와 새 도구의 별도 검증 범위를 구분한다
2. 실제 브라우저 desktop/mobile 상호작용·접근성·한글 IME, OS Share·offline 등 실기기 확인
3. 설정된 모델로 S1/S4 및 S5 실제 품질 확인. S5는 질문·서울 날짜/시간대·유형/필드 key와 label·data type/연산자·entity 종류를 Gemini에 보낸다. sensitive 전용 유형·필드 이름은 2026-10-01 사용자 승인 범위에 포함됐다. 문서 제목/본문/필드값/entity 이름은 카탈로그에서 선택하지 않으며 실제 호출에는 별도의 실행 환경과 안전한 자격 증명이 필요하다
4. 실제 private corpus 20/20 source와 사람 승인 expected·실제 관측이 필요하다. 현재 [83번](./83_PRIVATE_EVALUATOR_FOUNDATION.md)의 오프라인 기록 비교/report는 구현했지만 실제 모델/검색/DB 관측 수집, 자유 규칙·의미 판단과 사람 rubric은 미구현/미확인이다. case별/평균13점 기준도 임의 판정하지 않는다
5. 현재 build/schema/model/prompt/registry와 결합한 출시 증거. preflight의 수동 `evaluationPassed` 입력만으로 실제 평가 성공을 간주하지 않는다
6. 사용자 승인과 대상 확인 후 원격 migration/배포/호스트 허용 목록/AI flag, 원격 백업·복원·cutover 확인
7. 운영 D1·CPU·quota 한도. 기존 전체 처리기도 단일 링크 65회/3개 120회 binding 관측이 있으므로 S2 보완과 별개로 검증해야 한다. [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)는 Workers Free 50/Paid 1000 queries per invocation을 명시한다. Gemini 무료 유지 선택과 Cloudflare 요금제를 혼동하지 않는다

전체 goal은 계속 active다. 운영 권한이나 자료가 필요한 항목을 합성 시험으로 닫지 않는다.
