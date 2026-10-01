# 43. I8 Legacy Migration Hardening 근거

> 상태: `0018`~`0025` 시점의 역사적 local hardening 근거 · 현재 상태는 문서 44를 따름
> 검증일: 2026-08-29

> 2026-08-29 후속 구현에서 `0026`~`0029`, nonprojected visibility, quarantine, provider invocation lease, canonical owner/referential closure가 추가됐고 archive 구현 schema가 `v2-020`으로 올라갔다. 최신 local/remote 경계는 [44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md](./44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md)를 따른다. 아래 `v2-018`, 26/26, remote `0018`~`0025` 표현은 당시 검증 snapshot이며 현재 전체 상태로 읽지 않는다.

## 결론

이번 hardening은 “dry-run hash를 승인했다”는 사실만으로 live 데이터를 투영하지 못하게 만들었다. 실제 migration 실행에는 legacy write 잠금, 지속되는 승인 manifest, 행·투영 단위 진행 기록, 구조 대조 영수증이 모두 필요하다. knowledge 단계는 모든 비어 있지 않은 legacy table을 D1 cursor로 조금씩 재검증한 뒤에만 준비되며, 준비된 지식도 batch가 최종 성공하기 전에는 보이는 데이터가 되지 않는다.

현재 경계는 다음과 같다.

| 구분 | 현재 상태 | 완료로 간주하지 않는 것 |
| --- | --- | --- |
| `0018`~`0025` schema와 repository | 로컬 구현, fresh 26-migration 적용 및 집중 계약 통과 | remote D1 적용·deploy |
| 56개 adapter의 read-only live coverage | 56/56, 34개 non-empty, adapter 대상 2,291 rows를 artifact로 확인 | 원문 표본의 사람 승인 |
| live recovery baseline | D1 Time Travel bookmark와 verified backup ID 기록 | 실제 restore drill |
| source-only | live row 0건 실행 | envelope/mapping 전체 대조 |
| knowledge | live row 0건 실행 | 실제 Document/type/property/evidence 승격 |
| cutover | `FLAG_V2_LEGACY_READONLY="0"` 유지 | legacy mutation 중단, `capture_default` |

따라서 이 문서는 **코드 hardening 완료 근거**이지 **원격 migration 완료 보고서**가 아니다.

## 2026-08-29 local release hardening 추가 근거

| 항목 | 확인 결과 | 주장하지 않는 것 |
| --- | --- | --- |
| fresh local D1 | isolated persistence에서 `0000`~`0025` 26/26 applied | remote D1 migration |
| Worker binding drift | `npm.cmd run bindings:check` passed | production binding/deploy smoke |
| restore lease fencing/schema | focused 12/12 passed | 모든 외부 R2 장애 형태의 소진 |
| independent lease-fencing review | runtime·validation P0/P1 잔여 없음 | 전체 제품 독립 감사 완료 |
| cutover browser contract | Capture 1/1, Library 1/1 passed | owner 14일 관찰·실제 cutover |
| private sample core | 4/4 passed | private source 20/20 승인 |

`0021`은 backup 생성 재개, `0022`는 export packaging 재개, `0023`은 retention/GC 작업 영수증, `0024`는 fixed 8 MiB part restore upload 재개, `0025`는 backup/restore parent CAS·lease assertion과 restore publication/cleanup fencing을 schema에 추가한다. stale worker가 lease를 잃은 뒤 child mutation 또는 canonical object를 채택하지 못하는지가 focused contract의 핵심이다.

전체 web Vitest, production build, Worker build는 위 집중 결과와 별도의 최종 release gate다. 이 표는 확인된 focused 결과만 기록하며 전체 suite 완료를 대신하지 않는다.

## migration `0018`의 불변 조건

### 승인과 진행 상태를 D1에 남긴다

- `v2_legacy_migration_batches`는 table, adapter version, mode, dry-run hash, schema snapshot, immutable manifest, 입력 행 수, 예상 mapping 수, authoritative `next_offset`, 상태와 reconciliation receipt를 보존한다.
- `v2_legacy_migration_batch_items`는 승인 manifest의 각 위치에 legacy identity, row hash, envelope ID, 예상 mapping 수와 처리 상태를 고정한다.
- 같은 batch ID의 재요청은 기존 계약과 정확히 같을 때만 replay된다. table, mode, hash, adapter 또는 manifest가 다르면 새 작업으로 덮지 않고 중단한다.
- `succeeded` 전환 trigger는 offset, 성공 item 수, mapping 수, source/object dependency, `knowledge_pending=0`, 유효한 reconciliation receipt를 D1 안에서 다시 검사한다. 애플리케이션의 성공 응답만으로 성공 상태를 만들 수 없다.

