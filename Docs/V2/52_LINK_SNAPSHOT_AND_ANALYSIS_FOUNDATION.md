# 링크 원문 스냅샷·텍스트 분석 기반

기준일: 2026-09-08. 전체 goal의 G04/G05 저장 기반 구현 기록이다. **후속 Record/API 연결과 검증은 53번에서 이어간다. 이 문서만으로 검색·자동 수집까지 완성됐다고 판단하지 않는다.** 실제 Gemini 호출과 원격 DB migration은 수행하지 않았다.

## 1. 원문 정본

`0031_v2_link_snapshot_foundation.sql`은 기존 원문을 변경하지 않고 다음 정본을 추가한다.

| 저장 대상 | 의미 |
| --- | --- |
| `v2_link_snapshots` | 문서에 연결된 특정 시점의 원문 집합, 부모 스냅샷과 버전, 확보 상태 |
| `v2_link_snapshot_sources` | 정규화된 원문 소속·순서·안정적인 member key와 fingerprint |
| `v2_link_fragments` | 정확 원문 추출 또는 AI 해석 후보. 원본 내용은 변경하지 않음 |
| `v2_link_fragment_evidence` | 같은 스냅샷 안의 근거 원문·범위·관계. 이미지 대응의 자동 확정은 하지 않음 |

문서의 `current_link_snapshot_id`, `link_snapshot_version`, `published_link_run_id`는 별도 상태다. 본문 revision이 같더라도 원문 추가·선택 변경은 새 snapshot/version이 된다. GET은 스냅샷을 만들지 않는다. 기존 수동 원문에서의 첫 생성, 새 원문 추가, 선택/순서 변경은 명시적 쓰기 작업이다.

각 fingerprint와 manifest는 텍스트·메타데이터·첨부 해시와 안정적 member key/순서를 사용한다. 복원 중 바뀌는 D1 행 ID는 manifest 해시에 넣지 않는다. JSON의 키 정렬은 locale/ICU에 의존하지 않는다.

원문 선택에는 소유자·문서·Capture 일치, committed 첨부, legacy 공개 경계, restricted 잠금, lifecycle 검사가 적용된다. 내 본문 메모는 외부 원문 membership에 넣지 않는다. 저장 시 revision+snapshot+version CAS가 실패하면 첫 NOT NULL assertion으로 원문 추가와 자식 행까지 같은 batch에서 롤백한다.

0031은 전체 0006–0030 선행 migration을 전제로 한다. 기존 provider invocation lease 테이블의 CHECK를 `link_analyze`까지 확장하면서 기존 lease 행·인덱스·보호 trigger를 보존한다. 실제 migration 적용은 아직 로컬 시험 DB에서만 수행했다.

## 2. AI가 원문을 다시 쓰지 않는 계약

`link-analysis.v1`은 일반 개인 기록의 `analysis-v1`과 다른 계약이다.

1. 서버가 소유권과 manifest를 검증한 정확한 snapshot을 읽는다.
2. 외부 텍스트를 CRLF·LF·CR과 공백을 유지하는 줄 단위 블록으로 준비한다. 내 메모는 전송 payload에서 제외한다.
3. 모델은 member key와 시작/끝 블록만 선택한다. `rawText`, 사용자 평점/사건 필드, 이미지 짝, 조립 프롬프트 등의 추가 필드는 거절한다.
4. 서버가 원문을 slice하여 정확 텍스트·해시·UTF-16 범위를 만든다. 모델 요약은 `ai_interpretation`의 별도 `derived_text`이며 원문 복사에 섞이지 않는다.
5. 결과는 모두 `proposed`다. 제공자가 완전성·사용자 동의·검증 완료를 확정하지 않는다. 부분 원문은 `truncated`, 미검토 OCR은 `ocr_unverified`, 나머지 선택도 `selection_unverified`로 남는다.

입력은 최대 40 members, UTF-8 텍스트 100,000 bytes, 4,096 blocks다. 결과는 최대 64 fragments이고 발췌/파생 텍스트 합계와 근거 인용문 합계를 각각 200,000 bytes로 제한한다. 겹치는 범위나 반복 근거가 작은 모델 JSON에서 수 MB의 원문 복제로 증폭되는 문제를 검토에서 발견해 두 한도를 추가했다. 검증기 버전은 `link-analysis-exact-source.v2`다. 초과 내용을 조용히 잘라 저장하지 않는다.

