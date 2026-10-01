# 과거 AI 선택의 정확한 인증 근거 조회

2026-09-12 구현·결합 검증 checkpoint. [66번](./66_PROMPT_CURATION_RECOVERY_AND_RECEIPTS.md)의 남은 과거 AI create pending 복구 경로를 연결했고 최종 desktop/mobile100개를 검증했다. 전체 goal은 active이며 [완료 기준](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)의 약48%는 유지한다. 아직 이관 초안·이관 그룹 복원·삭제 증분 및 G07–G11은 남는다.

## 구현 계약

- `GET /api/v2/records/[recordId]/links/fragments/[fragmentId]/evidence`에 `snapshotId`와 `manifestHash`를 정확히 한 번씩 전달한다. 다른 query/위조 권한 query는 거절한다. 성공·오류 모두 `private, no-store`다.
- 응답은 `link-fragment-evidence.v1`: record ID, 원래 snapshot ID/manifest, 정확 fragment, 해당 fragment가 실제로 속했던 run이다. 최신20개 이력을 순회하거나 동일 텍스트에서 run/offset을 추정하지 않는다. 기록 본문·미선택 출처·서버 fingerprint catalog는 반환하지 않는다.
- 새 독립 repository는 소유자·capture·원래 document revision·run/job/input hash·지원하는 prompt/schema/validator·snapshot manifest·원문/첨부 연결을 확인한다. succeeded/partial인 완료 run만 허용하며 지원하지 않는 옛 validator를 추측해 승인하지 않는다.
- UTF-16 block 시작/끝, CRLF/공백/이모지 원문, raw hash, evidence/member/source, completeness를 재검증한다. 마지막 단일 접근 SQL에서 snapshot/source/첨부와 fragment/run/job/evidence를 다시 대조한다. 마지막 DB await 후 grant 만료도 확인한다. 새 AI 실행·publication·쓰기·원격 요청은 없다.
- 과거 조각의 review state가 rejected/superseded로 바뀌어도 정확한 역사 근거로는 읽을 수 있다. 새 쓰기 권한이나 현재 review 통과로 바꾸지 않는다. 원래 idempotency receipt 재생과 새 쓰기 CAS는 기존 서버가 구별한다.

## 실제 정리본 복구 연결

1. 기기 초안에는 기존 `prompt-curation-draft.v1`의 원래 basis/group/head/key/content/originals를 그대로 보관한다. runId를 추가하거나 구형 초안을 임의 이관하지 않는다.
2. 명시 재시도 시 원래 snapshot/parent/undo/manual 근거에 더해 선택된 AI ID만 중복 제거하여 최대64개, 동시4개씩 정확 조회한다. 화면의 최신 run은 이 역사 근거로 교체하지 않는다.
3. `assertPromptCurationAiEvidence`는 동기 capture 후 strict DTO/선택 identity/원문/범위/source hash를 검증한다. 명시 proof가 빠지거나 변조되면 현재 projection/parent를 이용해 조용히 통과시키지 않는다. 알 수 없는 필드/getter/뒤늦은 호출자 변경도 거절한다.
4. 원래 key/body로 POST하고 `assertPromptCurationReceipt`가 같은 근거로 전체 저장 receipt를 확인한다. 검증된 token만 복구 사본을 정리하며, 조회/복구 자체는 POST를 실행하지 않는다. 근거 누락 시 pending을 유지한다.
5. 브라우저 검증은 인증·소유권·원래 idempotency key의 서버 receipt 결합을 대체하지 않는다. 임시 fingerprint 인수는 기존 순수 range/source-hash 검증기 재사용용이며 반환 근거·manifest·권한에 들어가지 않는다.

## 독립 검토와 수정

- SQL/HTTP baseline에서65 PASS/1 FAIL: 저장 source_metadata='{}'가 일반500으로 표시됐다. 원문은 노출되지 않았으며 known `link_source_not_external`를 저장 근거 무결성 오류로 변환하는 좁은 수정을 적용했다. 실제 DB 장애를 검증 오류로 숨기지 않는다. root 결합에서 새 서버91개가 모두 통과했다.
- 클라이언트 읽기 검토에서 첫503 뒤 sibling423이 Promise.all에 흡수되는 경합을 발견했다. POST는 안 나가지만 권한 회수 뒤 평문이 남았다. root50256 실제 브라우저 RED1 FAIL로 재현했다. 수동/AI 저장 배치, 목록 병렬 조회, 최신 상태의 페이지 밖 수동 조회를 공통 `authorizedReadBatch`로 연결했다. 일반 오류는 sibling 종료까지 보존하고 권한 거절은 다른 미완료 읽기를 기다리지 않고 즉시 전달한다.
- helper의 변조된 native Promise constructor/then getter 경계도 독립 검토로 보완했다. 모든 sibling handler를 먼저 연결한 뒤 비동기 assimilation한다. 후속 시험의 오류 순서 기대값2개가 틀렸던 것을 고쳤고 실제 제품 검증/timeout을 낮추지 않았다.
- 작성자 시험 결과와 root 실제 컴포넌트 RED/후속 결과는 아래 별도로 기록한다. 검증 중인 작업을 완료로 간주하지 않는다.

