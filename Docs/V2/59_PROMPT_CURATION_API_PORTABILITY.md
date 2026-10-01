# G06 · 실제 정리본 HTTP API와 V2 이동성 결합

작성: 2026-09-08. 이 문서는 전용 검사의 범위·실패·최종 실행 증거를 기록한다. 전체 goal 완료·원격 복원·개인 corpus 검증을 의미하지 않는다.

현재 시험 파일은 [69번 후속 이관·삭제 증분 시나리오](./69_MIGRATED_CURATION_PORTABILITY.md)의8단계로 확장되었다. 아래4개 시험·해시·실행 시간은2026-09-08 당시 결과이며 현재 코드의 최종 근거로 대신하지 않는다.

**최종 결과: 세션 `43860`, 4/4 PASS, exit 0, 939.53초.** 실제 HTTP 생성/edit/undo → full/incremental → 실제 V2 ZIP → indexing부터 fresh/repeat 복원을 통과했다. 23:15:52 KST 두 proxy dispose와 workerd 0을 확인하고 단독 실행 창을 root에게 반환했다. 앞의 두 실패 실행은 당시 증거로 보존한다.

## 검사 경로

전용 파일: `apps/web/tests/contract/v2/prompt-curation-api-portability.test.ts`.

1. 격리 로컬 workerd D1/R2 두 개에 0006–0032 migration을 적용한다. `getPlatformProxy({persist:false,remoteBindings:false,envFiles:[]})`를 사용하며 기존 DB/R2·환경 파일은 변경하지 않는다.
2. pre-verified synthetic image reservation만 fixture로 만들고, 제품 capture commit과 snapshot bootstrap을 수행한다. 수동 발췌와 정리본 생성/edit/undo는 실제 HTTP route를 호출한다. 인증 세션·restricted grant·binding 주입만 대역이다.
3. 실제 `stageBackupWorkflow`/`advanceBackupWorkflow`로 full을 완료하고, HTTP edit/undo 후 incremental을 완료한다. 체인의 manifest·원본 checksum·정리본 delta를 검증한다.
4. 동일한 정본 상태에서 실제 `advanceResumableExportWorkflow`로 ZIP을 생성한다. ZIP을 검증한 뒤 46개 테이블의 envelope를 제거한 정확 canonical row 집합을 full+incremental materialization과 비교한다.
5. 빈 대상 DB/R2에서 실제 `stageArchiveRestore`의 indexing부터 manifest 검증·원본 검증·materialization·planning·명시 approval·apply·cleanup을 수행한다. 기존 planning checkpoint나 restore row를 직접 seed하지 않는다.
6. 같은 ZIP을 다른 restore 요청 키로 다시 indexing부터 처리한다. HTTP 이력과 역할별 정확 복사, 동일 논리 revision/이미지 generation, FK closure를 확인한다.

백업 체인 자체를 ZIP으로 바꾸는 제품 기능은 현재 없다. 4번은 **동일한 정본 상태의 두 산출물 비교**이며, 존재하지 않는 backup→ZIP 변환 API를 통과했다고 주장하지 않는다.

## 보호와 범위

- prompt/negative/parameters를 구분한다. CRLF·앞뒤/연속 공백·이모지·의도적 중복을 보존하고 개인 메모가 복사 문자열에 섞이지 않는지 확인한다.
- whole/item 이미지 대응 두 개를 보존한다. 이미지 bytes는 합성 PNG header이며 실제 디코딩/시각 품질 검사는 아니다.
- 대상 owner로 재매핑하고 source owner의 객체가 생기지 않는지 확인한다. AI flag는 꺼져 있다.
- 각 advance의 기존 검사 경계(export 20 / backup·restore 40 SQL statements, 최대 600 advances)를 유지한다. 새 전용 phase의 timeout은 기존 긴 통합 검사와 같은 300초이며 실패를 숨기기 위해 늘리지 않는다.
- Next/dev/typegen/build/브라우저·원격 migration/배포·실제 제공자 호출을 수행하지 않는다.

## 실행 기록

