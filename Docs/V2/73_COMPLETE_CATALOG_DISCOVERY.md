# 73. 전체 분류·대상·시간과 내 목록 탐색

상태: 2026-09-22 이 단위의 구현·로컬 검증 완료. 전체 진행률 약 55%/goal active를 유지한다. 이전 [72번](./72_SAVED_FIELD_READ_BUDGET.md)은 당시 완료 증거이며 이번 검사와 중복 합산하지 않는다. 목적별 모듈·수집/영상·최종 운영 범위는 여전히 전체 목표에 포함된다.

## 사용자 경로와 불변 조건

- 분류50/대상60/시간36개에서 조용히 끊기지 않고 모든 현재 접근 가능한 bucket을 검색·20개 페이지·전체 수로 탐색한다. 한 응답을 무제한 배열로 바꾸지 않는다.
- explore의 세 영역은 검색어와 페이지를 각각 갖는다. 화면 URL로 재진입·뒤로 가기 가능한 현재 조건을 유지한다. 순서는 기존 count 내림차순+안정 tie-breaker, 월은 내림차순이다.
- 검색의 분류 선택은 현재20개 페이지 밖의 선택도 보존한다. 검색 가능한 선택기이며 필드를 고르는 행위가 기록 검색을 자동 제출하지 않는다. 불명/현재 접근 불가 선택은 이름을 지어내지 않고 키를 보존한 명시 fallback이다.
- 분류·시간 facet의 restricted 제외, 대상의 normal+accepted/current 관계와 owner/active/legacy visibility를 유지한다. 분류의 기존 rejected/superseded 제외를 임의 accepted-only 변경하지 않는다. 각 페이지의 count/items/선택 metadata는 마지막 하나의 SQL snapshot이다.
- 저장 뷰 목록은 이름 검색·요약 DTO·20개 페이지/전체 수를 제공한다. 목록 안 기록의 기존 페이지, 보관함 cursor, 표시 필드 catalog는 재구현하지 않는다. 원문·query/display 저장·CAS·pin 의미는 변경하지 않는다.
- 모바일 하단 다섯 목적지를 유지하고 더보기는 실제 modal sheet로 만든다. 확인할 내용/내 목록/템플릿/설정은 보조 진입이며 동적 분류나 자동 pin을 전역 메뉴로 만들지 않는다. Escape·초점 복귀·스크롤·320px·접근성을 검증한다. 구현 중 전체 처리 상태 route가 없는 것을 확인했으므로 해당 항목은 `준비 중` 설명이며 기록별 상태로 안내한다. 처리 상태 통합 화면을 완료로 계산하지 않는다.
- 불법 요청은400, 인증/권한 거절 시 표시를 닫고 늦은 응답을 적용하지 않는다. 네트워크 오류는 원래 선택을 보존하고 명시 재시도한다. 개인 metadata는 private,no-store이며 응답을 원문·전체 기록으로 확대하지 않는다.

## facet 서버/클라이언트 계약

root 소유 순수 `src/lib/v2/retrieval/facet-page.ts`와 `infrastructure/d1/facet-page-repository.ts`로 구현한다.

- 요청: GET `/api/v2/explore-facets?kind=type|entity|month&q=...&page=...&selected=...`. kind 필수, q 기본 빈 문자열/trim/max100/유효 Unicode, page 기본1/정확 양의 safe integer. selected는 type에서만 canonical key 하나, 선택 metadata는 검색어와 독립이다. 알 수 없는/중복 query key는 거절한다.
- `FacetKind = "type" | "entity" | "month"`.
- `FacetItem = { key:string; label:string; count:number; entityKind:string|null }`. type은 registry key, entity는 object ID, month는 YYYY-MM. entityKind는 entity에만 실제 값을 넣고 나머지는 null이다.
- `FacetPage = { contract:"facet-page.v1"; kind:FacetKind; query:string; page:number; pageSize:20; totalCount:number; totalPages:number; items:readonly FacetItem[]; selected:FacetItem|null }`.
- 순수 함수: `parseFacetRequest(URLSearchParams)` → `{kind,query,page,selectedKey:string|null}`; `validateFacetPage(body, request)` → 엄격한 응답. 서버 함수 `readFacetPage(db,userId,request):Promise<FacetPage>`. `totalPages`는 최소1, 요청이 마지막 페이지를 넘으면 최종 SQL에서 clamp한다.
- 별도 exact selected 조회는 같은 base SQL/권한 snapshot 안에서 처리하며 없는 key의 label/count를 추정하지 않는다. JSON encoding과 사용자 문자열은 실행 HTML이 아니다.
- 월은 저장한 `captured_at`의 앞7자 기준을 유지한다. 유효한 YYYY-MM prefix만 달력 링크로 표시하며 시간대를 재분류하지 않는다. 손상된 월 prefix 제외는 기록 삭제나 전체 날짜 유효성 검증이 아니다. 검색은 SQLite `instr(lower(...),lower(?))`의 문자 그대로 부분 문자열 비교이며 `%`/`_`를 wildcard로 해석하지 않는다.

