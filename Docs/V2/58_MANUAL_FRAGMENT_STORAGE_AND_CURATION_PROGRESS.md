# G06 · 수동 정밀 발췌 저장과 정리본 기반 진행

최초 checkpoint: 2026-09-08 19:22 KST. 후속 checkpoint는 마지막 절에 덧붙인다. 전체 goal은 active다. 이 문서는 G06의 **부분 구현** 증거이며 정리본 UI·수정/undo·통합 완료가 아니다. 아래 초기 파일 해시와 미연결/검증 중 표현은 해당 시점의 기록이다.

## 구현한 실제 경로

- `GET/POST /api/v2/records/[recordId]/links/fragments`와 `D1ManualLinkFragmentRepository`를 추가했다. 본문·원문은 수정하지 않고 기존 0031 fragment/evidence에 정확한 사용자 발췌를 추가한다.
- 요청은 현재 revision/snapshot/manifest, member, UTF-16 start/end, 역할, idempotency key만 받는다. 클라이언트 rawText·확보 상태·processing run·권한 주장을 거절하고 첫 await 전에 primitive 요청을 복사한다.
- manual fragment는 processing run null, source_extract, confirmed/locked, `details_json.contract=manual-link-fragment.v1`와 `selectionOrigin=user_selected`다. 같은 범위의 supports/user_confirmed evidence를 별도로 보존한다. AI 실행 결과 조회에 섞지 않는다.
- 원문·선택 hash, surrogate 경계, inherited completeness, source 소속을 검증한다. 개인 메모·URL만 보관한 빈 자료·미확인 첨부 텍스트를 외부 원문으로 대체하지 않는다. 사용자가 쓴 part 번호는 source_explicit이 아닌 user_declared다.
- owner/capture/revision/legacy/lifecycle/privacy와 현재 snapshot을 확인한다. audit assertion→fragment→evidence→receipt를 하나의 batch로 저장하고 경쟁 시 모두 롤백한다. 제한 기록의 grant 만료를 SQL 저장 시점과 최종 응답에서 다시 확인한다.
- receipt 재생도 권한·정확 원문을 재검증한다. 응답 직전 원문 byte/metadata/membership 일치를 최종 access SQL과 함께 확인하여 해시 계산 await 중 원문 변경을 차단한다.
- 별도 수동 목록은 소유자/기록/snapshot 범위 cursor, created_at/id 동률 순서, 페이지 20개/원문 합계 100,000 byte 한도를 사용한다. 내용은 자르지 않으며 큰 조각도 다음 cursor로 계속 읽는다. 과거 snapshot의 조각은 유지하되 새 snapshot으로 자동 이동시키지 않는다.
- `textarea-source-range.ts`는 브라우저 textarea가 CRLF/CR을 LF로 표시하는 차이를 원본 UTF-16 위치로 변환한다. **아직 컴포넌트에 연결하지 않았다.** 원문·hash의 줄바꿈은 정규화하지 않는다.

## 실행 증거와 실패 이력

| 실행 | 최종 결과 | 범위 |
| --- | --- | --- |
| `g06-manual-fragments-initial.json` | 45 PASS / 2 FAIL, exit 1 | fixture가 존재하지 않는 lifecycle `trashed`를 쓰고 immutable created_at을 변경하려 했음 |
| `g06-manual-fragments-verified.json` | 49/49 PASS, exit 0, 22.55초 | 실제 `deleted` 전이와 삽입 전 고정 시각으로 fixture 수정. 두 경쟁 요청의 원자적 승패 추가 |
| `g06-manual-fragments-integrity.json` | 3파일 **126/126 PASS**, exit 0, 17.13초 | 최종 수동 SQL/HTTP 51 + 정리본 순수 67 + 독립 순수 8. 조회 후 source 변경 2건 추가 |
| `textarea-source-range.test.ts` | **10/10 PASS**, exit 0, 0.436초 | CRLF/CR/LF·공백·이모지·잘못된 표시 문자열·범위 |
| 수정 root 6파일 ESLint | 오류/경고 0, exit 0 (`80212`) | 마지막 root 제품/시험 수정 포함 |
| Next typegen | exit 0 | 새 fragments route 생성 |
| 타입 검사 | exit 0 (`58594`) | source 최종 fence 포함. 이후 textarea helper/시험과 진행 중 portability 후속 변경은 아직 포함 전 |

JSON은 `apps/web/test-results/` 아래에 있다. 합계 136개는 **126개 결합 실행과 별도 10개 실행**이다. 이전 실패 산출물은 그대로 두며 최신 전체 제품 suite PASS로 읽지 않는다. root 계약 검사는 실제 Node SQLite/foreign key/batch rollback 및 실제 route 함수에 세션·binding 대역을 사용했다. Cloudflare 원격 runtime·실제 인증 서버·OS clipboard 검증은 아니다.

검사에는 원문·내 메모 불변, AI job 0, 알 수 없는 요청 필드, 다른 소유자/자료/메모 ID, stale revision/snapshot/hash, 잠금/만료, 저장 후 만료와 재인증 재생, 원문·metadata·hash·소속·legacy·lifecycle 경합, 마지막 receipt 실패, 손상 조각/근거, 55건 동률 페이지, byte 한도, 과거 자료, 0030 미준비·GET 무쓰기·HTTP 정책이 포함된다.

## root 파일 지문

