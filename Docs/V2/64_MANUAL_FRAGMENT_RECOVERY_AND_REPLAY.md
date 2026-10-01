# 수동 발췌 화면 복구와 과거 저장 요청 재확인

2026-09-09. [63번의 수동 draft/receipt 계약](./63_LINK_DRAFT_SESSIONS_AND_MANUAL_RECOVERY_CONTRACT.md)을 실제 Record 화면에 연결했다. 이 checkpoint는 수동 발췌 복구와 해당 서버 재생 경로이며, 정리본·이관 화면의 reload 복구 완료가 아니다. [50번 전체 goal](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)은 active, 동일 산식의 추정 달성도 **약 48%**를 유지한다.

## 실제 화면 동작

- 수동 발췌를 열 때 인증된 recovery-policy를 확인한다. 닫힌 발췌 화면 때문에 불필요한 정책 조회를 시작하지 않으며, 한 번 연 뒤에는 focus/visibility 보호 정책 검사를 유지한다.
- 정확한 원문·source/member/key/hash·metadata/order, 원래 revision/snapshot/manifest, UTF-16 범위, 역할, 완전한 pending 요청을 같은 기기 사본에 담는다. 사용자 선택 원문은 범위가 아직 없어도 보존한다. 초기 기본 원문 표시만으로 새 초안을 만들지는 않는다.
- 다른 원문으로 이동하거나 명시적으로 현재 버전을 다시 확인할 때 기존 staged 초안을 먼저 park한다. 저장 실패·동의 꺼짐·보호 정책 변경이면 전환을 중단하고 현재 입력을 유지한다. 정상적인 원문 변경 후 선택 범위를 비우되 이전 사본을 삭제하지 않는다.
- reload 뒤에는 날짜·역할·미확인 요청 여부만 후보 목록에 표시하고, 명시적으로 복구한 뒤 내용을 연다. 복구 자체는 POST·AI 호출을 하지 않는다. 현재 입력이 있는 상태에서 다른 사본을 복구하면 먼저 별도 사본으로 보존한다.
- 새로운 저장과 같은 요청 재확인 모두 인증된 `GET /links?snapshotId=원래값`으로 source와 manifest를 다시 확인한다. 캐시된 source는 저장 권한이 아니다. 새로운 요청은 현재 revision/snapshot·capability도 확인한다.
- POST 전에 pending의 원래 body/key를 stage하고, 기기 복구가 켜졌으면 flush 성공을 기다린다. 실패하면 서버 POST를 보내지 않는다. 사용자가 직접 복구를 끈 뒤 서버 저장을 선택할 수는 있다.
- 네트워크 오류나 잘못된 2xx 영수증은 pending을 유지한다. 확인 전 원문·범위·역할은 동결한다. 과거 snapshot 화면에서도 기존 요청을 재확인할 수 있으며 새 basis로 자동 치환하지 않는다.
- 엄격한 원문/범위/receipt 검증 후 요청에 대응하는 immutable token으로만 기기 사본을 정리한다. 과거 receipt를 현재 snapshot 목록에 섞지 않는다. 409 후 현재 버전 확인은 명시적 동작이며 이전 pending도 별도 사본으로 남긴다.

### 인증 오류로 숨긴 입력

원문 조회/저장 API가 401/403/423 또는 record-not-found를 반환하면 수동 원문·범위·목록·복사 fallback을 숨긴다. `suspend()`가 정책 확인 세대를 무효화하고 debounce/flush를 멈춘다. 기존 durable 사본을 삭제하거나 숨긴 active 입력을 새 입력으로 덮어쓰지 않는다.

권한 확인 후 화면에 다시 들어와도 숨긴 입력을 자동 표시하지 않는다. **“이 화면의 숨긴 초안 다시 열기”**를 누르면 fresh recovery-policy의 identity/readability와 active payload·동의 경계를 확인한 뒤 기존 in-memory payload만 표시한다. original ID/basis/pending은 유지한다. 이 동작은 새 기기 사본·POST를 만들지 않으므로 기기 복구 opt-out 또는 인증된 restricted 읽기에서도 동작한다. 브라우저를 실제 닫으면 미저장 메모리만으로는 복구할 수 없으며, 기기 사본을 저장했다고 표시하지 않는다.

