# 링크 자료 버전 초안 · 기기 복구

기준: 2026-09-09. G05의 **snapshot 편집 화면**에 reload 복구를 연결한다. 수동 발췌·정리본·이관 요청의 공통 저장 기반은 준비했지만 그 세 화면의 복구 연결까지 완료한 문서는 아니다. 전체 goal은 active다.

## 저장 경계

- 기존 `lighthouse_editor_working_copies_v1` IndexedDB를 v3로 올린다. `copies`는 기존 문서 전용이며, 새 `links`와 `linkTombstones`는 링크 전용이다. Capture outbox·새 Capture 동기화에 연결하지 않는다.
- `copies/links/linkTombstones/policies`의 같은 transaction에서 record privacy를 적용한다. 어느 편집기의 관측/쓰기든 restricted는 양쪽 사본을 정리하고, sensitive는 평문을 정리한다. 기존 AES-GCM 키는 보존·공유한다.
- 링크 사본은 owner/record, 탭별 ID, generation, 정책 baseVersion, kind, scopeKey, payload를 가진다. kind는 snapshot/manual/curation/migration을 구분하며, 현재 UI 연결은 snapshot뿐이다.
- sensitive는 화면별 명시 동의 후 AES-GCM으로 저장한다. 링크 ciphertext는 ID·owner namespace·generation·시각·digest를 AAD로 결합한다. 동의는 재접속 시 자동 복원하지 않는다. restricted는 잠금을 해제해도 저장하지 않는다.
- 성공/명시 삭제는 해당 사본의 기대 generation까지만 정리한다. tombstone이 먼저 삭제된 같은/낮은 generation의 늦은 put을 거절한다. 다른 탭의 새 초안을 성공한 탭이 일괄 삭제하지 않는다.
- 저장 인수는 첫 await 전에 lossless JSON으로 깊게 캡처한다. getter/toJSON/함수/순환/Blob/undefined/sparse array를 받지 않으며 텍스트·구조 상한을 둔다. 로컬 이미지 bytes는 이 저장소의 범위가 아니다.

## 인증된 복구 정책

새 `GET /api/v2/records/[recordId]/recovery-policy`는 인증된 소유자의 `ownerId/recordId/currentVersion/privacyLevel`과 `contentReadable`만 보낸다. 본문·제목·원문·revision ID는 포함하지 않는다. 잠긴 기록도 restricted 정책을 받아 사본을 정리할 수 있다. 모든 성공/오류는 `private, no-store`다.

실제 `getRecoveryPolicy` SQL의 owner/Capture/current revision/legacy visibility 경계를 재사용한다. `contentReadable`은 응답 직전 grant 만료와 비교한다. 복구 목록·복호화 전에 이 endpoint를 확인하며, 복구 버튼을 누를 때 다시 확인한다. focus/visible 복귀에도 갱신한다. 오류가 나면 복구를 성공으로 간주하지 않는다.

새 응답이 다른 owner를 가리키거나 401/403/404/423이면 편집을 닫고 부모의 링크 원문 cache도 숨긴다. 부모 GET의 실제 `link_record_not_found`도 같은 폐기 경계에 포함했다. SSR parent는 owner:record key로 인스턴스를 분리하며 hook에도 동일 인스턴스의 namespace 변경 거절 guard가 있다.

## 입력·요청 계약

`link-snapshot-draft.v1`은 다음을 보존한다.

| 필드 | 의미 |
| --- | --- |
| basis | 편집 시작 시 expectedRevisionId / expectedSnapshotId / expectedSnapshotVersion |
| selected | 선택한 원본 source ID와 순서 |
| additions | 수동 원문·URL·작성자·역할·확보 범위·미완성 숫자 입력·클라이언트 source ID |
| pending | 제출할 정확한 전체 요청과 idempotencyKey 또는 null |

미완성 URL과 `-` 같은 숫자 입력은 제출 normalizer를 거치지 않고 복구한다. 원문은 자르거나 재작성하지 않는다. 복구 parser는 JSON 필드/크기/identity/중복을 확인하며 pending은 그 입력과 frozen basis에서 도출된 요청과 일치해야 한다.

