# G07 · 출처별 검색과 정확한 보관 위치

2026-09-12 19:27 checkpoint. 출처별 검색→정확 보관 위치의 로컬 연결/검증 완료. [전체 완료표](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)의 G07 일부이며 전체 goal 완료 선언이 아니다. 최신 상태는 [CURRENT_WORK_STATE](./CURRENT_WORK_STATE.md)를 따른다.

## 1. 사용자 경험과 보존 계약

검색은 기록 단위로 중복 없는 결과를 내면서 어떤 보관 원문/내 글/발췌/AI 해석/정리본 역할이 일치했는지 별도로 표시한다. 정확한 위치를 열어도 현재 편집 본문·초안·게시된 AI run을 변경하지 않는다. 과거 위치가 없거나 손상됐다면 명시적 오류를 내며 최신 버전의 유사 문구로 대체하지 않는다.

`record-location.v1`은 code-owned strict union이다. 모든 위치가 전체 선택 text의 SHA-256과 UTF-16 range를 포함한다.

| 종류 | 정확 식별자 | text 의미 |
| --- | --- | --- |
| 제목/내 글 | document revision + version | 제목 또는 보관 본문 전체 |
| 원문 | source item + optional snapshot/manifest/member | 저장 원문 text |
| 수동 발췌 | source + snapshot/manifest/member + fragment | 정확 선택 발췌 |
| AI 조각 | 위 식별자 + processing run | 원문 발췌 또는 명시 구별한 AI 해석 |
| 정리본 | snapshot/manifest + group + revision + role | 제목 또는 역할별 위치순 LF 조합; 중복 항목 유지 |

range는 반환 text 기준이며 원문 발췌 offset은 evidence에 별도 보존한다. origin/역할마다 첫 일치 범위를 제공하며 모든 substring occurrence를 match 수로 세지 않는다. 첫3개 preview와 전체 위치 pagination을 분리한다. 구조 필터/개체명만으로 포함된 기록에 가짜 본문 위치를 만들지 않는다.

## 2. 검색·권한·복사

- canonical 자료 CTE가 membership/count/page를 결정한다. FTS는 순위 보조이며 과거 원문·50개 이후 조각·20개 이후 run을 임의로 자르지 않는다.
- Unicode16 C/S simple folding을 사용한다. 원문 normalization/길이를 바꾸는 lowercase 없이 원래 UTF-16 offset과 digest를 유지한다. GLOB 메타문자는 literal escape한다. query NUL/lone surrogate는 거절하며 저장 원문의 NUL 뒤 구간도 검색한다.
- count/page/metadata/첫 match 또는 전체 match page는 각각 한 SELECT snapshot이다. SQL 뒤 hash/range 계산은 동기식이다.
- exact GET은 owner·capture owner·legacy visibility·lifecycle·snapshot manifest·source/evidence·version을 검사한다. 마지막 SQL 이후 restricted grant 만료를 확인한다. API는 private/no-store다.
- 정리본의 기존 standard/available_only/blocked 복사 정책을 유지한다. collection/alternatives를 검색했다고 합쳐 복사할 수 있는 것은 아니다. 독립 fragment의 rejected/superseded 상태는 복사를 차단한다. 이미 보관한 불변 정리본은 기존 channel 복사 정책으로 별도 판정한다.
- UI는 `?loc=`를 읽기 전용 패널로 열고 응답 식별자·hash·range·정책을 검사한다. 복사 직전 재조회하며 늦은 응답/만료 권한으로 text를 되살리지 않는다. 열기만으로 POST/AI 분석을 실행하지 않는다.

## 3. 중간 증거와 RED · 최종 결과는 5절

| 검사 | 현재 결과 | 범위·한계 |
| --- | --- | --- |
| locator 계약 | 173 PASS, exit0,18:52:09 | strict parser/UTF-16/hash/href; lone-surrogate ID RED 보완 |
| 계약 + Unicode | 231 PASS, exit0,1.28초,18:55:50 | 공식 casefold와 실제 SQLite/JS 대조; D1 Worker 아님 |
| exact API SQLite | 30 PASS, exit0,9.71초,18:57:40 시작 | 52 manual/21+ run, owner/privacy/delete/final await, 과거 source/body, 복사 정책 |
| canonical 검색 SQLite | 28 PASS, exit0,12.11초,19:00:09 | 53 matches/records, Unicode/literal/NUL; 추가 독립 검토 중 |
| 타입/lint/workerd/browser | 대기 | 작성/fixture만으로 통합 PASS를 주장하지 않음 |

exact API 최초28P2F 중 제품 RED는 source_commit 본문 digest를 일반 편집 revision digest로 취급한 문제였다. capture-payload digest와 immutable capture note를 검증하는 실제 계약으로 고쳤다. 다른 실패는 capture UNIQUE 위반인 fixture 오류로 제품 결함 수에 포함하지 않는다. canonical SQL 중간 RED는 page 정수 계산과 SQLite replace(NUL) 무효였다. NUL-bearing text만 BLOB 기반 구간 탐색으로 처리한다.

독립 읽기 검토에서 metadata 손상의500 오류 분류, 반환 snapshotVersion 최종 fence 및 opaque source ID delimiter 충돌을 발견했다. 모두 실제 RED 이후 보완했으며 최종 결과는5절과 같다.

## 4. 후속 범위와 근거

