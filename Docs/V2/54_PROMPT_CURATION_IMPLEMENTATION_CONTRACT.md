# G06 · 프롬프트 정리본 구현 계약

결정일: 2026-09-08. 45·47·48번의 분할 프롬프트/이미지 대응 기획을 0031/0032 저장 구조에 연결하는 구현 계약이다. 수동 정밀 발췌와 정리본 저장·조회·이력·수정/undo·복사 DB/HTTP/UI를 구현했다. 이전 저장 결합317 PASS(pure75+parser141+Node SQLite34+HTTP64+workerd3)와 최종 정리본 UI48 PASS는 [58번](./58_MANUAL_FRAGMENT_STORAGE_AND_CURATION_PROGRESS.md)에 있다. **명시 snapshot 이관 API는 구현·검증 중**([60번](./60_PROMPT_CURATION_SNAPSHOT_MIGRATION.md))이며 실제 API/백업/V2 ZIP 복원 결합은 [59번](./59_PROMPT_CURATION_API_PORTABILITY.md)에서 별도 검증한다. 이관 UI·reload 내구성과 출시 전체 검증은 남는다.

## 1. 최소 완결 흐름

원문에서 정확한 범위 선택 → 역할별 조각 묶음 → 연결·순서 확인 → 보관 이미지 대응 → 버전 있는 정리본 저장 → 개별/이어 복사 → 이력과 되돌리기.

자동 수집, OCR, 영상 분석, 번역 생성, 이미지 생성은 이 흐름의 선행 조건이 아니다. G08/G09와 별도로 진행하며 구현하기 어렵다는 이유로 그 범위를 삭제하지 않는다. G06의 이미지 대응은 검증된 **전체 보관 이미지** 기준이다. 이미지 영역 편집은 후속 작업으로 구분한다.

## 2. AI 조각과 사용자 정리본을 분리한다

- 기존 fragment의 원문·display_order·AI evidence를 수정해서 사용자 정리 상태를 표현하지 않는다.
- 새 `정리본(curation)`은 한 문서·한 snapshot에 고정한다. 같은 snapshot 재분석이 사용자 순서·역할·이미지 대응을 변경하지 않는다.
- 연결 확인, 순서 확인, 이미지 대응 확인, 원문 확보 범위는 독립이다. 사용자 확인으로 잘림·OCR 미확인·전체 조각 수 미상을 지우지 않는다.
- `continuation`은 이어지는 조각, `collection`은 같은 자료 묶음, `alternatives`는 다른 판본이다. 같은 저자/인접 시각만으로 continuation을 확정하지 않는다.

## 3. 저장 구조

현재 로컬 additive migration은 `migrations/0032_v2_prompt_curations.sql`이고 정본 버전은 `v2-032`다. 원격 적용 완료를 뜻하지 않는다. 이후 재개 시에도 실제 migration 목록과 portability 계약을 확인한다.

| 테이블 | 책임 |
| --- | --- |
| `v2_link_curation_revisions` | 소유자·문서·snapshot, 안정 group key, revision/parent/based-on, 변경 사유, 제목, 관계/순서 확인, 보관 상태, 구분자, manifest |
| `v2_link_curation_items` | revision 안의 fragment, 안정 item key, 역할별 순서, 선택 당시 fragment stateVersion |
| `v2_link_curation_examples` | revision 전체 또는 특정 item과 같은 snapshot의 committed 이미지 member/attachment 연결·순서·사용자 확인 |

정본 내용은 append-only다. 수정·삭제 표시·확정·undo는 새 revision을 만든다. 별도 mutable head 테이블 없이 owner/document/group의 최대 revision이 최신 상태다. `(document_object_id, group_key, revision_number)`는 UNIQUE이며 parent는 같은 그룹·snapshot의 직전 revision이다. `based_on_revision_id`는 undo 또는 다른 그룹에서 가져온 근거의 정규 FK다.