일반 normal 사본은 기존 policy 경계를 사용한다. sensitive는 화면별 명시 동의와 암호화를 요구하고, restricted는 기기 보존을 하지 않는다. 서버가 restricted 내용을 읽을 수 없다고 하면 부모 화면까지 닫으며 이전 평문 사본은 정책 store에서 제거한다.

## 서버: 현재 CAS와 과거 receipt 재생 분리

`D1ManualLinkFragmentRepository.create`는 owner/lifecycle/legacy visibility와 현재 restricted grant부터 확인한다. 그 다음 동일 owner·operation·key의 기존 receipt가 있을 때만 읽기 전용 재생을 시도한다.

1. payload hash와 단일 fragment ID/status201 receipt를 검증한다. 다른 body/record/key의 요청으로 이전 성공을 대신 인정하지 않는다.
2. 원래 snapshot/manifest/member와 정확 원문·범위·역할을 검증한다. 현재 자료로 바꾸거나 새 fragment를 생성하지 않는다.
3. 원래 revision의 존재, receipt 내용/상태, fragment tuple·사용자 선택 evidence, source/member/metadata를 최종 SQL 읽기에서 다시 결합한다. 접근이나 현재 문서 상태가 조회 중 바뀌면 fail-closed한다.
4. 기존 receipt가 없으면 종전 현재 revision/snapshot CAS와 4문장 atomic batch를 그대로 사용한다. 오래된 scope의 새 key는 409이고 row를 추가하지 않는다.
5. concurrent winner가 저장 후 현재 scope를 진행시켰더라도 loser는 같은 기존 receipt만 회수할 수 있다. 재확인 중 또 변경되면 409 후 같은 key를 다시 확인한다.

Cloudflare 스킬에 따라 [공식 D1 batch 계약](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)을 확인했다. 트랜잭션 실패 rollback·바인딩 경계는 유지했다. 실제 검사는 Node SQLite/HTTP handler와 로컬 합성 브라우저이며, 이 checkpoint에서 remote D1 또는 workerd를 새로 실행하지 않았다. 알려진 손상 source 오류만 replay 분기에서 명시적 integrity 오류로 좁혀 처리하고 unknown DB 오류는 숨기지 않는다.

## 오케스트레이션과 독립 검토

root는 실제 UI/hook/공통 복구 컨트롤·부모 연결·E2E harness·브라우저·통합·문서를 맡았다. `link_ui_implementation`은 저장 repository와 HTTP/SQLite 재생 시험을 병렬 구현하고 3파일을 동결한 뒤 root UI를 읽기 전용 검토했다. 다른 두 agent의 기존 한도 오류는 재시도하지 않았다.

검토로 보완한 항목:

- P1: hook의 lazy activation 이름이 같은 effect 안의 lifecycle 변수와 겹친 TDZ. 내부 변수 이름을 분리했다. 첫 scoped lint는 이를 잡지 못했고 브라우저 실행 전에 보완했다.
- P2: `staleDraft=false`인 과거 읽기 전용 snapshot 화면에서 기존 pending 재확인 버튼이 없던 경로. `!canWrite`에서도 명시 재확인을 노출했다.
- P2: 원문 B를 선택만 한 상태가 stage되지 않던 경로. 명시적인 선택을 null-range draft로 저장한다.
- P2: 인증 오류 뒤 active 사본이 복구 목록 필터에 계속 숨던 경로. 무조건 삭제나 강제 opt-in 대신 위의 명시적 in-memory 복귀를 구현했다.

이 UI 지적은 코드 기반 검토 후 보완한 것이며 전부 독립 RED 실행을 확보했다고 주장하지 않는다. 서버의 최초 3 RED는 실제 revision/snapshot/both 진행 후 기존 POST가 409가 된 시험이다. 중간 46P/1F는 손상 source 오류가 500으로 올라온 경우이고 최종 서버 검증과 구별한다.

