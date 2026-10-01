# 26. Legacy Inventory, Migration, and Cutover Runbook

> 상태: live read-only inventory·56/56 adapter coverage 완료 · `0029`까지 local 구현 · remote `0018`~`0029` 적용/source-only/deploy/cutover 미실행
> 최초 기준일: 2026-08-12 · 최신 실행 기준: 2026-08-29

## 1. 결론

기존 데이터는 고쳐 쓸 대상이 아니라 보존할 source다. migration은 legacy row를 정리된 V2 row로 덮어쓰는 작업이 아니라 다음 두 결과를 만드는 작업이다.

1. 원래 row·attachment로 돌아갈 수 있는 immutable source snapshot
2. source를 해석한 versioned V2 projection

legacy와 V2에 동시에 쓰는 dual-write는 하지 않는다. cutover 시점 이후 새 입력은 V2에만 저장하고 V1 mutation route는 read-only로 전환한다.

## 현재 실행 기준선 (2026-08-29)

이 절의 수치는 최초 기획 상태가 아니라 현재 repository와 2026-08-29에 재수집한 live read-only artifact를 기준으로 한다.
세부 local security/portability 검증은 [44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md](./44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md)를 따른다.

- 직전 recovery point는 `artifacts/v2-migration/live-20260828-pre-source-only/`에 보존돼 있다. 최신 본문 없는 inventory는 `artifacts/v2-migration/2026-08-29-resume-readonly/`이며 D1 144 tables / 11,141 rows, R2 622 objects / 3,818,865 bytes다. 이번 갱신은 read-only 조회이며 새 recovery point 생성이나 데이터 변경이 아니다.
- live source table 56개와 in-code versioned adapter 56개가 56/56으로 일치한다. 34개 table이 non-empty이고 adapter 대상은 2,291 rows다. 이는 **구조 coverage**이며 원문 표본의 사람 승인이나 projection 내용 승인이 아니다.
- remote migration source state는 envelope 0, mapping 0, source item 0, document 0이다. `FLAG_V2_LEGACY_READONLY=0`도 유지하므로 source-only, knowledge, legacy mutation 차단과 `capture_default` cutover는 아직 실행하지 않았다.
- read-only `wrangler d1 migrations list`로 remote pending이 `0018`부터 `0029`까지 정확히 12개임을 재확인했다. local repository에는 `0026` terminal reconciliation, `0027` quarantine/CAS, `0028` owner-safe FTS, `0029` provider invocation lease가 추가돼 있다. **목록 조회는 remote apply나 deploy가 아니다.**
- isolated local D1에 `0000`~`0029` 30개를 새로 적용했고 latest `0029`, provider lease table, 5개 guard trigger, query용 index를 확인했다. 이는 fresh local schema 근거이며 remote apply 근거가 아니다.
- backup/restore의 stale worker, parent CAS, canonical R2 publication, cleanup/retention race를 막는 lease-fencing 계약을 집중 검증했다. restore fencing/schema 묶음은 12/12를 통과했고 독립 검토에서 runtime·validation P0/P1 잔여가 없었다.
- source-only·knowledge_pending·superseded 및 알 수 없는 mapping 상태의 object는 lifecycle이 active여도 일반 detail·authoring·retrieval·timeline·rediscovery·Review·template·AI 표면에서 숨긴다. FTS source backfill/trigger와 관련 join은 document/source owner를 함께 확인한다.
- `npm.cmd run bindings:check`와 Capture/Library cutover Playwright 각 1건이 통과했다. binding drift와 V1 409/V2 인증 경계를 확인한 결과이지 production migration 성공 근거가 아니다.
- private corpus는 20 slots 중 ready 0이며 owner Capture 14일 관찰, 이후 Library 7일 관찰, 실제 device·사용성·recall 근거가 남아 있다. 이 외부 gate를 코드 검증으로 대체하지 않는다.

## 2. 현재 legacy inventory surface

local migration 기준으로 다음 그룹이 존재한다.

| 그룹 | 대표 table |
| --- | --- |
| identity | `users`, `sessions` |
| action | `projects`, `tasks`, `checklists`, task relations |
| life logs | `daily_logs`, `habits`, `habit_logs`, `health_metrics`, `workouts`, `career_history` |
| people | `people`, `interactions`, `network_edges`, `gifts` |
| knowledge/media | `zettels`, zettel relations, `media_logs`, media relations |
| place | `places`, `place_visits` |
| shared metadata | `tags`, `taggings`, `attachments`, `assets`, `audit_logs` |
| operations | `ai_conversations`, `quick_captures`, `notifications` |
| UI state | `saved_views`, `widget_layouts`, `shortcut_bindings` |
| import/backup | `import_jobs`, `backup_snapshots` |