## 검증 결과

| 검사 | 확인한 최종 출력 | 범위·한계 |
| --- | --- | --- |
| agent SQL/HTTP baseline | 43962 **65P/1F**,exit1,45.79초;70191 **84P/1F**,exit1,34.88초 | 같은 metadata 오류. 마지막 추가6개 selected PASS를 전체91 PASS로 합치지 않음 |
| root 새 기능 브라우저 | 38111 **84/84 PASS**,exit0,7.6분 | 새 근거30+기존 boundary18+복구36, desktop/mobile. 병렬 권한 경합 수정 전 |
| root 권한 경합 RED | 50256 **1 FAIL**,exit1,7.4초 | 503 뒤423인데 일반 오류/평문이 남는 실제 실패. trace/screenshot 보존 |
| root 계약 결합 | 94777 **474P/2F**,exit1,107.62초,7파일 | 서버91+manual56+manual replay47+projector22는 모두 PASS. 나머지 실패2개는 helper 시험 기대 오류 순서 |
| root 후속 순수 계약 | 7409 **260/260 PASS**,exit0,4.82초,3파일 | receipt161+draft90+batch9, 잘못된 시험 기대값 수정 후. 앞선 결합을476 PASS로 바꾸지 않음 |
| root 최종 브라우저 | 25971 **100/100 PASS**,exit0,7.9분 | batch16+앞선84, 중복 실행 합산하지 않음. 늦은 권한 거절/미응답 sibling·복구/과거 run 교체 포함 |
| root 타입/lint | 최종 typecheck8295 exit0;scoped13파일 lint52993 exit0 | 최종 helper/시험 포함. 앞선 typegen/typecheck27776·lint91644도 exit0이며 전체 lint/Worker 아님 |

현재 실행 핸들은 [현재 상태](./CURRENT_WORK_STATE.md)를 따른다. 이전17203은 도구에서 종료 확인됐고 `.last-run.json` passed만 남아 최종 개수를 증명하지 못하므로 재실행38111로 대체했다. 실제 provider·원격 Cloudflare·R2 bytes·workerd·전체 suite·Worker build 검증과는 구별한다. SQLite/합성 session·grant·model과 실제 route handler 시험이며 브라우저는 실제 React/Chromium+로컬 HTTP 대역이다.

검사 명령은 저장소 루트의 npm workspace를 사용한다.

```text
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/link-fragment-evidence.test.ts tests/contract/v2/prompt-curation-receipt.test.ts tests/contract/v2/authorized-read-batch.test.ts tests/contract/v2/prompt-curation-draft.test.ts tests/contract/v2/link-presentation.test.ts tests/contract/v2/manual-link-fragments.test.ts tests/contract/v2/manual-link-fragment-replay.test.ts
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/authorized-read-batch.test.ts tests/contract/v2/prompt-curation-receipt.test.ts tests/contract/v2/prompt-curation-draft.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-curation-read-batch-authorization.spec.ts tests/e2e/v2-prompt-curation-ai-evidence.spec.ts tests/e2e/v2-prompt-curation-recovery-boundaries.spec.ts tests/e2e/v2-prompt-curation-recovery.spec.ts --output=test-results/curation-exact-evidence-batch-final
```

## 제품·시험 지문