수정 뒤 agent는 숨긴 입력의 같은 ID/payload/scope 보존, 새 정책 확인과 동의 경계, opt-out/restricted 복귀를 다시 읽어 확인했고 추가로 확정할 데이터 유실·권한 결함은 찾지 못했다. 실행 없는 읽기 검토이므로 root 브라우저 결과를 독립 PASS로 바꾸지 않는다.

## 검증 기록

| 실행 | 최종 결과 | 범위/한계 |
| --- | --- | --- |
| agent83925 | 156/156 PASS, exit0,31.93초 | 기존 manual HTTP/SQLite56 + 새 replay47 + client receipt53. Next/workerd/실제 인증은 아님 |
| root23708 | 54/54 PASS, exit0,2.7분 | 기존 수동17 + 새 복구10, 각각 desktop/mobile. hidden-resume 후속 전 |
| root7151 | 6/6 PASS, exit0,25.3초 | 숨긴 pending의 재확인/정책 장애, opt-out·restricted in-memory 복귀. desktop/mobile |
| root23583 | 10파일 scoped lint exit0 | UI·hook·fixture·E2E·server·계약 시험. 전체 lint 아님 |
| root10629 | typecheck exit0 | hidden-resume와 새 시험 포함. Worker build 아님 |
| root88013 | 252/252 PASS, exit0,55.55초 | 서버56+replay47+receipt53+draft54+session16+store26. Node SQLite/HTTP·fake-indexeddb. 위156과 중복 합산하지 않음 |
| root59468 | 201 PASS / 1 FAIL, exit1,8.5분 | 수동60 + 기존 링크24 + snapshot24 + 세션6 + 이관40 모두 PASS. 정리본47P/1F는 아래 모바일 측정 오류 |
| root32529 | 48/48 PASS, exit0,1.8분 | 측정 보완 후 정리본 전체 파일, desktop/mobile. 최초202를 전체 PASS로 바꾸지 않음 |

브라우저는 실제 React/CodeMirror/Chromium IndexedDB·클립보드 대역·로컬 HTTP route 대역이다. 정상 fixture도 실제 URL source SHA와 실제 `manual-${id}` fragment-key 계약으로 맞췄다. 합성 fixture를 제품 성공에 맞추기 위해 검증을 완화하지 않았다. 새 320px 화면을 실제 렌더하고 scoped axe·가로 넘침 검사를 수행했다. root가 모바일 선택/복구 PNG를 열어 확인했다. 운영 사용자 시각 평가나 실기기 한글 IME 검증은 아니다.

### 통합 검사에서 드러난 측정 시점 오류

root59468의 유일한 FAIL은 정리본320px 모바일의 `up.y===down.y`였다(1338.421875 대1346.421875). 실제 trace에는 두 순차 Bounding box 호출 사이 smooth scroll이 계속되며 HTML scrollTop이2015→2007로8px 이동한 근거가 남았다. CSS는2열 grid이고 테스트가 서로 다른 viewport 시점 좌표를 비교했다. 두 버튼의 bounds를 한 번의 synchronous DOM read로 측정하도록 시험만 바꿨다. 정확 y 동일·각 버튼 높이44px 이상을 유지하고 좌우 비중첩 검사도 추가했다. 제품 CSS·전역 smooth scroll·허용 오차·timeout을 바꾸지 않았다. 이 후속 시험 파일은 아래10파일 hash 외에 별도 기록한다.

같은 통합 dev server에서는 snapshot reload 구간에 `The destination stream closed early` 로그1건도 출력됐으며 해당 시험은 통과했다. 출시 Worker runtime 검증이나 완전히 깨끗한 서버 로그를 주장하지 않는다.

후속 시험 lint root17544 exit0. `v2-prompt-curations.spec.ts` SHA-256은 `4D84115D6B87C6287AEB30842D01FACE2251C29E9D956AA51C8B9B2247F52D87`이다.01:27:54 KST에는3100 listener0으로 브라우저 서버 종료를 확인했다. 이후 정리본 helper는 [65번 별도 계약](./65_PROMPT_CURATION_DRAFT_CONTRACT.md)으로 인수했고 수동 검증252/브라우저202에 합산하지 않는다. 후속 시험·helper를 포함한 root78976 최종 타입검사 exit0.