| 파일 (`apps/web/` 기준) | SHA-256 |
| --- | --- |
| `src/lib/v2/domain/manual-link-fragment-v1.ts` | `f0c990b3ccbc223799a5856211776a6bcb7fbda8506e82f57f47c69dec084218` |
| `src/lib/v2/infrastructure/d1/manual-link-fragment-repository.ts` | `3f00447590f6f9db27d3c9148fdf857b752d793d167461d11327bdde6a76beab` |
| `src/app/api/v2/records/[recordId]/links/fragments/route.ts` | `64eefcda7841bc9445e56774c59652cbd32d7fdddb6262f13d91fdc3a20e594d7` |
| `tests/contract/v2/manual-link-fragments.test.ts` | `80f1b122f8b90c55a85f28bc6f84f34bda030b07e30b7cdbf2d1cf31150d26ca` |
| `src/lib/v2/domain/textarea-source-range.ts` | `97b189b78162c5520458ca549b9da7bdda5f6c96e5dd1d72af39055ffe0a0191` |
| `tests/contract/v2/textarea-source-range.test.ts` | `a8a184b9c4e243ba294e3e9959522e6b39304962e888b2904ff60a74b6c5bdd2` |

## 병행 중: 0032 정리본 이동성

`link_ui_implementation` agent가 0032 revision/item/example와 46개 canonical descriptor·v2-032·FK/논리키 반복 복원·증분 이벤트·noHistory scope conflict를 담당한다. 현재 SQL/R2 시험과 독립 읽기 보완 **진행 중**이다. 기존 originals verified→committed 시점을 앞당기지 않고 examples 삽입을 기존 전환 이후로 미루는 방향으로 보완한다.

첫 전용 전체는 4 PASS/1 FAIL이었다. V2 coordinator의 준비 fixture가 실제 materialization 완료의 consumed/offset/timestamp를 갖추지 않은 실패였으며 제품 guard는 낮추지 않았다. 아직 최종 동결 결과로 쓰지 않는다. root 읽기에서 manifest `parts/sourceCompleteness/selectionOrigin`의 엄격 검증 누락 가능성을 전달했으며 최종 재현/판정이 남았다. 자세한 실행 핸들은 현재 상태 문서와 agent 응답을 확인한다.

## 다음 완결 단위

1. 병행 DDL/이동성의 최종 실패·검토를 해소하고 root 통합 타입 검사를 끝낸다.
2. Record 안에 정확 범위 선택·역할 지정·수동 조각 목록을 연결한다. textarea 표시 범위를 원본 위치로 변환하고 실제 desktop/mobile 브라우저에서 확인한다. 409/오프라인/늦은 응답/잠금 이후 내용 보존·차단을 구별한다.
3. curation 실제 repository/API와 editor·이미지 대응·역할별 서버 검증 복사·append-only undo·새 snapshot 명시 이관을 구현한다. 수동 발췌 API 완료를 정리본 완성으로 계산하지 않는다.
4. 실제 수동 API 산출물→정리본→full/edit/undo/incremental/repeat restore의 결합 경로를 검사한다. 이동성 SQL fixture만으로 UI/공급자 동작을 주장하지 않는다.

이 turn에서 원격 migration·배포·R2 변경·실제 모델 호출·과금 변경은 하지 않았다. 57번 Worker는 이전 checkpoint의 증거이며 이번 새 코드/0032를 포함한 빌드가 아니다. 통합 후보가 안정된 뒤 secret-safe Worker를 다시 만든다.

## 후속 checkpoint · 2026-09-08 19:50 KST

### 연결한 구현과 API 검증

`GET /api/v2/records/[recordId]/links/fragments/[fragmentId]?snapshotId=...`를 추가했다. 서버 세션·잠금 만료·owner/snapshot/exact source fence를 다시 확인한 조각만 반환한다. 기존 AI fragment PATCH와 분리되며 읽기는 쓰기를 발생시키지 않는다. 수동 생성 capability는 현재 snapshot 기준이고 과거 AI run 선택 자체에 종속시키지 않았다.

root `49918`은 `manual-link-fragments.test.ts` 56 + `link-fragment-review.test.ts` 20 = **76/76 PASS, exit 0, 22.53초**다. 이후 API 제품 파일은 변경하지 않았다. 이 결과는 세션 최종 출력 근거이며 과거 `test-results/g06-manual-copy-api.json`은 후속 Playwright 실행 후 현재 목록에서 찾지 못했다. 기본 결과 폴더를 영구 증거 보관소로 가정하지 않는다.

`RecordManualFragments`를 기존 Record 링크 분석 화면에 연결했다. 사용자 선택 범위·역할 지정·별도 페이지 목록, 명시 버전 재확인, 재시도 요청 키, 서버 재검증 후 복사/직접 선택 대안을 구현했다. draft는 현재 화면 메모리에만 유지하며 새로고침 전 저장 안내를 표시한다. 이 구현은 아래 실패 때문에 사용 검증 완료가 아니다.

### 실패와 다음 수정

root Playwright `25073`: `npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-manual-fragments.spec.ts --project=desktop-chromium`, **1 PASS/7 FAIL, exit 1, 약 1.2분**. 실패 7개는 선택 후 미리보기 부재이며 키보드 선택도 실패했다. 55건 페이지 조회/과거 snapshot 전환은 PASS다. 원인이 UI·선택 이벤트·초기 상태/fixture 중 어디인지 아직 판정하지 않았다. mobile은 실행 전이다. 실제 컴포넌트와 로컬 API 대역 검사이며 실제 Cloudflare/auth/OS clipboard 검증은 아니다.

독립 읽기 검토의 미해결 P2:

- `record_not_found`/404도 접근 철회일 수 있으나 현재 manual state 정리는 401/403/423만 처리한다. fragment_not_found와 구분해야 한다.
- 잘못된 UTF-16 선택을 거절할 때 이전 유효 range가 남아 저장 버튼이 활성일 수 있다. 오류 시 range를 무효화해야 한다.
- 저장 카드에 primaryMemberId 기반 출처 URL/원본 anchor를 표시해야 여러 자료의 조각을 구별할 수 있다.