첫 제출 전에 pending을 기기에 기록한다. 저장 결과가 불확실하면 입력 수정을 잠그고 동일 요청을 명시 재시도한다. reload 후 현재 서버 snapshot이 달라져도 과거 pending을 임의 재기준화하지 않는다. 409 뒤 최신 상태를 읽고 사용자가 **현재 자료 버전을 기준으로 편집 계속**을 선택해야 새 basis/key를 쓴다. 페이지 방문·초안 복구는 POST나 AI 분석을 실행하지 않는다.

기기 저장 실패 시 서버 제출도 잠시 멈추고, 사용자가 이 화면의 기기 복구를 직접 끄면 서버 저장을 선택할 수 있다. 서버와 기기 저장을 별도로 안내한다. 브라우저 종료 직전 flush는 최선 시도이며, 정상 입력의 300ms checkpoint와 제출 전 await가 주된 내구성이다.

다른 초안을 복구할 때 현재 화면에도 입력이 있으면 먼저 별도 ID의 사본으로 보존한다. 기존 화면의 미저장 입력을 선택한 복구본으로 덮어 없애지 않는다. 다른 사본 삭제 버튼은 해당 generation만 삭제한다.

## 독립 검토와 보완

1. 동의를 끈 뒤 늦은 focus-triggered 복호화가 목록에 다시 들어오는 P2: verification/consent epoch와 enabled 상태를 결과 적용 직전에 재검사한다. 실제 브라우저의 암호화 해제를 지연시킨 회귀로 확인한다.
2. 동일 hook 인스턴스의 owner/record 변경 시 ID/pending이 남는 P2: 실제 SSR의 identity key와 hook fail-closed guard를 추가했다. 다른 기록으로 pending을 옮기지 않는다.
3. 초안 복구가 현재 미저장 입력을 덮는 경계: 기존 입력을 먼저 저장하고 새 local ID로 복구본을 연다.

## 검증 이력

- 저장소 agent 최종: 새 링크26 + 기존 문서13 = 39/39 PASS, exit0. IndexedDB 실제 브라우저가 아니라 fake-indexeddb이며 blocked/versionchange, v2→v3, 암호화 중 privacy 변경, 목록·삭제·generation 경합을 포함한다. scoped4파일 lint0.
- 새 metadata endpoint agent: 실제 LinkSqlite/repository SQL 29/29 PASS, exit0. 세션/grant/binding은 대역이다. 첫27P2F는 grant 대역의 호출 인자 기대 오류를 수정했다. 제품 권한 경계를 낮추지 않았다.
- root parser17 + 기존 SSR12 =29/29 PASS, exit0. exact CRLF·이모지·미완성 필드·pending 변조/retarget 거절·상한을 확인했다.
- 첫 브라우저 root14883:36PASS/2FAIL,exit1,2.2분. 두 FAIL은 401이 편집을 즉시 닫았는데 시험 helper가 화면이 보일 것을 기다린 모순이다. assertion을 닫힘 기준으로 수정했다.
- 최종 결합/후속 상태는 아래 checkpoint 또는 CURRENT_WORK_STATE에 최종 exit와 함께 기록한다. 부분 출력을 전체 PASS로 바꾸지 않는다.

## 한계·다음 작업

브라우저의 origin 암호화 키까지 접근할 수 있는 XSS/악성 스크립트에 대한 보안 경계가 아니다. 다른 기기에서 일어난 정책 변경을 오프라인 탭이 즉시 알 수 없으며, OS 강제 종료 직전 미완료 write까지 보장하지 않는다. 로컬 사본은 서버 백업에 포함되지 않는다.

다음은 같은 저장소/정책을 이용한 수동 발췌·정리본 초안·여러 이관 pending의 독립 복구다. 반드시 각 화면의 source/snapshot/run/revision identity와 exact 요청을 유지한다. 그 뒤 이관된 based-on 그룹의 ZIP/fresh/repeat 및 삭제/tombstone 증분, G07–G11을 계속한다.

후속 연결의 구체 경계:

- 수동 발췌: `choose/role/onSelection/rebase`에서 basis·source ID/member/hash/정확 원문·UTF-16 range를 보존한다. source를 새 인증으로 재검증하기 전 쓰지 않는다. pending은 완전한 POST 본문이다.
- 정리본: `start/updateDraft/applyLatest`의 draft(head/content/선택된 originals)와 `saveDraft/transition`의 create/revise/undo/archive/unarchive pending을 분리한다. undo/archive는 draft=null이어도 요청을 보존해야 한다. 빈 제목/미완성 이미지 연결은 초안에서 허용하고 pending만 제출 계약으로 검증한다.
- 이관: 선택했던 source의 정확 revision, 당시 target identity/members, plan, 새 groupKey/idempotencyKey 포함 request, attempted를 보존한다. 확인 checkbox는 복원하지 않는다. 최신 GET의 target으로 옛 pending/receipt 검증 context를 덮어쓰지 않는다.
- 이 checkpoint 당시 hook의 `stage`는 같은 활성 ID를 사용했다. 후속 [63번](./63_LINK_DRAFT_SESSIONS_AND_MANUAL_RECOVERY_CONTRACT.md)에서 명시 `park`와 immutable 완료 token을 추가했다. 여러 정리본/미확정 이관의 실제 UI 연결은 여전히 남아 있으며 공통 세션 준비만으로 완료했다고 판단하지 않는다.

## 최종 checkpoint

2026-09-09 00:16 KST. root41970 최종 후속 브라우저는 **54PASS/4SKIP/exit0**,2.7분이다. 새 snapshot 복구24+기존 링크24+기존 durability6을 통과했다. 기존 Capture의 writable harness가 꺼져4개를 건너뛰었다. 새 복구 검사는 전부 실행했으며 skip을 PASS로 계산하지 않는다.

- 직전 root42679 결합은 **173PASS/1FAIL**,174개,exit1,6.7분이다. 유일한 실패는 sensitive 재동의 직후 오래된 saved 문구가 남아 IndexedDB 완료 전에 읽은 것이다. verify/consent 시작에 status를 초기화하고 DB 완료도 직접 기다리게 보완했다. 위54개의 양기기 후속에서 해소했지만174개 전체를 최신 단일 PASS로 바꾸지 않는다.
- root70912: 저장소/새·기존 정책 API/SSR/parser8파일 **118/118 PASS**,exit0,40.05초. 앞선39/29/17 등과 중복 합산하지 않는다.
- receipt 검증: agent66 PASS 후 새 시험의 TS2345 좁은 metadata 타입을 root가 보완했다(제품 변경 없음).00:15:10 root 단일 파일 **66/66 PASS**,exit0,0.955초. 실제 LinkSqlite create→child snapshot→문서 revision→원래 요청 재생을 포함한다.
- 새 `assertSnapshotReceipt`는 원래 요청의 owner/record/parent/version·원문/metadata/선택 순서와 source fingerprint·manifest·coverage를 확인한다. malformed2xx는 pending을 지우지 않는다. 현재 documentRevisionId는 정상 replay에서 달라질 수 있어 원래 revision과 무조건 같다고 요구하지 않는다. 요청키→snapshot DB 연결·기존 source ID의 실제 DB 원문/소유권은 서버 신뢰 경계다.
- 늦은 POST의 응답/해시 검증/상태 GET 사이에 화면 권한·selection 세대가 바뀌면 화면을 다시 열거나 저장 성공을 표시하지 않는다.
- typegen58387 exit0, 최종 type6250 exit0. 중간 type65144의 시험 TS2345 1건은 보존한다. scoped root11파일 lint19304 오류/경고0 exit0와 수정 시험 후속 lint0, agent 저장소/receipt lint0. 전체 lint/build는 아니다.
- 브라우저 output: `apps/web/test-results/link-recovery-final`. root가 mobile320 전체/복구 컨트롤 PNG를 실제 확인했다. HTTP/인증은 로컬 대역이며 실제 공급자·OS기기·원격 저장 검증이 아니다. Next 로그에 종료/전환 중 `destination stream closed early`1건이 있었고 해당 테스트와 최종 프로세스는 exit0였다. 대역의 고의 응답 중단과 별개인 생산 원인까지 규명한 결과는 아니다.
- 00:16 KST root/agent 실행 중 핸들 없음,3100 listener0/workerd0. 환경·원문·전체 dirty tree 보존,원격 변경 없음.

### 실행 명령