주요 명령:

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/manual-link-fragments.test.ts tests/contract/v2/manual-link-fragment-replay.test.ts tests/contract/v2/manual-fragment-receipt.test.ts tests/contract/v2/manual-fragment-draft.test.ts tests/contract/v2/link-draft-session.test.ts tests/contract/v2/link-working-copy.test.ts
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-manual-fragments.spec.ts tests/e2e/v2-link-analysis.spec.ts tests/e2e/v2-link-snapshot-recovery.spec.ts tests/e2e/v2-link-draft-session.spec.ts tests/e2e/v2-prompt-curations.spec.ts tests/e2e/v2-prompt-curation-migration.spec.ts --output=test-results/manual-recovery-integration
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-prompt-curations.spec.ts --output=test-results/manual-recovery-curation-followup
npm run typecheck --workspace @light-house/web
```

## 잔여 작업

정리본 create/revise/undo/archive/unarchive와 snapshot 이관의 실제 draft/pending 복구를 같은 세션·정책에 연결한다. 이관된 based-on 그룹의 실제 ZIP/fresh/repeat와 삭제/tombstone 증분은 별도 검증한다. G07 출처별 검색/전용 뷰, G08 권한 있는 웹/Threads/Instagram 수집, G09 영상/자막/구간 분석, G10 최종 전체 회귀·Worker, G11 private corpus·실기기·운영 전환도 계속 남는다. 원격 배포·migration·provider 호출·환경값/모델 변경은 수행하지 않았다.

## 수동 checkpoint 파일 SHA-256

01:20:29 KST에 아래 10파일을 재계산했다. 이후 정리본 helper 추가는 이 수동 checkpoint와 분리한다.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/components/v2/record-manual-fragments.tsx` | `2D5C76A7904A80A1F1FE3D9DAC831C3BEF074DAF867A121151C348B1797CB602` |
| `apps/web/src/components/v2/editor/use-link-draft-recovery.ts` | `958A9B7FEB901DBBF50A54FF825F834F90D20A16F9DD17069D1F38277A1C53AF` |
| `apps/web/src/components/v2/editor/link-draft-recovery-controls.tsx` | `B2684CA3B6CA17F5F715ABFC5D86BC8F2DE425E7F10E732DB1B4F0AB70F50A7A` |
| `apps/web/src/components/v2/record-link-analysis.tsx` | `37C5444A23DC9615C3A3B0596AF985A40A035AD1B5C820CE05964DAEB94CC2BE` |
| `apps/web/src/components/v2/lab/link-analysis-audit-fixture.tsx` | `3D11C1E1DA2CE3FEA8167669E93A35FA86DE38FF2BF3FEA63BEAB76DA668DC6D` |
| `apps/web/tests/e2e/v2-manual-fragments.spec.ts` | `88E9D74B85CA9AF39E637E51FC0C62EB9BE3434E0569501759C44DAECD4AFE3E` |
| `apps/web/tests/e2e/support/prompt-curation-harness.ts` | `4A3135508BE996AAF7E4191E7C3E45B3B376723FB6A65C3DFE1A5845D91890B9` |
| `apps/web/src/lib/v2/infrastructure/d1/manual-link-fragment-repository.ts` | `3B2E2E0C0DE4E260524378E13917835E9D228BD23C856A90086C25E29F161872` |
| `apps/web/tests/contract/v2/manual-link-fragments.test.ts` | `AC9B14297920F6C105BA5C36AD7D882FE49EA531A0D5B681656E978DADC5C806` |
| `apps/web/tests/contract/v2/manual-link-fragment-replay.test.ts` | `59029EAFE2F831071D0FAE2C78815B8D2616CFC99E62CC26C10A7A23FBB421A8` |
| `apps/web/tests/e2e/v2-prompt-curations.spec.ts` | `4D84115D6B87C6287AEB30842D01FACE2251C29E9D956AA51C8B9B2247F52D87` |
