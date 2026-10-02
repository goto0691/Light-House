# 42. I8 Private Cutover 구현과 Release Gate

> 상태: live infrastructure와 V2 canary 완료 · private corpus/device/observation/grounded quota gate 미충족
> 검증일: 2026-08-13

## 2026-10-03 로컬 사전검증 보완

아래 8월의 live canary와 검사는 당시 결과로 보존한다. 현재 `cutover:preflight`는 evidence v1 JSON 구조를 읽지만 단순 boolean이나 과거 결과만으로 전환을 허용하지 않는다.

- 모든 시각은 실제 달력에서 유효한 UTC ISO 문자열(`YYYY-MM-DDTHH:mm:ssZ` 또는 `.SSSZ`)이어야 한다. 날짜만, 로컬 날짜, 시간대 offset, 불가능한 날짜는 거부한다. 순수 계약에는 명시 `now`를 전달할 수 있고 실제 CLI는 현재 UTC 시각을 사용한다.
- 측정 evidence는 사전검증 기준 시각보다 미래이면 안 되며 최대 24시간 이내여야 한다. 운영자가 옛 evidence의 날짜만 갱신하는 것은 새 측정을 대신하지 못한다.
- `capture_default`의 검증 snapshot은 측정 시각 직전 최대 24시간 이내여야 한다. `library_default`와 `closure`는 기존 Capture 전환 시각 직전 24시간의 snapshot인지 확인한다. 관찰 기간 동안 당시 복구점이 오래됐다는 이유만으로 새 전환 전 snapshot을 요구하지 않는다.
- `closure`는 Capture 기본 전환 후 **30일**과 rollback drill을 모두 요구한다. Library의 7일 관찰 기준을 종료 기준으로 재사용하지 않는다.
- CLI는 현재 source/expected 파일을 hash 검증한 corpus digest·정확 case 집합·승인 count를 재계산하고, `parseReport()`로 구조·집계·promotion을 다시 검사한 recorded evaluator report에 결합한다. 승인된 expected는 사람 승인과 사용자 위임 후 독립 검토를 구분하며 승인 수의 합계가 20이어야 한다.
- 별도 identity JSON의 `build_sha`, `schema_sha256`, `model_config_sha256`, `prompt_sha256`, `registry_sha256` 모두가 보고서와 같아야 한다. build SHA는 현재 Git HEAD와도 같아야 하고 runtime·migration·build·평가 소스에 미커밋 변경이 있으면 차단한다. explicit identity는 해당 후보를 실제로 측정한 산출물에서 준비하며 임의 hash로 채우지 않는다.
- 기록 평가가 `live_provider_verified=false`, `rubric=not_scored`, `promotion.eligible=false`이면 실제 공급자·독립 rubric·출시 판단 blocker가 남는다. foundation report의 결정론적 metric을 실제 모델 품질이나 최종 출시 승인으로 승격하지 않는다. 보고서 누락·identity/corpus 불일치·unknown·fatal도 전환을 차단한다.
- CLI는 private 경로, source/query/value, hash/identity, arbitrary parser/Git 오류를 출력하지 않는다. contract 소유 blocker key·설명과 aggregate 준비 count만 출력하며 실패 시 `recommendedEnv=null`, exit1이다.

```powershell
# 아래 두 파일은 동일한 현재 후보/corpus의 평가 산출물이다.
# 기본값은 .private/cutover/identity.json, .private/cutover/recorded-report.json이다.
npm.cmd run cutover:preflight -- --target=capture_default `
  --identity=.private/cutover/identity.json `
  --report=.private/cutover/recorded-report.json

# 순수 로컬 계약과 private 값을 출력하지 않는 CLI 경계 검사
npm.cmd run test --workspace @light-house/web -- --maxWorkers=1 tests/unit/v2/cutover-contract.test.ts
node --import tsx --test tools/v2-cutover/recorded-evidence.test.ts
node node_modules/typescript/bin/tsc --project tools/v2-cutover/tsconfig.json
```

