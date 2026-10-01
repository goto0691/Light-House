# G06 · 이관 검토 초안과 중단 요청 복구

2026-09-12 구현 checkpoint. [61번 이관 UI](./61_PROMPT_CURATION_MIGRATION_UI.md)의 메모리 전용 계획/요청을 기존 기기 복구 세션에 연결했다. [67번](./67_EXACT_HISTORICAL_AI_EVIDENCE.md)의 과거 증거 조회를 다시 구현하지 않는다. 전체 goal은 active이며 이관 그룹 이동성·삭제 증분·G07–G11은 남는다.

## 보존 계약

- `prompt-curation-migration-draft.v1`: `contract`, `phase: review | pending`, `plan`, `request`만 저장한다. 원래 source group/revision/snapshot/정리본 manifest, target document revision/snapshot/manifest, plan hash, 새 group key와 최초 idempotency key를 고정한다.
- 확인 checkbox, 권한/grant, 전체 source/target·history·이미지 bytes, 오류·saved·UI key는 저장하지 않는다. bounded own-data parser는 동기로 중첩 값을 복사한다. items/examples/confirmation은 각각 64개, issues는 129개이며 중복 item key·상충 참조·ready/pending 모순·알 수 없는 필드를 거절한다. 동일 fragment를 여러 item에서 재사용하는 의도적인 중복은 보존한다.
- scope는 원래 계획과 요청 identity를 포함하며 review→pending 변경만으로 다른 초안이 되지 않는다. 다른 계획·요청은 기존 초안을 독립 park한 뒤 시작한다. 기기 저장을 끈 상태에서 안전한 park가 불가능하면 기존 입력을 유지한다.

## 사용자 흐름과 권한

- 별도 `migration` recovery session과 복구 영역을 사용한다. 현재 선택한 정리본 detail 없이도 복구할 수 있다. 기기 사본 목록은 원문을 자동 노출하지 않으며 명시 복구는 POST/AI를 실행하지 않는다.
- 복구 시 인증된 정확 source revision GET과 원래 target snapshot GET을 병렬로 읽는다. plan digest·원문 범위·hash·역할·이미지 대응을 검증한 뒤 확인란을 해제한 새 검토 화면을 표시한다. 실패한 사본은 유지하고 명시 재확인을 제공한다.
- 기존 `assertMigrationPreview`/`assertMigrationReceipt`는 최신 target 조건을 유지한다. 새 `assertMigrationRecovery`/`assertMigrationRecoveryReceipt`만 최초 request basis를 받아 과거 target의 증거를 검증한다. 실제 DTO의 current 필드를 옛 값으로 위조하지 않는다. 선택된 target 최대 40개 member만 검증에 캡처하고 무관한 history/catalog를 제외한다.
- 저장은 pending 동기 stage→허용된 durable flush→fresh exact evidence→최초 body POST→strict receipt→그 token의 기기 사본 정리 순서다. 이미 committed인 old pending은 서버의 기존 receipt-before-current-CAS 경로로 재생하며, 미저장 stale pending은 409로 유지한다. 새 미리보기는 기존 pending을 park하고 다른 계획일 때만 새 키를 만든다.
- 401/403/423/record404는 정리본·이관 평문을 닫고 두 세션을 suspend한다. 접근 복구 뒤 숨겨진 초안은 명시 재개해야 열린다. sensitive는 별도 암호화 동의, restricted는 기기 저장 금지라는 기존 정책을 유지한다.
- 첫 일반 오류 뒤 도착한 권한 거절은 `authorizedReadBatch`가 우선 처리한다. 독립 리뷰에서 target HTTP 200 locked body가 배치 밖에서 해석되어 source503에 가려지거나 미응답 source를 기다리는 문제를 발견했고, 실제 RED 재현 후 target promise 내부에서 typed denial로 변환했다.

## 오케스트레이션과 현재 검증

root는 UI·실행 자원·통합 검증을, exact_ai_evidence_review는 parser/순수 시험을, curation_evidence_client_review는 응답 검증기/독립 UI 리뷰를, migration_recovery_browser는 새 브라우저 시나리오를 맡았다. 공유 파일의 동시 작성은 하지 않았다. 최종 실행 결과는 아래에 구별해 남긴다.