### 원본과 투영 identity를 분리한다

- envelope의 자연 identity는 `user_id + legacy_table + legacy_id + row_hash + schema_snapshot`이다. 같은 row JSON이라도 schema가 바뀌면 새 envelope가 된다.
- mapping의 자연 identity는 `user_id + legacy_envelope_id + adapter_version + projection_kind`다. 한 legacy row가 여러 글을 만드는 경우 각 projection을 독립적으로 추적한다.
- adapter version 또는 source hash가 바뀐 결과는 기존 projection을 제자리 수정하지 않는다. 새 envelope/mapping을 만들고 최종 knowledge 성공 시 이전 mapping을 `superseded`로 연결한다.
- envelope와 batch/mapping/item 변화는 `v2_change_events`에 기록되어 export와 incremental backup에서 누락되지 않는다.

## 실행 계약

### 0. legacy write 잠금이 선행한다

`/api/v2/migration/run`은 `FLAG_V2_LEGACY_READONLY=1`이 아니면 `409 legacy_source_not_locked`로 거부한다. repository도 별도 `legacyReadOnly` capability가 없으면 source-only와 knowledge 모두 거부하므로 route 우회 호출로 잠금을 생략할 수 없다.

이 조건은 migration 전에 legacy 데이터를 고정하기 위한 안전장치다. 현재 `wrangler.toml`은 의도적으로 `0`이므로 remote 실행은 아직 열리지 않았다.

### 1. source-only

1. 최근 재인증 뒤 table dry-run을 만든다. 단일 table manifest는 최대 5,000 rows이며 identity·row·projection root hash와 schema snapshot을 포함한다.
2. 사용자가 현재 dry-run hash를 승인하면 server가 batch와 manifest를 저장한다.
3. 한 요청은 한 projection만 만든다. source text와 deterministic projection은 archived lifecycle로 먼저 생성되고 mapping은 `source_only`가 된다. 글을 만들지 않는 row는 immutable `archived_only` mapping으로 보존한다.
4. 한 row에 여러 projection이 있으면 같은 offset에서 계속한다. 모든 projection의 source/object dependency가 확인된 뒤에만 item을 성공 처리하고 offset을 1 올린다.
5. 마지막 row 뒤 현재 source hash를 다시 확인하고 manifest·item·envelope·mapping·dependency를 대조한 receipt가 통과해야 batch가 성공한다.

기존 문서의 “25행 단위” 설명은 더 이상 실행 계약이 아니다. UI는 한 번의 사용자 동작에서 최대 100 rows를 순차 호출할 수 있지만, server 요청 경계는 **projection 1개**이며 authoritative offset은 server가 관리한다.

### 2. 재개 가능한 전체 source preservation gate

첫 knowledge 요청은 바로 투영하지 않는다. `0020`은 `v2_legacy_preservation_gates`에 대상 knowledge batch, 전체 보존 basis, table/row cursor, 누적 검증 수, revision과 lease를 저장한다. 한 HTTP invocation은 최대 16 rows·4 tables만 확인한다. 아직 남았다면 `gatePending=true`와 진행률을 반환하며, 같은 batch ID의 다음 요청이 D1 cursor에서 이어간다. 모든 항목을 통과한 뒤에만 knowledge batch를 준비하고 `batchPrepared=true`, `processed=0`으로 반환한다.

- 현재 존재하는 adapter table과 user-scoped row count
- 모든 비어 있지 않은 table의 reconciled source-only 성공 batch
- 각 table의 현재 PRAGMA column metadata와 저장된 schema snapshot
- source-only batch item에 정규화해 둔 legacy identity, row hash, projection hash와 projection target을 현재 row와 순서대로 대조
- 대상 table의 동일 dry-run source-only 성공 여부

table cursor가 끝날 때 row count를 다시 확인하고, 전체 cursor가 끝날 때 adapter inventory·schema·count·선택된 source-only dry-run basis를 다시 읽는다. 다른 table에서 schema나 row count가 그대로인 채 내용만 바뀌어도 row/projection receipt 비교가 knowledge를 잠근다. “이 table만 source-only가 끝났다”는 이유로 다른 legacy 원본을 남겨둔 채 지식화를 시작할 수 없다.