item은 같은 소유자·문서·snapshot의 `source_extract`만 참조한다. `ai_interpretation`을 원문 조립에 넣지 않는다. 역할은 `prompt / negative_prompt / parameters` 중 원래 fragment 역할과 같아야 한다. 역할을 바꾸려면 새 수동 발췌를 만든다. 역할별 position의 연속성·중복을 검증한다.

예시는 같은 snapshot의 검증된 이미지 attachment만 허용한다. 조립본 전체 예시는 item ID를 null로 둘 수 있으나 다른 판본 묶음에서는 개별 item을 지정한다. UI는 `내가 연결한 예시`로 표시한다. 실제 이미지 생성에 사용된 프롬프트임을 증명한 것으로 표현하지 않는다.

구분자는 첫 버전에서 LF 1개로 고정한다. manifest에는 재매핑되는 DB row ID를 넣지 않고 안정 key·원문 범위/해시·역할/순서·이미지 해시·구분자·계약 버전을 넣는다. 전체 파트 수와 번호는 미상/원문 명시/사용자 지정 근거를 구별하며, 단순 배열 길이로 원문의 완전성을 계산하지 않는다.

## 4. 수동 정밀 발췌

현재 AI의 줄 단위 선택만으로는 `1/3:` 번호 제거와 같은 줄의 prompt/negative 분리가 불가능하다. 기존 원문을 고치는 대신 `POST /links/fragments`를 추가한다.

요청은 현재 revision/snapshot/manifest, member ID, UTF-16 start/end, 역할, 요청 키다. **클라이언트의 rawText는 받지 않는다.** 서버가 확인한 원문을 slice해 정확 문자열과 해시를 만든다. 이모지 surrogate pair 중간 범위, 빈 범위, 초과 범위, source/hash 불일치를 거절한다.

기존 fragment/evidence 테이블을 재사용한다. 수동 조각은 processing run null, source_extract, 사용자 선택 evidence다. 원문 확보 상태를 상속하며 범위 수정은 새 fragment 생성이다. Record에서는 수동 발췌와 AI 실행 결과를 별도로 조회한다.

## 5. 저장·이관·undo

정리본 저장은 현재 문서 revision/snapshot과 예상 그룹 head revision/version을 같은 batch에서 CAS한다. assertion → revision/items/examples → receipt가 한 번에 저장되거나 모두 롤백된다. 서버의 owner·privacy·legacy·lifecycle 경계를 조회와 쓰기 직전에 검사하며 클라이언트 권한 주장을 사용하지 않는다.

undo는 과거 상태를 복제한 새 revision이다. 이전 row 삭제나 head 되감기를 하지 않는다. 보관은 archived, 보관 해제는 active 상태의 새 revision을 추가한다.

새 snapshot의 `현재 자료로 가져오기`는 **명시적 새 그룹**을 만든다. member key/fingerprint·범위·원문/이미지 해시로 일치 후보를 제시하고, 사용자 확인 후 새 snapshot의 수동 fragment와 그룹 v1을 생성한다. 이전 그룹은 유지하고 based-on FK로 연결한다. 누락한 항목을 조용히 제거하거나 비슷한 자료로 치환하지 않는다.

이관 v1의 세부 결정:

