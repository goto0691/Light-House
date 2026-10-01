# 71. 저장된 뷰의 실제 표시

상태: **G07 저장 뷰 표시의 로컬 사용자 경로 검증 완료**,2026-09-12. 70번 정확 검색의 후속이다. G07은75점, 전체는약55%이며 목적별 모듈/탐색/큰 필드 읽기 예산과 전체 통합·운영은 미완료다.

## 사용자 계약

- 생성/표시 설정 편집에서 list/cards/timeline/table, comfortable/compact, 그룹 없음/유형/보관월/작성월, 최대8개 필드를 선택하고 명시적으로 저장한다. 검색 조건·정렬·페이지 membership은 표시 설정과 별개다.
- 그룹은 **현재 페이지 안의 연속된 기록**만 묶는다. A/B/A 순서는 그대로이며 A 제목이 다시 나타날 수 있다. 전체 자료의 그룹별 건수나 전체 월별 조회로 오인시키지 않는다. 타임라인은 저장된 ISO 날짜 기준을 설명하고 작성일 미상은 보관일로 조용히 대체하지 않는다.
- 기본 메타데이터는 `@record.captured_at`/`@record.written_at`/`@record.updated_at`/`@record.type`의 명시 토큰이다. 일반 registry key는 @로 시작할 수 없으므로 충돌하지 않는다. 기존 bare `type`/`captured_at` 등은 계속 사용자 필드다. 동적 필드는 검색 가능한20개 단위 목록으로 탐색한다. 모르는 기존 키는 보존·제거할 수 있고 값이 없으면 미기록으로 표시한다. 새 유형마다 코드를 생성하지 않는다.
- 확정된 현재 속성만 출력한다. AI 제안/분쟁/기각/대체된 속성을 사실로 표시하지 않는다. 사용자 잠금 우선순위를 적용하며 최상위 값이 여러 개이거나 손상되면 conflict로 표시한다. 명시적 null은 미기록과 구분한다. 정상 schema는 현재 accepted 속성1개를 보장하고 손상 시험에서만 해당 unique index를 제거했다.
- 출처·사용자 잠금·실제 `unit_key`를 보존한다. 단위 변환이나 척도를 추정하지 않으며 척도 없는 평점4.5는 `4.5 (척도 미기록)`이다. 대표 분류와 선택한 분류 필드의 accepted/잠금/role 기준을 일치시켰다. 제안뿐이면 일반 기록, 동률이면 분류 확인 필요다.
- 민감/제한 기록의 추가 표시 필드는 값·존재 여부 모두 숨긴다. 정확 검색의 제목/문맥 정책, 권한 거절 시 전체 결과 닫기, readonly exact location 경로를 재사용한다. 일부 레이아웃에만 약한 조회 경로를 만들지 않는다.
- 표는 내부의 접근 가능한 스크롤 영역만 가로 이동한다. 생성 모달은 이름에 초기 초점·키보드 순환·Escape 닫기·트리거 초점 복귀를 제공한다. 실패/충돌 시 입력을 유지하고 자동 재저장을 하지 않는다.

## 저장 및 조회

- 기존 display_json과 query_plan_json을 유지한다. 새 migration·원문 변경·AI 호출은 없다.
- GET/PATCH `/api/v2/saved-views/[viewId]`는 인증한 소유자만 접근한다. PATCH display는 exact keys(action,display,expectedRevision), 기존 display 검증,8192byte 한도를 사용한다. 생성 POST는32768byte 한도다. mutation의 same-origin/쓰기 flag는 기존 공통 정책을 따른다.
- displayRevision은 **저장된 display_json bytes의 SHA-256 content-CAS**다. 단조 이력 버전이 아니며 A→B→A의 동일 상태는 허용된다. 같은 목표 상태의 재시도는 무변경 현재 상태 반환이며 과거 receipt 재생으로 주장하지 않는다. pin 변경은 display 변경과 충돌하지 않는다.
- 비교와 UPDATE 사이에도 owner/active/current display_json을 SQL에서 검사하고 UPDATE RETURNING으로 해당 쓰기의 응답을 만든다. 다른 display가 먼저 저장되면409이며 내 draft를 버리지 않는다. 최신 상태 GET과 명시 재적용으로 복구한다. 클라이언트는 같은 view ID·정확한 display·revision 형식을 확인한 성공만 적용한다.
- 필드 값은 canonical 최종 검색 SQL snapshot에서 record metadata/권한/검색 위치와 함께 조회한다. 결과마다 repository를 반복 호출하지 않는다. 평탄한 items/registry/property/type JSON 배열을 한 SELECT에서 받고 동기적으로 DTO를 조립한다. 이후 별도 권한/값 조회를 추가하지 않는다.
- 필드 catalog는 인증한 소유자 registry의 active/observed metadata다. q/page exact query·100자 검색·20개 페이지·범위 밖 페이지 보정을 지원하며 기록 값/기록 수/민감 기록 링크를 반환하지 않는다. 기존 bare key를 제외하지 않는다.
- 신규 응답과 오류는 private,no-store다. 외부 스크랩 내용은 데이터이며 HTML/SQL/renderer 명령으로 실행하지 않는다. display fields는 비동기 경계 전에 검증한 불변 복사본을 사용한다.