- 새 검사 파일 ESLint: 22:29 KST, exit 0, 오류/경고 0.
- 첫 명령: `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-api-portability.test.ts`.
- 첫 실행 시작: 22:30 KST, 세션 `54153`. root에게 단독 workerd 창을 승인받았다.
- 격리 workerd: PID 15796의 127.0.0.1:6339/6340, PID 4936의 127.0.0.1:14974/14975. 종료 시 두 플랫폼 dispose를 확인한다.
- 첫 실행 `54153`: **1 PASS / 3 FAIL, exit 1, 352.39초**, 22:29:57 시작. full 단계 143.891초, edit/undo·incremental 단계 148.133초. 두 플랫폼 dispose 출력과 22:36 KST workerd 프로세스 0을 확인했다.
- 실패 원인은 V2 backup의 `CHANGE_KIND_BY_TABLE`에 정리본 3개가 빠져 incremental 안에서 `metadataMode=full`로 처리된 것이다. full/증분 snapshot 자체는 succeeded였지만 계약 검사에서 delta를 기대하여 중단했다. 기존 V1에는 매핑이 있다. 이는 데이터 손실이라는 주장이 아니라 V2 증분 변경/tombstone 경로의 미연결이다. root에 정확한 세 매핑 보완을 요청했다.
- 후속 두 FAIL은 선행 ZIP이 아직 생성되지 않아 발생한 의존 실패다. fresh/repeat 복원은 미진입이며 결과가 없다.
- 검사 자체의 별도 정적 오타 두 개(assertion 테이블명, ZIP 진행 로그 속성)는 22:36 KST 정정했다. 최초 실패 위치와 무관하고 제품 수정으로 계산하지 않는다.
- root의 좁은 제품 파일 위임 후 22:37:50 KST `resumable-backup-v2.ts`의 변경 종류 목록에 세 엔트리만 추가했다. 0032 insert/delete trigger와 V1의 이름을 그대로 대조했다.
- 두 번째 격리 workerd: PID 20768의 127.0.0.1:4198/4199, PID 15680의 127.0.0.1:4695/4696. 두 수정 TS 파일 ESLint는 22:38 KST exit 0, 오류/경고 0이다.
- 두 번째 `64589`: **2 PASS / 2 FAIL, exit 1, 668.07초**, 22:37:57 시작. full 139.774초, edit/undo·incremental·ZIP 249.342초. 정리본 세 테이블의 delta와 full+delta/ZIP **46개 테이블 정확 비교는 PASS**다. ZIP은 **54,312 bytes**, SHA-256 `cffecf844fdb506f65ac854778858e48211266fa365dd191f0ff863a029bc3d3`.
- 실제 fresh ZIP restore `01M20M8ECHRH20G5869ZY7QG67`는 **succeeded**, 파일52개 검증/소비, 정본40행 create/apply, fork/conflict/invalid/rollback conflict 0이다. 이어진 HTTP 대조에서 POST receipt의 역할 간 입력 순서와 GET의 `copy_role,position` 정렬을 동일하다고 가정한 새 fixture가 실패했다. 원문/manifest 손실로 판정하지 않는다. source DB의 실제 GET을 보존해 target GET과 깊게 비교하도록 검사만 정정했다. 역할 내부 순서나 의도적 중복을 정렬해서 없애지 않는다.
- 두 번째 repeat 검사는 같은 선행 HTTP 대조에서 막혀 **미진입**이다. 두 플랫폼 dispose를 확인한 후 workerd 창을 root에게 반환했다. 최종 전용 재검사는 아직 필요하다.

## 실행 초기 해시와 동시 변경 한계

22:30 KST 실행 초기 읽은 SHA-256이다. 프로세스 시작 직전의 원자적 파일 freeze는 아니며 root의 별도 snapshot migration 구현이 병행된다. 종료 시 재해시하고 달라진 제품은 이 실행을 최종 코드 PASS로 삼지 않는다.

| 파일 | SHA-256 |
| --- | --- |
| 새 전용 검사 | `B6BB1F4C9DE50F855CE4CE05435E201404987148A7474311EB7950175B598EF1` |
| prompt-curation-catalog.ts | `92A76337F0500AF949A7D6E5A2D9871521ED45FC285473BA5F9D37EA6680154F` |
| prompt-curation-repository.ts | `4EF356067C5E2098C96AA41BC8FB279BF6D3739AFCA8B5649D54111871A6BBFE` |
| resumable-restore-v2.ts | `65DEB900F7ED7D843C3529F906EC99B6F479C5793F300A6C445606D4CC84D4DB` |
| resumable-export-v2.ts | `14B65EFB85ABB2A50CF1B51F214A2BABE92F74BCC7375FAFE22A42C26C69980A` |
| resumable-backup-v2.ts | `6911E442EBBFEA04456C05143562FF12F87FC0AE4AA7AF31A891E8A53ECC77D1` |

22:32 KST catalog는 root 변경으로 `9151EE7F24A78F41ECC5647969030E1C8CC3F622373A4BFC38E360283AACA6B3`가 되었다. 저장 일반 경로 최종 회귀는 root가 변경 완료 후 별도로 소유한다.

두 번째 실행 직전 해시:

| 파일 | SHA-256 |
| --- | --- |
| 새 전용 검사 | `1EF7276DF964079E5367DA76EBC397716D0010DEA75886A5FF210C1131822715` |
| resumable-backup-v2.ts | `CD9CDC82B0B6E2DDEDC95E70FC27C821EFD306961FEC09A3546E1857EC29D6FC` |
| prompt-curation-catalog.ts | `9151EE7F24A78F41ECC5647969030E1C8CC3F622373A4BFC38E360283AACA6B3` |
| prompt-curation-repository.ts | `ACB3B23834A3F0E0888101F496EA384291595F0275B37ABA6112AA10A4020539` |

V2 restore/export의 해시는 첫 실행 초기 값과 같다. 부모의 병행 구현으로 catalog/repository가 다시 바뀔 수 있으므로 종료 시 비교한다.

