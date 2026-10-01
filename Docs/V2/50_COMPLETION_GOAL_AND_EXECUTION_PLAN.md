# 전체 완성 goal · 실행 지침

시작: 2026-09-08. 사용자 요청: 모든 완성을 목표로 goal을 세우고 구현을 계속한다.

2026-09-23 실행 변경: [76번](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)에 따라 Sol Ultra가 구현을, Astra Ultra가 핵심 계약·고위험 판단·최종 검토를 맡는다. 아래55%는 과거 동등가중 추정 기준선으로 보존하고 현재 구현률처럼 반복 보고하지 않는다. 이후 사용자 시나리오별 사용 가능/연결·검증 중/미구현/운영 확인을 분리한다. 기존 전체 범위는 삭제하지 않는다.

실행 방식은 [루트 AGENTS.md](../../AGENTS.md), 재개 위치는 [CURRENT_WORK_STATE.md](./CURRENT_WORK_STATE.md)를 따른다. [Astra 실행 프로필](./56_ASTRA_EXECUTION_PROFILE.md)은 지침 개정 근거다. 이 문서는 전체 요구사항·완료표의 정본이며, 과거 진행 순서가 최신 사용자 요청을 대신하지 않는다.

## 1. 목표와 종료 조건

Light House V2를 확정 기획에 따라 개인 실사용 가능한 상태로 완성한다. 기존 I0–I8과 링크·영상·프롬프트 확장을 하나의 제품으로 연결한다. goal은 **active**이며, 부분 기능 완료·합성 화면·테스트 개수만으로 전체 complete를 선언하지 않는다.

완료는 다음 네 조건을 모두 충족한 상태다.

1. 확정 범위의 사용자 흐름이 실제 저장·조회·편집·재사용 경로로 연결된다. 미지원 공급자는 정확한 상태와 사용 가능한 대안이 있고, 구현하지 않은 자동화를 완료처럼 표시하지 않는다.
2. 원문·첨부·사용자 수정 우선권·작성자 구분·소유자/잠금 권한·오프라인 내구성·전체 이동성이 검증된다.
3. 현재 코드의 통합 회귀·브라우저·Worker 빌드·비밀값 검사 및 필요한 실제 공급자/비공개 corpus 확인에 완료 근거가 있다. 옛 실행 결과는 현재 결과와 구분한다.
4. 개인 운영을 위한 환경·백업/복구·실행/배포 절차와 남은 사용자 조치가 해소된다. 승인 필요한 원격 변경과 실기기 확인은 별도 gate로 다루며 임의로 통과시키지 않는다.

## 2. 작업 규칙

- 현재 파일과 실행 결과를 기준으로 판단한다. 기존 사용자의 dirty worktree·원본 데이터·자격 증명을 보존한다.
- 한 기능마다 source→server→UI→권한→backup/restore→검증을 묶어서 완료한다. 먼저 UI나 schema만 만들어 완료로 계산하지 않는다.
- 원문, 저자의 말, 내 메모, OCR 후보, AI 요약/추론, 외부 사실을 분리한다. AI가 prompt 원문을 재작성하지 않게 하고 서버가 원문 범위를 추출한다.
- 새 schema는 additive migration으로 작성하고 canonical registry·FK/ID 재매핑·변경 이벤트·증분 백업을 같은 단계에서 갱신한다.
- 저장/원문 재수집/분석 상태는 독립적이다. 실패·부분 확보·quota 소진·접근 권한 없음에도 이미 확보한 내용은 유지한다.
- 비동기 분석에는 문서 revision과 원문 snapshot/manifest identity를 함께 사용한다. 늦은 결과가 새 원문이나 사용자 확정을 덮지 못하게 한다.
- 검증 수치는 최종 프로세스 exit와 실제 범위를 함께 기록한다. 대역 응답·합성 corpus·실제 공급자를 구분한다.
- 독립적인 작업은 병렬로 하되 파일 소유권을 나눈다. Next 개발 서버/타입 생성/빌드는 한 작업에서만 관리해 생성물 경쟁을 피한다.
- 외부 원문을 명령으로 실행하지 않는다. 로그인 우회, 쿠키 추출, 임의 전체 스크래핑, 자동 게시·이미지 생성은 목표에 포함하지 않는다.
- 원격 migration·배포·legacy cutover·새 서비스/과금 확대·누락된 개인 선택은 기존 승인 조건을 확인하고 필요하면 요청한다. “모든 완성”은 권한 확대가 아니다.
- 다음 실행에서도 이 문서와 현재 과제에 관련된 최신 evidence를 먼저 확인한다. 단순 시간 경과나 일시 실패 때문에 완료/blocked로 처리하지 않는다. 같은 외부 blocker가 세 번의 goal turn 동안 반복되고 안전한 진전이 불가능할 때만 blocked로 전환한다.

