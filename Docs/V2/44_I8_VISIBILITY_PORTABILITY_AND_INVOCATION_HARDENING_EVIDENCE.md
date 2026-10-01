# 44. I8 Visibility, Portability, and Provider Invocation Hardening 근거

> 상태: `0026`~`0029`와 관련 runtime contract는 local 구현 · focused 검증 통과 항목과 최종 full regression을 구분 · remote `0018`~`0029` apply·deploy·cutover 미실행
> 검증일: 2026-08-29

> 후속 안내(2026-09-08): 이 문서는 위 검증일의 이력이다. `0030`과 canonical `v2-030` 및 감사 개선의 현재 검증은 [46_AUDIT_REMEDIATION_EVIDENCE.md](./46_AUDIT_REMEDIATION_EVIDENCE.md)를 따른다. 아래 원격 pending 기록은 이번에 재조회한 상태가 아니다.

## 결론

이번 hardening은 migration row를 안전하게 만드는 것에 그치지 않고, 아직 승격되지 않은 legacy projection이 일반 제품 표면이나 AI provider에 나타나는 경로를 닫는다. 또한 복구용 archive와 읽기용 export를 권한·범위 면에서 분리하고, export row가 owner 및 필수 parent closure를 만족할 때만 묶음에 들어가도록 강화한다.

다음 네 문장은 서로 다른 상태다.

| 구분 | 현재 근거 | 주장하지 않는 것 |
| --- | --- | --- |
| local implementation | migration `0000`~`0029`, visibility predicate, quarantine, protected export, template atomic publication, provider invocation lease 코드 존재 | production Worker에 배포됨 |
| focused verification | 아래 명시한 contract 묶음 통과 | 전체 suite·build·브라우저·실데이터 승격의 자동 승인 |
| remote read-only verification | D1/R2 inventory, adapter coverage, pending migration 목록 조회 | remote schema 변경 또는 데이터 쓰기 |
| private cutover | gate와 실행 surface 구현 | source-only·knowledge·legacy read-only·default route 전환 |

## Migration `0026`~`0029`

| migration | 역할 |
| --- | --- |
| `0026_v2_legacy_terminal_reconciliation_guard.sql` | `succeeded` 전 manifest length, per-item projection receipt, mapping/object lifecycle, superseded object archive 상태를 D1 trigger에서 재검사 |
| `0027_v2_legacy_migration_quarantine.sql` | batch `state_revision`, control state, idempotent quarantine receipt, reversible superseded basis, provenance assertion과 CAS transition |
| `0028_v2_fts_source_owner_fence.sql` | FTS source backfill과 link insert/delete trigger가 document owner와 source owner가 일치할 때만 source text를 합성 |
| `0029_v2_provider_invocation_lease.sql` | provider 호출 중인 object를 숨기는 mapping/object lifecycle mutation과 delete를 expiry까지 거부 |

`0027` quarantine은 source envelope를 삭제하는 destructive rollback이 아니다. 현재 batch가 만든 pending/current mapping을 제거하거나, `superseded_from_status`와 authoritative target lifecycle로 증명되는 이전 mapping만 복구한다. item·envelope·mapping·source count와 복구 mapping 목록은 assertion/receipt로 남고 stale revision 또는 provenance drift면 batch 전체가 rollback된다.

## Nonprojected visibility와 owner fence

일반 V2 surface에서 legacy-derived object가 보이려면 같은 owner의 연결 mapping이 모두 `projected`여야 한다. 하나라도 `source_only`, `knowledge_pending`, `superseded` 또는 미래의 알 수 없는 상태면 fail-closed로 숨긴다. importer가 사용하는 `legacy:` capture namespace의 object도 authoritative projected mapping 없이 native V2 record처럼 보일 수 없다.

공유 predicate와 same-owner parent join은 다음 범위에 적용한다.