### 3. knowledge quarantine과 원자적 승격

- 후속 요청은 type assignment, property value, evidence를 deterministic ID로 insert/reuse한 뒤 실제 저장된 의미 값까지 다시 읽어 충돌을 검사한다.
- 이 단계의 mapping은 `knowledge_pending`이며 `activation_batch_id`로 준비 batch에 귀속된다. object lifecycle은 계속 archived다.
- 마지막 reconciliation이 끝나면 한 D1 batch에서 이전 mapping supersede, 이전 object archive, 새 object의 목표 lifecycle 적용, pending mapping의 `projected` 승격, 성공 receipt 저장을 함께 수행한다.
- finalization 직전 source 변경, mapping 소유권 race, incompatible type/property/evidence preseed, 손상된 성공 receipt가 발견되면 보이는 데이터로 승격하지 않는다.

## D1 예산 대응

Cloudflare의 현재 D1 제한은 Workers Free에서 invocation당 50 queries, statement당 100 bound parameters, SQL function당 32 arguments, SQL statement 100 KB다. 구현과 검증은 이 범위를 기준으로 했다. 기준 원문은 [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)다.

- 실제 local workerd에서 compound `UNION ALL`은 5개 table까지 통과하고 6개부터 실패하는 동작을 확인해 schema와 row snapshot을 5-table chunk로 분리했다. 이 수치는 Cloudflare 공식 일반 제한이 아니라 이 프로젝트가 관찰한 더 엄격한 runtime 경계다.
- 넓은 legacy row는 `json_set`당 15개 field로 중첩해 32-argument 상한 안에 둔다.
- 56개 adapter의 존재 확인은 100 bindings 이하의 한 query로, user row count는 scalar subquery 한 query로 수집한다.
- 비용이 큰 전체 source-preservation gate는 D1에 cursor와 lease를 남기고 invocation당 16 rows·4 tables로 제한한다. UI도 한 사용자 동작에서 최대 8회만 이어서 호출하고, 남은 작업은 다음 동작에서 재개한다.
- 488-row table의 dry-run과 단일 source-only progression, 두 projection을 가진 daily log의 same-row continuation이 각각 50-query 예산을 넘지 않는지 계약 테스트가 계수한다.
- 40 rows·2 tables의 전역 gate를 repository 인스턴스를 교체하며 재개하는 계약은 각 invocation의 repository D1 호출이 40회 이하이고, gate가 통과하기 전 knowledge batch row가 생기지 않는지 확인한다.

## portability와 restore hardening

- export/backup schema version은 `v2-018`이다. migration batch와 batch item도 canonical registry에 포함되고 schema version이 manifest root hash와 metadata validation에 결합된다.
- `v2-017` full backup에서 `v2-018` incremental로 이어지는 chain은 호환하되, 새 schema로 선언하면서 필수 metadata가 빠진 archive와 schema downgrade는 거부한다.
- capture, envelope, mapping은 target DB가 독립적으로 만든 primary ID와 자연 identity를 구분한다. 같은 자연 identity는 reuse하고 foreign key와 `activation_batch_id`를 target ID로 재작성한다.
- attachment의 source `object_key`는 portable identity가 아니다. target-owned private R2 key를 만들고 verified hash/size identity로 duplicate를 판정한다.
- restore가 `succeeded` legacy batch를 가져오면 저장된 receipt를 신뢰하지 않고 manifest, item, mapping, dependency를 다시 reconciliation한다. 모순이면 해당 import에서 만든 row와 object를 rollback한다.
- restore rollback은 change event를 지우지 않고 `tombstone`을 추가한다. 이후 incremental backup이 제거 사실을 재현할 수 있다.

## 로컬 자동 검증