## 3. 완료표

`기준선 있음`은 이번 goal에서 재검증됐다는 뜻이 아니다. 각 항목은 완료 파일/명령/결과를 갖춘 뒤 상태를 갱신한다.

| ID | 영역 | 현재 상태 | 완료 증거 |
| --- | --- | --- | --- |
| G01 | 기존 V2 기능·운영 gate 현재 감사 | 로컬 감사·오프라인 평가 기반 구현, 실제 평가 잔여 | 문서/코드/검증 대조, [83번](./83_PRIVATE_EVALUATOR_FOUNDATION.md) recorded evaluator32개·기존 manifest25개 검증. 자유 규칙·사람 rubric·실제 공급자/corpus·운영 evidence는 미확인 |
| G02 | 수동 링크 저장·개별 복사 | 로컬 통합 후보 확인 완료 | 49번 기준선 + 2026-09-28 통합 후보 전체 회귀(vitest 전체·링크 계열 브라우저 404 PASS·쓰기 flag spec 36 PASS) |
| G03 | OS 공유 자료의 명시적 출처 전환 | 로컬 사용자 경로 완료 | 51번: 계약 12/12, 결합 브라우저 34/34. 실제 OS Share 전달은 G11 |
| G04 | snapshot·manifest·파생 조각 정본 | 로컬 저장·이동성 경로 검증 완료 | 0031·membership·해시·CAS·18/18 foundation, 반복 복원 수정 후 링크 이동성 파일 최종 9/9 PASS(726.265초). 별도 SQLite 15/15 및 기존 fixture 갱신 근거는 52·53번 |
| G05 | 외부 저자 구분 AI 분석 | 로컬 경로 완료, 실제 제공자 경로 확인(진단 모델) | 53·62번 로컬 검증에 더해 2026-09-28 HTTP 400 원인(`maxItems`) 수정, 진단 모델로 글·이미지 OCR 실제 성공(77번 후속). 설정 모델 1회 확인 잔여 |
| G06 | 프롬프트 연결·이미지 대응·조립본 | 로컬 사용자 경로·이동성 검증 완료 | 54·58–69번. 기존 DB/API/UI·draft/pending·정확 과거 AI 근거에 더해 실제 S2 이관, base-present 삭제/tombstone, full+delta·46테이블 ZIP·fresh/repeat 복원13 PASS. ID 충돌 RED 보완 후 SQLite 결합18 PASS. 현재 전체 통합·원격 운영은 G10/G11 |
| G07 | 목적별 Record 표시·저장 뷰·검색 | 로컬 사용자 경로 완료 | 70–75번 + 81번 자연어 리콜(명시 해석·카탈로그 경계·공유 governor, 합성 공급자·desktop/mobile 8 PASS). 실제 해석 품질은 G11 운영 확인 |
| G08 | 일반 웹·Threads·Instagram 수집 adapter | 일반 웹 허용 호스트 완료, SNS 자동은 사용자 결정 | 79번: 정확 호스트 허용·redirect/DNS/크기/시간 경계·불변 저장·부분/차단 상태, 회귀 닫음. SNS는 URL 보존+수동 보완, Meta 앱 권한·임의 호스트 egress 정책은 사용자 결정 |
| G09 | YouTube/영상 입력·구간 분석 | 로컬 완료, 실제 제공자 경로 확인(진단 모델) | 80번: 명시 구간 분석·이어서 분석·시각 근거·출처 SQL 증명·할당량 공유. unit36·SQLite/HTTP5·browser4 PASS, 진단 모델 실제 1회 성공. 설정 모델 1회 확인 잔여 |
| G10 | 전체 회귀·접근성·보안·Worker package | Cloud Linux 전체 Vitest·package 확인 · 현재 UI 검증 잔여 | 2026-10-01 고정 소스172파일3528시험 PASS/오류0, type/lint/bindings/db·safe Worker build exit0/secret0, local Worker 기동200. 현재 Chromium/localhost 제한으로 UI는 미확인. 과거 Playwright845 PASS/51 SKIP을 현재 결과로 재사용하지 않음. [82번](./82_CLOUD_LINUX_COMPLETION_EVIDENCE.md). 원격 runtime·D1 비용은 G11 |
| G11 | 개인 corpus·실기기·원격 운영 전환 | 승인/환경 확인 필요 | 현재 preflight·백업·원격 migration 상태, 사용자 확인과 배포/복구 근거 |