Gemini 전송 스키마는 지원 subset으로 보내고 문자열 길이 등의 엄격한 검증은 로컬에서 다시 수행한다. `const` 대신 단일 `enum`을 사용했다. [Gemini GenerateContent JSON Schema 지원 목록](https://ai.google.dev/api/generate-content)과 [구조화 출력 지침](https://ai.google.dev/gemini-api/docs/structured-output)을 확인했다.

### 분명한 제한

- 현재는 **수동으로 지정한 외부 텍스트** 분석이다. 스크린샷·영상·오디오를 이 실행기로 OCR/전사하거나 외부 URL을 fetch하지 않는다. 같은 스냅샷의 미처리 첨부는 유지하고 부분 처리로 기록한다.
- 줄 안에 프롬프트와 negative prompt가 같이 있으면 해당 줄 전체가 미검증 후보다. 줄 안의 정밀 분할/수동 범위 선택은 후속 UI 범위다.
- 구조 검증은 AI 요약 문장의 의미적 진실을 증명하지 않는다. `AI 해석 후보` 표시·근거·사용자 확인과 개인 속성/사건으로 자동 승격하지 않는 구조가 안전 경계다.

## 3. 비동기 저장과 동시 변경

`D1LinkAnalysisRepository.enqueue`는 명시 요청 시에만 `link_analyze` 작업을 만든다. 식별자는 문서·revision·snapshot·manifest와 분석 계약/정확 입력 hash에 결합된다. 일반 Capture의 `ai_enabled`를 켜거나 기존 outbox를 개인 분석용으로 재사용하지 않는다.

`runNextLinkAnalysisJob`은 기존 main analyzer runtime governor와 lease를 사용한다. 할당량 제한 시 제공자를 호출하지 않고, 최종 provider lease 획득 직전에 최신 revision·snapshot·manifest·소유권·공개/잠금 상태를 확인한다.

저장에서도 실행 중인 job/run·유일 lease owner·유효 invocation lease·최신 문서 상태를 같은 D1 batch에서 검사한다. 빈 결과도 assertion을 거치므로 실패한 CAS에 조각이나 게시 포인터만 남지 않는다.

- 새 snapshot 뒤 도착한 성공 결과는 과거 스냅샷의 `superseded` 후보/`stale` run으로만 저장한다.
- 유효한 새 결과만 `published_link_run_id`를 바꾼다. 기존 사용자 확정값이나 본문은 갱신하지 않는다.
- 오래된 실패/만료 복구가 새 snapshot의 Capture 상태·확인 항목을 덮지 않도록 별도 조건을 적용했다.
- 일반 분석이 나중의 문서 편집 등으로 다시 요청되더라도 `manualLinkV1` 자료가 있는 기록은 일반 개인 분석 입력에서 거절한다. 외부 저자의 글이 개인 사건·평점으로 처리되는 우회 경로를 막는다.
- 잠긴 restricted 기록의 전용 AI 분석은 이 버전에서 활성화하지 않는다. 서버에 원문 저장/조회 권한이 있다고 외부 제공자 전송 권한까지 가정하지 않는다.

## 4. 이동성

정본 버전은 `v2-031`이다. 이전 `v2-030` archive 지원, 문서 soft pointer ID remap, snapshot 부모 순서, 조각·근거 정규 FK, 변경 이벤트와 전체/증분 백업을 함께 갱신한다.

복원된 미완료 `link_analyze` 작업은 audit-only/superseded로 정규화한다. 오래된 DB ID를 포함한 실행 identity로 제공자를 자동 호출하지 않는다. 원래 archive/staged 원문은 별도로 유지한다. 복원 후 재분석은 복원된 현재 입력으로 새 명시 요청을 만들어야 한다.

복원 검증에서 계획 단계의 부모 정렬만으로 충분하지 않고 실제 적용 단계에서도 부모 행 존재를 확인해야 하는 문제를 발견했다. V1 재매핑 후 self-reference 정렬과 V2 적용 단계의 부모 존재 조건을 보강했다. 최종 회귀 결과는 아래 기록을 따른다.

같은 자료를 다시 복원할 때 `v2_documents.object_id`처럼 PK가 동시에 FK인 행을 독립적으로 fork하는 결함도 수정했다. 정규화된 내용이 같으면 부모 재매핑과 함께 재사용하고, 다르면 고립된 문서를 만들지 않고 명시적 conflict로 남긴다. 기존 archive와 staging 원문은 유지한다. 재사용 판정의 조회와 fenced batch 사이에 canonical 데이터 전체에 대한 새 CAS를 추가한 것은 아니므로, 모든 동시 변경의 선형화까지 입증한 결과로 읽지 않는다.

fragment의 확인 상태·사용자 잠금·stateVersion은 정본에 포함한다. 검토와 명시 분석 요청의 HTTP idempotency receipt 자체는 canonical archive에 포함하지 않는다.

## 5. 검증 기록

이 절의 수치는 최종 완료된 프로세스만 적는다. 전체 제품 release 증거와 혼동하지 않는다.

| 검사 | 현재 확인 결과 |
| --- | --- |
| 공유 전환 UI/로컬 입력 | 51번: 계약 12/12, 결합 브라우저 34/34, scoped axe/가로 넘침 0 |
| 정확 원문 AI 계약 | 40/40 PASS, 본문/근거 인용 증폭 방지·제공자 subset·원문/메모 분리 포함 |
| 링크 실행기 단위 계약 | 31/31 PASS, 대역 제공자·대역 저장소/governor. 실 제공자 아님 |
| D1 분석 저장 경로 | 15/15 PASS. 동시 요청 병합·활성 lease 보존·늦은 실패/종료·구 snapshot 만료 복구 포함. 기존 processing/legacy/owner 검사와 결합 39/39 PASS, exit 0, 334.29초. 후속 일반 분석 경합 수정의 재검증은 53번 |
| snapshot/migration 정본 | 최신 DDL foundation 18/18 PASS, 대상 lint 오류·경고 0 |
| backup/restore 기본선 | 첫 실행 4/6 PASS의 self-parent 실패/timeout 수정 후 8/8 PASS, exit 0, 659.90초 |
| 반복 복원 후속 수정 | PK=FK 경계 RED 재현 후 선택 4/4 PASS, exit 0, 341.12초. 별도 SQLite 4파일 15/15 PASS, exit 0, 3.37초. 앞의 기본선과 합산한 단일 최종 실행은 아님 |
| 수정 후 링크 이동성 결합 재검증 | `link-snapshot-portability.test.ts` **9/9 PASS**, 726.265초. 전체 unit/contract 실행 안에서 해당 파일의 모든 검사가 완료됐다. 전체 suite는 별도 실패/잔여 실행이 있어 PASS로 표시하지 않음 |
| 실제 repository/governor 실행 | 7/7 PASS, 로컬 SQLite/전체 schema와 대역 제공자. Wrangler 검사를 대체하지 않음 |
| 일반 분석 호환 회귀 | processing-pipeline 17 + analysis-reliability 16 + provider-invocation-lease 3 = 36/36 PASS, exit 0 |
| 타입·lint | 중간 typegen/tsc exit 0; 변경 파일 lint exit 0. 최종 통합 검사 별도 |

원격 배포, 실제 공급자, private corpus, 실기기 Share/PWA, 전체 Worker build, 제품 전체 회귀는 이 문서의 부분 검사로 대체하지 않는다.

## 6. 연결 작업과 후속 범위

1. 인증·CSRF·요청 크기 제한이 있는 snapshot/명시 분석 API와 Record 조회 projector를 연결했다. 최신 근거는 53번이다.
2. Record에서 확보 원문/미처리 자료/AI 해석 후보를 구분하고 정확 복사·확인·거절·근거 이동을 제공한다.
3. 원문 보강/선택 변경→snapshot 2→재분석 흐름의 데스크톱·모바일 브라우저 검증은 53번에 기록한다.
4. 프롬프트 순서/이미지 대응·조립본·저장 뷰/검색·허용된 공급자 수집·YouTube 흐름을 G06–G09에 따라 구현한다.

현재 수동 Capture의 일반 개인 분석 AI-off 보호는 유지한다. 전용 Record 분석 요청이 별도로 작업을 만들며, 검증 근거는 53번에 기록한다. 저장 기반·실행기만 구현된 것을 자동 정리 기능의 사용자-facing 완성으로 표시하지 않는다.

### 채택한 UI/API의 통합 계약

- API는 `/api/v2/records/[recordId]/links` 아래 조회·snapshot 생성·명시 분석·fragment 검토로 구현했다.
- `requireV2RequestContext(request, { mutation: true })`의 동일 origin/JSON 검사와 서버 세션·restricted grant를 사용한다. 클라이언트가 보낸 `restrictedUnlocked`는 권한으로 받지 않는다. 처리 전후 소유자·privacy·legacy 공개 상태를 다시 확인한다.
- Record의 개인 Knowledge 다음, 원본과 첨부 앞에 독립적인 링크 정리 패널을 둔다. 과거 snapshot은 읽기 전용이며 자동으로 현재 포인터를 바꾸지 않는다.
- 기존 `RecordSourceMaterials`의 고정된 “AI 분석 안 함” 문구는 실제 처리 상태를 받도록 바꾼다. 미처리 첨부와 현재 원문 분석 완료를 섞지 않는다.
- 외부 자료에는 기존 “내 기록으로 확인” Review API/UI를 재사용하지 않는다. 전용 `발췌 확인 / 해석 보관 / 거절`과 fragment stateVersion CAS가 필요하다. 해석을 보관해도 개인 사실·검증된 원문으로 승격하지 않는다.
- 첫 명시 요청의 중복 전송은 기존 입력 identity로 합친다. 실패·종료 후 같은 입력의 새 사용자 재분석은 기존 완료 결과를 덮지 않는 새 명시 attempt 계약으로 보강했다.
- 정확 복사, 근거 앵커, 409 시 새 입력 유지, URL-only/첨부 미처리, 빈 결과·quota·과거 결과, desktop/mobile 접근성·터치 영역을 브라우저 검증에 포함한다. 이미지 대응과 합쳐 복사는 G06이다.
