# Record 맞춤 보기 · 개인정보와 실패 격리

2026-09-22 최종. [20번 확장 계약](./20_ICON_AND_VIEW_EXTENSION_CONTRACT.md)의 현재 `workout.metrics.v1`과 실제 Record 경로를 보강한 G07 단위다. 이 단위의 로컬 구현·검증은 완료했으며 전체 goal은 active, 동일 비중 완료 기준은 600/1100=54.55%(약55%)로 유지한다.

## 계약과 구현 범위

- 본문이 먼저이고 highlights·맞춤 보기·generic fields가 뒤따른다. 확장 실패가 원문·일반 필드·내보내기를 막지 않는다.
- 서버가 실제 소유자/canonical capture·revision/legacy 공개 상태와 DB privacy를 읽는다. 호출자의 `locked=false`만으로 restricted 열람 권한이 생기지 않는다. 실제 route가 확인한 재인증 grant를 명시적으로 전달하며 최종 SSR 권한 검사를 유지한다.
- sensitive 운동 모듈은 서버에서 고정 제목·빈 fields/sourceLabels의 redacted DTO다. restricted는 grant가 있어도 이 모듈을 만들지 않는다. 권한 있는 본문과 generic fields의 읽기를 차단한다는 뜻은 아니다.
- 연결된 restricted 문서의 제목/관계 근거를 모문서에 노출하지 않는다. 연결 대상 owner/lifecycle/legacy/canonical 경계도 마지막 SQL 검사에 포함한다.
- 마지막 SQL snapshot은 관계 identity(대상/이름/predicate/source)와 evidence identity도 재검사한다. 제3 기록의 인용 원문은 source/capture owner와 원 capture 문서들의 canonical/legacy/privacy 조건을 통과해야 한다. 제한 해제한 현재 restricted 기록의 자기 근거는 허용하되 제3 restricted 기록은 허용하지 않는다. source 없는 외부 citation 의미와 허용된 일반 필드의 본값은 유지한다.
- 설치된 코드 소유 module/preset만 사용한다. unknown/locked/빈 필드는 생략하고 version/shape 오류는 해당 모듈 안내로 대체한다. AI가 실행 코드·CSS·컴포넌트를 등록하지 않는다.
- full 모듈은 JSON 전체 깊이32/노드10000 경계 안에서 불변 복제 후 엄격한 shape/renderer/evidence/source 검증을 통과해야 한다. field value/locator만 세지 않고 metadata까지 센다. getter/toJSON은 실행하지 않는다. 문자열을 잘라 원문을 훼손하지 않는다.
- 실제 Record/Review는 개인정보 선별을 마친 presentation을 JSON 문자열 prop으로 보내고 client에서 JSON.parse한다. 설치 Flight encoder/decoder가 raw object의 own `__proto__` 키를 소실시킴을 재현했기 때문에 정상 사용자 JSON 키를 버리는 방식으로 우회하지 않는다. prototype을 변경하지 않는 own data property 복제·고정과 문자열 전달을 함께 사용한다. 타입 배지는 displayType만 받는다. DB/백업 정본은 바꾸지 않는다.
- 비어 있는 boolean은 `아니요`로 단정하지 않고 `값 없음`으로 표시한다.
- 중복된 동일 필드는 기존 정렬에서 첫 accepted 값을 사용하고 서로 다른 허용 필드2개가 있어야 운동 모듈을 만든다. 사용자 우선 정렬을 유지한다.
- UI는 설치된 Next의 `catchError`와 Suspense로 각 모듈 오류를 격리한다. 오류 원문은 출력하지 않는다. 모듈 목록32개 한도·중복 제거·320px 줄바꿈·키보드 접근을 검증한다.
- 새 장소/작품/대화 모듈을 빈 preset 슬롯을 채우기 위해 생성하지 않는다. 반복 가치와 generic view의 한계를 확인한 뒤 확장한다. 자동 OCR/공급자/영상/전역 처리 상태와 전체 통합/운영은 이 단위 밖의 미완료 범위다.

## 오케스트레이션

root는 registry·D1 projection·실제 route/lab wiring·단일 workerd/Next/browser/type 실행 창·문서를 담당한다. module_contract_audit는 순수 위험 시험, module_privacy_audit는 실제 SQL/SSR 개인정보 시험과 읽기 감사, module_fallback_ui는 모듈 UI/fixture/browser 시험을 맡았다. 파일 소유권은 겹치지 않으며 이미 완료한 agent 파일은 동결한다.

