# 정리본 편집·미확인 요청 복구와 엄격한 저장 응답 검증

2026-09-09 02:39 KST 당시 checkpoint. [65번 순수 계약](./65_PROMPT_CURATION_DRAFT_CONTRACT.md)을 실제 정리본 화면에 연결했다. 아래 검사/해시는 당시 이력이다. 후속 [67번](./67_EXACT_HISTORICAL_AI_EVIDENCE.md)에서 과거 AI 실행의 정확 근거 조회와 병렬 권한 오류 처리를 연결했다. 전체 goal은 active, [완료 기준 추정치](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)는 약48%이며 이관 초안 복구는 아직 남는다.

## 실제 연결

- Record에서 owner/record identity와 접근 철회 callback을 전달하며 해당 identity로 workspace를 분리한다. 정리본을 처음 열 때 복구 정책을 확인한다.
- 제목·관계·역할별 순서·중복 itemKey·이미지 대응·선택 originals와 원래 basis/group/head를 함께 보존한다. 빈 제목·미완성 이미지 연결도 초안으로 유지하되 유효한 요청 전까지 저장하지 않는다.
- create/edit뿐 아니라 `draft=null`인 undo/archive/unarchive의 완전한 pending도 복구한다. 복구/방문은 자동 POST·AI 호출을 하지 않는다.
- 미확인 요청 중 편집은 잠근다. 재시도는 원래 key/body를 사용하며 현재 문서나 snapshot으로 자동 치환하지 않는다.409 뒤의 최신 상태 적용도 이전 사본을 park한 다음 명시 실행한다.
- 다른 새/기존 정리본을 열 때 현재 초안을 먼저 park한다. 보존이 꺼졌거나 실패하면 전환을 중단한다. `초안 보존하고 편집 닫기` 뒤에는 목록의 명시적인 `이 기기 사본 삭제`로 삭제할 수 있다. 미확인 transition도 별도로 보존하고 닫을 수 있다.
- 인증/권한/잠금/기록 삭제 오류는 캐시와 입력을 숨기고, 복구 session은 suspend한다. 재인증 후 명시적인 숨긴 입력 다시 열기를 제공한다. opt-out/restricted 입력을 강제로 기기에 저장하지 않는다.
- normal은 기기 복구 기본 켜짐, sensitive는 화면별 명시 동의 후 암호화, restricted는 기기 저장 금지다. 기존 공통 저장소·generation·정책 경계를 사용한다.

## 요청과 receipt 검증

1. 원래 요청을 stage/flush한다. 복구를 켠 상태에서 기기 보존이 실패하면 POST를 멈추고 입력을 유지한다. 사용자가 직접 복구를 끄면 서버 저장은 가능하다.
2. 원래 snapshot GET, revise의 정확 parent GET, undo의 정확 restore target GET을 새로 인증한다. 선택된 manual fragment는 최대64개를 동시4개씩 조회한다. 현재 candidate 첫 페이지가 증거를 대신하지 않는다.
3. 동일 key/body로 POST한다. 서버의 기존 receipt-before-current-CAS, 소유자/잠금/원자적 batch 계약은 변경하지 않았다.
4. `assertPromptCurationReceipt(value,{recordId,pending,snapshot,parent,restoreTarget,manualFragments})`로 정확 원문/범위/역할, 요청 content, snapshot/group/parent/undo 전이, 이미지 연결, manifest와 prepared 채널 전체를 검증한다.
5. replay이면 그룹의 실제 최신 head도 새로 읽는다. 옛 receipt를 최신 버전으로 표시하거나 현재 snapshot 목록에 옛 그룹을 끼워 넣지 않는다.
6. 검증된 요청의 immutable token만 기기 사본 정리에 사용한다. 복구 원본/해당 active generation만 정리하고 다른 그룹/새 입력/늦은 응답의 사본은 지우지 않는다.

helper는 DB가 fresh 응답과 replay에서 반환하는 content 배열의 표현 순서 차이를 itemKey/role-position 의미로 비교한다. 텍스트·중복·실제 조립 순서는 변경하지 않는다. 선택 snapshot 증거와 무관한 availableSources/이력 페이지는 descriptor 검사 뒤 캡처에서 제외한다. 오랫동안 누적한300개 자료 때문에 작은 정리본의 receipt 검증이 실패하지 않는다.

## 신뢰 경계·미완료 항목