- 명시 선택한 과거 revision을 원본으로 삼는다. 그 그룹의 최신 revision을 몰래 대신 사용하지 않는다. 이관 결과는 새 그룹의 active revision1, parent null, based-on은 원래 선택한 revision이다. 기존 그룹의 보관 상태와 모든 이력은 유지한다.
- 동일 member key가 있으면 fingerprint까지 같아야 한다. 그 key의 내용이 달라졌다면 다른 자료로 대체하지 않는다. key가 아예 없을 때만 동일 fingerprint의 **유일한** 후보를 제시한다. 같은 후보가 여러 개면 임의 선택하지 않는다.
- UTF-16 범위·원문 문자열/해시, 이미지 전체 해시/MIME/크기는 정확히 일치해야 한다. 첨부 목록 자체도 최종 SQL에서 확인한다. 원문 확보 상태가 달라지면 이관을 막으며 완전성 경고를 상향하지 않는다.
- 이관 v1은 전부 성공하거나 전부 거절한다. 누락·변경·모호한 항목을 나열하고, 근사 매칭·일부만 저장·모호한 후보의 수동 매핑은 지원하지 않는다. 사용자는 필요한 원문을 현재 자료에 다시 넣거나 일반 editor에서 별도 정리본을 만들 수 있다.
- 미리보기 GET은 저장하지 않는다. POST에는 현재 본문/자료/manifest, 미리보기 plan hash, 새 group key, 요청 키만 받는다. 서버가 다시 계획을 계산하고 확인한 plan과 같을 때만 처리한다. 클라이언트의 원문·manifest 본문·fragment proof·권한 주장은 받지 않는다.
- 한 원래 fragment를 여러 item에서 의도적으로 재사용했으면 새 수동 fragment는 하나, item은 모두 유지한다. 역할·순서·제목·관계/순서/이미지 확인 상태를 그대로 복사하며 AI가 고른 범위도 사용자 이관 확인 후 새 수동 선택 근거로 보존한다.
- AI의 `selection_unverified`는 원문 확보 범위와 다른 상태다. preview의 `selectionConfirmations`에 AI가 골랐던 item key들을 명시하고, UI는 POST 전에 이 범위의 확인 의미를 표시해야 한다. 새 수동 선택은 원래 source의 확보 상태를 상속한다. AI 선택 미확인만 해소할 수 있고 원문의 unknown/partial/OCR 경고·파트 미상·외부 전체 범위 미확인은 지우지 않는다. AI의 partial→truncated 표현도 같은 원문 partial 경고로 보존한다.
- owner/privacy·current revision/snapshot·새 그룹 부재·이전 원문/정리본·현재 후보 전체 원문/첨부를 같은 단일 SQL assertion에서 확인한다. assertion→새 manual fragments/evidence→정리본 revision/items/examples→receipt가 한 atomic batch다. 실패하면 모두 롤백한다.
- 응답 유실 재시도는 같은 요청 키를 사용한다. 저장 후 현재 자료가 더 진행되어도 원래 확인한 target snapshot과 selected revision에 결합한 receipt만 재생한다. 이전/새 원문과 권한을 다시 확인하고 기존 결과를 다른 최신 자료로 재이관하지 않는다.

## 6. 복사 계약

| 행동 | 내용 |
| --- | --- |
| 개별 원문 복사 | 해당 fragment 문자열만 그대로 |
| 이어 복사 · N조각 | 연결/순서를 확인한 continuation의 같은 역할만 저장된 LF 구분자로 결합 |
| 확보한 N조각만 복사 | 누락/전체 수 미상인 경우의 명시적 별도 행동. 미완전 경고 유지 |

순서가 미확정이면 기본 이어 복사를 비활성화한다. collection/alternatives를 하나의 prompt처럼 합치지 않는다. prompt/negative/parameters는 항상 별도 채널이며 제목·출처·설명·번역·code fence를 끼워 넣지 않는다. 중복 문장도 자동 제거하지 않는다.

조립 문자열은 원문 전체가 아니라 **원문 조각으로 구성한 파생 표현**이다. 서버가 계산한 정확 문자열·SHA-256·byte 수·경고를 사용자 복사 요청에 반환한다. 기존 출력 byte 예산을 적용하고 초과하면 명시적으로 거절한다. Record 첫 응답에 모든 이력의 조립 문자열을 중복 전송하지 않는다.

## 7. API와 화면

기존 `/api/v2/records/[recordId]/links` 아래에서 확장한다.

- `POST /fragments`: 수동 범위 발췌.
- `GET/POST /curations`: 정리본 목록/그룹 생성.
- `GET /curations/[groupKey]`: 선택 revision과 cursor 이력.
- `POST /curations/[groupKey]/revisions`: 수정·확정·undo·보관 상태 변경.
- `GET /curations/[groupKey]/revisions/[revisionId]/copy?channel=prompt`: 권한을 다시 확인한 파생 복사.
- `GET/POST /curations/[groupKey]/revisions/[revisionId]/migration`: 현재 자료로의 정확한 이관 미리보기/명시 확인 저장. 새 다섯 번째 route이며 검증 범위는60번이다.