타입 `9934`는 unknown 응답 접근으로 exit 1, responseJson 수정 후 재검사 전이다. scoped lint `58010`은 오류 0/경고 1/exit 0이며 cleanup 경고 수정 후 재검사 전이다. 새 E2E와 agent 최종 변경까지 통합 확인해야 한다. 기존 통과한 Worker는 이번 UI/API를 포함하지 않는다.

### 0032 이동성 최종 전용 검사

작성 agent 최종 보고 `21782`: `prompt-curation-portability.test.ts` **5/5 PASS, exit 0, 309.29초**, scoped 8개 TS 파일 lint exit 0. root가 빈 manifest parts 변조를 지적했고 `24773` **1 FAIL/4 skipped**로 재현한 뒤 검증을 보완했다. 초기 `13250`·중간 `95833` 결과와 최종 결과를 구분한다.

세 정본 테이블과 canonical 46/schema 032, FK·논리 키 충돌/동일 재생·증분/undo/tombstone·noHistory scope 경계를 연결했다. 기존 originals verified→committed 공개 시점은 유지하고 examples 삽입만 이후로 지연한다. source completeness/part provenance, manual·AI selection origin과 원문 근거를 검증한다. V1 fresh/collision/repeat 경로는 전용 시험 범위에 포함되지만, **V2는 verified materialization checkpoint 이후**이며 fresh ZIP intake/검증 전체 또는 실제 수동 API→정리본→복원 결합 완료가 아니다.

최종 파일은 19:29:42 동결, agent 19:35:07 재확인과 root 19:47 조회의 아래 SHA-256이 일치했다:

| 파일 | SHA-256 |
| --- | --- |
| `migrations/0032_v2_prompt_curations.sql` | `288c5f2a92420047d4d61c736e3c5ca431e2991e9086b890f6474e4c8d5e6c93` |
| `apps/web/tests/contract/v2/prompt-curation-portability.test.ts` | `5ed56bc02cf633ac39a4e852adfdb343ca53870bb453cdf31da281db42484f96` |

다음 작업은 위 수동 UI 실패/검토 해소 후 desktop/mobile·타입/lint 확인이다. 정리본 실제 저장 API/editor·예시 이미지·역할별 조립 복사·undo·명시 snapshot 이관은 이어서 구현한다. 전체 G06 또는 제품 goal 완료로 표시하지 않는다.

## 후속 checkpoint · 2026-09-08 20:26 KST

### 수동 발췌 UI 실패 해소

기존 readonly textarea의 선택 경로를 두 가지로 분리했다. 네이티브 `select`/`selectionchange`에서는 실제 범위 변경을 관찰했으나 React synthetic onSelect에서 유효 범위가 전달되지 않았다. native listener 보완 후 `68121`은 **7 PASS/1 FAIL, exit 1**이었다. 남은 Shift+방향키 실패는 `navigator.platform=Win32`인 독립 Chromium 페이지의 단순 readonly textarea에서도 재현했다. editable textarea에서는 같은 키가 caret/selection을 이동했다. 이를 모든 OS/브라우저의 보편적 동작으로 단정하지 않는다.

`SourceRangePicker`는 기존 설치 CodeMirror의 `minimalSetup`, `readOnly`, `editable=false`, focusable textbox와 changeFilter를 사용한다. 실제 원문은 편집하지 않고 display-only LF 좌표를 기존 helper로 원본 UTF-16 범위에 되돌린다. 별도 의존성 설치나 모델 호출은 없다. 명시적으로 수동 발췌를 열 때만 도구를 lazy-load하며 자동 focus를 빼앗지 않는다.

이전 진단 중 React 내부 handler를 직접 호출한 `40337` 1 PASS는 **진단용**이며 UI 수용 근거가 아니다. 그 코드와 console 출력은 최종 파일에서 제거했다. 실제 keyboard/mouse 선택을 사용하는 최초 CodeMirror `40786`은 **8/8 PASS, exit 0, 29.2초**였다.

### 보완한 경계

- 기록 접근 철회: 401/403/423 또는 `record_not_found`는 수동 목록·draft·fallback·pending 요청 키를 정리한다. non-JSON 401도 같은 경로다. `manual_link_fragment_not_found`는 해당 카드만 닫고 다른 unsaved 선택은 유지한다.
- 정확 선택: 잘못된 surrogate 경계가 오면 이전 유효 range를 무효화한다. 실제 DOM Range로 이모지 중간을 선택해 확인했고, 정상 emoji keyboard 선택은 UTF-16 5–7로 저장됐다.
- 출처: `primaryMemberId`를 통해 카드에 원문 URL과 보관 원문 anchor를 표시한다. 출처 문자열을 복사 대상 rawText에 덧붙이지 않는다.
- 원문 교체: 독립 읽기에서 source 교체 commit→passive cleanup 사이의 이전 콜백 가능성이 제기됐다. 브라우저 재현된 결함으로 주장하지 않고 layout active-source fence, keyed member/basis, 최신 draft 일치 검사를 보강했다. 동일 문자열의 다른 member 선택도 범위를 초기화하는 실제 UI 회귀를 추가했다.
- 현재 자료·과거 AI 실행: 수동 생성은 current snapshot에 고정하며 과거 AI run을 보고 있어도 허용된 수동 편집은 유지한다. 과거 snapshot은 read-only다.
- 입력/접근성: Tab·마우스·키보드 선택, 타이핑/삭제/Enter/insertText, 합성 paste/drop/composition 경계를 검사했다. 1,001줄 원문의 마지막 emoji/결합문자 줄을 가상화된 화면에서 선택해 원본 끝 위치를 저장했다.
- 시각 확인: 초기 전체 PNG에서 CodeMirror의 투명 native selection 배경과 전역 테마의 밝은 글자색이 겹쳐 선택 글자가 흐려짐을 확인했다. 선택 도구에만 글자색을 고정했고 computed `::selection` 색상 및 최종 desktop/mobile 선택 영역 PNG를 확인했다.