- fresh authenticated GET도 브라우저 쪽 검증이 서버 소유자/DB proof를 대체한다는 뜻은 아니다. projection에 생략된 source fingerprint/전체 metadata와 idempotency key의 실제 receipt 결합은 repository의 책임이다.
- 당시 create pending에 사용한 AI 실행이 최신 projection에서 사라지고 기존 parent도 없으면 pending을 유지했다. 후속67번은 정확 fragment ID로 과거 run을 인증 조회한다. 여전히 cache 원문에서 범위를 추정하지 않고, 정확한 근거가 없으면 pending을 유지한다. 기존 draft 계약은 runId를 보관하지 않는다.
- 기존 migration preview/재시도 UI는 유지했지만 source/target/plan/key의 durable recovery 연결은 아직 없다. 확인 checkbox를 자동 복구하지 않는 별도 migration draft 계약이 필요하다.
- provider 호출·원격 D1/R2·workerd·전체 suite·Worker package는 이번 변경에서 실행하지 않았다. 이미지 시험은 합성 attachment membership/로컬 응답이며 실제 R2 bytes 검증이 아니다.
- 기존 schema/서버/환경/자격 증명/사용자 원문은 변경하지 않았다.

## 오케스트레이션·검증

root는 실제 UI·parent 연결·공통 취소/저장소·브라우저 시험·통합·문서를 소유했다. `link_ui_implementation`은 strict receipt helper/실제 SQLite 시험2파일을 병렬 작성해01:59:08 KST 동결했다. 이후 읽기 검토에서 발견한 정책 세대 경합은 session/시험2파일로 별도 위임해02:13:22 동결·인수했다. Next/dev/Playwright/typegen/build는 root만 실행한다. 다른 agent의 알려진 사용 한도 오류는 반복하지 않았다.

### 독립 검토에서 발견한 경합

1. **권한 회수 직후 unmount 저장**: parent의 423 응답으로 편집을 닫더라도 공통 hook의 일반 navigation cleanup이 옛 ready 정책으로 평문을 flush했다. 실제 브라우저 RED는 generation3→4의 잘못된 증가였다. owner/record별 동기 취소 알림을 먼저 전달하고, suspend에서 debounce와 진행 중 저장의 AbortController를 중단한다. IndexedDB transaction도 abort signal로 rollback한다. 정상 navigation은 그대로 보존하며 다른 기록에 취소를 전파하지 않는다. 서버 privacy 수준을 임의로 바꾸거나 이미 확정된 사본을 삭제하는 동작이 아니다. 200 응답의 redacted locked projection도 권한 회수로 처리한다.
2. **정책만 바뀐 pending의 잔존**: 저장 응답을 기다리는 사이 baseVersion/privacy가 갱신되면 generation만 증가해, 성공 후 사본 정리가 옛 세대에만 적용되고 미확인 요청이 다시 나타날 수 있었다. agent RED2건 후 session token에 별도의 stage identity를 결합했다. 동일 frozen payload·scope·ID·origin인 정책 갱신만 최신 세대까지 정리한다. 실제 새 입력(내용이 같아도 포함)은 보존하며, cleanup await 도중 또 정책이 바뀌면 명시 실패하고 같은 token으로 재확인한다.
3. **parent의 보조 요청 경로**: 이력 더 보기 GET와 analyze/review의 권한 오류가 기존 refresh와 달리 입력을 닫지 않는 누락을 확인했다. root58120의 실제 이력 GET 200 locked RED는 정리본 영역 expected0/actual1로 실패했다. 모든 parent 요청에 공통 응답 검사·늦은 요청 fence를 연결하고 agent 작성20시나리오(양기기40)를 기존 링크/snapshot/이관과 결합 검증했다. 권한 없는 이력 응답은 빈 페이지로 병합하지 않는다.

독립 후속 읽기에서는 공통 async helper의 검증 후 반환과 호출부 적용 사이의 microtask 경계를 추가 지적했다. 이는 **정적 검토**이며 실행 RED로 주장하지 않는다. 호출부에도 적용 직전 동기 sequence 검사와 이력 updater fence를 유지하고, analyze/review도 새 refresh를 시작하기 전에 재확인한다. 관련 최종 후속 결과는 아래에 구분한다.

동기 취소 registry 시험에서 stale unsubscribe가 새 구독 목록까지 지우는 1건도 RED로 드러나 같은 Set일 때만 삭제하도록 수정했다. 추가 store 시험은 시작 전 취소, 암호화 도중 취소, IDB put 성공 뒤 commit 전 취소의 rollback을 확인한다. 전체 서버 권한/기기 백업 검증이 아니라 로컬 취소 범위다.

