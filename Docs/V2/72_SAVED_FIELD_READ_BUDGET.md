# 72. 긴 표시 필드의 읽기 예산과 선택 이름 복구

상태: 2026-09-22 이 단위의 로컬 구현·관련 검증 완료. G07의 후속이며 목적별 모듈/탐색이 남아 전체55%/goal active를 유지한다. 이전 goal turn은71번 사용자 경로와 검증·완료표를 실제 변경한 **progress**다. 이번 재개에서 포트3100/workerd0과 현재 파일을 확인했고 이번 단위도 실제 사용자 경로와 검증을 추가한 progress다.

## 읽기 계약

- 목록 projection에서 동적 속성의 저장 JSON이2048 UTF-8 byte 이하이면 기존 typed value를 유지한다. 큰 값은 SQL에서256 Unicode codepoint의 저장 JSON 접두부와 전체 저장 byte 수만 반환한다. text/date/JSON뿐 아니라 공백 때문에 예산을 넘는 유효한 number/rating/boolean/null도 포함한다. 형식 불일치와 무한대 숫자는 계속 conflict다. UI는 이를 명시적인 JSON 일부로 구별하고 복사 원값으로 쓰지 않는다. 저장된 원본은 수정하지 않는다.
- 선택 필드 최대8개/기록 페이지의 기존 제한을 유지한다. count/page/권한/필드 projection은 같은 SQL snapshot이고 추가 per-record 조회를 하지 않는다. 이 예산은 동적 속성 값에 대한 것이며 검색 원문 전체 경로의 비용 측정이 끝났다는 뜻이 아니다.
- 전체 값은 사용자가 명시적으로 열 때만 새 GET으로 읽는다. owner/active/legacy visibility/current document/capture/current accepted property/사용자 잠금 우선/normal privacy를 마지막 SQL에서 함께 확인한다. 이 목록용 surface에서는 restricted grant가 있어도 민감/보호 필드를 노출하지 않는다.
- 명시 조회 한 번에는 저장 JSON 최대2MiB를 서버에서 읽어 타입을 검증하고 content revision을 계산한다. 일반 응답은4096 UTF-16 단위 이하의 구간이며 surrogate pair를 나누지 않는다. 서버 읽기 자체가4096자로 줄었다고 주장하지 않는다. 전체 복사는 별도 명시 요청으로 최대2MiB 저장 JSON에 대응하는 전체 값을 반환한다.
- text/date는 JSON 문자열을 디코딩한 값, JSON은 저장 JSON 문자열 그대로, number/bool/null은 기존 typed materializer의 값 표현을 사용한다. 숫자는 JavaScript Number이므로 raw JSON의 지수 표기·공백·초정밀 정수 표기를 byte 단위로 복사한다는 계약은 아니다. 저장 raw JSON 자체는 보존하며 단위/출처는 별도 표시한다. 읽기 위치와 복사는 UTF-16 문자 단위이며 원본 수정/AI 호출이 없다.
- 첫 열기 이후 페이지/전체 복사는 동일 record/property/key/원값 JSON/형식/단위/출처/사용자 잠금을 묶은 SHA-256 revision을 요구한다. 변경되면409이며 서로 다른 값을 이어 붙이지 않는다. 최초 열기는 현재 값을 확인하는 동작이지 이전 preview의 역사 버전을 보장하는 locator가 아니다.
- 응답은 private,no-store. 취소·unmount·identity 변경 후 늦은 응답은 적용하지 않는다. 권한 상실/record identity 또는 privacy 이상 응답은 기존 검색 결과 전체를 닫는다. field/property identity 불일치도 적용하지 않는다. 일반 오류는 명시적 재시도,409는 이전 값·preview 제거 후 처음부터 읽기다.413도 이전 값·복사를 제거하되 버전 변경으로 단정하지 않고2MiB 읽기 한도와 원값 보존을 설명한다.
- 성공한 최초 읽기 이후 목록 조회 당시 preview를 재노출하지 않는다. 현재/전체 복사는 매번 fresh GET과 revision 검사를 거쳐야 한다. 클라이언트는 JSON parsing 전에 일반32KiB/전체5MiB HTTP body 상한을 streaming으로 검사한다. 서버 단일 값2MiB 한도와 JSON 응답 인코딩 상한은 서로 다른 예산이다.