이 slice 이후에도 저장 뷰 layout/density/groupBy/visibleFields 렌더, 목적별 모듈, facet/catalog가 남는다. 이번 구현으로 G08 자동 수집/G09 영상·자막 기능이 생긴 것은 아니다. 실제 provider·개인 corpus·실기기·원격 gate는 별도다.

외부 기술 근거: [Cloudflare prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Unicode16 CaseFolding](https://www.unicode.org/Public/16.0.0/ucd/CaseFolding.txt). Unicode 데이터 버전·해시·라이선스를 제품 helper에 기록했다.

## 5. 최종 연결·검증 결과

- root84311: **9파일378 PASS, exit0,91.20초**,19:23:37 시작. actual workerd2 + Node SQLite canonical36/reason6/exact API30/damage7/HTTP roundtrip31/actual SSR6 + locator173/Unicode87. 전체 앱 suite가 아닌 영향받은 관련 결합 검사다.
- 실제 workerd2는0006–0032 전체 로컬 schema에서 search→source/manual/curation exact read, 동일 bytes/hash/range·중복 조립 역할·owner/restricted와 긴 Unicode 토큰을 확인했다. ASCII300/École200/한글·emoji·특수문자/Σ→ς/astral 동치,20,000자 prefix·NUL 뒤 정확 위치를 포함한다. 실제 provider/원격 D1 성공은 아니다.
- root28954: **desktop38+mobile38=76 PASS, exit0,2.2분**. 원문/52+근거/27번째 run/정리본 역할·부분 복사,404/409/503 및 권한·잘못된200·늦은응답, 현재 draft 유지·close/reopen/back/reload,320px·키보드·clipboard fallback·scoped axe·자동 POST0. HTTP는 대역이고 실제 DB 경로는 위 API/SQL 검사가 담당한다.
- root18886: 모바일 스크린샷에서 native 선택 영역의 낮은 대비를 확인하고 scoped selection CSS를 보완한 후 **desktop/mobile2 PASS, exit0,15.8초**. 선택 text/mark 색상·키보드 선택·320px/axe를 재검사했다.76개 결과와 이2개를 중복 합산하지 않는다.
- root15817 타입 exit0, 제품/시험26개 scoped lint55295 exit0. 마지막 선택 CSS/시험 변경 후 최종 타입92306과 후속 lint도 exit0다. 새로운 전체 build/Worker package는 이번 기능 검증에 포함하지 않았다.
- [검증 파일 지문27개](./evidence/70-search-location-hashes.json)의19:31 최종 재해시 불일치0,문서4개 로컬 링크88개 누락0,git diff --check exit0를 확인했다. 종료 후 workerd0/포트3100 listener0다. 지문은 산출물 동일성 확인이며 기능·운영 승인 자체가 아니다. 독립 검토도378개 합계/52% 산식/미완료 경계를 확인했다.

### 확인된 실패와 해결

1. root37443 결합311P1F(exit1)에서 실제 D1이6-arm compound SELECT를 거절했다.4-arm 이하 materialized groups로 분리해 같은 SQL snapshot/전체 후보를 유지했다. root69363 전용1 PASS 후 최종84311에서 긴 토큰까지2 PASS다.
2. [D1 공식 한도](https://developers.cloudflare.com/d1/platform/limits/)의 함수인수32·GLOB50bytes에 맞게 JSON을 작은 묶음으로 합치고, 긴 token을48-byte 이하 atom-preserving 조각으로 분할했다. 마지막 Unicode scalar의 동치 anchor를 instr로 찾은 후 같은 시작점의 모든 조각을 순서대로 검증한다. query300 UTF-16/원문/후보를 축소하지 않는다.
3. source/member ID `(a:b,c)`와`(a,b:c)` 충돌을 actual SQLite RED로 확인하고 JSON tuple identity로 바꿨다. 훼손 metadata는 narrow integrity 오류로 분류하고 unrelated DB/access 오류는 유지했다. snapshot_version 변조2건은 immutable trigger를 명시 제거한 손상 fixture이며 정상 UPDATE 차단도 별도 검증했다.
4. 풍부한 plan JSON이 `/search`에서 무시되는 문제와 중복/알 수 없는 query를 actual HTTP RED로 확인했다. 두 endpoint가 strict 공통 parser를 사용하고 contains/lte/multi-entity/date/limit을 그대로 유지한다. 긴query를 조용히 자르지 않는다.
5. 더보기 중 공개 수준이 바뀌면 이전 카드의 제목/문맥/근거까지 숨긴다. same SQL snapshot의 privacyLevel을 필수 응답으로 확인하고 접근/필터 이탈은 private/no-store404로 닫는다. 실제 search/saved-view SSR의 마지막 await 뒤 grant 만료 누락도4P2F RED→최종6 PASS로 보완했다.
6. 첫 browser92962는47P15F였다. 취소된StrictMode 초기 GET을 고정 횟수에 포함한 시험 오류를 trace의 ERR_ABORTED로 구별해, 렌더 후 복사/retry 정확히+1·identity·POST0으로 검증했다. 실제 작은 날짜/분류 대비3.91:1은 색상 보완했다.

추가 단발 node -e 한도 진단80566은2분 이상 무출력으로 결과를 얻지 못했다. root가 시작한 확인된 부모node/자식workerd만 종료했고 증거로 사용하지 않는다. 후속 실제 Vitest/workerd 종료 결과가 정본이다.

이 slice의 검증으로 G07을25→50, 전체550/1100=50%에서575/1100=52.27%(약52%)로 갱신한다. G07 전체 완료·G10 전체 통합/Worker·G11 운영 승인은 아니다.
