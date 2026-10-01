# 링크 초안 세션 분리와 수동 발췌 복구 계약

2026-09-09 00:47 checkpoint. [62번 snapshot 복구](./62_LINK_SNAPSHOT_DRAFT_RECOVERY.md)의 후속 기반 구현이다. 당시 수동 발췌·정리본·이관 화면의 전체 reload 복구는 아직 연결하지 않았다. 이후 수동 화면·과거 요청 재생 보완은 [64번](./64_MANUAL_FRAGMENT_RECOVERY_AND_REPLAY.md)에 기록한다. 아래 CAS-before-replay 제한과 hash·검사는 이 checkpoint 당시 근거다. 전체 goal은 active이며 [50번](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)의 진행률 추정 48%를 유지한다.

## 구현된 경계

- `LinkDraftSession`은 활성 초안과 저장 완료 통지를 분리한다. `stage`는 debounce 전에 bounded JSON을 복제·고정하고 `{id,generation,origin}` token을 돌려준다. token은 이 화면의 메모리에서만 유효하며 저장된 payload의 권한 증명으로 복구하지 않는다.
- `saved(token)`은 실제로 보낸 ID/세대와 그때의 복구 원본만 정리한다. 늦은 응답이 새 scope의 ID나 복구 원본을 지우지 않으며, 같은 ID의 더 최신 입력도 남긴다. IndexedDB 정리 도중 실패해도 같은 token으로 다시 정리할 수 있다.
- `park()`는 현재 초안의 저장을 확인하고 활성 ID를 분리한다. 저장 실패·저장 중 새 입력·보호 정책 변경 시 전환을 실패시킨다. 조회 중 들어온 새 입력도 마지막 확인으로 보호한다. `stage` 자체는 같은 편집의 명시적 rebase에 쓰일 수 있으므로, **독립 그룹으로 바꾸는 호출자는 반드시 `await park()` 후 전환**해야 한다.
- `restore`는 서버 policy→현재 복구 목록→현재 입력 보존→대상 재조회 후 실행한다. 중간에 대상이 삭제되거나 권한/동의가 바뀌면 복구하지 않는다. snapshot editor는 숫자 세대만 보내던 정리 호출을 immutable token으로 바꿨다.
- 기기 복구를 끈 상태·restricted·policy 확인 실패에서 새 `park`는 현재 입력을 버리고 진행하지 않는다. 앞으로 수동/정리본 UI에 연결할 때 이 실패를 입력 보존 메시지로 처리해야 한다. 복구 동의를 임의로 켜거나 자동 제출해 우회하지 않는다. 현재 snapshot의 명시 rebase 동작은 유지한다.

## 수동 발췌 helper

`manual-fragment-draft.ts`는 원래 revision/snapshot/manifest basis, 선택한 source ID/member/key/hash/정확 원문/metadata/order, 역할, UTF-16 범위, 완전한 pending POST를 보존한다. 미선택/접힌 범위와 미완성 초안은 저장할 수 있지만 빈 범위를 POST로 바꾸지 않는다. pending만 서버 제출 계약으로 엄격히 확인한다. 공백·CRLF·이모지·정규화 차이를 임의로 바꾸지 않는다.

공개 인터페이스는 `parseManualFragmentDraft`, `manualFragmentScope`, `manualFragmentRequest`와 `ManualFragmentDraft/Basis/DraftSource`다. source DTO는 캐시된 입력일 뿐이며 새 요청 전에 인증된 source를 재확인해야 한다.

`assertManualFragmentReceipt(value,{request,source})`는 실제 POST 응답의 contract/item/replayed, 선택 원문 전체 hash, 정확 slice/hash, UTF-16 범위, member/key/role/completeness와 사용자 선택 출처를 검사한다. 늦은 replay에서 이미 바뀐 review 상태는 허용하지만 원문은 바뀔 수 없다. 성공 JSON이라는 이유만으로 기기 사본을 지우지 않는다.