일반 E2E select helper는 **짧은 ASCII fixture 전용**으로 제한했다. ArrowRight는 grapheme 단위이고 `.cm-line`은 가상화된 DOM이므로 UTF-16 문자 수/전체 원문 추정에 남용하지 않는다. Unicode/긴 원문은 명시적인 키 시퀀스와 원본 fixture 기준으로 검사한다.

### 최종 검사와 실패 이력

| 명령/실행 | 최종 결과 | 정확 범위 |
| --- | --- | --- |
| manual desktop/mobile 추가 경계 `1893` | **28 PASS/2 FAIL**, exit 1, 약 1.7분 | 두 실패는 lazy component 표시 전에 Tab을 누른 검사 준비 조건. 기다림을 제거하거나 focus 단언을 약화하지 않고 도구 visible 이후 검사하도록 보완 |
| pointer/emoji 선택 재검사 `94875` | **4/4 PASS**, exit 0, 20.5초 | desktop/mobile 각각 2개 |
| `npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-manual-fragments.spec.ts tests/e2e/v2-link-analysis.spec.ts --output=test-results/g06-manual-link-regression` · `49013` | **58/58 PASS**, exit 0, 약 2.4분 | 수동 34 + 기존 링크 24. 아래 마지막 selection 색상 보완 전 |
| `npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-manual-fragments.spec.ts --output=test-results/g06-manual-final` · `73982` | **34/34 PASS**, exit 0, 약 1.6분 | 선택 색상/PNG 검사를 포함한 최종 manual 17 × desktop/mobile |
| `npm run typecheck --workspace @light-house/web` · `8916` | **exit 0** | 최종 UI/E2E·0032와 agent 최종 파일 포함. 이 checkpoint에는 route 추가 없음 |
| 수정 TS/TSX 5파일 ESLint · `82246` | **오류/경고 0, exit 0** | record-manual-fragments, source-range-picker, textarea-source-range, manual E2E, link-presentation test |
| `textarea-source-range.test.ts` 별도, 20:16 KST | **10/10 PASS**, exit 0, 1.16초 | 순수 CRLF/CR/LF·UTF-16 변환; 후속 helper 변경 없음 |
| agent `link-presentation.test.ts` · `89368` | **22/22 PASS**, exit 0, 8.08초 | 기존 13 + 추가 9: current snapshot/과거 run, write·AI flag 조합, restricted grant/만료/정책 변경. root 해시 일치 |

최종 PNG: `apps/web/test-results/g06-manual-final/v2-manual-fragments-manual-8893b-ter-a-fresh-authorized-read-{desktop,mobile}-chromium/`의 `manual-fragments-selection.png`, `manual-fragments-saved.png`, 전체 `manual-fragments-record.png`. root는 이전 전체 PNG 2장과 최종 선택 영역 PNG 2장을 직접 확인했다. 후속 Playwright는 다른 output 경로를 사용해 이 checkpoint를 보존한다.

17개 시나리오는 정확 CRLF 저장/출처/새 조회 후 복사, keyboard/collapse, pointer/Tab/readOnly, 네트워크 동일 키 재시도, 409 명시 재확인, 늦은 응답 무효화, 423, non-JSON 401, 403, record 404, fragment 404, 과거 AI run, emoji/잘못된 범위, source 교체, 긴 원문, clipboard fallback 재검증, 55건 페이지/과거 snapshot이다. 첫 사례에서 manual 범위 axe 규칙 위반 0과 가로 overflow 없음을 확인했다.

### 최종 파일 지문과 한계