| 실행 | 결과 | 범위/한계 |
| --- | --- | --- |
| agent parser 32186 | 104 PASS, exit 0, 1.54초 | 순수 planner roundtrip·상한/변조·own-data. lint85549 exit 0 |
| agent response | 100 PASS, exit 0, 2.24초 | 기존42+복구58. lint51877 exit 0 |
| root 순수 결합, 17:29 | 242 PASS, exit 0, 3.09초 | parser104+response100+session29+batch9. agent 결과와 중복 합산하지 않음 |
| root 기존 이관 68405 | 40 PASS, exit 0, 1.8분 | desktop/mobile 기존 미리보기·저장·권한·320px. redacted 경합 수정 전 |
| root redacted RED 77869 | 2 FAIL, exit 1 | source503이면 일반 오류만 표시, source held이면 권한 거절 표시가 없음. 실제 screenshot/trace 보존·root 직접 이미지 확인 |
| root 타입 | 47459 exit 0; 8061 exit 1; 91515 exit 0 | 8061의4오류는 새 시험의 readonly DTO 직접 변조. Object.assign으로 시험 의도를 유지하고 최종 타입 통과 |
| root scoped lint 2070 | exit 0 | 제품/시험7파일. 선행 rg의 cwd 경로 오류는 lint 결과와 별개 |
| root 최종 타입/lint | 53650 typecheck exit 0, 18984 scoped lint exit 0 | 시각적 제목/heading 보완 포함 최종7파일 |
| canonical 보완 후 타입/lint | 58196 typecheck exit 0, 69149 파일 lint exit 0 | 제품 변경 없이8번째 시험파일까지 포함 |
| canonical 순서 RED→보완, 17:40 | 처음 1P/2F exit 1(1.57초) → 3 PASS exit 0(1.47초) | 실제 Node SQLite에0032 적용·두 curation self-FK 기대값·canonical table 존재 검사. 제품 SQL/registry 변경 없음 |
| root 새 복구 5510 | 54 PASS, exit 0, 4.9분 | desktop/mobile 27개씩. 최초 redacted RED2 포함. 화면 제목 보완 전 |
| root 최종 결합 36181 | **90 PASS, exit 0, 8.4분** | 편집/이관 복구의 시각적 제목 구분 및 heading hierarchy 보완 후, 새 이관54+기존 정리본36 |

RED 산출물: `apps/web/test-results/curation-migration-redacted-red`. 새 복구 산출물: `apps/web/test-results/curation-migration-durable-first`. 실제 React/IndexedDB/Chromium과 HTTP/정책/receipt 대역 검사이며 원격 D1/실제 provider/실기기/OS Share 성공을 주장하지 않는다. 서버 SQL·schema·migration·원격 운영은 이번에 변경하지 않았다.

## 남은 작업

최종 browser90개를 검증했다. 다음은 이관된 `basedOnRevisionId` 그룹의 ZIP/full/delta/fresh/repeat 복원과 삭제/tombstone 증분이다. 전체 suite·secret-safe Worker·공급자·운영 gate는 전체 통합 후보에서 별도 검증한다.

읽기 전용 후속 조사와 root의 코드 대조로 다음 실행 범위를 구체화했다. 첫 순서 fixture만 실제 검사·보완했고, 나머지는 실행 PASS나 제품 결함 확정이 아니다.

- `canonical-restore-order.test.ts`의 migration0031/현재0032 registry 불일치와 큐레이션 `parent_revision_id`/`based_on_revision_id` 기대 목록 누락은 root가 실제 실패를 재현한 후 보완했다. canonical table 존재 검사도 추가하여 최종3 PASS다. 이를 다시 선행 과제로 반복하지 않는다.
- `resumable-restore-self-reference.test.ts`는 object 참조만 검사한다. 이관 그룹의 cross-snapshot based-on 증거로 대체하지 않는다.
- 기존 `prompt-curation-api-portability.test.ts`의 실제 HTTP/V2 full/delta/ZIP/fresh/repeat 구조를 재사용한다. S1 원본 A와 **full 전에 존재하는** 독립 삭제 대상 T를 생성→full→실제 S2 이관 B→T 삭제→delta→canonical46테이블/ZIP 비교→fresh/repeat restore와 GET/copy 검증을 추가한다. B의 원본 A는 삭제하지 않는다.
- 기존 `prompt-curation-portability.test.ts`의 transient는 full 이후 생성/삭제되어 base-present tombstone 제거를 증명하지 못한다. archive와 실제 삭제를 혼동하지 않는다.
- `resumable-restore-v2.ts`의 tombstone은 `v2_restore_rows` 스테이징에서 제거되고 최종 apply는 reuse/insert다. 따라서 삭제가 반영된 **백업 상태를 fresh 복원하고 동일 결과를 반복**하는 계약을 검증한다. 기존 사용자 DB를 강제 삭제하는 동기화 기능으로 확대하지 않는다.
- registry의 두 self-reference·정확 논리키/owner·원본 FK 재매핑과 V2 delta event 매핑은 이미 있다. 역순 ID·누락/다른 owner·충돌 PK 경계부터 빠르게 검사하고, 긴 workerd 왕복은 단일 자원 창에서 수행한다. 실제 RED가 확인된 제품 경로만 수정하며 한도/timeout을 낮추지 않는다.