이 목록은 migration file의 schema 목록일 뿐 live row count·column drift·R2 상태를 확인한 결과가 아니다.

## 3. Migration evidence directory

실행 산출물은 source code와 분리한다.

```text
artifacts/v2-migration/{run_id}/
  run.json
  inventory/
    tables.jsonl
    columns.jsonl
    row-counts.json
    timestamp-ranges.json
    null-and-shape-profile.jsonl
    r2-objects.jsonl
    r2-orphans.jsonl
    samples.private.jsonl
  mapping/
    adapter-map.yaml
    field-coverage.csv
  dry-run/
    projections.jsonl
    conflicts.jsonl
    duplicate-candidates.jsonl
    registry-candidates.jsonl
    attachment-actions.jsonl
  verification/
    count-reconciliation.json
    hash-reconciliation.jsonl
    recall-results.json
    manual-review.csv
  rollback/
    drill-report.md
```

`samples.private.jsonl`과 본문이 들어간 산출물은 gitignore한다. aggregate count·hash·status report만 repository에 남길 수 있다.

## 4. Phase L0 — immutable preflight snapshot

live inventory 전에 다음을 만든다.

- D1 database export 또는 verified backup snapshot ID
- migration schema version과 git SHA
- R2 object listing with key, bytes, ETag, last modified
- current environment identifiers
- V1 app write route 목록
- start sequence/time watermark

snapshot 검증 전 migration writer를 실행하지 않는다. API token, presigned URL, source body는 run report에 남기지 않는다.

## 5. Phase L1 — read-only live inventory

inventory tool은 select/list/head만 수행한다.

### D1 table profile

각 table마다:

- schema and indexes
- total rows and rows per user
- created/updated/deleted date range
- null/empty distribution
- distinct legacy category/type/status
- duplicate primary-looking external IDs
- JSON parse failures
- body length distribution
- foreign-key-like orphan count

body 전문을 report에 넣지 않고 길이, hash, classification code만 기본 수집한다. 대표 sample 열람은 사용자가 지정한 private artifact에만 저장한다.

### R2 profile

- key namespace별 object count·bytes
- DB attachment key와 object existence join
- DB row 없는 object
- object 없는 DB row
- identical checksum/ETag candidate
- preview만 있고 original 없음 또는 반대
- public-looking URL field와 private key 일치 여부
- content type·extension mismatch

ETag를 SHA-256으로 간주하지 않는다. migration 시 original을 실제 stream hash한다.

## 6. Damage taxonomy

모든 이상은 임의 수정 대신 code로 분류한다.

| code | 의미 | 기본 처리 |
| --- | --- | --- |
| `DOMAIN_MISROUTED` | 사람 table에 미디어 등 잘못된 domain | source 보존, 올바른 candidate projection |
| `MIXED_CONCERNS` | 한 row에 여러 사건·글이 섞임 | 자동 split 금지, review candidate |
| `PLACEHOLDER_SHELL` | 자동화 빈 껍데기·seed | source 보존, default Library 제외 후보 |
| `DUPLICATE_EXACT` | source ID/hash 동일 | idempotent reuse |
| `DUPLICATE_SEMANTIC` | 비슷하지만 동일성 불명 | merge candidate만 생성 |
| `TIME_AMBIGUOUS` | 실제 작성/사건일과 import일 혼합 | 두 timestamp 분리, precision 표시 |
| `ATTACHMENT_ORPHAN` | DB/R2 한쪽만 존재 | quarantine와 manual action |
| `BROKEN_RELATION` | 대상 row 없음 | unresolved relation evidence |
| `JSON_INVALID` | metadata JSON 손상 | raw string 보존, parse error 기록 |
| `AI_DERIVED_UNKNOWN` | 값이 사용자/AI인지 불명 | imported_unknown provenance |
| `SOURCE_MISSING` | 원문이 없고 파생값만 존재 | 파생 source snapshot, 손실 warning |

`SOURCE_MISSING`을 AI로 채워 완전한 기록처럼 만들지 않는다.

## 7. Canonical legacy source envelope

각 legacy row는 V2 projection 전에 다음 envelope로 snapshot한다.