## 재현과 현재 증거

- 기존 actual Record/edit recovery SSR12개는 수정 전에도 PASS였다. 기존 잠긴 Record 자체가 노출됐다고 주장하지 않는다.
- 신규 privacy25개 첫 실행:11 PASS/14 FAIL. sensitive full projection, unlocked restricted 모듈, restricted 연결 제목/근거와 repository 독립 권한 경계를 재현했다. 이어 late target privacy/mutable unlock2개도 RED였다.
- 순수 시험 초기5개 RED: 민감 payload, 중복 필드, 알 수 없는/변조 preset, caller 객체 공유. 후속 전체 metadata 예산/배열 속성4개 및 getter/정확 경계3개 RED를 보완했다.
- 21:43:29 KST 순수116+기존 registry3=119 PASS, exit0,968ms 뒤 plain JSON prototype 보존2개를 추가해121 PASS(926ms)를 확인했다. 실제 Flight negative control의 null prototype 거부 및 own `__proto__` 소실을 별도 재현하여 문자열 경계를 추가했다. 최종 순수120+기존3+Flight9=132 PASS/exit0(21:59:33,6.85초). Flight는 실제 설치 encoder→EOF→decoder→JSON.parse를 검증하지만 로그인한 브라우저/배포 검사가 아니다.
- SQL/SSR 첫 보완39개 및 관계/canonical 추가48개 PASS 뒤 제3 restricted 근거1개가 RED였다. evidence 최종 authority 검사를 추가하고 늦은 identity·source owner/capture/canonical/legacy·자기 restricted·외부 citation까지 확장했다. 훅 미발동1개는 SQL 통합에 맞춰 bind target identity 기반 시험으로 고쳤으며 의미/timeout은 낮추지 않았다. 최종 SQL/SSR63+기존12=75 PASS/exit0(89629,21:59:03,21.45초).
- root47025 기존 actual workerd processing17+legacy6=23 PASS/exit0(175.55초), root4385 새 workerd4 PASS/exit0(39.74초)는 evidence 추가 전 중간 결과다. 최종 evidence5+기존23 결합 root20196은28 PASS/exit0(213.81초)다.
- 첫 타입 root85011의 SQL alias union 누락2개를 보완했다. 두 번째 타입 root76047은 작성 중 transport 시험의 safe child env 타입1개로 실패했고 제품 타입 오류는 없었다. 이후11025 및 최종95372 타입 exit0이다.
- Flight fixture 초기7개 실패(2회)는 동일 child process의 compiled React alias 누락이었다. 이를 보완한 뒤6 PASS/1 FAIL로 확인된 raw `__proto__` 소실은 실제 제품 전달 제약이므로 문자열 경계로 수정했다. CJS 기본 lint는 프로젝트 config의 react-hooks plugin 등록 오류가 있어 TS 파일 기존 lint와 CJS 별도4규칙/no-config-lookup 및 node --check를 구분했다. 모두 최종 exit0이다.

원문·사용자 자격 증명·앱 내부 Gemini 역할·원격 자원을 변경하지 않는다. migration/배포/cutover/과금 확대 없이 격리된 로컬 합성 자료로 검증한다.

## 최종 검사 · 2026-09-22

| 실행 | 최종 결과와 범위 |
| --- | --- |
| module_contract_audit 21:59:33 | 순수120+기존 registry3+설치 Flight9=132 PASS,exit0,6.85초 |
| module_privacy_audit89629 | 실제 SQL/SSR63+기존 policy12=75 PASS,exit0,21.45초 |
| root20196 | 격리 workerd/D1 module5+processing17+legacy6=28 PASS,exit0,213.81초 |
| root41234 | module36+기존 내구성6=42 PASS/4 SKIP,exit0,1.3분 |
| root95372 | 최종 전체 앱 타입 검사 exit0; route typegen 이후 마지막 TS 변경 포함 |
| root37733 / root62246 | 변경 TS/TSX15파일 lint exit0 / 마지막 browser 시험 변경 재검사 exit0 |
| root의 화면 확인 | desktop/mobile 합성 실제 컴포넌트4화면 캡처·눈으로 확인 |