저장소 루트에서 npm workspace를 사용했다.

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/editor-working-copy.test.ts tests/contract/v2/editor-working-copy-policy.test.ts tests/contract/v2/editor-working-copy-cross-tab-privacy-regression.test.ts tests/contract/v2/link-working-copy.test.ts tests/contract/v2/link-snapshot-draft.test.ts tests/contract/v2/link-recovery-policy-route.test.ts tests/contract/v2/record-recovery-policy.test.ts tests/contract/v2/record-recovery-policy-ssr.test.ts
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/link-snapshot-receipt.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-link-snapshot-recovery.spec.ts tests/e2e/v2-link-analysis.spec.ts tests/e2e/v2-product-durability.spec.ts --output=test-results/link-recovery-final
npm run typecheck --workspace @light-house/web
```

### 최종 파일 SHA-256

실행 결과를 어느 제품/시험에 적용했는지 확인하기 위한 checkpoint다. 저장소의 다른 변경을 이 기능의 새 변경으로 주장하지 않는다.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/lib/v2/editor/editor-working-copy.ts` | `D7A14FD09C6FCB8C7FC81C78E5DD0B0176CF1E24938B5B9150E0341014AF53FF` |
| `apps/web/src/lib/v2/editor/link-working-copy.ts` | `E468F52B1C6DE47CAE9F2CF8FFFAFCA0ABF5B3456C869E8FD116F894C24A3CFD` |
| `apps/web/src/lib/v2/editor/link-snapshot-draft.ts` | `BB25BAACCA1A8EF975F3E62FB3F00C29EAC6B18A92FCB01827CE9AFAA157EA33` |
| `apps/web/src/lib/v2/editor/link-snapshot-receipt.ts` | `8B52E4CE491F1C4769682387635D90738965831AE5982C0A26D2598DCDB01DD5` |
| `apps/web/src/components/v2/editor/use-link-draft-recovery.ts` | `BC952673D0964106E8BECCDAD89D773AB76FA3F1FD3A40F7C73A5C7E338B0445` |
| `apps/web/src/components/v2/link-snapshot-editor.tsx` | `9F594F51458DD05E8391E97E839E5066D0170388E76A1C09164F8CA3EAC4D38E` |
| `apps/web/src/components/v2/record-link-analysis.tsx` | `E8FD7411AFA545A2AFB513AE69CCAAFBC283EC59500E80D3080C30CD8CCBF303` |
| `apps/web/src/components/v2/lab/link-analysis-audit-fixture.tsx` | `DEDF722D9905FC60BDDCB2861291314265F18FC2A9E4E321768F82D4BE524033` |
| `apps/web/src/app/api/v2/records/[recordId]/recovery-policy/route.ts` | `CB735D079FC0BDD3AB4745AA415FA13E1C9560219F08FF197A4D2D1F84CC262A` |
| `apps/web/src/app/v2/records/[recordId]/page.tsx` | `AD28DF4EA2B6DCCE393820F30E29F9EA723E6E8A916E32C2DDB97A56F3FE5668` |
| `apps/web/src/app/v2/link-analysis.css` | `C22D86DF4822155F1BD15230BCCF2174354EE7EF09B4A2359DC929ED0BC3CC9E` |
| `apps/web/tests/contract/v2/editor-working-copy-policy.test.ts` | `CBBFF42158DE6DBCFA2C75AD0855C0EAC53B99F785ADDD4F503F1F9426BAC6A9` |
| `apps/web/tests/contract/v2/link-working-copy.test.ts` | `7FEEF1B42B2737BC953AA2749132B7D32615100A680604DAFDE4694452B62FF4` |
| `apps/web/tests/contract/v2/link-snapshot-draft.test.ts` | `892C97540C60397CB9439607E8233D617D166B220C2D25E10D3BE09C6209363B` |
| `apps/web/tests/contract/v2/link-recovery-policy-route.test.ts` | `87FBF8B36F3EEB4656F946C5E2CA829635500CEB3FFEB5536C1DBE75B1C10208` |
| `apps/web/tests/contract/v2/link-snapshot-receipt.test.ts` | `1600AEC3A918BAC36760F9939B61DAD4A9C0FCB8295651D6891FAFBF7BDD1595` |
| `apps/web/tests/e2e/v2-link-analysis.spec.ts` | `0248ABC60B431FF37F3E64C758566F2429BB2884402E3BFD5DF337233CBEF4EA` |
| `apps/web/tests/e2e/v2-link-snapshot-recovery.spec.ts` | `B90B9C093845E2477F3FE05669095BED9D5BC1305B3E21D8265BB496B7E2F137` |
| `apps/web/tests/e2e/support/link-snapshot-receipt-fixture.ts` | `C1DC08B185B449E7DD84E1993AB9A7B73331AF1A5E8A42E78012E80776458210` |