24시간은 현재 개인 운영의 사전검증·전환 전 복구점 freshness 상한이다. 26번의 전환 직전 snapshot 및 T+30 종료 계약을 실행 가능한 검사로 구체화한 것이며 실제 device·live 모델·원격 migration/배포·관찰 기간을 로컬 시험으로 대체하지 않는다.

## 2026-08-29 후속 hardening 상태

- local repository는 `0026` terminal reconciliation, `0027` migration quarantine/CAS, `0028` owner-safe FTS, `0029` provider invocation lease까지 확장됐다. current canonical archive 구현 계약은 `v2-020`이고 `v2-017`·`v2-018`·`v2-020`을 지원한다. 아래 2026-08-13 canary에는 이 후속 코드가 배포돼 있지 않다.
- backup/restore lease owner 교체 중 stale writer가 child row, canonical R2 key, cleanup/retention 상태를 덮지 못하도록 CAS·attempt object·receipt·trigger 경계를 추가했다. restore fencing/schema 집중 묶음은 12/12를 통과했고 독립 검토에서 P0/P1 잔여가 없었다.
- nonprojected legacy object는 일반 read/write/AI/search/template/export 표면에서 fail-closed로 숨기고, migration export만 recent reauthentication 뒤 full-account source envelope까지 보존한다. provider gateway 호출 중에는 object-level invocation lease가 격리·trash·quarantine race를 막는다.
- generated Worker binding과 `wrangler.toml` drift를 검사하는 `npm.cmd run bindings:check`가 통과했다. Capture cutover E2E와 Library cutover E2E도 각각 1/1 통과해 legacy mutation 409와 인증 경계를 서로 다른 assertion으로 확인했다.
- 후속 OpenNext Worker build와 Wrangler deploy dry-run은 83 static pages, Assets 740, D1/R2/Assets binding, gzip 2,647.32 KiB로 통과했고 bundle/repository secret 감사도 hit 0이었다. 이는 local package 근거이며 remote deploy가 아니다. 작업 트리가 아직 재현 가능한 release snapshot으로 고정되지 않았으므로 실제 배포 blocker로 유지한다.
- 2026-08-29 read-only refresh는 D1 144 tables / 11,141 rows, R2 622 objects / 3,818,865 bytes와 adapter 56/56을 확인했다. remote D1 pending은 `0018`~`0029` 12개이며 source-only와 knowledge는 0건이다. apply·deploy·flag 변경을 실행하지 않았으므로 정식 cutover가 아니다.
- private corpus는 여전히 ready 0/20이며 owner Capture 14일, 이후 Library 7일, 실제 device·사용성·recall 및 grounded quota 근거가 남아 있다. 아래 2026-08-13 canary 결과와 자동 검증 표는 그 날짜의 역사적 snapshot이다.

## 2026-08-13 live canary 결과