| 검사 | 최종 결과/시점 | 범위·실패 이력 |
| --- | --- | --- |
| 최초 실제 정리본 UI | root34364 **84/84 PASS**,exit0,6.5분 | 새 복구36+기존48,desktop/mobile.320px PNG 확인·scoped axe·키보드. 후속 missing-record 분기 보완 전 |
| 누락 기록 오류 RED | root53338 **1 FAIL**,exit1 | `/links`의 실제 `link_record_not_found`를 접근 철회로 처리하지 않는 누락 재현.01:59 UI 오류 분류 보완; 후속 결합에서 재검증 |
| 새 receipt/draft 계약 | agent **199 PASS**,exit0,2.89초 | 실제 LinkSqlite receipt109+기존 draft90. 초기 SQL 시험 컬럼 오류1건은 실제 document save 경로로 고침 |
| root 계약 결합 | root7850 **241/241 PASS**,4파일,exit0,02:01:04/7.58초 | receipt109+draft90+session16+IDB store26. agent199와 중복 합산 금지 |
| 타입 | root48586 **exit0** | 최초1288 새 browser 시험 readonly mutation4건,95367 agent 작성 중 fixture implicit-any2건은 시험만 보완 후 해소 |
| scoped lint | root16279(6파일),99731(7파일),agent helper2파일 **exit0** | 마지막 root 범위는 새 boundary 시험 포함. 전체 lint 아님 |
| 후속 브라우저 결합 | root34500 **100/100 PASS**,exit0,5.0분 | boundary12+기존 이관40+snapshot24+링크24. 공통 경합 수정 전 결과 |
| parent revoke RED→후속 | root15021 **1FAIL**,exit1 → root33854 **2PASS**,exit0,17.5초 | 423의 desktop/mobile. 후속 200 locked 시험은 아래 공유 복구 결합에 포함 |
| 공통 session 경합 | agent RED **2FAIL**,exit1 → **58PASS**,exit0,1.20초 | session29+store29, 2파일 lint0. fake-indexeddb이며 브라우저 결과가 아님 |
| 취소 registry/store | root 초기 **32P1F**,exit1 → **33PASS**,exit0,1.08초 | registry4+store29. stale unsubscribe 제품 수정 후 전 파일 재검사 |
| 최종 계약 결합 | root2366 **261/261 PASS**,5파일,exit0,02:17:23/7.77초 | receipt109+draft90+session29+store29+registry4. 앞선 241/58/33과 중복 합산 금지 |
| 경합 보완 후 타입/lint | root57609 typecheck **exit0**,root27713 scoped16파일 lint **exit0** | parent 보조 경로의 후속 수정 전. 전체 lint/Worker 아님 |
| 공유 복구 브라우저 | root44976 **144/144 PASS**,exit0,9.8분 | 정리본 복구36+boundary18+수동60+snapshot24+세션6. 마지막 parent 보조 요청 수정 전 |
| parent 보조 경로 RED | root58120 **1FAIL**,exit1,7.9초 | snapshot history200 locked 뒤 정리본 영역이 남는 제품 결함. 공통 권한 검사로 수정 |
| parent 결합 | root23769 **128/128 PASS**,exit0,5.9분 | 신규 parent40+기존 링크24+snapshot24+이관40. 적용 직전 추가 fence 보완 전 |
| parent 타입/lint | root92952 typecheck **exit0**,87528 scoped2파일 lint **exit0** | 공통 권한 검사 후, 적용 직전 추가 fence 보완 전 |
| 적용 직전 fence 최종 후속 | root96567 **88/88 PASS**,exit0,4.5분 | 신규 parent40+기존 링크24+snapshot24. 다른 실행과 중복 합산 금지 |
| 최종 타입/lint | root78818 typecheck **exit0**,17713 scoped2파일 lint **exit0** | 추가 fence·신규 parent 시험을 포함한 최종 상태 |