```json
{
  "format": "lighthouse-legacy-row",
  "version": 1,
  "legacyTable": "media_logs",
  "legacyId": "...",
  "userId": "...",
  "row": {},
  "rowHash": "sha256:...",
  "capturedAt": "...",
  "schemaSnapshot": "migration-0005",
  "attachments": [],
  "damageCodes": []
}
```

envelope는 Source Layer의 immutable JSON source item 또는 private migration blob으로 보존하고 `legacy_source_mappings`에서 찾아갈 수 있게 한다. 개인정보가 들어 있으므로 UI에서 일반 JSON dump를 자동 노출하지 않고 `원래 가져온 데이터 보기`로 접근한다.

## 8. Adapter map contract

adapter는 YAML/TypeScript registry 양쪽에서 같은 version ID를 사용한다.

```yaml
adapter: media_logs_v1
source_table: media_logs
projection_version: 1
source_text_fields: [review, content]
timestamp_rules:
  written_at: created_at
  event_start: started_at
  event_end: completed_at
outputs:
  - kind: entity
    entity_kind: work
  - kind: document
    type_candidates: [media_review]
  - kind: event
    event_kind: consumption
manual_review_when:
  - work_identity_ambiguous
  - review_contains_multiple_works
```

각 source column은 다음 중 하나로 coverage가 있어야 한다.

- source text
- typed projection
- metadata preserved only
- intentionally excluded with reason
- manual review

coverage가 없는 column이 있으면 adapter gate 실패다.

## 9. Table group mapping

기본 방향은 [08_MIGRATION_AND_BACKEND_REUSE.md](./08_MIGRATION_AND_BACKEND_REUSE.md)를 따른다.

### Knowledge and writing

- `zettels` → Document + source links + imported type/tag candidates
- zettel links → Relation, broken targets는 unresolved
- `daily_logs.journal` → Diary candidate Document
- `daily_logs.meditation` → 별도 Meditation candidate Document
- `quick_captures` → Capture Bundle + text source, 기존 routing은 imported suggestion

### Media and places

- `media_logs` metadata → Work Entity candidate
- review/content → Review Document
- dates → consumption Event
- `places` → Place Entity candidate
- `place_visits` → Visit Event + Review Document/assessment

### People and conversations

- `people` → Person Entity candidate
- `interactions` → Conversation/Meeting Event + related Document
- `network_edges` → imported relation candidate, semantic ambiguity review
- gifts → Gift Event or note depending on actual shape

### Life and workout

- workout → Workout Event + typed measurement
- health metric → Measurement Event/property, no diagnosis
- habit logs → Habit Event; seed rows separate
- career history → Career Event + organization entity candidate

### Operational data

- `ai_conversations`: default knowledge import 제외, source linkage가 명확한 user-visible output만 review
- `audit_logs`: prose source로 import하지 않음; migration provenance에 필요한 event만 metadata mapping
- notifications: import하지 않음
- saved views: condition이 V2 registry로 무손실 변환되는 경우 draft saved view
- widget/shortcut state: import하지 않고 archived settings export에만 보존

## 10. Phase L2 — source-only projection

첫 writer pass는 AI를 호출하지 않는다.

- capture/source envelope
- source text and original attachment link
- legacy mapping
- deterministic timestamp/source metadata
- import batch ID

이 단계의 성공 조건은 `legacy row count → source envelope count` reconciliation과 hash다. entity resolution, split, type quality는 다음 단계다.

## 11. Phase L3 — deterministic knowledge projection

- 명확한 table semantics만 object/document/event로 투영
- user-written body는 Markdown revision으로 그대로 시작
- existing rating·measurement는 typed property로 변환하되 raw evidence 유지
- tag/category는 `imported` candidate type/tag
- 외부 ID가 명확할 때만 entity reuse
- ambiguity는 review queue

AI는 손상 복구의 정본 author가 아니다.

## 12. Phase L4 — AI-assisted candidate projection

AI 사용 범위:

- mixed source의 split proposal
- unknown domain/type·field candidate
- entity candidate resolution query 생성
- topic index와 evidence locator
- duplicate candidate ranking

금지:

- source text rewrite
- semantic duplicate 자동 merge
- uncertain historical date 확정
- 사람의 관계·감정·의도 accepted
- missing original 복원이라고 주장

migration job은 interactive보다 낮은 queue priority와 별도 quota budget을 가진다.

## 13. Dry-run manifest

각 source row마다 하나 이상의 action을 기록한다.