- 운영 URL: `https://project-light-house.gogo0691.workers.dev`
- Worker version: `574542ec-1c7a-44e1-9d3c-5ed17124f90b`
- D1 `0001`~`0017` migration history가 정리됐고 `wrangler d1 migrations list`는 `No migrations to apply`다.
- 기존 DB에 이력이 없던 0003~0005는 실제 컬럼·인덱스·테이블을 대조한 뒤 기준선으로 등록했다. FTS는 원본 행을 보존한 채 파생 행만 재구축했고 원본/FTS 행 수와 15개 유지 trigger를 검증했다.
- 사전 구조 inventory는 87 tables / 10,110 rows, V2 적용 후 inventory는 144 tables / 10,964 rows다. 기존 일반 테이블의 행 변화는 없고 차이는 FTS 정상화, migration history, V2 schema다.
- D1 Time Travel 사전 bookmark는 ignored recovery artifact에 기록했다. SQL export는 기존 FTS5 virtual table 때문에 Cloudflare가 거부했다.
- R2 inventory는 14 objects / 3,675,692 bytes에서 verified full backup 뒤 52 objects / 3,684,612 bytes가 됐다. D1 snapshot row는 `status=succeeded`, validator와 manifest root hash, `verified_at=2026-08-13T03:02:49.389Z`를 가진다.
- R2 CORS는 운영 origin과 `localhost:3000`, `PUT`, 서명된 content/checksum/reservation metadata header로만 제한했다.
- secret 8개는 Worker secret으로 등록했고 값은 deploy command나 로그에 출력하지 않았다.
- `gemini-3.6-flash` text+1px PNG structured live probe는 통과했다. 기존 `gemini-2.5-flash`는 신규 계정에서 종료됐으므로 grounded 역할을 공식 저비용 후속 `gemini-3.5-flash-lite`로 바꿨다. 이 역할의 live probe는 현재 키의 quota `429`로 미통과다.
- OpenNext custom Worker가 AI queue `*/5 * * * *`, backup maintenance `20 18 * * *` UTC를 처리한다. secret-authenticated direct smoke에서 processing은 두 역할 모두 `idle`, backup은 1 user를 성공 처리했다.
- 운영 로그인, 보호된 dashboard, `/v2/capture`, D1/R2 binding `ready=true`를 브라우저로 검증했다. 개발 기본 로그인 값은 공개 UI에서 제거했고 production admin secret 누락 시 fail-closed한다.
- live 144-table inventory를 기준으로 source table 56개와 모든 필드의 deterministic adapter coverage를 검증했다. 인증 테이블 2개와 FTS virtual/shadow table만 명시적으로 제외했으며, 56/56 adapter가 통과했다. 실제 source-only migration과 내용 표본 승인은 아직 실행하지 않았다.
- 현재 canary flag는 routes/write/AI/offline/PWA on, V2 default Library와 V1 legacy-readonly off다. 따라서 정식 `capture_default` cutover를 선언한 상태가 아니다.

## 구현 결과

### 단계적 전환 계약

`cutover-contract-v1.ts`는 전환을 세 목표로 분리한다.

| 목표 | 바뀌는 기본 동작 | 추가 조건 |
| --- | --- | --- |
| `capture_default` | V2 write·AI·offline 활성화, V1 mutation read-only, Library는 아직 legacy | owner V2 capture 14일, private corpus 20/20, live Gemini/Worker, 실제 device, live D1/R2와 migration reconciliation, verified snapshot, usability |
| `library_default` | `/`, login 후 진입, 전역 검색·로고가 V2 Library/Search | Capture 전환 뒤 7일, private recall top-10 90% 이상 |
| `closure` | 전환 관찰 종료 판단 | rollback drill 통과 |

증거가 하나라도 없거나 형식이 틀리면 `eligible=false`다. 도구는 Cloudflare 설정을 변경하지 않으며 통과한 경우에만 여섯 feature flag의 추천값을 JSON으로 출력한다.

```powershell
Copy-Item tools/v2-cutover/evidence.example.json .private/cutover/evidence.json
npm.cmd run cutover:preflight -- --target=capture_default
npm.cmd run cutover:preflight -- --target=library_default
npm.cmd run cutover:preflight -- --target=closure
```

private corpus count와 승인 상태는 operator가 숫자로 주장할 수 없고 실제 `.private/golden-corpus/manifest.yaml`, source SHA-256, `human_approved` expected 결과에서 다시 계산한다.

### V1 read-only와 기본 route

- `middleware.ts`는 safe method가 아닌 요청 중 V1 보관 데이터·upload·legacy import·legacy cron route로 명시된 경로를 중앙에서 409 `legacy_readonly`로 거부한다.
- V1 GET/HEAD/OPTIONS와 V2 API는 통과한다. login/logout session, 프로필·appearance·AI·shortcut 설정, export, notification read, Notion preview는 보관 기록 mutation이 아니므로 유지한다.
- V1 shell에는 읽기 전용 banner를 표시하고 Quick Capture를 제거한다.
- V2 write가 기본이면 전역 Capture와 `Cmd/Ctrl+Shift+N`이 `/v2/capture`로 간다.
- Library 기본 전환 뒤 `/`, 로그인 성공, LH logo, `Cmd/Ctrl+K`가 V2 Library/Search로 간다.
- Library UI rollback은 `FLAG_V2_DEFAULT_LIBRARY=0`으로 제한한다. V2 Capture와 V1 read-only는 유지하며 dual-write와 reverse migration을 만들지 않는다.