20:24 KST 조회 후 위 최종 실행 동안 제품/시험 파일 변경 없음:

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/components/v2/record-manual-fragments.tsx` | `f50816001729001e462e34e31d984e1f8d664e354bc0ea83c93f4baefdaadf44` |
| `apps/web/src/components/v2/source-range-picker.tsx` | `7285fe3293faf265556b459ea6387eb1d050a385f89bbf33044b3eb289344d7c` |
| `apps/web/src/app/v2/link-analysis.css` | `61929fde51e61987625fb15d491e8502b5d5b7b8e4c0e5fa416162ac8e71fb3d` |
| `apps/web/tests/e2e/v2-manual-fragments.spec.ts` | `c9dcea70a754e7c97097044aa8afae4cc0778a16bdc1aee03755cf41f840f24d` |
| `apps/web/tests/contract/v2/link-presentation.test.ts` | `783ac0b1084abd1c425efe6c98b102ae062f616c4756e2bdcb7f52b1a7b21652` |

0032와 portability test의 SHA도 19:50 절의 값과 일치했다. 독립 agent는 쓰기 없이 실제 EditorState의 삽입/삭제/전체 치환 거절과 8,001줄의 순수 좌표 변환을 확인했다. 이를 실기기 조작이나 브라우저 속도 측정으로 계산하지 않는다.

브라우저 검사는 실제 React/CodeMirror UI에 로컬 API·clipboard 대역을 사용하고 non-localhost 통신을 거절했다. mobile은 Pixel 7 viewport/touch 설정의 Chromium 에뮬레이션이며, 실기기 선택 핸들·OS 공유/clipboard·실제 IME·외부 인증은 미검증이다. draft는 메모리 한정이며 reload 내구성은 G05에 남는다. 기존 manual API·0032 이동성은 이번 checkpoint에서 변경하지 않았다. 현재 전체 suite/새 Worker/실제 Gemini/원격 deploy/cutover 완료가 아니다. 다음은 54번의 실제 curation 저장 API/UI·이미지 대응·역할별 복사·append-only undo·명시 snapshot 이관이며 전체 goal은 active를 유지한다.

최종 인계 검사 · 20:32 KST: 갱신 문서 5개 로컬 링크 74개 중 누락 0, 위 최종 파일 해시 5개 모두 일치, exit 0. 이 checkpoint의 실행 핸들은 모두 terminal이며 마지막 포트 확인에서 3100 listener가 없었다.

## 후속 checkpoint · 2026-09-08 20:58 KST

### 정리본 저장 초안과 재개 확인

정리본 request parser, 저장 응답 타입, 원문/조각/이미지 검증 catalog, D1 repository를 작성했다. repository에는 create/list/get/revise/copy가 있고 edit·undo·archive·unarchive를 새 revision으로 추가한다. 원문과 문서 본문을 변경하지 않는다. revision/items/examples/audit/receipt는 한 batch로 저장하며 items/examples는 JSON 기반 묶음 INSERT를 사용한다. **아직 정리본 HTTP route나 editor에 연결되지 않았다.**

parser의 알 수 없는 필드·getter·prototype·순환·성긴 배열·UTF-16·역할별 순서·중복 키·action별 입력 경계를 검사했다. 실제 Node SQLite/0032 저장 검사는 생성·조회·정확 복사·같은 요청 재실행·edit/undo/archive/unarchive, 64개 item 묶음, owner/snapshot/head, 최종 receipt 실패의 전체 rollback, 저장 직전 원문/privacy/fragment 상태 변경을 다룬다. fixture는 외부 URL의 수동 원문이며 실제 이미지·AI 발췌·50건 이후 이력·HTTP/인증·새 API 복원 결합까지 검사한 것은 아니다.

| 명령 | 최종 결과 | 범위 |
| --- | --- | --- |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-request.test.ts tests/contract/v2/prompt-curation-repository.test.ts` | 20:55:01 시작, **151/151 PASS**, exit 0, 3.96초 | parser 141 + actual SQLite repository 10; 앞선 repository 단독 20:49의 10 PASS와 구분 |
| `npm run typecheck --workspace @light-house/web` | `61539` **exit 0 terminal** | 위 새 코드 포함. route 추가 없어서 typegen 재실행 없음 |
| `npm exec --workspace @light-house/web -- eslint` + 아래 TS 6파일 | **오류·경고 0, exit 0** | 새 parser/응답/catalog/repository와 두 검사 파일만 |

20:58 조회 SHA-256:

| 파일 (`apps/web/` 기준) | SHA-256 |
| --- | --- |
| `src/lib/v2/domain/prompt-curation-request.ts` | `bceac60015180cdfde7fe47599903a877dfffe599c2d075e8845c5751f37f983` |
| `src/lib/v2/domain/stored-prompt-curation.ts` | `c6126eec8c29a71ec77cbcaca3d06a2d8de8f7663fb4a162df76e7e5fc6763d9` |
| `src/lib/v2/infrastructure/d1/prompt-curation-catalog.ts` | `645ecef4bf3ff782d4636fb44b451274c3912464bd599a0d2d217befbd3892b4` |
| `src/lib/v2/infrastructure/d1/prompt-curation-repository.ts` | `8407478a0bbebfe5e9fe61d2d97cdd63c25de710fed8124898d1bf95ce28bc6f` |
| `tests/contract/v2/prompt-curation-request.test.ts` | `1771009fef07f1fd439489e3909eebdd52676ced43c9073daf5a81d9c8c73641` |
| `tests/contract/v2/prompt-curation-repository.test.ts` | `5ab205876686569e8987991cac88bbc84c6bb62090c7f37ee3b0a923babb282e` |

parser/test는 agent의 20:44 동결 해시와 root 조회가 일치했다. 현재 초안의 정적 검토 잔여는 catalog 복수 proof의 전체 검증, AI run/input/manifest 일치, 손상 receipt의 요청 내용/parent/action 결합, 시계 역행·동일 시각/50건 이후 이력이다. 재현·수정·추가 검사가 필요하며 이번 151 PASS로 통과시킨 항목이 아니다. 정확한 재개 목록은 CURRENT_WORK_STATE에 둔다.

이번 재개에서는 제품 코드를 추가 변경하지 않고 Astra 지침·현재 인계와 로컬 schema 안내를 동기화했다. 원격 호출·Wrangler·migration·배포·cutover·새 Worker/전체 suite 실행은 없었다. 모든 위 실행은 terminal이며 전체 goal은 active다.

## 후속 checkpoint · 2026-09-08 21:31 KST

### 정리본 저장 안전성·HTTP API

네 route 파일에서 목록/생성, 선택 revision/이력, edit/undo/archive/unarchive, 역할별 정확 복사를 구현했다. 서버 세션 owner·실시간 restricted grant·mutation 정책·write flag를 기존 HTTP 경계로 확인한다. 모든 성공/오류는 private/no-store이고, 새 저장 201/동일 요청 재생 200을 구분한다. AI-off에서도 이미 보관한 원문을 수동 정리할 수 있다. 원문·이미지 본체나 클라이언트 권한 주장을 받지 않고 ID/기대 버전/선택만 받는다. 64항목·64이미지의 최대 Unicode 키를 포함하는 256,000 byte 요청 한도를 실제 HTTP에서 검증했다.