```json
{
  "legacy": { "table": "place_visits", "id": "...", "hash": "..." },
  "actions": [
    { "kind": "create_event", "candidateId": "..." },
    { "kind": "create_document", "candidateId": "..." },
    { "kind": "reuse_entity", "candidateId": "...", "reason": "external_id" }
  ],
  "warnings": ["TIME_AMBIGUOUS"],
  "review": false,
  "adapterVersion": "place_visits_v1"
}
```

dry-run 전체 count:

- input rows, source envelopes
- output documents/entities/events
- attachment copy/reuse/missing
- exact duplicate reuse
- semantic duplicate candidates
- split proposals
- unresolved relations/entities
- damage code distribution
- excluded column count
- errors and retryable failures

## 14. Manual review sampling

전체 row를 수동으로 읽지 않더라도 각 adapter는 다음 sample을 검토한다.

- 최소 20건 또는 row의 5% 중 작은 쪽, 단 5건 미만 금지
- damage code별 최소 3건
- split·merge candidate 전부 또는 최대 50건
- attachment missing 전부
- user rating/date 변환 대표값
- 사람 관련 high-risk relation 전부

검토 결과는 approve, adapter-fix, record-review, exclude-with-reason로 기록한다.

## 15. Reconciliation gates

### Structural

- source envelope count = 대상 legacy row count
- row hash 계산 실패 0
- mapped attachment existence와 missing count 설명
- output foreign references closure
- adapter column coverage 100%

### Substantive

- sample에서 원문 회귀 성공 100%
- user rating·date·measurement 변환 정확 100%
- wrong entity auto merge 0
- mixed row automatic destructive split 0
- placeholder가 일반 Library를 오염시키는 비율 목표 충족

구조상 errors=0을 내용 승인으로 부르지 않는다.

## 16. Cutover sequence

```text
T-14d  V2 new-capture shadow/private use 시작
T-7d   legacy full dry-run + manual sample
T-1d   verified D1/R2 snapshot, route inventory freeze
T0     final delta inventory
       V1 mutation route disable
       V2 capture default
       source-only delta projection
T+1d   count/hash verification
T+7d   recall/search comparison
T+14d  V2 Library/Search default 판단
T+30d  rollback drill closure, legacy remains read-only
```

cutover 중 새 write를 legacy와 V2에 동시에 하지 않는다. V1 read route에는 `이전 보관소 · 읽기 전용` 표시를 둔다.

## 17. Rollback

### V2 Capture 장애

- source commit health를 우선 복구
- local outbox를 보존
- 필요하면 minimal V2 text-only capture route 유지
- legacy write를 자동 재활성화해 두 정본을 만들지 않음

### Library/Search/UI 장애

- 기본 route를 legacy read UI로 되돌림
- V2 capture는 유지
- V2 object와 migration mapping은 삭제하지 않음

### Bad migration batch

- recent reauthentication과 legacy write lock을 확인한 뒤 migration workbench에서 현재 `state_revision`, idempotency key, 사유로 batch quarantine 요청
- D1 assertion fence 안에서 pending/current mapping을 제거 또는 이전 source-only/projected basis로 복구하고 object를 archive/원래 lifecycle로 되돌림
- batch를 `quarantined` control state로 전환하고 immutable source provenance, 보존 count, 복구 mapping 목록을 receipt에 기록
- source envelopes는 유지
- adapter 수정 후 새 projection version 생성
- 기존 잘못된 result는 superseded로 보존

## 18. 실제 구현된 실행 surface

이전 초안의 `scripts/v2/inventory-d1.ts`, `migrate-source-only.ts`, `rollback-batch.ts` 등의 경로는 현재 repository에 존재하지 않는다. 존재하지 않는 wrapper를 운영 명령으로 사용하지 않는다.

### Read-only inventory와 adapter coverage

```powershell
# D1 schema/count/timestamp inventory. --remote를 생략하면 local D1이다.
npm.cmd run migration:inventory:d1 -- --remote --database DB --config wrangler.toml --run-id <run-id>

# R2 key/size/ETag/time inventory. ETag는 SHA-256으로 취급하지 않는다.
# 값은 ignored apps/web/.env.local에서 자동으로 읽거나 현재 process env로 덮어쓴다.
npm.cmd run migration:inventory:r2 -- --run-id <run-id>

# D1 inventory의 columns.jsonl을 in-code adapter registry와 대조한다.
npm.cmd run migration:adapters:validate -- `
  --columns artifacts/v2-migration/<run-id>/inventory/columns.jsonl `
  --out artifacts/v2-migration/<run-id>/mapping/field-coverage.csv

# 사용자 범위를 고정한 private sample plan 또는 추출. 출력은 ignored private path여야 한다.
npx.cmd tsx tools/v2-migration/sample-private-d1.ts --remote --user <legacy-user-id> --run-id <run-id> --plan-only
```