dev stream의 snapshot reload 도중 `The destination stream closed early`를100개 결합에서1회·144개에서2회·최종88개에서1회 관찰했다. 해당 assertion 통과와 별개로 런타임 로그 무오류라고 보고하지 않는다. 기존 middleware deprecation·NO_COLOR 경고도 남는다. 전체 suite·최종 Worker는 별도 G10의 미완료 검증이다.

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-receipt.test.ts tests/contract/v2/prompt-curation-draft.test.ts tests/contract/v2/link-draft-session.test.ts tests/contract/v2/link-working-copy.test.ts
npm run test:e2e --workspace @light-house/web -- v2-prompt-curation-recovery.spec.ts v2-prompt-curations.spec.ts --output=test-results/curation-recovery-initial
npm run test:e2e --workspace @light-house/web -- v2-prompt-curation-recovery-boundaries.spec.ts v2-prompt-curation-migration.spec.ts v2-link-snapshot-recovery.spec.ts v2-link-analysis.spec.ts --output=test-results/curation-recovery-integration
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-receipt.test.ts tests/contract/v2/prompt-curation-draft.test.ts tests/contract/v2/link-draft-session.test.ts tests/contract/v2/link-working-copy.test.ts tests/contract/v2/link-draft-access.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-prompt-curation-recovery.spec.ts tests/e2e/v2-prompt-curation-recovery-boundaries.spec.ts tests/e2e/v2-link-snapshot-recovery.spec.ts tests/e2e/v2-manual-fragments.spec.ts tests/e2e/v2-link-draft-session.spec.ts --output=test-results/curation-recovery-final
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-link-parent-access-boundaries.spec.ts tests/e2e/v2-link-analysis.spec.ts tests/e2e/v2-link-snapshot-recovery.spec.ts tests/e2e/v2-prompt-curation-migration.spec.ts --output=test-results/curation-parent-access-final
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-link-parent-access-boundaries.spec.ts tests/e2e/v2-link-analysis.spec.ts tests/e2e/v2-link-snapshot-recovery.spec.ts --output=test-results/curation-parent-apply-fence-final
npm run typecheck --workspace @light-house/web
```

## 인수 hash

root가01:59 receipt2파일과02:13 session2파일,02:26 parent 시험1파일을 인수해 전체 읽기·해시를 확인했다. 아래17파일은 이 checkpoint의 최종 제품/시험 해시이며, 과거62–65번의 당시 해시를 덮어쓴 것이 아니다. 실행 중 root/agent 작업은 모두 종료했다.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/lib/v2/editor/prompt-curation-receipt.ts` | `488D546BBC0BD25460B9186AF2CB555E85D142A5358C0BE50015E833CBA632F6` |
| `apps/web/tests/contract/v2/prompt-curation-receipt.test.ts` | `10192F73B02999A3056E17E260A23E2EE78B57AFDA35720652AE8110418DB883` |
| `apps/web/src/lib/v2/editor/link-draft-session.ts` | `F03B382F9D102D7A1370E9C57F717BB98C2392D86E3D24DC5162B767387FE760` |
| `apps/web/tests/contract/v2/link-draft-session.test.ts` | `5A04826C99619810722F51179A9F80B44FA13F426D04B7F5E156DF23DC1D864E` |
| `apps/web/src/components/v2/record-prompt-curations.tsx` | `62886F9C269E24DF082F9B8EE90B253F0C5B6E8A00E6B25B0FDB5330B9B26855` |
| `apps/web/src/components/v2/prompt-curation-editor.tsx` | `5FC784608A562EA19D4DB6C64B852A7FAD149219B9BE707BECCAC80BE84234CB` |
| `apps/web/src/components/v2/editor/use-link-draft-recovery.ts` | `61CF55ACB1DE54ABB830092E02010D16390D97AA0C0500035CCAADFB8AD77424` |
| `apps/web/src/lib/v2/editor/link-draft-access.ts` | `D7F3C6300E487D73F031072B9FB551D8AEB9E32ACB70C068CFAF783E9A467BE2` |
| `apps/web/src/lib/v2/editor/link-working-copy.ts` | `E0BBB3F2E311B42A6F80C62963F3EB2718F5E23502A57C5C6F74C3618CE8997F` |
| `apps/web/tests/contract/v2/link-draft-access.test.ts` | `4C5AEE2BC22D2F5023B6D1346024BA9B62CFE48AEF5BFD213784013C2F71F362` |
| `apps/web/tests/contract/v2/link-working-copy.test.ts` | `34C85D55FC66803F7CCF59FDCE076593A04AB433EDD1C1D8A7A1BE840E7A814B` |
| `apps/web/tests/e2e/v2-prompt-curation-recovery.spec.ts` | `3E2649ADE01978481A682F26DB0F17B08BEDB102896DBA8F27F98D1919B9C1E4` |
| `apps/web/tests/e2e/v2-prompt-curation-recovery-boundaries.spec.ts` | `79B0592E77099C56B021294757A096610988C5AECDC8A9A31539E76CD457A071` |
| `apps/web/tests/e2e/support/prompt-curation-harness.ts` | `AEB1EFE2FF8D865F29CD4786D14359903FD45F10602179BFEFAB601B9A5EC985` |
| `apps/web/tests/e2e/v2-prompt-curations.spec.ts` | `2DE60BB56D9A51E285BAF7D23C1F412C764BA53D264C1C6FEF53D6454DDA3FDD` |
| `apps/web/tests/e2e/v2-link-parent-access-boundaries.spec.ts` | `EAE365CAC4E80722EAB993CD09BF54AB0E3A8A6EC80E85454B8C30E23D90F2CD` |
| `apps/web/src/components/v2/record-link-analysis.tsx` | `D69CBCE614439CB22A368740CFE93636E4158E4BEC997C31E746A93593CBC711` |

최종 재확인:02:41:53 KST17파일 SHA-256 불일치0,3100 listener0/workerd0. 변경5문서의 로컬 파일 링크97개 누락0. 파일 존재 검사이며 heading anchor·외부 링크 전체 검증은 아니다. 다음은 과거 AI run 증거 조회와 이관 초안 연결이며 이 checkpoint만으로 전체 goal 완료를 선언하지 않는다.
