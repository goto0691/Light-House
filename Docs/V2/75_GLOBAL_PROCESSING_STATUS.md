# 전역 처리 상태 · G07

2026-09-23. 상태: S0 로컬 구현·관련 검증 완료. 전체 goal은 active이며 [50번](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)의 과거 600/1100, 약55% 기준선은 현재 구현률로 해석하지 않는다.

## 범위와 표시 계약

- 실제 `/v2/processing` + authenticated `GET /api/v2/processing/status`. 데스크톱 보관함 utility·모바일 More 진입(D-038)을 연결한다. 1차 메뉴를 늘리지 않는다.
- 서버에 저장된 기록만 다룬다. `storage=saved`와 AI 상태를 별도로 표시한다. 기기 초안/오프라인 전송 대기·실패는 이 서버 목록의 범위가 아니며 기존 capture/기기 queue를 이용한다.
- 최초 capture receipt의 `aiProcessing`, capture의 마지막 상태, 가장 최근 job 하나를 전체 분석 정본으로 쓰지 않는다. 현재 revision과 링크 snapshot/manifest에 맞는 작업들을 읽는다. 일반/링크 분석은 최신 작업, grounding은 input hash별 최신 작업을 집계한다.
- `queued`, `processing`, `retry_wait`, `needs_review`, `completed`, `outdated`, `unprocessed`, `restricted`를 고정된 한국어로 표시한다. job 성공이 사용자 검토 완료를 의미하지 않는다. partial run과 open review/현재 published 조각 제안은 별도 flag이며 확인 필요로 분류한다.
- 만료된 실행 lease에 유효한 provider invocation lease도 없으면 실행 중으로 단정하지 않고 확인 필요로 보여준다. 조회가 lease 복구를 실행하지 않는다.
- runtime enabled/configured와 main/grounded role의 `state/retryAt`만 읽는다. 관측값이 없으면 unknown이다. cooldown 경과는 장애 해소를 증명하지 않고 다음 runner 확인이 필요하다. retry 시각은 실행 보장 시간이 아니다.

## 데이터·권한 경계

- owner, document kind, active/archived, canonical, capture owner, current revision 소속, legacy projection 조건을 동일한 목록/count에 적용한다. 한 최종 SQL SELECT가 목록·count·runtime을 함께 읽는다.
- 제목 외 원문·URL·출처·모델 출력·오류 본문·probe owner·API key는 DTO에 없다. normal 제목은 목록용240자 preview이며 원문 수정이 아니다. sensitive 제목은 `민감 기록`; restricted는 `잠긴 기록`, stage 없음, partial/review flag 없음이다. overview에서는 재인증으로 원문을 확대하지 않는다.
- 20개 고정 페이지, savedAt/id 내림차순 keyset, filter-bound cursor, 고정 필터5개. counts는 현재 조회 snapshot의 각 분류 전체 수다. 서로 다른 페이지 사이의 동시 변경은 고정 스냅샷 세션이 아니므로 새로고침으로 다시 확인한다.
- API 성공과 오류 모두 `private, no-store`, `Vary: Cookie`. GET에 큐 enqueue/dispatch/tryAcquire/runner/provider 호출이 없다.
- 재분석은 기록을 열어 기존 명시 절차를 이용한다. 링크 재요청의 revision/snapshot/hash/idempotency/동의 경계를 유지한다. 현재 존재하지 않는 일반 분석/grounding용 임의 retry endpoint를 만들거나 CRON_SECRET 경계를 client로 옮기지 않는다.
- client는 페이지/필터/새로고침의 stale 응답을 무효화하고 오류/권한 실패에서 오래된 내용·count/runtime을 비운다. 외부 응답 오류문은 표시하지 않는다. 기존 기록 편집 초안은 변경하지 않는다.

## 병렬 소유권

- root: 공유 DTO, D1 repository/API/SSR·lab 등록, workerd/Next/browser/type 자원 창, 문서·최종 확인.
- module_fallback_ui: 실제 client/CSS, desktop utility/mobile More, lab fixture와 browser 시험.
- module_privacy_audit: 실제 Node SQLite·API/SSR 독립 검증.
- module_contract_audit: 기존 receipt/runner 상태 위험 조사와 순수 query/cursor 경계 검증, 독립 SQL 검토.

## 검증 기록

인계 시점의 8676 뒤 변경을 실제로 재검증했다. 최초 최신본 실행은 SQLite fixture가 성공 job에 대응하는 성공 run을 만들지 않아 11 FAIL/167 PASS, exit1이었다. fixture에 입력 hash가 맞는 run을 넣고, run 없는 성공 job은 확인 필요로 남기는 경계를 추가했다. stale/superseded 최신 run은 완료가 아닌 `outdated`로 표시한다. 합성 UI의 partial/open review를 `completed`로 잘못 둔 입력도 수정하고, 모순된 서버 DTO는 client에서 닫는다. archived 기록이 Review 목록에는 없을 수 있어 각 행의 확인 링크는 해당 Record로 연결한다.

| 최신 검사 · 2026-09-23 | 결과와 범위 |
| --- | --- |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/unit/v2/processing-status.test.ts tests/contract/v2/processing-status-repository.test.ts tests/contract/v2/processing-status-routes.test.ts` | 107 순수 + 52 실제 SQLite + 17 API = 176 PASS, exit0 |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/processing-status-ssr.test.ts tests/contract/v2/processing-status-workerd.test.ts` | 실제 SSR 2 + Workerd D1 3 = 5 PASS, exit0. owner/restricted·조회 실패와 실제 SQL 집계를 포함 |
| `npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-processing-status.spec.ts --project=desktop-chromium --project=mobile-chromium` | 실제 컴포넌트/lab 브라우저 40 PASS, exit0. 필터·권한 실패·경합·키보드·320px 접근성 포함 |
| 마지막 행 링크 변경 뒤 `--grep "saved originals"` 재검사 | desktop/mobile 2 PASS, exit0. 이전 40건과 별도 범위이며 합산한 전체 재실행이 아님 |
| 변경 S0 파일 scoped ESLint | exit0. 마지막 링크 변경 뒤 해당 TSX·browser 시험 파일도 exit0 |

실제 `/v2/processing` SSR은 분리된 SQLite 시험으로 확인했다. 브라우저는 합성 lab/요청 대역이며 개인 자료·실제 Gemini·원격 Cloudflare·실기기 증거는 아니다. S0는 읽기 전용이며 원문/URL/provider raw/error body는 DTO로 나오지 않는다. 전체 suite/Worker build와 S1을 포함한 최종 타입 결과는 별도 단위에서 확인한다. 11:38 KST에 port3100 listener/workerd 프로세스는 없었다.

기술 참조: 설치 Next16.3의 page/Route Handlers/Server and Client Components 가이드, [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [Wrangler API](https://developers.cloudflare.com/workers/wrangler/api/). 설치 Wrangler4.121.0과 기존 격리 fixture를 사용한다. 원격 migration/배포/서비스·과금 확대/실제 Gemini 호출은 이 단위에서 하지 않는다.