22:50 KST 두 번째 종료/fixture 정정 후: workerd 프로세스 **0**, 두 proxy dispose 확인. backup/restore/export와 repository 해시는 두 번째 시작 값과 같고, catalog만 root의 추가 구현으로 `9909F05B1A8BE7785147C9B5E35D80298CA74EA31B4E1DE1641B82106EFDB5E0`로 바뀌었다. GET 기준 비교를 적용한 새 검사 해시는 `7C0ADC293D38729B10307926D3C8AD8535AC7111B4BC69E8D6E32983122BA5C8`이다. 다음 실행은 root의 D1 검사 창 반환 후에만 시작한다.

## 세 번째 전용 재검사

- root의 workerd 창 반환 후 **22:58:23 KST**, 같은 명령으로 세션 `43860`을 시작했다. 시작 전 workerd 0이다. 격리 proxy는 PID 24264의 `127.0.0.1:3414/3415`, PID 23824의 `127.0.0.1:3907/3908`이다.
- 시작 해시: 검사 `7C0ADC293D38729B10307926D3C8AD8535AC7111B4BC69E8D6E32983122BA5C8`, backup `CD9CDC82B0B6E2DDEDC95E70FC27C821EFD306961FEC09A3546E1857EC29D6FC`, catalog `668892BB662C90926E0B92DB97175E644A2D5454E4C580DE9DB3640CD52EC7F4`, repository `81DDE87CA6235BF75521D30773017FAAAE4B71480878B6076662F003EA10429A`. V2 restore/export 해시는 첫 실행 값과 같다.
- source POST receipt의 prepared manifest와 source GET의 prepared manifest를 비교한 후 실제 source GET 전체를 target GET 대조 기준으로 사용한다. 역할 내부 순서·의도적 중복·CRLF·공백·이미지 대응을 지우는 정규화는 하지 않는다.
- 최종 **4/4 PASS, exit 0, 939.53초**다. Vitest 시작 22:58:26, 각 단계는 full 143.665초, edit/undo·incremental·ZIP 253.283초, fresh 234.352초, repeat 247.944초였다. 300초/단계·query 상한은 변경하지 않았다.
- full snapshot `01M20N242HBNY6PKZAGAMKYAH3`, manifest root `sha256:d9875f644c13a71da302238029c59e29c0c57289078f6e44548ab18283bc74c1`.
- incremental snapshot `01M20N6PE68NPNAFE8HNBPEY9D`, manifest root `sha256:dfe339bc667ee982b4029d097ad0db074f6bd29441ed1f1c1f38370c8d9607c2`. 정리본3테이블 모두 delta였고 revision delta는 edit/undo 두 개만 포함했다.
- 실제 ZIP **54,312 bytes**, SHA-256 `4100ca70b976c8c70f23917bfc233d86394d9f943fa9deaccfbae0c2b265c315`. full+incremental과 ZIP의 정본 **46테이블** 정확 일치를 확인했다.
- fresh batch `01M20NE6690Z48946N5DEXPPRY`: 파일52개 검증/소비, 정본40행 create/materialize/plan/apply, conflict/invalid/fork/rollback conflict0. 실제 HTTP로3버전 이력·역할별9개 정확 복사·manifest·이미지 대응 및 R2 원본 바이트를 확인했다.
- repeat batch `01M20NNW53RTED25T9WMKBRXNG`: ZIP indexing부터 다시 실행하여 **create0/reuse40**, conflict/invalid/fork/rollback conflict0. 전후3정본테이블 전체 row·이력/복사·이미지 object key/바이트 불변, target owner 정규 FK, workflow lease assertion 잔여0을 확인했다.
- `api-portability disposed 2 isolated workerd platforms` 최종 출력 및 23:15:52 KST 실제 workerd0을 확인했다. 시작/종료의 검사·backup·catalog·repository·restore·export **6개 SHA-256 모두 일치**했다. root의 별도 이관 UI/helper 작업은 이 검사에 포함되지 않는다.

## 최종 판정의 한계

- 로컬 workerd D1/R2의 실제 제품 경로이며 Node SQLite 모형이나 완료 checkpoint 직접 seed가 아니다. HTTP handler를 직접 호출한 Request/Response 통합 검사로, 실제 네트워크 인증/배포된 Worker/브라우저 검증은 아니다.
- 새 그룹 생성/edit/undo 이력을 검증했다. 명시 snapshot 이관으로 생성한 based-on 그룹까지 포함한 추가 restore closure, 정리본 tombstone이 있는 실제 V2 증분 삭제, 충돌 소유자의 새 PK 재매핑은 이 네 검사 범위가 아니다.
- 정본 delta 매핑의 누락을 보완한 것은 증분 계약 연결이며 데이터 손실을 재현했다는 의미가 아니다. 원격 migration/배포·실제 사용자 원문·실제 이미지 디코딩·Gemini 호출·전체 suite/최신 Worker·운영 gate는 수행하지 않았다.
- fixture/backup 두 TS 파일의 마지막 scoped ESLint는 exit0, 오류/경고0이었다. 전용 실행 이후 이 두 파일은 변경하지 않았다. 새 이관 response helper의 별도 순수 검사는 위4개 이동성 결과에 합산하지 않는다.