- Record detail, revision authoring, trash/restore mutation
- Library/Search/FTS, timeline, saved view, rediscovery, relation context
- presentation, Review action, template observation/session/source link
- analysis와 grounded processing input, source/attachment lookup
- portable 문서 metadata의 type/relation/attachment와 migration canonical archive의 object, source, relation, type/property/evidence 및 child registry row

특히 child row에 같은 `user_id` 문자열이 있다는 사실만으로는 충분하지 않다. type assignment의 type, property의 field/run/supersedes parent, relation의 predicate/run, review receipt의 review/run/target, template version/source/session/observation parent, source attachment의 source/attachment, document current/parent revision 등이 같은 owner이면서 선택된 export scope 안에 있어야 한다. 그렇지 않으면 child도 export하지 않는다.

processing job·run·proposal·grounding·Review dependency graph는 공유 recursive CTE에서 root object/capture/revision과 parent job/run closure를 계산한다. 같은 긴 scope 식을 중첩 복제하지 않아 D1 expression-depth 한도를 피하면서 plain, full-fidelity, `includeHistory=false` 세 모드가 같은 owner 규칙을 유지한다.

## Portable export와 migration export의 분리

| 항목 | `portable` | `migration` |
| --- | --- | --- |
| 목적 | 사람이 읽고 선택 공유 | 다른 Light House 환경에 무손실 왕복 복구 |
| 범위 | 요청한 privacy/trash/history/original 선택 | account 전체 normal+sensitive+restricted, trash, history, originals 강제 |
| nonprojected legacy | 일반 record/document에서 제외 | source envelope, mapping, batch/item을 포함한 full-fidelity 보존 |
| 권한 | restricted가 없으면 일반 session 가능 | 생성·continuation·download 모두 recent reauthentication |

보호된 export의 grant가 만료돼도 job 상태와 timestamp는 보이지만 bundle hash, byte size, manifest count는 redaction한다. download UI는 object key나 공개 URL을 받지 않고 비밀번호 재인증 뒤 authenticated fetch로 blob을 받아 저장한다. ZIP 자체는 password-encrypted가 아니므로 UI와 README의 암호화 저장소 안내는 유지한다.

canonical archive의 현재 구현 schema는 `v2-020`이다. 지원 목록은 `v2-017`, `v2-018`, `v2-020`이며 외부에 게시하거나 지원한 적 없는 `v2-019`는 건너뛴다. `v2-020`은 cumulative descriptor filtering으로 `v2-018` migration batch/item metadata를 유지한다. pre-`0027` row의 control/quarantine column은 restore compatibility layer가 안전한 기본값으로 정규화한다.

## Template publication atomicity

반복 패턴 threshold를 통과할 때 template row만 먼저 남기거나 `current_version_id`를 먼저 공개하지 않는다. template, immutable version, 모든 source link, pattern observation outcome을 한 D1 `batch()`에 넣고 마지막 statement가 threshold·owner·version 관계를 다시 검사해 current version을 게시한다. 중간 statement 실패 또는 다른 template version을 가리키는 fixture에서는 batch 전체가 rollback되어 반쪽짜리 generated draft와 provenance가 남지 않는다.

## Provider invocation lease

analysis와 grounded runner는 source/revision/template/mapping visibility를 읽은 다음, 실제 gateway 호출 직전에 current job/run/worker lease와 active object를 다시 대조해 120초 invocation lease를 획득한다. 획득 실패 시 provider를 호출하지 않는다.

유효 lease 동안 다음 경로가 같은 입력을 숨길 수 없다.

- projected mapping을 nonprojected로 변경, 다른 object/user로 이동 또는 삭제
- active object에 nonprojected legacy mapping 부착
- object archive/trash/delete
- migration finalization 또는 quarantine이 해당 mapping/object를 격리