## 오케스트레이션

root는 설정 저장/CAS/API·field catalog·SSR/workerd 시험과 통합 실행 창/인계를 맡았다. curation_evidence_client_review는 필드 projection·canonical SQL, migration_recovery_browser는 실제 UI/lab/e2e, exact_ai_evidence_review는 독립 API/SQLite owner·CAS·의미 충돌·분류 검토를 맡았다. 파일의 동시 작성자를 한 명으로 유지했다. root가 실제 workerd3개 실행 창만 명시 위임하고 종료 후 Next 창을 사용했다.

Cloudflare/Wrangler Skill에 따라 [현재 prepared statement API](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)와 [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)를 확인했다. Wrangler4.121.0의 격리 fixture에서 `persist:false,remoteBindings:false,envFiles:[]`를 사용했다. Skill의 오래된 session/가격 예시는 사용하지 않았고 원격 연결·환경 파일 읽기·원격 migration 적용은 하지 않았다.

## 중간 RED → 최종 보완

- root54854는 기존schema16 retrieval13 PASS/fullschema32 검색·표시3 FAIL(exit1,124.62초)이었다. 실제 D1 expression depth100 오류를 평탄한 sibling projection으로 해소했다. timeout이나 검색 상한을 줄이지 않았다.
- 정상 schema의 사용자 bare key4개/catalog1개에서 독립5 RED를 재현했다. `@record.*` 분리 후 사용자 기존 필드/필터 의미를 보존했다. 이어 대표 분류의 잠금/제안 제외 불일치2 RED를 보완해 독립8개가 통과했다.
- 초기 API77P2F는 기존 change_events trigger를 누락한 시험의 total_changes 기대값이었다. 재시도가 추가 쓰기를 하지 않는 전후 기준으로 보완했고 최종 API83개를 검증했다.
- 최초 browser73105는 select label 선택자 timeout 후 중단(exit1)했다. 접근 가능한 combobox role/name으로 시험 선택자를 보완했다. 중단된 출력은 전체 시험 결과로 계산하지 않는다.
- combined50574는110P4F였다. 기존 exact-search76은 통과했고 새 화면에서 실제 모달 초점/안내문 대비 결함이 각각 desktop/mobile에서 재현됐다. showModal 뒤 이름 input ref에 초점을 주고 일반 안내문 색을 보완했다. 오류 문구 색과 시험 기준은 유지했다. 후속 신규38개가 모두 통과했다.

## 최종 검증

| 실행 | 결과 | 범위 |
| --- | --- | --- |
| root65946,19:59:09 시작 | 123 PASS/8파일,exit0,49.35초 | canonical36/HTTP 왕복31/exact API30/새 actual SSR5/reason6/damage7/기존 SSR6/unit2 |
| agent62393,20:00:51 시작 | 58 PASS,exit0,31.14초 | fields16+canonical36+reason6. 위와42개 중복 |
| agent92665,19:55:55 시작 | 83 PASS,exit0,17.99초 | 실제 route+SQLite owner/CAS/경합/catalog/strict 입력 |
| agent21742,19:59:04 시작 | 3 PASS,exit0,78.33초 | 실제 workerd/full migration0006–0032의 exact2+display1 |
| root57237,20:04:36 시작 | 21 PASS,exit0,67.12초 | 실제 workerd 기존retrieval13+독립 bare key/분류8 |
| root50574 | 110 PASS/4 FAIL,exit1,3.4분 | 기존 browser76 PASS+새34 PASS/초점·대비4 FAIL |
| root18774 | 38 PASS,exit0,1.3분 | 최종 desktop19+mobile19:4layout/CAS/권한/25개 catalog/키보드/320px/axe |
| root77470 / root34158 | 각각exit0 | 최종 tsc --noEmit / 변경 TS·TSX22파일 scoped ESLint |

