# 41. I7 Portability, Backup, Restore, Legacy Migration 구현 근거

> 상태: coded implementation 및 local gate 완료 · live D1/R2 inventory와 private cutover는 미검증
> 검증일: 2026-08-12

> 이 문서는 2026-08-12 I7 시점의 역사적 검증 기록이다. 이후 live inventory·56/56 adapter coverage, `0018`~`0029` hardening, nonprojected visibility·quarantine·provider invocation fence가 진행됐다. 현재 운영 상태와 미완료 gate는 [44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md](./44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md) 및 [26_LEGACY_INVENTORY_AND_CUTOVER_RUNBOOK.md](./26_LEGACY_INVENTORY_AND_CUTOVER_RUNBOOK.md)를 따른다. 아래의 인증 실패와 migration 개수는 당시 결과이며 현재 상태로 읽지 않는다.

## 구현 결과

### Portable/Migration export

- migration 0017에 user별 change sequence, export job, backup snapshot, restore batch/row, immutable legacy envelope/mapping을 추가했다.
- `Lighthouse Export Bundle v1`은 고정 canonical table registry를 사용한다. `portable`은 Markdown·metadata·원본을, `migration`은 revision·registry·evidence·source JSONL까지 포함한다.
- 모든 payload는 파일별 SHA-256·byte count·record count와 `checksums.sha256`, manifest root hash로 검증한다. manifest에 없는 파일, 중복/절대/상위 경로, CRC 손상, 지원하지 않는 압축·암호화는 거부한다.
- restricted는 기본 범위에 없고 최근 재인증 후 명시적으로만 포함한다. ZIP 자체는 암호화되지 않는다는 경고를 생성·다운로드 UI 양쪽에 유지한다.
- ZIP writer는 stored ZIP32 data descriptor를 사용하며 R2 multipart로 바로 흘려 보낸다. 2 GiB 논리 원본 검증 결과 largest chunk 8 MiB, max ArrayBuffer 8,458,005 bytes, max RSS 114,106,368 bytes, 37,675 ms로 `bounded=true`였다.

### Restore와 rollback

- 업로드 복원은 verify → checksum/schema/reference closure → dry-run → 명시적 checkbox 승인 → import 순서다. interactive ZIP은 decompression bomb 방어를 위해 256 MiB, file count, entry size, total size budget을 적용한다.
- dry-run은 create/reuse/fork/conflict를 table별로 계산하며 hash가 import 시점과 다르면 중단한다. ID와 content가 같으면 reuse, ID가 같고 content가 다르면 fork하며 composite/settings 충돌은 자동 overwrite하지 않는다.
- import는 allowlisted table/column과 parameter binding만 사용하고 D1 batch를 80 statement 이하로 제한한다. attachment는 SHA-256/size를 다시 확인한 뒤 private restore namespace에 저장한다.
- 복원 중 어느 table에서든 실패하면 이미 만든 row와 attachment만 역순으로 제거한다. reused row는 제거하지 않는다. 같은 bundle의 두 번째 restore는 신규 0이며, 각 batch rollback 경계가 분리된다.
- 선택한 private backup도 full+incremental chain을 검증·합성해 같은 dry-run/import/rollback 엔진으로 복원한다. backup blob source와 복원 destination R2를 분리하고 8 MiB multipart streaming copy를 사용한다.

### 자동 private backup과 보존

- full snapshot은 전체 canonical metadata를, incremental은 change event가 있는 단일키 aggregate만 delta로 기록하고 나머지는 보수적으로 full shard로 기록한다. metadata mode는 manifest root hash에 포함된다.
- backup 성공은 fixed end sequence, metadata body SHA/schema/count 재검증, manifest 재다운로드 검증, 모든 content-addressed original의 size/hash 확인, 최종 source sequence 불변을 모두 통과한 뒤에만 기록한다.
- 자동 maintenance는 월간 full → 주간 full → 일간 incremental 우선순위를 사용한다. manual 또는 pin snapshot은 자동 정리하지 않으며 daily 30, weekly 12, monthly 12와 retained incremental의 모든 chain ancestor를 유지한다.
- snapshot metadata/manifest를 정리해도 blob은 즉시 삭제하지 않는다. 모든 retained ref가 0인 hash에 GC mark를 만들고 7일 뒤 다시 ref가 0일 때만 backup blob namespace에서 삭제한다.
- `/v2/settings/data`에서 수동 full/incremental 생성, 검증, pin, 선택 backup dry-run·승인 복원, export/ZIP 복원과 rollback을 제공한다. secret-authenticated `/api/v2/backups/maintenance`는 최대 50 account를 bounded 순회한다.

### Legacy migration