17:06 KST 읽은 SHA-256. 17:11 및 최종 17:18:10 KST 재계산에서 13파일 불일치 0이다. 변경 문서 5개의 로컬 파일 링크 99개 누락 0, 포트 3100 listener 0, workerd 프로세스 0을 확인했다.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/lib/v2/domain/link-fragment-evidence-v1.ts` | `A91594302A888549967BA28586833981810C7D0F7FA20233DC6D95A39B56AE50` |
| `apps/web/src/lib/v2/infrastructure/d1/link-fragment-evidence-repository.ts` | `F48B240BA85775E7EAEE6498F520A7D6FA8B77C981C0C883D26129D8817714CE` |
| `apps/web/src/app/api/v2/records/[recordId]/links/fragments/[fragmentId]/evidence/route.ts` | `8802ABF2B3A04A65F5588ECB407836D53D6F6989A4ECED89B934B2EB37630D62` |
| `apps/web/src/lib/v2/editor/prompt-curation-receipt.ts` | `19A5379FA1BB990EB73C56A13AECD595A03E15D8C2429571C91C52C834AE5931` |
| `apps/web/src/lib/v2/editor/authorized-read-batch.ts` | `A306C5E9D18B895A299BEB5E0AECD6E60FA043FEDBAD24F2AC9D02856BD2AC12` |
| `apps/web/src/components/v2/record-prompt-curations.tsx` | `11D7F4D827EB556887B42CA61F0AA2AB4201749B1C5EEBE1E0E222FC29033CCC` |
| `apps/web/tests/contract/v2/link-fragment-evidence.test.ts` | `E60701DE94CC80D1C34F6A862FF2796A9926953861C6012AB7C901A7970B7246` |
| `apps/web/tests/contract/v2/prompt-curation-receipt.test.ts` | `F76C2F19C693294CDAD02E14B8E6D5CFF944464E47DFB4D6B7AB49A6C4CE69E4` |
| `apps/web/tests/contract/v2/authorized-read-batch.test.ts` | `8BB70CD63FC47964A1DAFFBCED012292AE9B2330A53CD84F029A4D98267B838D` |
| `apps/web/tests/e2e/support/prompt-curation-harness.ts` | `B60968851CBFEB3D511A07B2E4285252764ED31C50D32D99FC6517D83195C787` |
| `apps/web/tests/e2e/v2-prompt-curation-recovery-boundaries.spec.ts` | `D889DB96F07049E1459CDB7B4D664E26311E5CCE938B38D5FE27BCF86A0622E8` |
| `apps/web/tests/e2e/v2-prompt-curation-ai-evidence.spec.ts` | `F2116E86DAB255888E76EC7ADE56EAC47F820D016EEB7AC6FD22054BC1A0DFF7` |
| `apps/web/tests/e2e/v2-curation-read-batch-authorization.spec.ts` | `F06A32C6C5AA0C0EFD3280B446AB3B6D2CB54EEA98DF6844173EBF0E1EE93B8E` |

## 남은 실제 구현

다음은 이관 draft/pending의 source revision/target/plan/key 고정·명시 재확인·park/token 결합이다. 이어서 based-on 이관 그룹 full/delta/fresh/repeat 복원과 삭제 증분, 저장 layout·검색/정확 이동, 권한 있는 공급자 adapter·영상/자막·OS Share·실기기·운영 gate로 진행한다. 본 기능의 국소 검증을 전체 출시 성공으로 바꾸지 않는다.

다음 이관 복구의 코드 기반 인계 결정(구현 완료가 아님):

- `LinkWorkingCopy.kind`에는 이미 `migration`이 있다. 별도 복구 세션과 `{contract:'prompt-curation-migration-draft.v1',phase:'review'|'pending',plan,request}` 형태를 사용하고 기존 store/session을 재사용한다.
- plan은 원본 group/revision/snapshot/manifest와 대상 basis를 가진다. request의 expectedPlanHash/basis와 일치해야 하며 최초 groupKey/idempotencyKey를 유지한다. 동기 parser는 제한된 데이터·중복/참조를 확인하고, 비동기 단계에서 plan digest와 fresh source/target을 검증한다.
- source 전체 정리본/target 전체 projection·history·권한·checkbox·saved/오류 상태는 durable payload에 넣지 않는다. 복구 후 정확 source revision GET과 원래 target snapshot GET을 사용한다. checkbox는 해제하고 자동 POST/AI0을 유지한다.
- 현행 `assertMigrationPreview`/`assertMigrationReceipt`의 target-current 조건을 몰래 위조하지 않는다. 원래 pending basis를 받는 별도 역사 근거 경로가 먼저 필요하다. 현재 preview 의미는 그대로 유지한다.
- 현재 `visibleMigration`이 선택한 detail/scope에 종속되는 UI도 복구 panel과 분리한다. 미저장 stale pending409는 원래 사본 유지, 명시 새 preview는 먼저 독립 park, 성공한 old pending은 같은 요청으로 재생하고 정확 token만 정리한다.
- decisive test는 committed response-lost→대상 snapshot/문서 진행→reload→동일 요청→중복 그룹0, stale 미저장409·변조/누락·권한/정책 세대·여러 이관 독립 park·민감/제한·desktop/mobile/320px다.