### 전체 진행률 보고 · 2026-09-22

사용자 요청에 따라 전체 범위를 유지한 **완료 기준 달성도 추정치**를 보고한다. 첫 기준은 약48%,69번 G06 로컬 검증 뒤50%,70번 정확 검색 위치 연결 뒤52%였으며,71번 저장 뷰 표시 검증 뒤 **약55%**다.72번 긴 필드·선택 이름,73번 전체 탐색·내 목록·모바일 진입,74번 현재 목적별 모듈 경계를 추가 검증했지만 전역 처리 상태와 필요에 따른 추가 모듈·통합이 남아 같은55%를 유지한다. 소요 시간·코드 줄 수·테스트 수의 비율이나 출시 가능 확률이 아니다. G01–G11을 동일 비중으로 두고 0/25/50/75/100의 보수적 단계 점수를 부여했다. 작업 크기가 서로 같다는 뜻은 아니므로 향후 일정 추정에 이 수치를 사용하지 않는다.

| 영역 | 달성도 | 이번 점수의 근거와 미완료 경계 |
| --- | ---: | --- |
| G01 | 50 | 감사·결함 보완 수행. 현재 artifact 출시 증거·개인 평가 runner와 운영 gate 정합성 잔여 |
| G02 | 75 | 수동 링크 저장·복사 기준선과 후속 회귀 있음. 최종 통합 후보 확인 전 |
| G03 | 100 | 명시적 출처 전환의 로컬 사용자 경로 검증 완료. 실제 OS 전달은 G11에만 계산 |
| G04 | 100 | snapshot·manifest 저장·이동성 경로 검증 완료. G06의 새 정리본 복원은 별도 |
| G05 | 50 | 수동 텍스트 분석·저자 분리·Record와 snapshot 복구 연결. OCR·실제 제공자 잔여 |
| G06 | 100 | 수동 발췌·정리본·이관 초안/중단 요청 복구·정확 과거 AI 근거와 DB/API/UI 연결. 69번 실제 이관 그룹·base-present 삭제 증분·fresh/repeat 이동성 검증 완료. 현재 전체 통합/운영은 G10/G11에만 계산 |
| G07 | 75 | 70–73번 검색·표시·읽기·전체 탐색에74번 현재 workout module privacy/version/fallback·근거 권한·JSON 키 보존 검증을 추가했다. 전역 처리 상태·필요에 따른 추가 목적별 모듈과 최종 통합은 남아 점수를 유지한다 |
| G08 | 0 | 권한 있는 자동 수집 adapter 미완료. 수동 URL 저장을 자동 수집으로 계산하지 않음 |
| G09 | 0 | 영상/자막/구간 분석 미완료. 링크·시간 metadata 입력만으로 완료 계산하지 않음 |
| G10 | 50 | 관련 회귀와 과거 Worker 검증 있음. 현재 최종 전체 suite·Worker·보안/접근성 통합 증거 없음 |
| G11 | 0 | 자격 증명 등 기존 준비와 별개로 현재 개인 corpus·실기기·원격 전환 gate 미통과 |

산식: `(50+75+100+100+50+100+75+0+0+50+0) / 1100 × 100 = 54.55%`(반올림55%).71번에서575/1100=52.27%의 G07만50→75로 변경했고72–74번에서도600/1100을 유지한다. 범위/가중치는 유지했다. 완전히 끝난 영역만 세는 엄격한 지표는 **3/11(27.3%)**이며 부분 달성도를 반영한 위 수치와 구별한다. 100점인 로컬 영역도 전체 운영 승인을 의미하지 않는다. 앞으로 의미 있는 checkpoint에서 같은 기준으로 갱신하고 범위/가중치 변경이 필요하면 변경 전후를 명시한다. 작은 수정이나 반복 테스트만으로 점수를 높이지 않는다.