- receipt는 단순 revision 포인터를 신뢰하지 않는다. 원래 요청의 action·parent·based-on·snapshot·manifest·정규화 내용/상태와 반환 revision을 결합하고 응답 직전 근거를 다시 검사한다.
- AI fragment는 실제 originating run/input hash와 job의 owner/document/snapshot/capture/stage/manifest hash/version 일치를 요구한다. AI 제공자는 테스트 대역이며 실제 Gemini 결과가 아니다.
- 모든 catalog proof를 검사하고, 정상 proof가 앞/뒤에 있다고 손상 proof가 가려지지 않게 했다. snapshot/member/source/rawText/nullable metadata/evidence/image commitment와 revision/child 전체 값·개수를 검사한다.
- 이력은 created_at 대신 revision_number 내림차순이다. 시계 역행 55개정, 실제 HTTP cursor의 51그룹/51개정과 혼용/다른 owner·record·group scope 거절을 확인했다.
- 이미지 연결은 전체/항목별 관계와 미확인 경고를 보존한다. 정상 DDL의 immutable guard를 먼저 확인한 뒤, 별도 손상 fixture에서 foreign item pointer가 전체 이미지(null)처럼 보이는 경우도 마지막 조회 fence로 거절한다.

### 실제 D1에서 발견한 SQL 실패와 수정