위 네 정리본 route 파일은 현재 구현되어 있다. 요청은 서버가 재검증할 ID·기대 버전·선택/정렬 정보만 받으며 rawText·소유권·manifest 자체를 클라이언트 주장으로 받지 않는다. 64개 항목/64개 이미지 및 최대 길이 Unicode key를 수용하는 요청 본문 상한은 256,000 byte다. 새 저장은 201, 같은 요청의 안전한 재생은 200이며 모든 성공/오류 응답은 private, no-store다. 목록/이력은 페이지당 20개이고 커서는 owner·record·snapshot 또는 group scope에 결합한다. 이력 정렬은 시계가 역행해도 revision_number 기준이다. 불완전 복사는 `mode=available_only`의 명시 행동을 요구한다.

기존 Record 안에 원문 범위 선택, 역할별 정리 editor, 예시 이미지 선택, 저장 정리본 카드 네 책임을 둔다. 모바일 정렬은 드래그뿐 아니라 위/아래 버튼을 제공한다. 정확 복사와 불완전 상태 표시는 inspector나 hover에 숨기지 않는다. 다른 탭·409·네트워크 실패·늦은 저장 응답의 입력 보존은 G05의 남은 draft 내구성과 함께 검증한다.

현재 Record의 정리본 목록/editor/detail/이력·수정/undo/보관/정확 복사를 연결했다. 역할별 위/아래·중복 추가, 전체/항목별 예시, 관계/순서 확인, 출처 이동을 표시한다. 수동 발췌 저장은 열린 정리본 catalog에 알리며 요청 중 갱신은 완료 후 한 번 적용한다. 목록·이력·수동 조각은 cursor로 추가 조회한다. 과거 AI run을 보고 있어도 현재 snapshot의 수동 쓰기 capability가 있으면 정리할 수 있고 과거 snapshot은 읽기 전용이다.

409는 입력을 유지하고 현재 자료/선택 원문을 GET으로 확인한 뒤 별도 적용과 저장을 요구한다. 첫 페이지에 없는 수동 선택도 최대 64개 ID를 4개씩 병행 조회한다. 확인 후 props가 다시 바뀌면 그 응답을 새 기준으로 적용하지 못한다. 정확 원문/역할이 같은 candidate의 상태 버전을 선택과 중복 추가용 원문 catalog 모두에 갱신한다. 네트워크 응답 유실은 같은 요청 키로 재시도하며 401/403/423/record 404는 입력·목록·복사 fallback을 닫는다. 복사는 매번 서버의 정확 문자열/해시/byte 수를 검증한다.

명시 snapshot 이관 확인 UI도 연결했다. 원문/이미지 대응과 AI 선택 범위 확인 의미를 표시하고, 체크박스 후 별도 POST로 새 그룹을 만든다. 실패한 미리보기 재확인·닫기/열기는 같은 plan의 요청 키를 버리지 않는다. 409는 명시 재확인하며, 저장 뒤 부모의 해당 자료 버전으로 이동할 때 권한 거절이면 링크 원문과 입력을 폐기한다. [61번](./61_PROMPT_CURATION_MIGRATION_UI.md)에 현재 검사와 한계가 있다.

현재 입력과 이관 요청 키는 화면 메모리에서만 보존한다. 접기/펼치기는 유지하고 미저장 이탈 경고를 제공하지만 reload 복구·다른 탭 동기화·여러 미확정 이관의 독립 보존은 아직 보장하지 않는다. 현재 검증 범위와 실패 이력은 58·61번·CURRENT_WORK_STATE를 따른다.

## 8. 이동성과 범위

세 테이블의 canonical descriptor/FK closure/자기 참조 순서, 복원 owner/document/snapshot/attachment 검증, 변경 이벤트, full/incremental backup을 같은 변경에서 갱신한다. JSON ID 배열로 정규 FK를 대체하지 않는다. group/item key는 논리키이므로 DB ID처럼 재매핑하지 않는다.