| 검증 | 결과 | 검증 범위 |
| --- | --- | --- |
| `legacy-migration-hardening.test.ts` | 26/26 passed | 5,000-row bound, query budget, multi-projection continuation, resumable global source gate, rowid order, damage receipt, collision, retry, stale/race, supersession |
| `resumable-legacy-preservation-schema.test.ts` | 2/2 passed | pre-`0020` projection receipt backfill과 incomplete passed-gate SQL guard |
| `portability-restore.test.ts` | 7/7 passed · 240.10s | local workerd D1/R2 binding에서 export/restore, duplicate-free replay, rollback, legacy supersession, corrupt succeeded-batch reject, backup chain |
| `source-foundation.test.ts` | 8/8 passed | archived lifecycle source commit 호환을 포함한 source foundation 회귀 |
| `legacy-inventory-d1.test.ts` | 1/1 passed | 모든 adapter를 5-table chunk로 읽는 local workerd D1 binding 계약 |
| `restore-identity-hardening.test.ts` | 3/3 passed | capture conflict, envelope/mapping natural-ID reuse, forked activation batch FK rewrite |
| `backup-schema-contract-v1.test.ts` | 3/3 passed | v2-018 필수 metadata, v2-017→v2-018 chain, schema mismatch reject |
| private sample core | 4개 계약 구현 | deterministic sampling, risk candidate 추가, private ignored path, read-only SQL guard |
| fresh local D1 migration | 26/26 applied · exit 0 | Wrangler 4.121.0 isolated persistence에서 `0000`~`0025` |
| web typecheck | passed | 현재 TypeScript contract |
| Worker binding type check | passed | generated `CloudflareEnv`와 `wrangler.toml` drift 검사 |
| cutover Playwright | Capture 1/1, Library 1/1 passed | legacy 409와 authentication assertion 분리 |
| restore lease fencing/schema focused run | 12/12 passed | stale owner·publication·cleanup fencing |
| private sample core | 4/4 passed | deterministic/private-path/read-only guard 계약 |
| full ESLint | exit 0 · 0 errors · 34 warnings | 기존 React compiler 조언과 generated declaration warning 포함 |

`source-foundation`, `legacy-inventory-d1`, `backup-schema-contract-v1`, `restore-identity-hardening` 네 파일은 한 grouped run에서도 합계 15/15, exit 0을 확인했다. 위 표에서 명시적으로 `passed`라고 적은 행만 이번 진행에서 실행 결과가 확인된 항목이다. “계약 구현”은 test가 존재한다는 뜻이며 최종 전체-suite 결과와 동일한 주장으로 사용하지 않는다.

## 2026-08-28 remote read-only baseline

`artifacts/v2-migration/live-20260828-pre-source-only/`에 내용 본문을 포함하지 않는 read-only inventory와 recovery point를 저장했다.

- D1: 144 tables, 11,140 rows
- adapter coverage: 56/56, non-empty 34 tables, adapter 대상 2,291 rows
- R2: 584 objects, 3,809,946 bytes
- migration source state: envelope 0, mapping 0, source item 0, document 0
- Time Travel bookmark: recovery artifact에 기록
- latest verified backup: `01M1277Q852GZ27ANCMXDX7J73`

이 baseline 뒤 remote D1에 `0018`을 적용하거나 migration row를 쓰지 않았다. bookmark와 snapshot ID는 복구 근거이지 migration 성공 근거가 아니다.

## 남은 순서와 gate

1. 이미 통과한 bindings/typecheck/lint/fresh migration/focused fencing 외에 로컬 전체 test와 production/Worker build를 최종 통과한다.
2. remote 적용 직전 새 recovery point와 verified full backup을 확인한다.
3. pending `0018`~`0025`를 remote D1에 적용하고 schema/index/trigger를 read-only로 검증한다.
4. `FLAG_V2_LEGACY_READONLY=1`을 배포해 V1 archive mutation이 실제 409가 되는지 smoke test한다.
5. git 밖 private artifact에 representative row sample을 추출하고, source text·rating·관계·손상 표식을 사람이 승인한다.
6. 34개 non-empty table을 source-only로 실행하고 table별 receipt와 전역 envelope/mapping count/hash를 대조한다.
7. final source delta가 0이고 전체 preservation gate가 통과한 뒤에만 knowledge를 table별로 실행한다.
8. Document/type/property/evidence와 archived-only 표본을 다시 검토하고 backup/restore/rollback drill을 수행한다.
9. 별도의 private corpus, device, usability, owner observation gate가 통과하기 전에는 `capture_default`나 project completion을 선언하지 않는다.

restricted grant를 얻기 위해 로컬 비밀번호를 production endpoint로 보내는 단계는 자동으로 수행하지 않는다. 실제 migration 직전에 사용자의 즉시 확인을 받은 뒤 제한된 시간의 grant에만 사용한다.
