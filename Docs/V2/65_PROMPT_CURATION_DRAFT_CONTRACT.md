# 정리본 초안·미확인 요청 복구 데이터 계약

2026-09-09 01:33 KST 당시 순수 helper checkpoint. [64번 수동 화면 복구](./64_MANUAL_FRAGMENT_RECOVERY_AND_REPLAY.md) 다음 연결을 준비한 기록이다. 실제 정리본 UI 연결·후속 검증은 [66번](./66_PROMPT_CURATION_RECOVERY_AND_RECEIPTS.md)을 따른다. 아래의 미연결/다음 단계 표현은01:33 당시 상태이며 이관 복구는 여전히 남는다. [50번 전체 goal](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)은 active, 약48%다.

## 구현 인터페이스

`apps/web/src/lib/v2/editor/prompt-curation-draft.ts`:

- `PromptCurationRecoveryDraft = { contract: 'prompt-curation-draft.v1', draft: PromptCurationEditorDraft | null, pending: PromptCurationPending | null }`
- editor draft는 실제 UI의 basis/groupKey/head/content/선택 originals/dirty/conflict에 대응한다.
- pending은 `{kind:'create'|'revise', groupKey, request, originals}`다. 기존 서버의 strict create/revise body를 사용한다. URL·현재 UI scope·owner 주장·clearDraft 같은 transport/화면 상태는 권한처럼 저장하지 않는다.
- `parsePromptCurationDraft(unknown)`은 저장된 엄격 JSON을 검증한다.
- `capturePromptCurationDraft(unknown)`만 실제 UI의 누적 originals에서 선택된 조각을 남기고, 알려진 optional sourceItemId/sourceUrl/isManual의 없거나 undefined인 값을 null로 정규화한다. stored 후보의 빈 memberId도 명시 null이 된다. 임의 unknown 필드를 조용히 삭제하지 않는다.
- `promptCurationScope`는 원래 document revision/snapshot/manifest/group/head/action/undo 대상을 구분한다. 제목·요청 키 변경만으로 독립 그룹을 만들지는 않는다.
- `promptCurationDraftRequest`는 kind/groupKey/request/originals 전체를 반환한다. 이미 pending이 있으면 원래 key/body만 허용하며 최신 basis로 자동 치환하지 않는다.

## 보존과 검증 경계

빈 제목·선택 조각 없음·alternatives 전환 중 아직 전체 이미지로 남은 연결 등 실제 미완성 UI 입력은 복구할 수 있다. 유효한 서버 요청과는 구별하므로 그 상태로 pending을 만들 수는 없다. CRLF·공백·이모지·유니코드 정규화 차이는 그대로 보존한다.

선택 후보 cache는 fragment ID별로 한 개만 보관하지만 명시적인 중복 itemKey/순서는 유지한다. 64조각·64이미지의 기존 상한을 낮추지 않는다. 기존 source role/stateVersion·snapshot와 선택 item의 일치를 검사한다. 읽기 후보인 manual/ai/stored 출처를 보존하되 AI 해석·개인 메모·허위 검증 필드를 원문 권한으로 받지 않는다. accessor/prototype/sparse array/cycle/unknown/초과 입력은 실패시키며 잘라 저장하지 않는다.

create/edit pending은 draft의 원래 basis/head/content/group/originals와 exact 일치를 요구한다. undo/archive/unarchive는 `draft=null`이어도 완전한 pending이 남는다. archive/unarchive의 originals는 원래 `expectedCurationRevisionId` 내용, undo는 `restoreRevisionId` 대상 내용이라는 호출자 계약이다. parser가 DB에서 그 결합을 독립 증명하는 것은 아니다.

## 다음 실제 UI 연결

1. `record-prompt-curations.tsx`에 owner/record key, 공통 recovery hook·명시 후보 UI를 연결한다. UI type의 readonly/null 정규화 어댑터도 함께 맞춘다. 기존 `prompt-curation-editor.tsx`의 메모리 전용 안내는 연결 완료 시에만 바꾼다.
2. draft와 pending을 함께 stage하고 원래 요청을 flush한 뒤 POST한다. 여러 그룹/이관 리뷰로 이동할 때는 park를 먼저 확인한다. `draft=null` transition의 unload/복구도 빠뜨리지 않는다.
3. 새 요청과 기존 pending 재확인 전에 인증된 원래 snapshot·fragment/attachment·revision을 조회한다. undo 대상과 현재 head를 혼동하지 않는다. 기존 repository는 receipt 검증을 current CAS보다 앞서 수행하지만 UI의 현재 canWrite/scope 제한과 단순 receipt 확인은 보강해야 한다.
4. create/edit/undo/archive/unarchive별 엄격 receipt 검증 뒤 immutable token으로만 정리한다. 손상2xx·응답 유실·현재 scope 진행·권한 만료·동의 철회·다른 그룹 입력 경합을 실제 desktop/mobile에서 검증한다.
5. 이관의 source/target/plan/context/group/key 복구는 별도 kind이며 확인 checkbox를 복구하지 않는다. 이 helper로 이관 완료를 주장하지 않는다.

## 검증·오케스트레이션

agent `link_ui_implementation`은 helper/전용 시험2파일만 구현하고01:32:15에 동결했다. root는 수동 통합을 병행한 뒤 두 파일 전체를 읽어 검토했고 hash를 재계산했다. 초기 원격/DB/React API를 이 helper에서 실행하지 않는다.

- agent 최종 **285/285 PASS**,exit0,1.42초: 신규90+기존 request141+manual draft54. 두 파일 lint exit0.
- root01:33:00 **90/90 PASS**,exit0,0.656초: 새 전용 파일 인수 재검증. 위285와 중복 합산하지 않는다.
- 중간 root90925 타입 검사 exit2는 시험의 readonly `structuredClone` 반환값을 mutable fixture에 대입한 TS2322 한 건이다. 시험에 명시 mutable 타입을 표시해 보완했고 제품 helper는 변경하지 않았다. root78976 최종 타입 검사 **exit0**이며 수동 후속 측정시험과 새 helper/시험도 포함한다.
- 실제 화면/IndexedDB 연결·원래 revision GET·성공 receipt 검증·Worker·원격 인증은 이90개 순수 계약 검사의 범위 밖이다.

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-draft.test.ts tests/contract/v2/prompt-curation-request.test.ts tests/contract/v2/manual-fragment-draft.test.ts
npm run typecheck --workspace @light-house/web
```

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/lib/v2/editor/prompt-curation-draft.ts` | `3A7240FC3F97218BED938DAD08966D6A2425E35FFEF7C2E7C1B4AF45D55FAF1F` |
| `apps/web/tests/contract/v2/prompt-curation-draft.test.ts` | `84DA3562AB26AC8900796276FE21A52BF83FFA9DFEF648662C250081A36EA9EC` |