서로 다른 계약/SQL/API/SSR 시험 합계는 **246개 =123+16+83+21+3**다. 단일 전체 suite 실행이 아니다. agent21742 이후 canonical SQL 파일의 마지막 변경은 기존 검색 조건과 대표 분류가 실제 일치할 때만 구체 분류명을 말하도록 한 **JS 이유 문구 한 줄**이며 SQL은 불변이다. 이후 root57237이 해당 경로를 재검증했다. 마지막 UI 포커스/CSS 변경 뒤 root18774와 최종 타입/lint를 확인했다. 새38개와 이전 기존76개를 단일114 PASS로 표현하지 않는다.

재현 명령은 저장소 루트에서 실행한다(실제 workerd와 Next 실행 창은 겹치지 않는다).

```powershell
npm run test --workspace @light-house/web -- tests/contract/v2/retrieval-canonical-origins.test.ts tests/contract/v2/search-location-roundtrip-api.test.ts tests/contract/v2/record-location-api.test.ts tests/contract/v2/saved-view-display-ssr.test.ts tests/contract/v2/retrieval-match-reason.test.ts tests/contract/v2/record-location-damage.test.ts tests/contract/v2/search-location-ssr-access.test.ts tests/unit/v2/saved-view-contract.test.ts
npm run test --workspace @light-house/web -- tests/contract/v2/saved-view-fields.test.ts tests/contract/v2/retrieval-canonical-origins.test.ts tests/contract/v2/retrieval-match-reason.test.ts
npm run test --workspace @light-house/web -- tests/contract/v2/saved-view-display-api.test.ts
npm run test --workspace @light-house/web -- tests/contract/v2/search-locations-workerd.test.ts tests/contract/v2/saved-view-display-workerd.test.ts
npm run test --workspace @light-house/web -- tests/contract/v2/retrieval.test.ts tests/contract/v2/saved-view-field-key-collision.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-saved-view-display.spec.ts
npm run typecheck --workspace @light-house/web
```

## 화면·지문 및 검증 한계

최종 source/test23파일과 화면6개의 SHA-256은 [지문 목록](./evidence/71-saved-view-display-hashes.json)에 보존한다. 20:21:29 재해시29개 불일치0,문서4개 로컬 링크92개 누락0,포트3100 listener0/workerd0,git diff --check exit0(기존 LF→CRLF 경고만)을 확인했다. 이 목록은 현재 단위의 증거이며 이후 제품 변경의 PASS를 보장하지 않는다. 70번의 과거 지문을 덮어쓰지 않는다.

root는 실제 컴포넌트의 [desktop cards](./evidence/71-saved-view-display/desktop-cards.png),[desktop table](./evidence/71-saved-view-display/desktop-table.png),[mobile cards](./evidence/71-saved-view-display/mobile-cards.png),[320px controls](./evidence/71-saved-view-display/mobile-320-controls.png),[320px create dialog](./evidence/71-saved-view-display/mobile-320-create-dialog.png)를 직접 확인했다. 표의 큰 너비는 내부 스크롤로 제한되고 모달은 세로 스크롤을 사용한다. lab의 시험 전환 버튼·합성 레코드는 제품 IA나 실제 개인 corpus가 아니다. 모바일 viewport 검사는 실기기 검증을 대신하지 않는다.

## 남은 G07 및 전체 경계

- 긴 accepted text/JSON 값은 지금 잘라 저장하지 않는다. 큰 필드의 **명시적 일부 표시/원값 열기·payload 예산**은 후속이다. 전체 값을 일부인 것처럼 숨기거나 일부값을 완전한 원값처럼 표시하지 않는다.
- 표시 설정을 닫았다 다시 열 때 catalog label cache가 사라져 선택 키가 `user_rating · 기존 필드`처럼 표시될 수 있다. 선택/order/value는 유지되며 검색하면 label을 얻는다. 재진입 label 복구는 후속 UX다.
- 목적별 Record module/semantic icon, 기존 facet/catalog50/60 제한·saved-view 전체 탐색이 남는다. 신규 선택 필드 catalog의20개 단위 페이지 완료와 구별한다.
- 새 메타데이터 토큰의 API 저장/읽기는 검증했다. 기존 display_json 이동성 경로를 그대로 쓰지만 이번 토큰을 담은 full+delta 복원 자체는 직접 재실행하지 않았다. 이를 새 이동성 시험 PASS로 주장하지 않으며 최종 통합 후보에서 포함한다.
- 현재 전체 suite/Worker package, 실제 OCR/제공자/웹·SNS 수집/영상 분석, 개인 corpus/실기기/원격 운영 gate는 이 단위로 완료 처리하지 않는다. 배포·migration·legacy cutover·과금 확대 없음.