receipt에 없는 owner/record/sourceItemId/manifest 및 idempotencyKey의 DB 결합은 인증된 서버 SQL 책임이다. 클라이언트 helper로 이를 독립 증명했다고 주장하지 않는다. 현재 수동 create API는 현재 revision/snapshot CAS를 receipt replay보다 먼저 확인한다. 원래 요청 후 서버 기준이 바뀌면 같은 키도 409일 수 있다. snapshot API의 과거 요청 재생 보장을 수동 API에 그대로 적용하지 않는다. UI 연결 시 이 차이를 해결/명시하고, 원래 pending을 최신 basis로 자동 치환하지 않는다.

## 오케스트레이션·독립 검토

root는 공통 세션/hook/snapshot 연결·브라우저·통합·문서를 소유했다. `link_ui_implementation`은 수동 helper 2개와 계약 시험 2개를 독립 구현 후 동결했고, root 코드를 읽기 전용으로 검토했다. 다른 두 agent의 기존 한도 오류는 재시도하지 않았다.

독립 검토 P2: session 내부의 저장 완료 확인만으로는 hook의 후속 `load` 대기 동안 생긴 새 입력을 보호하지 못했다. `await park(); stage(C)` 호출 전에 B가 입력되면 B의 ID를 재사용할 수 있었다. hook의 tail 확인을 추가하고 실제 React hook에서 hash 읽기를 지연시킨 뒤 새 입력/401을 주는 브라우저 시험을 추가했다. 이 지적은 처음에는 코드 기반 재현 후보였으며, 최초 실패 스트림을 제품의 실제 RED로 바꿔 적지 않는다.

실험실 `surface=link-draft-session`은 실제 hook·Chromium IndexedDB를 사용하지만 완료 통지는 합성이고 실제 서버 저장 receipt 검증이 아니다. 화면에도 이를 명시한다. 실제 수동 화면 복구·정리본·이관 request 재생을 검증한 것으로 간주하지 않는다.

## 검증 기록

| 실행 | 결과 | 범위/한계 |
| --- | --- | --- |
| root 00:30:32 | 42 PASS, exit0,1.28초 | 새 session16 + 기존 저장소26. fake-indexeddb |
| root51814 | 48 PASS, exit0,2.9분 | 기존 링크24 + snapshot 복구24, desktop/mobile. 후속 park tail 보완 전 |
| agent 00:32:31 | 107 PASS, exit0,1.64초 | 수동 draft54 + receipt53. 실제 LinkSqlite0032 create/replay4 확보 상태 포함 |
| root2035 | 149 PASS, exit0,5.86초 | 위4 계약 파일 단일 결합. 앞선42/107과 중복 합산하지 않음 |
| root36767 | 28 PASS/2 FAIL, exit1,2.1분 | 현재 snapshot24 + 새 세션4 PASS. 2개는 Next route announcer까지 잡은 alert locator 오류 |
| root97893 | scoped 11 TS 파일 lint exit0 | 제품·시험·실험실만. 전체 lint 아님 |

실패 이력: root60490은 React Compiler가 class의 `session.current` getter를 ref처럼 추론한 memoization lint3건이었다. 값을 읽는 `snapshot()` 메서드로 바꿨고 규칙을 비활성화하지 않았다. 후속 root lint0. agent의 최초107개 중1개는 trim 시험 선택이 원래 공백을 제외해 trim이 no-op인 fixture 오류였다. 선택 fixture를 바로잡은 뒤107 PASS이며 제품 helper는 바뀌지 않았다. 브라우저36767의 두 실패에서는 전환 차단 문구와 새 입력 보존을 실제 화면에서 확인했으나 assertion이 중복 alert로 실패했다. 시험을 main 영역으로 한정했다.

후속 root10654는 **6/6 PASS**,exit0,28.8초다. 독립 검토에서401 시험이 화면 숨김만으로 잘못 통과할 수 있다는 한계를 추가로 지적했다. 거절 화면에서도 비민감 scope 번호와 실제 park 거절을 검사하도록 강화했다. 제품 hook은 바꾸지 않았으며 최종 root20943은 **2/2 PASS**,exit0,16.7초다. 원래30개 결합28P2F를 단일30PASS로 바꾸지 않는다.