## 내 목록 계약

- GET `/api/v2/saved-views?q=...&page=...&pinned=0|1`: 알려진 단일 query key만 허용하며 검색어 max100/유효 Unicode와 양의 safe integer 페이지를 검증한다.
- `saved-view-catalog.v1`은 query/pinnedOnly/page/pageSize20/totalCount/totalPages와 요약 views만 전달한다. 요약은 id/name/description/iconKey/pinned/pinOrder이며 저장된 query_plan_json/display_json은 목록 SQL에서 읽거나 파싱하지 않는다.
- count와 page는 owner/active 조건을 적용한 한 SQL에서 계산한다. 손상되거나 큰 상세 query JSON은 목록 열기를 막지 않는다. 보관함 메뉴의 pinned 요약은 기존 최대 5개이며 전체 목록과 구분한다.
- 입력 중 값은 응답으로 덮지 않는다. 401/403/404/423은 본문 파싱을 기다리지 않고 닫으며 epoch/abort로 늦은 응답을 배제한다. URL의 검색/페이지/고정 조건을 Back/Forward/reload와 연결한다.
- More가 소유한 일시 history entry 위에 catalog URL을 쌓지 않고 보류한 뒤 닫기 시 반영한다. 새 목적지 선택은 이 반영과 Next의 popstate 복원을 마친 다음 task에서 수행한다.

## 서버·계약 검증

- root75888: `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/catalog-discovery-workerd.test.ts` — 2026-09-22 20:38:15 시작,33.01초,4 PASS,exit0. 실제 격리 workerd+D1 전체 migration6–32에서 type61/entity65/month49·MAX_SAFE_INTEGER clamp·선택독립·schema probe 뒤 privacy 변경·손상 query JSON을 포함한 저장 뷰43개 summary를 검증했다. `persist:false/remoteBindings:false/envFiles:[]`, Wrangler4.121.0이며 원격 자원·환경 비밀값을 사용하지 않았다.
- 감사54252: `tests/contract/v2/explore-facet-page.test.ts` 실제 GET+Node SQLite/순수94 PASS,exit0,20:44:12 시작14.26초. 최초71개→확장88개 PASS 뒤 기존 LF/TAB/CRLF label6개 RED를 발견했다. 기존 쓰기 계약은 이 문자열을 허용하므로 label의 query용 제어문자 검사를 제거했다. root36736은93P/1F였고 남은1개는 문서에 없던 label surrogate 거절 가정이었다. 해당 시험은 기존 문자열 보존 양성으로 정리했으며 q Unicode/control 검증3개는 유지했다. 이후94 PASS·scoped lint34220 exit0·파일 동결.
- agent61072: catalog SQL/API·순수·SSR73+기존 POST29 =102 PASS,4파일,exit0,20:49:40 시작10.31초. 초기4개 RED(무제한 목록·손상 query JSON·5개 초과 pinned 메뉴·중복 q)를 재현하고 summary SQL/엄격 query로 보완했다. 최종 scoped lint18584도 exit0.
- root24204: 신규 탐색/검색 SSR11+기존 retrieval13+legacy visibility6 =30 PASS,3파일,exit0,20:44:23 시작132.47초. 기존 workerd 회귀와 새 SSR+Node SQLite를 구분한다.
- root77365: 기존 저장 표시 API83+SSR5 =88 PASS,2파일,exit0,20:50:49 시작24.96초. exact get/POST/PATCH/CAS의 기존 경로를 변경하지 않았는지 확인했다.
- root83985: Next typegen 성공 뒤 첫 tsc실패(throw helper 제어흐름 좁히기/시험 helper unknown 타입), 해당 타입 선언을 보완한 root65954 tsc exit0(후속 nav/fixture 보완 전). 동작 검사를 타입 검사로 대체하지 않는다.
- 서로 다른 서버·계약·SSR 검사 수는 **318개(4+94+102+30+88)**다. 초기/부분/재실행을 다시 더하지 않는다. 이 수치는 전체 suite·Worker build·실제 개인 corpus 검증이 아니다.