정규화된 같은 그룹·버전의 내용은 재사용한다. 같은 논리 identity의 다른 내용은 명시적 conflict이며 임의 group key 변경이나 부모 없는 revision fork를 하지 않는다.

`portable + includeHistory=false`가 정리본의 과거 fragment/parent FK를 제외하는 경우에는 scope conflict로 중단하고 이력 포함을 안내한다. 제외 의사를 무시해 이력을 내보내거나 FK를 null로 바꾸지 않는다. 읽기용 텍스트 export와 정리 설정/undo를 복원하는 canonical export를 혼동하지 않는다.

## 9. 착수와 검증 순서

1. 원문 범위/조립 manifest의 순수 계약과 역순·누락·판본 혼합 fixture.
2. migration/정본 저장·owner/privacy/CAS·이동성. AI와 무관한 사용자 정리본 보호.
3. 인증 API와 Record 컴포넌트, 저장·정밀 선택·이미지 대응·undo·정확 복사.
4. 재분석/새 snapshot 이관/반복 복원/50건 이후 이력·목록을 포함한 결합 검증.

필수 실패 사례는 한 줄 prompt/negative, CRLF·공백·이모지 범위, 알려진 2/3과 전체 미상, 다른 작성자/판본, 일대다/다대다 이미지, foreign owner/snapshot·미보관 이미지, privacy 변경 후 receipt 재생, 동시 편집·늦은 응답, 복사 실패다. full→수정/undo→incremental→새 DB 복원 및 같은 자료 반복 복원을 통과해야 한다. 합성 fixture 통과와 실제 개인 자료/제공자 검증은 분리한다.

## 10. 순수 계약 구현 현황

`src/lib/v2/domain/prompt-curation-v1.ts`의 `extractManualPromptFragment`, `preparePromptCuration`, `copyPromptCuration`을 구현했다. 서버가 검증한 source catalog를 전제로 정확한 slice/hash, 역할별 순서/관계, 안정 manifest, 명시적 미완전 복사를 처리한다. 원문 합계 100,000 UTF-8 byte와 역할별 출력 합계 200,000 byte 예산을 적용하며 초과분을 잘라 저장하지 않는다.

전용 `prompt-curation-v1.test.ts` 첫 **67/67 PASS**, 두 파일 ESLint 오류/경고 0이다. 3→1→2 순서, 2/3·전체 미상·상충, 같은 줄 역할 분리, CRLF·공백·이모지, 중복 원문 보존, alternatives 이어 복사 차단, 이미지 대응 경고를 검증했다.

독립 `prompt-curation-review.test.ts`에서 5 RED/3 PASS를 확인했다. 해시 계산 await 중 source/selection/fragment 변경 4건과 source 1/2의 prompt·2/2의 negative를 모두 선택해도 각 역할에 missing을 붙이는 판정 1건이었다. public 진입에서 전체 plain 입력을 첫 await 전에 방어적으로 복사하고, 파트 확보 범위를 **모든 역할에 선택된 source**로 계산하도록 수정했다. 미선택 catalog 자료는 누락을 채우지 않는다. 연결·순서 확인 후 정확 원문을 복사할 때도 selection_unverified·미확인 이미지 대응 경고 및 externalScope=unverified는 유지한다.

수정 후 기존 67 + 독립 8 = **75/75 PASS**다. API 정책 21 + SSR 정책 12와 4파일 결합 실행은 **108/108 PASS**, exit 0, 13.69초였다. 이 후속 변경의 전체 lint/Worker는 현재 상태 문서를 따른다.

위 순수 단계는 DB owner/snapshot/committed attachment 검증을 대신하지 않는다. 후속 수동 발췌와 정리본 저장/HTTP·실제 로컬 D1 및 UI 검증은 58번에 기록한다. 실제 OS clipboard·reload 내구성·명시 snapshot 이관·새 API 통합 이동성은 미완료다.