success·retry·dead-letter terminalization은 job/run 변경과 같은 D1 batch에서 lease를 해제한다. process가 사라지면 TTL 뒤에만 mutation이 다시 가능하다. 이 경계는 provider가 받아 본 입력과 commit 시점 visibility가 호출 도중 뒤집히는 TOCTOU를 막는 것이며, 일반 편집을 장시간 잠그는 기능은 아니다.

## 확인된 local focused evidence

| 검증 | 결과 | 의미 |
| --- | --- | --- |
| schema-version availability + backup schema + legacy restore compatibility + restore identity hardening | 12/12 passed | `v2-017`·`v2-018`·`v2-020` 선택, pre-`0027` 정규화, 자연 identity/FK rewrite |
| protected export profile/route | 6/6 passed | migration full scope와 recent reauthentication 경계 |
| actual ZIP malformed-parent fixture | 1/1 passed | cross-owner type/run/field/revision/template/review/legacy successor·batch item이 Markdown/metadata/canonical JSONL에 유출되지 않고 verified migration ZIP도 closure 유지 |
| template repository focused suite | 18/18 passed | atomic generated draft publication, injected failure rollback, same-pattern concurrent winner와 orphan version/provenance 0건 |
| provider invocation + processing pipeline + legacy migration hardening | 54/54 passed | analysis·grounded race 2건, processing owner/terminalization, finalization·quarantine invocation conflict와 CAS/provenance 회귀 |
| canonical descriptor hard/soft/polymorphic closure | 1/1 passed | plain·full-fidelity·`includeHistory=false` 전 descriptor의 binding/execution과 필수 parent closure |
| portability restore + canonical visibility unit | 8/8 + 2/2 passed | malformed parent/successor 제외, portable restricted provenance 최소화, migration own full provenance와 restore closure |
| source foundation + owner-join runtime | 10/10 + 1/1 passed | source/document/revision owner fence와 knowledge/source/review runtime parent join 회귀 |
| fresh isolated D1 migration | 30/30 applied | `0000`~`0029`, provider invocation lease table 1, guard trigger 5, query용 index 3(PK autoindex 포함) |
| bindings check + DB schema check + migration tools | passed · tools 4/4 | generated Worker binding/config drift, Drizzle/schema consistency, inventory/adapters tool 회귀 |
| TypeScript + ESLint | passed · lint 0 errors/34 warnings | warning은 기존 React hook/ref advisory와 generated Worker declaration disable 중심이며 non-blocking; 병행 변경 병합 뒤 최종 재실행 필요 |

위 표는 명시된 focused run만 뜻한다. 병행 변경 뒤 root typecheck/lint 재실행, full web suite, production/Worker build, E2E·private gate 결과는 이 문서의 최종 release validation 절에서 별도로 합산해야 하며 focused 결과로 대체하지 않는다.

## Local Worker package와 secret audit

| 검증 | 결과 | 경계 |
| --- | --- | --- |
| OpenNext Worker build | passed | 83 static pages, package 생성 성공 |
| Wrangler deploy dry-run | passed | Assets 740, D1 `DB`, R2 `ARCHIVE_ASSETS`, Assets binding 인식, gzip 2,647.32 KiB |
| build-time env isolation | passed | production/development/test injected env `{}`, local env file 2개 mask/restore, audited files 6,358에서 secret hit 0 |
| repository/ignored-path secret scan | passed | tracked 316 files와 Git 19 commits의 현재 secret exact hit 0, high-confidence credential pattern 0, local env·migration artifact tracked history 0 |

검사한 Worker bundle SHA-256은 `ee484660ea125ceb3b90f42b904f2491d3ba2c64bab7ca629878cc3823b94cb9`다. 이 값은 이번 local build artifact 식별자이며 다음 build의 고정 정본이 아니다. dry-run은 binding·package·startup 준비를 확인하지만 실제 deploy가 아니다.