- 0000~0005 SQL에서 인증 상태인 `users`, `sessions`를 제외한 36개 legacy data table을 모두 versioned adapter registry에 등록했다.
- 글·기록 성격의 19개 table은 source text와 명확한 rating/measurement만 deterministic Document/type/property로 투영한다. source text와 typed value가 모두 없는 빈 shell은 Document를 만들지 않는다.
- relation, notification, audit, attachment metadata, UI/old job state 17개 table은 가짜 글로 만들지 않고 immutable `archived_only` envelope/mapping으로 보존한다. 이 raw archive는 restricted export를 명시적으로 선택한 경우에만 포함한다.
- 부모에만 `user_id`가 있는 checklist/place visit/relation과 composite identity를 adapter의 고정 join scope·identity columns로 처리한다. table/column/SQL은 registry allowlist이며 request 값으로 동적 identifier를 만들지 않는다.
- table dry-run은 최대 5,000 row의 identity+row hash root, 예상 Document/archive 수, damage code만 반환하고 원문은 응답하지 않는다. 현재 `0018` 계약에서는 동일 dry-run hash를 명시 승인하고 legacy write를 잠근 뒤 server 요청당 projection 1개를 처리한다. UI는 이를 최대 100 rows까지 순차 호출하며, row의 모든 projection이 끝나야 offset을 이동한다. 모든 non-empty table의 source-only와 전역 재대조 뒤에만 knowledge batch가 열린다.
- migration workbench는 실제 row/column coverage, dry-run, source-only/knowledge offset, envelope/projected/archived reconciliation을 보여준다. AI는 이 경로에서 호출되지 않는다.
- live inventory 도구는 SELECT/PRAGMA만 허용하고 D1 schema/count/timestamp range를 세 번의 Wrangler batch로 수집한다. R2 도구는 key/size/ETag/time만 기록하며 ETag를 SHA-256으로 간주하지 않는다.

## 자동 검증 결과

- `npm.cmd test -- --run`: 25 files, 124 tests 통과
- I7 집중 계약: ZIP/path/corruption/large-source, export→empty restore, source Markdown 보존, restricted 기본 제외, duplicate 0, fault injection rollback, backup full+incremental→empty restore, attachment streaming copy, legacy envelope·composite scope, retention grace GC를 포함한 12 tests 통과
- `npm.cmd run test:e2e`: 50 cases 중 적용 가능한 33건 통과, device/project별 의도된 17건 skip
- `npm.cmd run lint`: 0 errors, Next 16 compiler 권고를 포함한 30 warnings 유지
- `npm.cmd run build`: Next.js 16.3 production build 통과, 81 static pages와 모든 V2 API route 생성
- `npm.cmd run typecheck`: 통과
- `npm.cmd run db:check`: `Everything's fine`
- `npm.cmd run portability:spike:large`: 2,147,483,648-byte logical source, largest chunk 8,388,608 bytes, bounded pass
- `npm.cmd run migration:inventory:d1 -- --run-id local-i7-tool-validation-2`: read-only tool 실행 성공, 별도 persisted local DB가 비어 있어 tables 0/rows 0
- 0000~0005 SQL 자동 추출 검증: legacy tables 38, auth 제외 2, adapter 36, uncovered column 0, unregistered data table 0

## 통과한 I7 gate와 경계

- migration ZIP과 private backup chain 모두 빈 D1/R2 target으로 round-trip했다.
- source Markdown 공백과 attachment SHA-256/size를 보존했다.
- 두 번째 restore의 create/fork는 0이었다.
- injected D1 failure 뒤 live source/object/document residual은 0이었다.
- source-only envelope 수·distinct hash·mapping status를 batch 단위로 reconciliation했다.
- media rating 4.5와 본문을 deterministic projection으로 회수했고 원 envelope는 UPDATE trigger가 거부했다.
- retention 31번째 daily snapshot은 prune되었지만 blob은 7일 전에는 존재했고, 7일 뒤 unreferenced 재확인 후에만 삭제되었다.

## 남은 외부 release gate

- remote D1 inventory 실행은 현재 `Wrangler is not authenticated. Run wrangler login or set CLOUDFLARE_API_TOKEN`에서 중단됐다. live row count·timestamp·column drift를 수집하지 않았으므로 live adapter coverage 통과를 주장하지 않는다.
- R2 S3 credential 환경 변수도 설정되어 있지 않아 live key/size/orphan inventory를 실행하지 않았다.
- 실제 live source-only 전체 행 envelope count/hash reconciliation, attachment orphan 분류, adapter별 manual sample, final delta와 rollback drill은 private cutover 전에 수행해야 한다.
- private 20-case corpus, Gemini live role, Linux/Worker deployment, 실제 Windows·Android·screen reader·IME, 2주 owner observation은 I8 gate다.