## 선택 필드 이름

기존 catalog 검색(q/page)와 분리된 key 반복 query(max8 canonical keys)로 현재 선택한 active/observed registry metadata를 가져온다. q/page와 혼용하지 않고 owner/key 순서를 보존한다. retired/미등록은 명시 fallback이며 선택/order는 버리지 않는다. 선택 metadata와 검색 페이지 상태를 분리해 다른 검색/설정 재진입에도 이름을 유지한다. 권한 거절 시 label과 대기 중 저장 응답도 폐쇄한다.

표시 설정 PATCH/충돌 후 GET은 권한 거절 헤더를 받는 즉시 닫고 미완료 JSON 본문을 기다리지 않는다. 새 목록 생성은 검증·정규화한 독립 불변 요청을 보내고201 응답의 name/description/iconKey/queryPlan/display와 fresh display SHA-256을 대조한 뒤 이동한다. 응답 ULID는 서버 생성 형식만 확인한다. 새 ID를 미리 아는 identity 증명이나 중복 생성 방지 receipt가 아니다. 다른 응답이면 현재 이름·표시 입력을 보존하고 이동하지 않는다.

## 오케스트레이션과 검증

- root: projection/DTO·원값 repository/API·SearchResults 연결·실제 workerd/Next 통합·기록.
- saved_field_labels: 선택 label lookup/API/controls/상위 저장 폐쇄·별도 SQL/브라우저 시험.
- saved_field_reader_ui: 명시 reader·복사·취소/경합·lab/브라우저 시험.
- saved_field_read_audit: 독립 실제 SQL/API 경계 시험. 제품 파일 동시 작성 없음.

Cloudflare/Wrangler Skill에 따라 [prepared statement API](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)와 [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)를 확인했다. 설치 Wrangler4.121.0의 getPlatformProxy에서 persist:false/remoteBindings:false/envFiles:[]를 유지한다. Skill의 오래된 session/가격 예시는 적용하지 않는다. 원격 변경 없음.

## 발견한 실패와 보완

- 초기 root93303:63 PASS/1 FAIL,exit1,120.33초. 새 실제 D1 긴 값 검사는 통과했으며 실패는 같은 fixture에 추가된 필드로 catalog 전체 건수가23→24가 된 시험 격리 문제다. 기존23개 운동 필드 검색을 명시해 보완했고 후속88241은2 PASS/exit0/33.50초다.
- 독립 API fixture의 current_revision_id NOT NULL 위반을 비존재 revision ID로 교정했다. 테스트 타입 검사에서 unknown narrowing과 현 TS lib의 String.isWellFormed 미지원도 보완했다. 제품 tsconfig/검증 기준은 낮추지 않았다.
- 유효한 숫자·참/거짓·null 앞에2200개 공백이 있을 때 preview에서 conflict가 된 제품 결함8 RED를 독립 재현했다. renderer별 JSON type과 null을 검사해 보완했다. 이어 abs(SQL integer 최소값)의 실제 integer overflow2 RED를 재현하고 유한값 BETWEEN 검사로 수정했다. 독립82개와 실제 workerd의 최소값/무한대/잘못된 유형 경계가 최종 통과했다.
- 최초 browser48962:102 PASS/16 FAIL,exit1,5.1분. reader60와 기존 표시38은 PASS다. label16 실패는 StrictMode effect의 첫 ERR_ABORTED 요청도 완료 조회로 센 시험 및 Next route announcer까지 잡은 alert 선택자 문제였다. 네트워크 완료/취소를 구분하고, 정확한 요청 키·명시 취소·늦은 응답 handler의 settle 뒤 미적용 검사를 유지했다. 제품 main 영역 선택자로 보완했다. 이 결과를 단일 전체 PASS로 바꾸지 않는다.
- 독립 읽기 검토에서 표시 저장401 헤더 이후 JSON 본문을 기다리는 권한 폐쇄 지연과 생성 응답의 ID만 검사하는 경계를 추가 발견했다. root24055에서 보류본문 PATCH401/충돌 이후 reloadGET423·생성의8가지 응답불일치×desktop/mobile **20 FAIL/exit1**을 수정 전에 확인했다. error-context에서도 편집 region 잔류와 잘못된 생성 응답 뒤 모달 이탈을 직접 확인했다. 헤더 직후 폐쇄와 생성 내용 확인으로 보완했고 마지막 독립 읽기 검토도 두 지적의 해소를 확인했다.
- 보완 후 combined59025는142 PASS/2 FAIL,exit1,4.4분이다. reader64/기존표시38/labels40은 통과했으며 유일한 실패는 정상 생성 뒤 합성 도착 HTML의charset 누락으로 한글heading이 깨진 fixture 문제다. 실제 생성 응답 검증과 목적지URL 확인은 모두 통과한 뒤 실패했다. HTML의HTTP Content-Type과meta charset만 수정하며 제품은 변경하지 않는다.