## 브라우저 결함 재현과 수정

| 실행 | 결과 | 해석 |
| --- | --- | --- |
| root68201 | 80 PASS/4 FAIL/4 SKIP, exit1, 3.7분 | 320px 검색 grid 넘침, 모바일 페이지 버튼 가림, More 이동 실패를 실제로 재현 |
| root32954 | 3 PASS/5 FAIL, exit1 | 가로 넘침 해소. 하단 여백·이동은 아직 실패 |
| root68553 | 실제 RSC 4 FAIL, exit1 | HTML 응답 대역을 제거해도 목적지 URL이 유지되는 제품 결함 확인 |
| root14340 | 4 PASS/4 FAIL, exit1 | 카드 margin 우선순위 수정 후 버튼·레이아웃 PASS. microtask 이동은 여전히 실패 |
| root56854 | 4 FAIL, exit1 | 새 task 이동으로 목적지 URL/H1 성공. 남은 실패는 보이는 row와 숨긴 peek의 중복 텍스트 선택자 |
| root73758 | **90 PASS/4 SKIP, exit0, 3.2분** | 시험 locator 한 줄 수정 후 결합94 시나리오. 뒤의 추가 timer 감사 보완 전 결과 |
| root95550 | 6 FAIL, exit1 | 첫 지연 대역: 취소 assertion 실패2·release 전 조기 이동4. Next 내부 타이머까지 잡는 대역의 정밀도 한계가 있어 제품 확정 RED6으로 계산하지 않음 |
| root71064 | 6 PASS, exit0, 12.5초 | 정확한 목적지 callback만 지연하여 unmount·native Forward·재열기 후 취소를 desktop/mobile에서 확인 |
| root91007 | **96 PASS/4 SKIP, exit0, 3.3분** | 취소 보완을 포함한 최종 결합100 시나리오. facet44/catalog46/기존 내구성6 PASS |

실패 문맥은 [초기 오류 폴더](./evidence/73-catalog-discovery/initial-failures/)에 보존한다. timeout·권한 검증·클릭 가능성 기준을 낮추지 않았다.

- grid는 intrinsic min-width를 제한하고, 모바일 실제 bottom margin은 뒤에 선언된 카드 shorthand보다 높은 specificity로 유지한다. H1 크기·light native checkbox도 복원했다.
- More는 component lifetime UUID로 살아 있는 Forward와 reload/remount orphan을 구분한다. 기존 history state를 보존하고 Escape/Back/Forward/초점/body lock을 연결했다.
- popstate 안의 동기 router.push와 microtask는 Next restore에 취소되므로 새로운 task로 목적지 이동을 분리했다. 시험 locator는 실제 record option의 접근성 이름을 사용한다.
- 독립 최종 감사가 예약 이동의 unmount/새 이동 취소 누락을 발견했다. timer ref를 cleanup/restore/show/close에서 취소하며 실행된 callback은 참조를 비운다. `completeMoreNavigation` 이름은 시험 대역이 해당 0ms callback만 구분하기 위한 것이며 제품 delay나 timeout은 변경하지 않았다. 71064의6 PASS와 별도 최종 읽기 검토에서 원 지적 해소를 확인했다.
- 결합 명령: `npm exec --workspace @light-house/web -- playwright test tests/e2e/v2-catalog-discovery.spec.ts tests/e2e/v2-saved-view-catalog.spec.ts tests/e2e/v2-product-durability.spec.ts`.
- 4 SKIP은 쓰기 flag가 꺼진 기존 capture 회귀 2개×desktop/mobile이다. 통과로 계산하지 않는다. 본 작업은 read-only catalog/navigation 범위이며 쓰기 범위를 넓혀 실행하지 않았다.
- 실제 UI와 Next RSC를 사용하지만 합성 자료·HTTP 대역을 포함한다. scoped axe·합성 IME Enter·Chromium mobile emulation은 전체 접근성·실제 한글 IME·실기기·실제 제공자 검증을 대신하지 않는다.