오케스트레이션은 공유 계약과 파일 소유권을 먼저 고정한다. root가 통합·실행 자원·진행률/완료표를 맡고, 실제 도구에서 확인한 사용 가능한 agent에게 독립 구현과 읽기 전용 위험 검토를 순차 또는 병렬 위임한다. 과거 agent 이름/문서만으로 생존을 가정하거나 알려진 사용 한도 오류를 반복 호출하지 않는다. 임의 reset/모델 전환은 하지 않으며 사람의 승인이 필요한 운영 gate를 보조 agent의 PASS로 대신하지 않는다.

## 4. 실행 순서

원래 의존 흐름은 G01/G03→G04→G05→G06/G07이며 G08/G09는 공급자 접근과 runtime capability를 확인해 연결한다. 재개 시에는 최신 사용자 요청과 현재 완료표의 미완료 항목을 사용한다. G01/G03에서 이미 완료된 부분을 매번 처음부터 반복하지 않는다. 공유 계약이 안정된 독립 작업은 병행하고, 새로 확인된 결함은 영향받는 단계에서 보완한다. G10/G11의 전체 완료 증거는 최종 통합 후보에서 확인한다.

기획 변경이 필요하면 이유와 영향을 기록한다. 구현이 어려워졌다는 이유로 자동 수집·분석을 조용히 scope에서 지우지 않는다. 공급자 제약으로 구현할 수 없는 범위는 정확히 제시하고 사용자와 완성 범위를 합의한다.

## 5. 진행 기록