### Cloudflare package

- Next 16.3 Node `proxy.ts`는 현재 OpenNext Cloudflare 1.20.2가 지원하지 않아 bundle을 거부했다. Next 16이 계속 제공하는 Edge `middleware.ts`에 pure request guard만 격리했다.
- Turbopack production trace는 Windows에서 junction을 재생성할 때 `EPERM`이 발생했다. production script를 `next build --webpack`으로 고정하자 OpenNext Worker 생성이 완료됐다. dev server는 기존 Turbopack을 유지한다.
- `apps/web/.open-next/worker.js` 생성 SHA-256은 `D05223BF4D44C84108A102AB62AA3BC9C5568F0C3AC2064C37BE5CC65C64BC45`였다. 이 값은 build artifact 식별값이지 다음 build의 고정 정본이 아니다.
- Wrangler deploy는 D1 `DB`, R2 `ARCHIVE_ASSETS`, Assets와 V2 flag를 인식했다. 계정에 없고 deterministic V2 retrieval이 사용하지 않는 legacy Vectorize binding은 제거했다.
- final deploy upload는 raw 13,470.74 KiB, gzip 2,513.65 KiB였고 Worker startup은 27ms였다.
- `public/_headers`는 `/_next/static/*`를 immutable 1년 cache하고 `/sw.js`는 no-store와 자체 CSP를 유지한다.

## 2026-08-13 자동 검증

| 검증 | 결과 |
| --- | --- |
| 전체 Vitest unit/contract | 30 files, 151 passed |
| cutover state machine unit | 4 passed |
| authenticated home routing unit | 2 passed |
| V1/V2 middleware contract | 13 passed |
| explicit cutover Playwright | desktop 2 passed |
| Next production build | 81 static/dynamic route output, middleware 인식 |
| OpenNext Worker build | completed |
| Wrangler live deploy | D1/R2/assets, two Cron triggers, production login and binding smoke passed |
| lint | 0 errors, 기존 React compiler 조언 30 warnings |

## 현재 사전검증 결과

로컬 private manifest는 구조상 유효하고 20개 slot과 expected draft 5개가 있지만 실제 source hash와 사람 승인이 없어 `readyCount=0`, `readyForPrivateEvaluation=false`다. `.private/cutover/evidence.json`에는 live에서 확인한 항목만 true로 기록했다. `cutover:preflight`는 이 상태에서 추천 flag를 출력하지 않고 남은 미충족 gate를 나열한다.

다음을 아직 완료했다고 주장하지 않는다.

- Gemini 3.5 Flash-Lite grounded live role probe의 quota 해소
- live V2 source commit smoke와 legacy adapter substantive sample/source-only/final-delta reconciliation
- 실제 restore/rollback drill
- Windows Korean IME 수동 검수, Android Share Target, iOS fallback, screen reader
- 실제 글 20건의 human-approved expected와 fatal/privacy/usability/recall 평가
- owner account 14일 Capture 및 이후 7일 Library 관찰

이 항목은 코드로 대체하거나 임의의 `true`로 채울 수 없는 release evidence다.

## 실제 전환 순서

1. private source와 사람이 쓴 expected를 20/20 준비하고 `npm.cmd run eval:private:gate`를 통과한다.
2. live Gemini, Worker, device, usability 결과를 날짜·artifact와 함께 private cutover evidence에 기록한다.
3. read-only live D1/R2 inventory와 adapter coverage를 검증하고 source-only migration을 수행한다.
4. legacy dry-run hash를 승인하고 manual sample·구조 reconciliation을 통과한다.
5. owner가 V2 Capture를 14일 사용한다.
6. 전환 직전 verified backup을 만들고 final delta를 reconcile한다.
7. `cutover:preflight --target=capture_default`가 출력한 flag만 배포하고 V1 409/V2 commit/outbox를 smoke test한다.
8. 7일 뒤 recall 90%와 사용성 회귀를 확인해 `library_default`를 검토한다.
9. T+30일 rollback drill 뒤 `closure`를 통과한다. legacy archive와 source envelopes는 삭제하지 않는다.