각 도구의 실제 option은 서로 다르다. D1 inventory는 `--remote`, `--database`, `--config`, `--run-id`, `--out`; R2 inventory는 `--run-id`, `--out`과 `R2_ACCOUNT_ID` 또는 `R2_S3_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; coverage는 `--columns`, `--out`을 사용한다. inventory와 private sample 도구는 `apps/web/.env.local`을 자동으로 읽으며 secret 값은 command, artifact, 문서에 출력하지 않는다. 초안에 있던 공통 `--environment`, `--dry-run`, `--apply`, `--after` 계약은 구현돼 있지 않다.

### Migration write와 reconciliation

source-only와 knowledge 실행은 독립 CLI가 아니라 인증된 앱 surface를 사용한다.

| 단계 | 실제 surface | 강제 조건 |
| --- | --- | --- |
| inventory | `GET /api/v2/migration/inventory` | 로그인 + recent restricted grant |
| table dry-run | `POST /api/v2/migration/dry-run` | `{ "table": "..." }`, recent restricted grant |
| approved progression | `POST /api/v2/migration/run` | `FLAG_V2_LEGACY_READONLY=1`, `approved=true`, `mode`, `importBatchId`, 현재 `dryRunHash`; server 요청당 기본 projection 1개 |
| reconciliation | `GET /api/v2/migration/batches/{batchId}` | 로그인 + recent restricted grant |
| quarantine | `POST /api/v2/migration/batches/{batchId}/quarantine` | recent restricted grant + `FLAG_V2_LEGACY_READONLY=1` + 현재 `expectedRevision` + idempotency key + 사유 |

UI의 `/v2/settings/data` migration workbench가 이 API를 순서대로 호출하고 server의 authoritative offset·gate·revision·quarantine 상태를 표시한다. bad batch를 사유 확인 뒤 격리하는 server/UI surface는 구현됐다. `migrate-source-only.ts`, `dry-run-projection.ts`, `verify-reconciliation.ts`, `rollback-batch.ts` 같은 별도 CLI는 현재 없으며 실제 remote quarantine/restore drill은 완료 gate로 남는다.

### Local release와 cutover preflight

```powershell
npm.cmd run bindings:check
npm.cmd run validate:local
npm.cmd run test:e2e:cutover:capture --workspace @light-house/web
npm.cmd run test:e2e:cutover:library --workspace @light-house/web
npm.cmd run eval:private:validate
npm.cmd run eval:private:gate
npm.cmd run cutover:preflight -- --target=capture_default
```

`eval:private:gate`와 `cutover:preflight`는 evidence가 미완료인 동안 실패해야 안전하다. 실패 출력을 우회하거나 evidence boolean을 임의로 채우지 않는다. `bindings:check`는 generated Worker binding type drift를 막는 local gate이며 remote binding 존재 여부나 deploy 성공을 대신하지 않는다.

## 19. 완료 gate

- live D1/R2 inventory report 존재 — 2026-08-29 read-only refresh 완료, remote write 직전 새 recovery point와 verified backup 필요
- 모든 table adapter의 column coverage 100% — 56/56 구조 gate 완료, substantive sample 미완료
- fresh local `0000`~`0029` 30/30, binding type, workflow/provider lease, cutover route 계약 구현 — 최종 local full regression과 remote 12-migration apply·deploy·migration 완료는 별개
- source-only dry-run count/hash reconciliation 통과 — 미완료
- 대표 source 원문 회귀 100%
- semantic duplicate는 후보일 뿐 자동 merge 0
- attachment orphan 전부 action 분류
- final delta migration idempotent
- V1 mutation route inventory와 disable test 통과
- batch rollback drill 성공
- migrated representative record가 V2 recall query에 포함
- private corpus 20/20 human-approved, owner Capture 14일과 Library 7일 관찰, 실제 device·사용성·recall gate 통과

이 gate 전에는 전체 legacy migration 날짜를 약속하지 않는다. V2의 새 입력과 source foundation을 먼저 안정화한다.