- 2026-09-08: 전체 goal 생성, G01/G03 병렬 착수. 49번의 수동 링크 AI-off guard는 전용 provenance 처리 경로가 검증되기 전까지 유지한다.
- G01 첫 재계산: private corpus 구조는 유효하나 20개 중 ready 0, expected 초안 5. capture_default/library_default/closure preflight는 각각 blocker 15/17/18로 부적격이다. 8월 13일 측정 evidence의 다른 true 값들은 후보 artifact·schema·빌드 해시·신선도와 결합되어 있지 않아 현재 PASS로 읽지 않는다.
- G01 추가 잔여: 실제 private 모델 평가·정답 비교·recall 보고 runner, artifact 기반 출시 증거 검증, 문서의 T+30 closure 관찰과 현재 코드의 정합성을 보강해야 한다. 사용자 승인 expected와 실기기/관찰 기간을 자동 테스트로 대체하지 않는다. embedding rerank는 측정 후 선택 기능이며 무조건 필수 구현으로 계산하지 않는다.
- G04 설계 보정: 45번의 세 테이블 기본안에 snapshot membership 테이블 하나를 추가한다. 기존 document-source 연결은 여러 snapshot의 같은 source 소속을 표현하지 못한다. 네 테이블의 정규 FK와 문서 soft pointer로 JSON ID 배열·복원 cycle을 피하고, manifest hash는 재매핑될 D1 ID를 포함하지 않는다.
- G03: 공유 draft를 원문으로 단정하지 않고 사용자가 내 메모/출처 원문을 선택하는 UI를 구현했다. 전환 자체는 원본 rows·본문을 변경하지 않는다. desktop/mobile 결합 34개와 scoped axe/가로 넘침 검사를 통과했다.
- G04/G05: 0031 snapshot 정본과 전용 `link_analyze` 저장/실행 기반을 구현했다. 모델이 원문을 재작성하지 않고 블록만 선택하며, 내 메모는 제공자 입력에서 제외한다. 오래된 snapshot/lease의 완료·실패가 최신 상태를 덮지 않는 검사를 추가했다. 진행 근거와 제한은 52번에 기록한다.
- G01 추가 발견/수정: 기존 review resolve endpoint는 서버에서 확인한 restricted grant를 저장 repository에 전달하지 않았고, repository도 restricted privacy를 차단하지 않았다. 클라이언트 body를 신뢰하지 않는 서버 grant 전달과 조회/쓰기/receipt replay의 잠금 경계를 보강했다. 실제 POST/SQLite 회귀 13/13 PASS, 상세는 53번.
- G05: 명시 요청의 네트워크 재시도와 새로운 재분석을 구분하는 receipt를 추가하고, 기존 처리 실행기에 전용 stage를 연결했다. 사용자 요청에서는 enqueue만 하며, main 작업 3개의 기존 처리 예산을 유지한다. Record 버전 선택/발췌 검토 UI와 연결했고 desktop/mobile 최종 새 UI 24개를 검증했다.
- G01/G05 후속: 개인 분석 중 외부 원문 추가 경합을 독립 재현했다. 제공자 호출 직전과 성공/실패/만료 복구에 원문 경계를 보강하고, 회수된 old attempt가 새 lease·링크 작업·capture를 건드리지 않도록 검증했다. 경합 12/12 PASS, 제공자는 대역이다.
- G04 반복 복원: PK가 FK인 문서를 잘못 독립 fork하는 경계를 수정했다. full/incremental 기본선과 후속 선택 검증을 분리해서 52번에 기록했다. 원격 복원이나 모든 동시 canonical 수정의 검증은 아니다.
- G01 편집 복구 후속: 다른 탭의 오래된 normal 사본이 restricted purge 뒤 평문으로 다시 저장되는 경합을 fake IndexedDB로 RED 재현했다. record 단위 transaction policy fence와 서버 current_version 문맥을 연결해 보강 중이다. 새 링크 editor의 reload draft 복구까지 완료된 것으로 간주하지 않는다.
- G06: append-only 정리본 3테이블과 정밀 수동 발췌, 역할별 조립 복사, 명시적 snapshot 이관·undo 계약을 54번에 확정했다. 순수 계약 67개 및 독립 경합/누락 판정 검사 8개가 수정 후 통과했다. 저장/API/UI는 미구현이다.
- G10 기존 회귀: 031 정본보다 오래된 복원 ZIP/내보내기 DB fixture 때문에 8개 실패를 확인했다. 최신 canonical 파일과 0024–0031 migration을 fixture에 반영했다. 43개 테이블의 보수적 603단계는 기존 600단계/사용자 동작 상한을 넘으므로 추가 '계속 진행' 1회가 필요하다. 제품 상한·검증·timeout은 유지했다. 후속 6 PASS + 남은 2 PASS는 단일 전체 재실행과 구분한다.
- G10 후속: 새 경로 4개가 retention 삭제 허용 목록에 빠진 제품 결함을 0031에서 보강했다. 해당 실제 D1/R2 검사 1개 PASS. 전체 회귀의 나머지 4개는 현재 상태 문서에서 추적하며 전체 PASS로 표시하지 않는다.
- 사용자 우선순위에 따라 GPT-6 Astra 작업 지침을 먼저 정비했다. 루트/앱 지침, V1 역사 라우팅, 최초 로드맵/현행 완료표, 현재 인계 문서를 분리했다. 상세 근거는 56번이며 앱 Gemini/원격 권한/전체 goal은 유지한다.
- 지침 정비 후 미해결 4개 회귀의 fixture를 실제 schema/소유권/복원 출처 계약에 맞췄다. stable PUT 재생성 경합과 일반 오류의 늦은 failure-write 두 분기를 보강했다. retention 전체 파일 및 현재 제품 Worker package까지 확인했다(57번). 원래 전체 exit 1은 이력으로 유지하며 다음 기능 구현은 G06 저장/API/UI다.
- G06 후속: 실제 수동 정밀 발췌 GET/POST와 원자적 fragment/evidence/receipt 저장을 구현했다. 최종 권한·원문 fence 및 55건/byte cursor 경계를 포함한 SQL/HTTP 51 + 기존 pure 75 결합 126 PASS, textarea 원본 위치 변환 별도 10 PASS다(58번). 0032 정리본 이동성은 병행 검증 중이며 UI·정리본 API/undo는 미완료다.
- 19:50 KST 갱신: Astra 문서의 V1 직접 진입 경로를 보완했다(56번). G06 단일 복사 전 재검증 GET 포함 후속 API 76 PASS, 0032 이동성 최종 전용 5 PASS. 수동 UI는 연결됐지만 desktop 1 PASS/7 FAIL이며 독립 검토 3개 보완과 mobile/통합 타입이 남았다. 현재 재개 위치와 terminal 핸들은 CURRENT_WORK_STATE에 기록했다. 이전 진행 시점의 '미연결/검증 중' 표현은 그때의 기록이다.
- 20:26 KST 갱신: native readonly textarea의 키보드 한계와 선택 알림 문제를 분리해 CodeMirror 기반 읽기 전용 선택 도구로 보완했다. 초기 UI 실패·독립 P2 3건을 해소하고 최종 수동 34/34 PASS·타입/lint exit 0, 기존 링크 포함 직전 58/58 PASS를 확인했다. source 교체·1,001줄·이모지·권한 변경·정확 복사 및 capability 22개 범위는 58번에 기록했다. 정리본 실제 저장/API/editor·이미지 대응·undo와 전체 운영 목표는 계속 미완료다.
- 21:31 KST 갱신: 정리본 HTTP API와 저장 안전성을 연결했다. 손상 receipt 요청 결합·전체 proof·AI run/input/manifest·시계 역행 이력 검사를 보강했다. 실제 workerd에서 드러난 중첩 SQL 깊이 실패를 같은 SQL의 materialized proof/EXCEPT 검증으로 해소했고, 64항목/64이미지·동시 요청·최종 실패 rollback을 포함한 결합 317 PASS를 확인했다. 원문·보안·transaction 경계나 검증 상한을 낮추지 않았다. editor·reload 복구·snapshot 이관·새 API 복원 결합과 전체 운영 gate는 남는다.
- 22:19 KST 갱신: 실제 Record 정리본 editor/list/detail/history/undo/copy를 연결했다. 통합104 PASS 뒤 충돌 적용 후 중복 버전·320px/접근성을 보완한 최종 정리본48 PASS다. 수동 저장 알림·요청 중 갱신,55개 이후 선택의 개별 재검증, 늦은 확인/복사/저장 응답과 권한 경계를 포함한다. 원문/환경/서버 계약·원격 운영은 변경하지 않았다. 명시 snapshot 이관·새 API 복원 결합·reload 내구성과 G07–G11은 남는다.
- 2026-09-09 00:16 KST: snapshot 편집 초안의 명시 reload 복구·미완성 입력·응답 유실의 같은 요청 재생·privacy/동의/generation 경계를 연결했다(62번). 계약/권한8파일118 PASS, 실제 SQLite receipt66 PASS, 후속브라우저54 PASS/기존Capture4 SKIP,최종타입/lint0.173P1F 결합의 상태표시 경합을 수정한 후속 결과이며 전체174 PASS나 전체제품 완료를 주장하지 않는다. 수동/정리본/여러 이관 pending 복구와 G07–G11은 계속 남는다.
- 2026-09-09 00:47 KST: 사용자 오케스트레이션·진행률 요청을 반영해 전체11영역의 보수적 단계 점수를 약48%로 보고했다. root와 보조 agent가 세션/통합과 수동 helper를 나누고 독립 park 경합 검토를 반영했다(63번). 결합149 PASS, 기존 링크/snapshot48 PASS, tail 보완 결합28P2F의 locator 수정 후 세션6 PASS·401강화2 PASS, 최종타입/lint0. scope별 immutable 완료 token과 수동 draft/receipt helper는 준비됐지만 각 실제 수동/정리본/이관 화면의 복구 연결은 다음 작업이다. 이 기반 변경만으로 진행률을 올리지 않았다.
- 2026-09-09 01:28 KST: 실제 수동 발췌 화면에 source/range/role/pending 복구·명시 전환 park·fresh source GET·strict receipt/token cleanup·인증 오류 뒤 숨긴 입력의 명시 복귀를 연결했다(64번). agent는 current CAS를 유지한 과거 exact receipt 읽기 재생을 구현하고 UI를 독립 읽기 검토했다. root 계약252 PASS,브라우저결합201P/1F(수동60 포함); 유일한 정리본 모바일 순차 좌표 측정오류는 trace의 smooth-scroll 이동을 확인해 동일 시점 측정으로 보완했고 후속48 PASS다. 전체202 PASS 또는 현재 Worker 성공으로 바꾸지 않는다. G06 전체 종료 기준은 아직 미충족이므로 약48%를 유지하며 정리본/이관 복구로 이어간다.
- 01:33 후속:65번 정리본 create/edit/undo/archive/unarchive draft/pending 순수 helper를 병렬 구현·인수했다. agent285 PASS/root전용90 PASS,2파일hash일치/lint0·최종타입0이다. UI 미연결/성공 receipt 검증 미구현과 구별하며 진행률은 그대로 유지한다.
- 02:39 checkpoint:66번 실제 정리본 복구·strict receipt를 root UI와 agent helper/시험으로 병렬 구현했다. 원래 요청·역할/순서/중복·이미지 대응, 독립 그룹 park, fresh 증거·정확 replay와 세대별 정리를 연결했다. 독립 검토의 unmount 저장/정책 세대 경합과 parent 보조 요청 권한 누락을 RED 재현·보완하고, 적용 직전 async 경계의 정적 검토도 반영했다. 최종 계약261 PASS,공유 복구144 PASS,parent 결합128 PASS 뒤 최종 후속88 PASS·타입/lint0다. 중복 실행/합성 응답/실제 provider를 구별한다. G06 잔여와 G07–G11 때문에 전체 진행률 약48%·goal active를 유지하며 과거 AI 증거 조회와 이관 복구로 이어간다.
- 2026-09-12 checkpoint:67번 과거 AI exact fragment/run 인증 조회와 strict preflight/receipt를 실제 정리본 재시도에 연결했다. source metadata 손상 오류 분류와 병렬 조회의 늦은 권한 거절을 독립 검토·RED 재현 후 수정했다. root 계약 결합474P2F의2개는 순수 시험 기대 오류 순서였으며 후속260 PASS로 해소했다. 새 서버91개는 결합에서 PASS다. 브라우저84 PASS 뒤 경합 수정 포함 최종100 PASS다. 기존 draft/key/원문/실행 모델/환경·원격 상태는 유지했다. 전체48%·goal active이며 다음은 이관 초안과 과거 pending 증거 검증이다.
- 2026-09-12 이관 checkpoint:68번 별도 migration session과 최소 plan/request 저장·fresh exact source/target·과거 pending receipt 재생·독립 park·정확 token 정리를 구현했다. root와3개 agent가 UI/계약/시험/독립 리뷰를 분담했다. 순수242 PASS, 기존 이관40 PASS, target200 locked 경합2 RED 후 새 복구54 PASS다.0032 canonical 순서 fixture의1P2F를 실제 재현하고3 PASS로 보완했다. 편집/이관 복구 제목 구분 후 최종90개 결합 PASS/exit0/8.4분, 타입/lint0이며8파일지문일치·로컬문서링크96개유효를 확인했다. 전체48%·goal active이며 다음은 실제 이관된 그룹과 base-present 삭제 증분의 왕복 검증이다.
- 2026-09-12 이동성 checkpoint:69번 실제 이관 그룹·full 이전 삭제 대상의 tombstone 증분·46테이블 ZIP·fresh/repeat 검증을 root와 agent가 분담했다. V1 복원 self-cycle 및 V2 succeeded 상태의 undo 근거 ID 오염을 독립 RED로 재현해 원본 기준1회 매핑으로 수정했다. 최종 SQLite18 PASS, 실제 workerd 이동성13 PASS/exit0/1223.76초, 독립 검색 표시 보완과 기존 회귀19 PASS/exit0/61.14초, 최종 타입·수정9파일 lint0다. G06 로컬 완료 기준 충족으로75→100, 전체 약48%→50%로 갱신했다. G07은25점이며 다음은 출처별 검색 match→정확 저장 위치 연결이다. 전체 suite/Worker·실제 제공자·원격/실기기 gate는 미완료다.
- 2026-09-12 저장 뷰 checkpoint:70번 정확 검색 위치 연결로 G07을25→50(전체52%)으로 갱신한 뒤71번 실제4layout/선택 필드/페이지 그룹/밀도/CAS 설정 복구를 root와3개 agent가 병렬 구현했다. 실제 D1 깊이 오류·사용자 필드명 충돌·분류 우선순위·모달 초점/대비를 RED로 확인하고 보완했다. 범위별 서로 다른 계약/SQL/API/SSR246개 PASS, combined browser110P4F의 실제 UI 결함 보완 뒤 신규38 PASS, 최종 타입/scoped lint exit0다. 단일 전체 suite나 단일114 browser PASS로 합산하지 않는다. G07만50→75, 전체575→600/1100=약55%로 갱신했다. 목적별 모듈·탐색·긴 필드 읽기 예산·최종 통합/운영은 남는다.
- 2026-09-22 긴 필드 checkpoint:72번 SQL preview/read 예산·명시 페이지·fresh 원값 복사·content revision·privacy 폐쇄·선택 필드 이름 복구를 root와3개 agent가 분담했다. 큰 scalar/null·signed64 최소값·권한 오류 본문 대기·생성 응답 불일치를 독립 RED로 재현해 보완했다. 범위별 서버/계약299개 PASS, combined browser142P2F는 합성 도착 HTML의 charset 누락2건이며 한 줄 보완 뒤 labels42 최종 PASS다. reader64/기존표시38은 combined에서 PASS이며 단일144 PASS 실행으로 바꾸지 않는다. 최종 타입/scoped lint exit0, source/test24파일/화면2개 증거는72번. G07은75·전체55%를 유지하며 다음은 facet/catalog/저장 뷰 전체 탐색·모바일 진입이다. 전체 suite/Worker·실제 제공자/영상/개인 corpus/원격 운영은 미완료다.
- 2026-09-22 전체 탐색 checkpoint:73번을 root와3개 agent가 facet 서버·catalog·UI·독립 검증으로 분담했다. 기존 50/60/36 하드컷을 bounded20개 페이지·검색·전체 수로 바꾸고 페이지 밖 선택을 보존했다. 내 목록 summary와 모바일 More를 연결했으며 실제 RSC 이동 취소·320px/하단 가림·history lifetime 및 예약 이동 취소를 보완했다. 서로 다른 서버/계약/SSR318 PASS, 마지막 browser96 PASS/4 SKIP(exit0,3.3분), 타입/scoped lint exit0이며 초기 실패/대역 한계를73번에 보존했다. source/test28+화면3 지문을 기록했다. G07은75·전체55%를 유지한다. 다음은20번 확장 계약에 따른 privacy/version/fallback 선행 검증과 가치가 있는 목적별 module이며 전역 처리 상태·OCR/실제 제공자·수집/영상·전체 통합/운영은 잔여다.
- 2026-09-22 Record 모듈 checkpoint:74번을 root와3개 agent가 registry/SQL·UI·독립 권한·순수/Flight 시험으로 분담했다. sensitive/restricted 모듈, restricted 연결 제목과 제3 원문 인용, stale relation/evidence identity, JSON 키 전송 소실을 재현해 보완했다. 서로 다른 서버/계약/SQL/Flight235 PASS, 최종 browser42 PASS/4 SKIP(exit0,1.3분), 타입/변경 TS15 lint exit0이며 실제4화면을 확인했다. source/test17+화면4+실패요약1 지문을 기록했다. G07은75·전체55%를 유지하며 다음은 전역 처리 상태 화면이다. 기존 전체 goal/수집/영상/실제 제공자/최종 통합·운영 범위는 삭제하지 않았다.
- 2026-09-29 00:30 KST checkpoint(Claude Code 세션, 사용자 지시로 이어서 완성·Gemini 재호출 승인): 76번 S3 잔여 회귀를 닫았다. S1 HTTP 400 원인(`maxItems`)과 무료 일일 한도 대기 결함, 실제 응답의 추출·근거 offset 결함을 수정했다(77번 후속). S4 영상 구간 근거(80번)와 S5 자연어 리콜(81번, 병렬 agent)을 구현했다. 진단 모델 실제 호출로 S1 글·이미지와 S4 영상 성공을 확인했다. 통합 후보 전체 검사는 CURRENT_WORK_STATE에 있다.
  - 점수: G02 75→100, G05 50→75, G07 75→100, G08 0→50, G09 0→75, G10 50→75. 나머지는 유지(G01 50, G03·G04·G06 100, G11 0).
  - 산식 `(50+100+100+100+75+100+100+50+75+75+0)/1100 = 825/1100 = 75.0%`. 엄격 완료 영역은 G02·G03·G04·G06·G07 **5/11(45.5%)**이다. 기준·가중치는 바꾸지 않았다.
  - 남은 것: G01 private corpus 평가 runner와 사용자 승인 정답, G05·G09 설정 모델 실제 1회 확인, G08 SNS 권한·임의 호스트 정책, G10 원격 runtime, G11 원격 migration·배포·실기기·운영 전환. 원격 작업과 결제는 하지 않았다.