## 서버 검사 완료분

| 실행 | 최종 결과 | 범위 |
| --- | --- | --- |
| root17788,19:58:13 시작 | 73 PASS,6파일,exit0,80.53초 | actual workerd2·canonical36·fields16·bare key/분류8·SSR5·reason6 |
| agent93239,19:58:50 시작 | 82 PASS,exit0,33.66초 | 실제 route+Node SQLite: 예산·원값·권한·동시 변경·revision·UTF16·복사·scalar/정수 최소 경계 |
| agent62589 | 115 PASS,exit0,31.61초 | 새 exact label32+기존 표시 API83 |
| agent40228 | 144 PASS,exit0,31.51초 | 위115와 중복+새 create response29. 실제 POST+SQLite 성공응답과 helper 왕복1개 포함 |
| root19602 / root55958 | 각각exit0 | 당시 코드의 타입 검사 / 변경 TS·TSX21파일 scoped ESLint. 이후 UI 응답 보완 뒤 아래 최종 검사로 갱신 |
| root59025 | 142 PASS/2 FAIL,exit1,4.4분 | reader64+기존표시38+labels40 PASS. 합성 도착페이지 인코딩 보완 뒤 labels42 후속 검증 |
| root69408 | exit0 | 변경 TS·TSX23파일 scoped ESLint. 이후 시험 HTML 한 줄 변경 외 제품 불변 |
| root49929 | 42 PASS,exit0,1.3분 | 최종 labels21×desktop/mobile, 앞의20 RED 및 정상 생성/이동 포함 |
| root82197 | exit0 | 모든 수정 뒤 최종 tsc --noEmit. 마지막 시험 한 파일 ESLint도 root 직접 exit0 확인 |

서로 다른 서버/계약 시험은 **299개 =73+82+144**다. agent62589/이전80·66개를 다시 더하지 않는다. 브라우저는59025의reader64/기존표시38 PASS와 마지막49929의labels42 PASS라는 범위별 결과이며 단일144 PASS 실행이 아니다. 현재 전체 suite/Worker build·실제 제공자·실기기·원격 운영 검증은 아니다.

root85709의18 PASS/2파일은 workerd2+fields16이며 명령에 잘못 적은 나머지 두 파일은 실행되지 않았다. 이 누락을 확인해17788에서 정확한 파일명으로6파일을 검사했다. 실패·잘못된 명령을 성공 범위로 합산하지 않는다. author PASS·합성 브라우저를 전체 통합/공급자/실기기/원격 운영의 증거로 확대하지 않는다.