## 표시와 최종 확인

[데스크톱 내 목록](./evidence/73-catalog-discovery/desktop-catalog.png), [320px 페이지 하단](./evidence/73-catalog-discovery/mobile-catalog.png), [모바일 더보기](./evidence/73-catalog-discovery/mobile-more.png)를 root가 실제 렌더 후 확인했다. 합성 검증 자료이며 Next dev 배지는 제품 메뉴가 아니다.

- root99395: 최종 변경 TS/TSX25파일 `npm exec --workspace @light-house/web -- eslint <파일 목록>` exit0.
- root67818: `npm run typecheck --workspace @light-house/web` 최종 exit0. Next typegen 이후 마지막 제품/fixture/시험 변경까지 반영했다.
- [SHA-256 manifest](./evidence/73-catalog-discovery-hashes.json)는 source/test28파일과 화면3개를 고정한다. 브라우저 실행 후 제품/시험 수정은 없다.
- Next dev86127은 의도적인 Ctrl+C로 종료(exit1)했고, 21:23:26에 port3100 listener0·workerd0을 확인했다. 이 dev 종료 코드는 검증 실패가 아니다. 검사 핸들은 모두 종료했다.
- Cloudflare/Wrangler Skill의 격리 로컬 검증을 적용했다. 원격 배포/migration/cutover·과금·자격 증명·원문·앱 Gemini 설정은 변경하지 않았다.
- 최종 root 대조: manifest31개 불일치0, 문서4개 로컬 링크95개 누락0, 저장소 기본 `git diff --check` exit0, 별도 source/test/현재 문서31파일 후행 공백0. 독립 문서 검토도 수치·범위·잔여·핸들 모순을 발견하지 못했다.

다음은 [20번 확장 계약](./20_ICON_AND_VIEW_EXTENSION_CONTRACT.md)에 따라 기존 module의 privacy/version/fallback을 검증하고, 일반 필드 표시로 해결되지 않는 실제 가치가 있는 모듈만 확장하는 것이다. 빈 moduleKeys만으로 전용 페이지를 일괄 생성하지 않는다. 전역 처리 상태·OCR/실제 제공자·자동 수집/영상·최종 전체 suite/Worker·개인 corpus/실기기/원격 운영은 미완료다.

## 오케스트레이션 소유권

- root: facet 순수 계약·SQL/API·공통 연결(v2-lab page)·actual workerd·Next/typegen/build·문서/최종 검사.
- saved_field_labels: 저장 뷰 catalog 계약/repository/API·내 목록 page/component/CSS·계약/SSR/e2e. 기존 POST·정확 get·pin/CAS 의미 보존.
- saved_field_reader_ui: explore/search 소비 화면·분류 선택기·mobile more sheet/공유 하단 nav·LibraryView·lab fixture·e2e. root facet 계약을 소비하며 전역CSS보다 scopedCSS를 사용한다.
- saved_field_read_audit: facet 계약/API/실제 SQLite 독립 시험·owner/privacy/동시 변경·50/60/36 이후·선택 유지/무효 query 검토. 제품 파일 편집 없음.

공유 파일은 한 명만 수정한다. Next/dev/typegen/build/workerd는 root 단일 창, agent는 Node SQLite/순수 시험·scoped lint만 실행한다. 원격/환경/의존성/schema 변경과 전체 suite/Worker 실행은 이번 단위의 기본 작업이 아니다.