Node SQLite 통과만으로 Worker 호환을 주장하지 않고 Wrangler Skill에 따라 `getPlatformProxy`의 **persist=false, remoteBindings=false**인 실제 로컬 workerd D1을 사용했다. 기존 로컬 fixture에 0006–0032를 적용했으며 원격 D1/R2는 호출하지 않았다. 종료 시 dispose한다. [Wrangler API](https://developers.cloudflare.com/workers/wrangler/api/), [D1 batch 계약](https://developers.cloudflare.com/d1/worker-api/d1-database/)

초기 저장 batch가 `Expression tree is too large (maximum depth 100)`으로 모두 실패했다. 임시 EXPLAIN 진단은 **첫 audit INSERT의 검증식**으로 위치를 좁혔고, catalog만 남긴 경우는 compile, revision fence를 남긴 경우는 실패했다. 컬럼/외부 AND 균형화만으로는 부족했다. SQLite는 중첩 표현식 깊이를 제한한다. [SQLite limits](https://sqlite.org/limits.html)

최종 catalog/revision fence는 각각 한 JSON bind의 materialized proof CTE와 NULL-safe EXCEPT 집합 비교를 사용한다. expected에서 live owner-scoped row를 빼서 남는 항목이 없어야 통과하며, 자식 개수·scope ID·전체 값을 함께 비교한다. proof는 서버에서 생성하며 HTTP 입력으로 받지 않는다. 의도적 중복 fragment는 사용자 items/복사에 그대로 유지된다. evidence는 동일 ID 순서의 JSON 집계로 보존한다. 모든 검증은 기존 단일 SQL 조회 또는 atomic batch 안에 있고, await로 validation/write를 분리하거나 보안 assertion을 제거하지 않았다. 새 assertion 테이블·임시 audit row·서비스·migration은 추가하지 않았다.

### 실패/검증 이력

| 실행 | 최종 결과 | 해석 |
| --- | --- | --- |
| 최초 저장 추가 검사 · 21:03:49 | 6 FAIL / 10 PASS, exit 1 | 4개는 receipt/proof/input_hash/시계 역행 실제 동작 RED. 2개 manifest 변조는 기존 DDL이 먼저 막은 fixture 실패였으며 제품 결함으로 계산하지 않음 |
| 수정 후 Node 저장 | 16/16 → 25/25 PASS, exit 0 | 이미지·경합·grant 만료·history snapshot 추가. 실제 D1 호환을 대신하지 않음 |
| 초기 local D1 `89312`, `9572` | 각각 3 FAIL, exit 1 | depth100. 9572는 43.80초. 컬럼 AND 균형화만으로 미해결 |
| 진단 `99891`, `65328`, `62444` | 각각 선택 1 FAIL / 2 skipped, exit 1 | EXPLAIN 기반 statement/검증식 분리. 62444에서 revision fence 위치 확정 |
| 중간 결합 `75128` | D1 3 FAIL / Node 25 PASS, exit 1, 57.01초 | catalog 평탄화만으로는 부족함을 확인 |
| 첫 D1 GREEN `39574` | 36/36 PASS, exit 0, 84.81초 | D1 3 + Node 33. 임시 EXPLAIN 진단이 남은 중간 결과 |
| 5파일 결합 `58128` | 313/313 PASS, exit 0, 25.20초 | pure 75 + parser 141 + Node 33 + HTTP 64. 아래 최종 이미지 pointer 보완 이전 |
| D1 최종 진단 제거/이미지 추가 `16343` | 3/3 PASS, exit 0, 59.58초 | 실제 64항목/64이미지·동시성·rollback. 마지막 pointer 보완 이전 실행 |
| **최종 6파일 결합 `95759`** | **317/317 PASS, exit 0, 84.24초**, 21:29:55 시작 | pure 75 + parser 141 + Node 저장 34 + HTTP 64 + workerd D1 3. 임시 진단 코드 없음 |
| `npm exec --workspace @light-house/web -- next typegen` | exit 0 | 새 네 route 타입 생성. Next dev/build는 실행하지 않음 |
| 타입 `57337` → `23688` → 최종 `41231` | 최초 exit 1, 이후 두 번 exit 0 | 테스트 literal widening/순환 추론 annotation 5개 오류를 명시 타입으로 보완. 최종은 모든 제품/시험 변경 포함 |
| 변경 TS 11파일 ESLint | 오류/경고 0, exit 0 | 네 route, HTTP helper, catalog/repository/SQL helper, 세 검사 파일 |

최종 명령: `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-request.test.ts tests/contract/v2/prompt-curation-repository.test.ts tests/contract/v2/prompt-curation-routes.test.ts tests/contract/v2/prompt-curation-v1.test.ts tests/contract/v2/prompt-curation-review.test.ts tests/contract/v2/prompt-curation-d1.test.ts`.

HTTP 작성 agent의 최초 64 PASS를 그대로 인수하지 않고 root가 코드/타입을 확인하고 최종 결합에서 재실행했다. 독립 읽기 검토에서 EXCEPT의 owner/snapshot/sibling/NULL 경계 약화는 발견되지 않았다. 제안한 sibling 손상/nullable metadata/evidence/image 검사 8개와 foreign item pointer 손상 검사를 실제 Node SQL에 추가했다. 검토 자체는 실행 PASS가 아니며 위 최종 실행과 구분한다.

### 최종 파일 지문

아래 경로는 `apps/web/` 기준이다. 21:31 조회 후 제품·시험 파일 변경 없음.

| 파일 | SHA-256 |
| --- | --- |
| `src/lib/v2/infrastructure/d1/prompt-curation-catalog.ts` | `6406848f9f26aa6ace0175aa5c05e2da04d486d5fb9aad48806bd3ab01ea371a` |
| `src/lib/v2/infrastructure/d1/prompt-curation-repository.ts` | `4ef356067c5e2098c96aa41bc8fb279bf6d3739afca8b5649d54111871a6bbfe` |
| `src/lib/v2/infrastructure/d1/sql-conjunction.ts` | `c51136f16e79184a4b23f0496003969c687840dabac5943f4b4a24157ceb961d` |
| `src/lib/v2/server/prompt-curation-http.ts` | `91a6ba2313652450ab93a22c2244241359f2610f34a7998b974f5e747cce2717` |
| `tests/contract/v2/prompt-curation-repository.test.ts` | `f3dc6242c618bb503c2bddbe9b326bdc17cb970f296c9cadd0916e61f397e3eb` |
| `tests/contract/v2/prompt-curation-d1.test.ts` | `26776f0d0773a9655ece01d265e8cc8b17af03474212b0faa671955a95fbed31` |
| `tests/contract/v2/prompt-curation-routes.test.ts` | `85622832541aa12bcbd43262a729c3d8d9e82a57a63c964fdd83c1da37ce182a` |
| `src/app/api/v2/records/[recordId]/links/curations/route.ts` | `1363dce5527fa9935359f803315b86ebdb6e3e7e8a2ec4c513771840237e97d2` |
| `src/app/api/v2/records/[recordId]/links/curations/[groupKey]/route.ts` | `fce17064f80a9023ea4d7707b0263ab08867ea553558938cf1ae0d087d32b7ed` |
| `src/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/route.ts` | `8814b8249413e8a3ca9463b59d7ee7524bd12a36c691a0f5c313b44d4b762ca8` |
| `src/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/[revisionId]/copy/route.ts` | `d3a0dd1b768a167f457369668a8efd49780d41db8dbf4302e5d37425af56ff3a` |

이미지는 synthetic pre-verified reservation으로 D1의 실제 commit/membership을 검사했으며 R2 업로드·이미지 decode 성공 주장이 아니다. HTTP 인증/binding과 AI gateway는 대역이다. 실제 로컬 D1 검사도 production Worker 요청 전체의 무료 query quota·원격 D1·실제 제공자·private corpus를 검증한 것은 아니다. 기존 0032 이동성 5 PASS는 새 API에서 생성한 full/edit/undo/incremental/repeat restore 결합을 대신하지 않는다. 정리본 editor·reload 내구성·명시 snapshot 이관·통합 이동성, G07–G11은 남는다. 원격 배포/migration/cutover·과금·모델 설정은 변경하지 않았고 전체 goal은 active다.

인계 정합성: 갱신한 5문서의 로컬 파일 링크 74개 누락 0, 최종 제품/시험 SHA-256 11개 일치, exit 0. 최초 문서 검사는 copy route 해시를 65자로 전사한 오류와 README의 기존 Markdown hard-break 공백을 함께 보고했다. 해시를 실제 파일과 맞춰 수정했고 두 칸 hard-break는 보존했다. 파일 존재/지문 검사이며 모든 외부 링크·heading anchor 검사는 아니다. 모든 검사 세션은 terminal이고 21:36 포트 조회에서 3100 listener는 0이었다.

## 후속 checkpoint · 2026-09-08 정리본 UI

### 구현과 통합 경계

`record-prompt-curations.tsx`/`prompt-curation-editor.tsx`/`prompt-curations.css`를 실제 Record에 연결했다. 별도 메뉴나 AI 재실행 없이 저장 원문을 정리한다. 초기 열기 전 GET은 없으며 수동 발췌 저장 알림은 열린 catalog만 갱신한다. 요청 중 알림은 현재 요청 종료 후 한 번 처리하며 실패를 무한 자동 재시도하지 않는다.

- 역할별 순서·명시 중복, 제목/관계/순서 확인, 전체 또는 항목별 이미지 대응과 미확인 경고. 원문/원본 이미지 링크를 표시한다. 조각 구성/순서가 바뀌면 순서 확인을 초기화한다. 판본/묶음은 이어 복사하지 않는다.
- 목록·선택 이력·append-only edit/undo/archive/unarchive. 51그룹/51개정 및 55수동 조각을 조회한다. 오래된 이력 선택이 이미 읽은 페이지나 선택 버튼을 지우지 않도록 보완했다.
- 409는 입력 유지→최신 확인→명시 적용→별도 저장이다. 페이지 밖 선택 수동 조각은 ID별 인증 GET으로 확인하며 최대64/동시4다. 거절·원문/역할 불일치 선택을 자동 제거하거나 예전 stored manual proof로 대체하지 않는다.
- 최신 확인의 scope를 저장해 이후 문서/권한 props가 바뀌면 옛 상태를 재적용하지 못하게 했다. 최신 적용은 items뿐 아니라 중복 추가에 사용되는 originals의 상태 버전도 갱신한다.
- 같은 요청 키 재시도, 잠금/권한 실패 시 목록·입력·fallback 제거, 늦은 저장/복사 응답 폐기, 서버 복사 receipt의 revision/role/mode/render/hash/byte 검증과 fallback 재인증을 포함한다.
- desktop/mobile 실제 컴포넌트, 키보드, scoped axe/가로 넘침을 검사했다. 본문·원문·입력은16px, 제어 최소44px, 모바일 정렬은2열이다. 실제 OS clipboard는 대역이며 실제 휴대폰/IME 성공으로 표현하지 않는다.

화면 메모리 draft의 접기/펼치기·이탈 경고만 구현했다. reload 복구·다른 기기의 즉각 삭제·명시 snapshot 이관은 남는다. 사용자 글·외부 원문·기존 환경 파일은 변경하지 않았다. UI의 HTTP 대역은 실제 세션/SQL/R2 검사를 대신하지 않으며, 이전 317 결합과 범위를 분리한다. 이번에는 backend/schema/원격 migration/배포/실제 제공자/모델·과금 설정을 변경하지 않았다.

### 실제 실패와 검사

| 실행 | 최종 결과 | 범위와 해석 |
| --- | --- | --- |
| 첫 UI `59371` | 2/2 PASS, exit0,14.2초 | desktop 저장/정확 복사·접기 유지, 최종 CSS 이전 |
| 확장 `61880` | 28 PASS/2 FAIL,exit1,1.4분 | 오래된 버전 선택 때 이력 첫페이지로 돌아가는 실제 UI 문제. 기존 페이지를 보존하도록 수정 |
| 경합 추가 `51625` | 8 PASS/2 FAIL,exit1,43.7초 | 이력 수정·55개 이후 재확인·busy 알림 PASS. 실패2개는 draft 없는 새 상태에도 충돌 버튼을 기대한 시험 준비 오류. 새 scope의 catalog 요청을 기다리도록 수정 |
| 통합 `78201` | **104/104 PASS,exit0,3.6분** | 정리본46+수동34+기존 링크24. 이후 originals 버전/CSS 2열/320px 검사 보완 전 |
| 마지막 타입 `92909` | **exit0** | 최종 group 역할 변경까지 포함. 이전 nullable 오류 `47704`를 보완했고 `25461`/`74485`/`4870`도 exit0 |
| 마지막 TS/TSX 6파일 ESLint `7859` | **오류/경고0,exit0** | 두 부모·두 새 UI·새 E2E/harness. 전체 앱 lint 아님 |
| 정리본 `32882` | 46 PASS/2 FAIL,exit1,1.8분 | 새320px axe가 빈 목록 div의 aria-label/role 오류를 검출. 목록과 editor에 group 역할을 명시했고 검증 기준을 낮추지 않음 |
| 최종 정리본 `21131` | **48/48 PASS,exit0,1.7분** | 최종 접근성·320px·중복 버전·회복/이력/복사 검사. desktop24/mobile24 |

명령은 루트 기준:

```text
npm exec --workspace @light-house/web -- playwright test tests/e2e/v2-prompt-curations.spec.ts tests/e2e/v2-manual-fragments.spec.ts tests/e2e/v2-link-analysis.spec.ts --output=test-results/g06-curation-integrated
npm exec --workspace @light-house/web -- playwright test tests/e2e/v2-prompt-curations.spec.ts --output=test-results/g06-curation-final-a11y
npm run typecheck --workspace @light-house/web
```

독립 읽기 검토는 harness의 CAS/receipt 요청 내용·그룹/복사 경로 scope·opaque cursor 부족을 찾아 보완했다. 실제 계약 parser/pure 조립 복사를 사용하지만 DB의 전체 권한/무결성/transaction을 모사했다고 주장하지 않는다. 늦은 복사·수동 저장 알림 두 누락을 추가했다. 제품 검토의 최신 확인 scope 및 중복 추가 stateVersion 두 P2도 회귀에 반영했다. 검토 자체는 실행 PASS가 아니다.

### UI 파일 지문

최종 검사 시작 시 조회하고22:20 종료 후7개 모두 일치한 SHA-256이며 경로는 `apps/web/` 기준이다.

| 파일 | SHA-256 |
| --- | --- |
| `src/components/v2/record-prompt-curations.tsx` | `62bdd7661275e32627fb2d4b3708cab4a698d1429b2d861fe8a36b381ee80745` |
| `src/components/v2/prompt-curation-editor.tsx` | `326e4ea8b0db8c85cbddd6686d54e3ab9382e929a77213a3f2bc080df7dc7d41` |
| `src/app/v2/prompt-curations.css` | `deeba3bd443756ffe145d9d2aa74b3a36f5d9ec0256f3c40c22518b0262692f2` |
| `src/components/v2/record-link-analysis.tsx` | `5b5ce1729bce36175022e49b7a2b6f10a18dfd42c480ecf1dd1ba6422f79e084` |
| `src/components/v2/record-manual-fragments.tsx` | `fe95c360e524cba38c78233255158b18842f271f0dc7f49f3318ae4d1e27b5af` |
| `tests/e2e/v2-prompt-curations.spec.ts` | `976d744b15a9cde9b27a0f312801139423441bdc1e1c6d762a614dda435481f1` |
| `tests/e2e/support/prompt-curation-harness.ts` | `6d3c93ba97e94c82a523d4e6ce3c28ed73f1589616b5043925e831e787a545bc` |

최종 인계: 갱신4문서의 로컬 파일 링크8개 누락0, UI/시험7해시 일치,exit0. 포트3100 listener0이다. root가 최종320px와 desktop/mobile PNG를 직접 확인했다. 실제 휴대폰 화면·운영 이미지를 검증한 것은 아니며 합성1px이미지/clipboard 대역이다. 원격 작업·새 Worker/full suite 실행 없음. 모든 root검사·agent작업은 종료했고 전체goal은 active다.