서로 다른 서버/계약/transport/SQL 검사는 **235개(132+75+28)**다. 중간 PASS·재실행을 더하지 않는다. Playwright는46개 계획 중42 PASS/4 SKIP이다. SKIP은 기존 capture 쓰기 flag가 꺼진2개 시험×2프로젝트이며 통과로 계산하지 않는다. 전체 suite/Worker package/실제 Gemini·개인 corpus·모바일 실기기·원격 운영 검증이 아니다.

실행 명령은 루트에서 다음처럼 범위를 명시한다.

```text
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/unit/v2/context-module-presentation.test.ts tests/unit/v2/extension-registry.test.ts tests/contract/v2/context-module-rsc-transport.test.ts
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/record-module-privacy.test.ts tests/contract/v2/record-recovery-policy-ssr.test.ts
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/record-modules-workerd.test.ts tests/contract/v2/processing-pipeline.test.ts tests/contract/v2/legacy-projection-read-visibility.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-record-modules.spec.ts tests/e2e/v2-product-durability.spec.ts
npm exec --workspace @light-house/web -- next typegen
npm run typecheck --workspace @light-house/web
```

브라우저 초기52400/64715는 label selector 진단 후 중단한 부분 실행이다. 실제 accessible combobox/textbox 이름으로 수정했다. 완주43406의40 PASS/2 FAIL/4 SKIP에서 확인한 [색상 대비 실패](./evidence/74-record-modules/initial-contrast-failure.md)는 scoped CSS specificity로 보완했다. 56390의42 PASS/4 SKIP 뒤 시각 확인에서 긴 JSON 옆 태그 늘어남을 발견해 align-content와 태그 높이 단언을 추가하고 최종41234를 실행했다. timeout·접근성 기준·개인정보 검사를 낮추지 않았다.

## 화면·고정·인계

[데스크톱 정상](./evidence/74-record-modules/desktop-normal.png), [모바일 정상](./evidence/74-record-modules/mobile-normal.png), [모바일 민감 안내](./evidence/74-record-modules/mobile-sensitive.png), [JSON 정확 표시](./evidence/74-record-modules/desktop-json.png)를 최종 코드로 다시 렌더하고 root가 확인했다. Next dev 배지는 제품 메뉴가 아니다. locator 원문 details는 lab의 전송 검사이며 실제 제품 모듈은 근거 문장/링크를 표시한다.

[SHA-256 manifest](./evidence/74-record-modules-hashes.json)는 source/test17개+화면4개+초기 실패 요약1개를 고정한다. manifest 생성 전 임시 Playwright 오류 파일 복사 경로가 없어 첫 manifest 생성 시도를 폐기했고, 원본 trace 복사본이라고 주장하지 않는 관찰 요약을 만든 뒤22개 모두 존재함을 확인해 생성했다. 최종 검사 후 제품/시험 변경은 없다.

Next94277은 의도적인 Ctrl+C(exit1)로 종료했다. 22:13:09 KST port3100 listener0/workerd0을 확인했으며 모든 검사 핸들은 종료했다. 기본 `git diff --check` exit0이다. 기존 CRLF 안내는 이번 변경 오류로 처리하거나 파일 전체 개행을 바꾸지 않았다.

마지막 root 대조는 manifest22개 hash 불일치0·문서4개 로컬 링크96개 누락0이다. 독립 문서 감사도 수치/검증 범위/goal/핸들/잔여의 모순을 발견하지 못했다. 단순 후행 공백 검사는 README6행의 기존 Markdown hard break를1개 표시했으며 문서 의미를 보존하고 일반 공백 오류와 구분했다.

Cloudflare/Wrangler Skill은 기존 로컬 격리 fixture와 현재 D1 API 확인에 사용했다. 초기화/의존성 업그레이드/원격 명령을 새로 실행하지 않았다. API 타입/관찰 범위는 실제 설치 Next 가이드·serializer와 실제 테스트를 따른다.

다음은 G07 전역 처리 상태 화면을 기존 저장/분석/실패 상태와 연결하는 일이다. 목적별 module은20번 계약에 따라 반복 가치가 필요한 것만 확장한다. G05 OCR/실제 제공자, G08 권한 있는 일반 웹/SNS 수집, G09 영상/자막/구간, G10 최종 전체 suite/Worker, G11 개인 corpus/실기기/원격 운영은 계속 미완료다.