재현 명령(저장소 root, workerd와Next 실행 창은 순차 사용):

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/saved-view-display-workerd.test.ts tests/contract/v2/saved-view-fields.test.ts tests/contract/v2/retrieval-canonical-origins.test.ts tests/contract/v2/saved-view-field-key-collision.test.ts tests/contract/v2/saved-view-display-ssr.test.ts tests/contract/v2/retrieval-match-reason.test.ts
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/saved-field-read-api.test.ts
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/saved-view-create-response.test.ts tests/contract/v2/saved-view-display-api.test.ts tests/contract/v2/saved-view-field-labels.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-saved-field-reader.spec.ts tests/e2e/v2-saved-view-field-labels.spec.ts tests/e2e/v2-saved-view-display.spec.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-saved-view-field-labels.spec.ts
npm run typecheck --workspace @light-house/web
```

최종 scoped lint는 변경 TS/TSX23파일에 대해서만 실행했다. CSS는 실제 브라우저에서 검사했다. 전체앱 lint/전체suite/Worker build를 이번 단위에서 실행한 결과가 아니다.

## 화면 확인과 증거 범위

root는59025에서 생성된 [desktop320 reader](./evidence/72-saved-field-read/desktop-320-reader.png),[mobile320 reader](./evidence/72-saved-field-read/mobile-320-reader.png)를 직접 확인했다. 읽기 구간의 제한된 세로 스크롤·줄바꿈·버튼 접근과 private 값 숨김을 확인했다. 상단 lab 전환문구·합성시험 레코드·Next dev badge는 제품 IA나 개인 corpus가 아니다. 모바일viewport 검사는 OS share/한글IME/실기기를 대신하지 않는다. 후속 시험이 test-results를 비우기 전에 두 화면을 별도 evidence 경로에 보존했다.

최종 source/test24파일과 화면2개의 SHA-256/byte 크기는 [지문 목록](./evidence/72-saved-field-read-hashes.json)에 보존한다.59025 시작 당시 동결 지문과의 변경은 labels e2e의 합성 HTML charset 한 줄뿐이며 다른23파일은 불변이다. 화면도 해당 실행에서 보존했다. 지문은 이 시점의 증거이며 이후 변경의 PASS를 보장하지 않는다.

20:23:09 KST 최종 재해시26개 불일치0, 문서4개 로컬 링크90개 누락0, git diff --check exit0(기존 LF→CRLF 경고36개), 포트3100 listener0/workerd0을 확인했다. 알려진 실행 핸들은 모두 종료했다. 독립 문서 읽기 검토에서도299개 중복 제외·55% 산식·미완료 경계를 확인했으며 이는 root의 실제 재해시/프로세스 확인을 대체하는 검토는 아니다.

원본 source/snapshot/property 저장·schema·migration·환경·자격 증명·Gemini 모델 설정은 변경하지 않았다. 새 화면 token을 포함한 full+delta 실제 복원은71번과 같이 최종 통합에 남는다. 이번 read-only API의 존재를 이동성 전체 재검증이나 실제 provider·원격 운영 성공으로 바꾸지 않는다.

## 다음 단위의 실제 코드 진입점

독립 읽기 검토(시험 미실행)에서 기존 구현과 잔여를 구분했다.

- semantic icon20종과 workout.metrics.v1은 존재한다. 장소/작품/대화 preset의 빈 moduleKeys가 목적별 표시 확장 대상이다.
- retrieval-repository의 분류/대상/시간 facet은 각각50/60/36개 하드컷·배열 반환이며 explore와 search가 그대로 소비한다. bucket 검색/페이지/전체 수·페이지 밖 선택한 분류 보존이 잔여다. 분류·시간의 restricted 제외, 대상의 normal+accepted/current 관계 경계를 임의 변경하지 않는다.
- saved-view repository.list는 하드컷이 아니라 모든 active 뷰의 full query/display를 한 번에 읽는다. 내 목록 화면도 전부 SSR하므로 이름 검색·bounded 요약 DTO·페이지/총개수가 후속이다. 목록 안 기록의 page/total과 보관함 기록 cursor는 이미 있다.
- 모바일767px 이하에서 library sidebar가 숨겨져 내 목록 링크를 잃는다. 기존 하단 더보기는 settings 이동이므로 모바일 명시 진입을 함께 보완해야 한다.
- OCR/실제 Gemini, 권한 있는 자동 수집, 영상/자막 분석, 최종 전체 suite/Worker, 개인 corpus/실기기/원격 운영은 이 단위로 해결됐다고 주장하지 않는다. 원문·자격 증명·원격 상태·schema 불변이다.