## 실행 명령과 지문

아래 명령은 `apps/web`에서 실행했다. 새 라우트/서버 schema 변경이 없어 typegen/Worker 전체 빌드를 반복하지 않았다.

```text
npm run test -- --maxWorkers=1 tests/contract/v2/prompt-curation-migration-draft.test.ts tests/contract/v2/prompt-curation-migration-response.test.ts tests/contract/v2/link-draft-session.test.ts tests/contract/v2/authorized-read-batch.test.ts
npm exec -- playwright test tests/e2e/v2-prompt-curation-migration.spec.ts --output=test-results/curation-migration-durable-baseline
npm exec -- playwright test tests/e2e/v2-prompt-curation-migration-recovery.spec.ts --grep "redacted target" --project desktop-chromium --output=test-results/curation-migration-redacted-red
npm exec -- playwright test tests/e2e/v2-prompt-curation-migration-recovery.spec.ts --output=test-results/curation-migration-durable-first
npm exec -- playwright test tests/e2e/v2-prompt-curation-migration-recovery.spec.ts tests/e2e/v2-prompt-curation-recovery.spec.ts --output=test-results/curation-migration-durable-final
```

agent 소유4파일은 root가 실제 코드를 읽고 동결 지문 일치를 확인했다. 아래 root 최종 코드/시험8파일은 2026-09-12 17:47:00 KST 재해시 불일치0이다. 변경 문서5개의 로컬 파일 링크96개 누락0, 포트3100 listener0·workerd0, diff whitespace 검사 exit0을 확인했다. 마지막 문서 결과 반영은 코드 지문을 변경하지 않는다.

root는 RED screenshot과 최종 모바일320px의 실제 migration-recovery-320.png를 직접 확인했다. 편집/이관 복구 제목, 원문 줄바꿈·경고·확인 버튼·가로 넘침 없음은 해당 합성 화면 범위다. 최종90개는 키보드/axe와 데스크톱·모바일 상호작용을 포함한다. 모든 root/agent 실행 핸들은 종료됐고 원격/기존 데이터 변경은 없다.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/components/v2/record-prompt-curations.tsx` | `DC35503FC94AADA3E47792099882816F79175879585794D410AB88591107D72A` |
| `apps/web/src/components/v2/prompt-curation-migration.tsx` | `D479843C94B665B096A78E0BFDBA1A5F4EA262E6A6C066C4BC91674445CEB4C4` |
| `apps/web/src/lib/v2/editor/prompt-curation-migration-draft.ts` | `EFF8EB4E8E7E52E69C0CB6D506108BD0DACC5017ED667FFBE7DA5495B4259DA1` |
| `apps/web/src/lib/v2/domain/prompt-curation-migration-response.ts` | `8CF432E95AB79B4F0236A052025E6A00AE68C6B9A84494B3357CDAD00F9B52B4` |
| `apps/web/tests/contract/v2/prompt-curation-migration-draft.test.ts` | `C2F882DD2088163B9AFFDA26B7A54630AD9AA1CD5E4F46499F62B2DAAF23C21E` |
| `apps/web/tests/contract/v2/prompt-curation-migration-response.test.ts` | `745DB2A50E462723E44F18987479C4672AA42B6C54677421801641017C51F659` |
| `apps/web/tests/e2e/v2-prompt-curation-migration-recovery.spec.ts` | `376F43A0D69D7CECBCA69BD2E40A7F53D4D77598458FA11905C2E275FD3018AE` |
| `apps/web/tests/contract/v2/canonical-restore-order.test.ts` | `962C2F4C2ECFCAE20C9B2798F09E41C41C27818F775CAAD321C0196E0DF48CDE` |