typegen90990 exit0, 최종 type23543 exit0, 전체 수정11파일 scoped lint97893 exit0, 마지막 fixture/test2파일 lint11475 exit0다. 현재 Worker나 전체 앱 suite를 새로 검증한 것은 아니다.00:45:43 KST 포트3100 listener0/workerd0을 확인했고 최종타입까지 모든 root/agent 핸들은 terminal이다. 원격 배포·migration·provider 호출·환경값 변경은 없다.

### 명령

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/link-draft-session.test.ts tests/contract/v2/link-working-copy.test.ts tests/contract/v2/manual-fragment-draft.test.ts tests/contract/v2/manual-fragment-receipt.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-link-draft-session.spec.ts tests/e2e/v2-link-snapshot-recovery.spec.ts --output=test-results/link-session-final
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-link-draft-session.spec.ts --output=test-results/link-session-followup
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-link-draft-session.spec.ts --grep 'authentication loss' --output=test-results/link-session-auth-final
npm run typecheck --workspace @light-house/web
```

### 최종 checkpoint SHA-256

제품/시험11파일의 표와 실제 hash를 다시 비교해 불일치0을 확인했다. 이번 갱신5문서의 로컬 파일 링크90개 누락0이다. heading anchor·외부 링크 전체 검증은 아니다.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/lib/v2/editor/link-draft-session.ts` | `45CEBA1AD52224DCEC294296E5B9E1FFF39562BAD052655E2137E5182B3023B8` |
| `apps/web/src/components/v2/editor/use-link-draft-recovery.ts` | `107FB7FD6D3D0BD1750FD6549CCF8977E72AF622A2DF6C4166DF3264411D3547` |
| `apps/web/src/components/v2/link-snapshot-editor.tsx` | `C0C39D68E90CF30E8C865E2D242A5AC9B55DEB5B9813EA6F16DFCDA32B84A709` |
| `apps/web/src/lib/v2/editor/manual-fragment-draft.ts` | `1396A2FFA8AD1E1B949E0FF3E1798BB1F246822758AA0E2379BD6508FD3A62A1` |
| `apps/web/src/lib/v2/editor/manual-fragment-receipt.ts` | `BFDDA2EE9BE35B9755AB6F60DFBE43CBBA6B8AA56336156F201E4AE5EB0DEDD1` |
| `apps/web/src/components/v2/lab/link-draft-session-audit-fixture.tsx` | `BE22481172F7DED398819FA581AF6315E30CF00F4AD6370B63393EE41C310EA3` |
| `apps/web/src/app/v2-lab/page.tsx` | `0C6E8EEF09DB210EBE41414BE214C8C8AFB5D3AEC8ED34A5D642498A0C656509` |
| `apps/web/tests/contract/v2/link-draft-session.test.ts` | `3E88A833B523C5C7FE099BB6C6B098400071D633527B85C1722C19DD5E5AAB6F` |
| `apps/web/tests/contract/v2/manual-fragment-draft.test.ts` | `828EA7FD1D7F79566A1D8F5A5825AE6F54B18BB3C019D8E9F997D7BCD4A70C16` |
| `apps/web/tests/contract/v2/manual-fragment-receipt.test.ts` | `13ED63ABA3EE3D2FC1A0FADAF7BAA6959A235E4D01C19D0379FB1B8ADCAE7AA8` |
| `apps/web/tests/e2e/v2-link-draft-session.spec.ts` | `D4391ED518AE9C866E06FBFD5C6860E6F94D5B09595ADA652912BCE27491F26C` |

## 다음 구현

1. 수동 UI에 인증 identity, 원문 재확인, stage/park/token과 명시 복구·동의 UI를 연결한다. 원래 pending 409 경계, 응답 유실, source 선택 교체와 불완전 입력을 실제 화면에서 검증한다.
2. 정리본 create/revise/undo/archive/unarchive의 pending을 draft와 분리해 보존한다. 선택된 originals만 포함하며 독립 그룹은 park한다.
3. 이관 원래 source revision/target members/plan/context/새 groupKey/동일 요청키를 함께 고정하고 확인 체크는 복구하지 않는다. 여러 미확정 요청을 새 target GET으로 덮어쓰지 않는다.
4. G06 이관된 그룹 복원·삭제/tombstone 증분과 G07–G11을 계속한다. 외부 수집·영상 분석을 수동 링크 입력으로 대체 완료하지 않는다.