현재 release snapshot은 HEAD만으로 재현되지 않는다. 감사 시점에 staged 0, unstaged 35, untracked 378이었고 Worker 진입점, 안전 build script, migration `0006`~`0029`도 그 작업 트리에 포함돼 있다. 이 프로젝트는 아직 개발 중인 사용자 worktree이므로 파일을 임의 폐기하거나 자동 commit하지 않았지만, 실제 deploy 전에는 사용자가 승인한 재현 가능한 snapshot을 고정하고 같은 snapshot에서 회귀와 package hash를 다시 만들어야 한다.

## Final release validation 진행 상태

| 검증 | 현재 결과 | 판정 |
| --- | --- | --- |
| full Vitest 첫 실행 | 67 files / 362 tests 중 65 files / 360 tests passed | 2 failures는 product regression이 아니라 오래된 route fixture로 식별, focused 수정 후 backup route 3/3과 adjacent 6/6 통과; 최종 full rerun 대기 |
| Playwright E2E | 33 passed, 21 intentional project/cutover skips, 0 failed | local browser contract 통과; 실제 device·owner 관찰이나 cutover 완료 아님 |
| private manifest structural validation | 20 cases 구조 통과, ready 0 | ready gate와 cutover preflight의 실패는 의도된 fail-closed 결과 |
| Gemini main synthetic | `gemini-3.6-flash` Korean text + image passed, input 1,147/output 17 tokens, 4,504 ms | synthetic capability 근거이며 private corpus 품질 승인 아님 |
| Gemini grounded synthetic | `gemini-3.5-flash-lite` quota `429` | live grounded release gate 미통과 |

첫 full Vitest의 360/362를 최종 전체 통과라고 쓰지 않는다. fixture 수정이 병합된 같은 worktree에서 67 files / 362 tests를 다시 실행해 0 failure를 확인한 뒤에만 최종 수치로 승격한다.

## 2026-08-29 remote read-only verification

`artifacts/v2-migration/2026-08-29-resume-readonly/`는 본문을 포함하지 않는 조회 artifact다.

- D1: 144 tables, 11,141 rows
- R2: 622 objects, 3,818,865 bytes
- adapter registry: 56/56 valid, unregistered source table 0
- non-empty adapter tables: 34, adapter 대상 rows 2,291
- migration source state: envelope 0, mapping 0, source item 0, document 0
- `wrangler d1 migrations list`: pending `0018`~`0029`, 정확히 12개

이 확인 중 remote migration apply, D1/R2 content mutation, Worker deploy, secret 변경, feature flag 변경, password reauthentication, source-only/knowledge 실행은 하지 않았다. inventory `errors=0`이나 adapter 56/56은 구조 coverage이며 legacy 본문 해석의 substantive 승인이 아니다.

## 남은 승인 경계와 순서

1. 최종 local full regression을 통과하고 사용자가 승인한 재현 가능한 release snapshot을 고정한다. Worker build와 dry-run은 그 snapshot에서 다시 생성한다.
2. 사용자의 즉시 승인 아래 remote write 직전 Time Travel/recovery point와 verified full backup을 새로 확인한다.
3. pending `0018`~`0029` 12개를 순서대로 remote D1에 적용하고 table/index/trigger를 read-only query로 재검증한다.
4. 새 Worker를 deploy한 뒤 login, binding, protected export, provider scheduler의 synthetic smoke를 수행한다.
5. 별도 승인 아래 `FLAG_V2_LEGACY_READONLY=1`과 V1 mutation 409를 확인한다.
6. private substantive sample 승인 후 source-only, reconciliation, 전체 preservation gate, knowledge 순으로 진행한다.
7. 실제 backup/restore/quarantine drill, private corpus 20/20, device·사용성·recall, owner 14일/7일 관찰 전에는 `capture_default`, `library_default`, closure 또는 project completion을 선언하지 않는다.

restricted grant를 얻기 위해 사용자의 비밀번호를 production endpoint로 보내는 단계와 remote mutation은 이 read-only 검증의 권한 범위에 포함되지 않는다.
