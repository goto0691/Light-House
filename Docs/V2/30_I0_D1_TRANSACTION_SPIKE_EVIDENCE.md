# 30. I0 D1 Transaction Spike Evidence

> 상태: `I0-009` 기술 spike 완료 · Workers binding batch 채택  
> 검증일: 2026-08-12  
> 범위: D-063, ADR-002의 source commit 원자성·멱등성·outbox 경계

## 1. 결론

V2 source commit은 Cloudflare REST helper가 아니라 Worker `D1Database` binding의 `batch()`로 구현한다. local workerd D1에서 Capture, Source 2건, 검증된 attachment link, analyze outbox, idempotency receipt를 하나의 batch로 저장했고 모든 statement 경계의 failure injection에서 partial row가 0건임을 확인했다.

기존 `apps/web/src/lib/server/cloudflare-d1.ts`는 V1 호환용 단일 REST query helper로 남긴다. V2 application/repository가 이 helper를 import하거나 여러 REST call로 transaction을 흉내 내는 것은 금지한다.

## 2. 구현 위치

| 계약 | 구현 |
| --- | --- |
| domain input·receipt·error | `apps/web/src/lib/v2/domain/source-commit.ts` |
| D1 batch repository | `apps/web/src/lib/v2/infrastructure/d1/source-commit-repository.ts` |
| OpenNext runtime binding | `apps/web/src/lib/v2/infrastructure/cloudflare/runtime-bindings.ts` |
| local D1 schema | `apps/web/tests/fixtures/v2/source-commit-spike.sql` |
| isolated Wrangler config | `apps/web/tests/fixtures/v2/wrangler.d1-spike.toml` |
| binding/fault contract test | `apps/web/tests/contract/v2/d1-source-commit.test.ts` |
| Next runtime probe | `apps/web/src/app/api/v2/spikes/d1-binding/route.ts` |

## 3. Transaction sequence

한 source commit batch는 다음 순서를 사용한다.

1. `v2_capture_bundles`
2. 하나 이상의 `v2_source_items`
3. verify된 attachment의 `v2_source_attachment_links`
4. AI가 켜졌으면 `v2_processing_outbox`의 `analyze` event
5. `v2_idempotency_records`의 immutable receipt

AI가 꺼진 입력은 outbox를 만들지 않지만 나머지 source commit과 idempotency receipt는 같은 원자적 경계를 사용한다. outbox payload에는 `captureId`만 넣었으며 source body를 복제하지 않는다.

attachment link 앞에는 DB trigger가 있다. 같은 user 소유이며 `verified` 상태인 reservation만 연결할 수 있다. `uploaded` 상태를 강제로 넣은 테스트에서는 link statement가 실패하고 그 앞에서 만들어진 Capture와 Source까지 전부 rollback됐다. 기존 reservation은 source commit 밖의 선행 단계이므로 유지된다.

## 4. Idempotency 결과

unique scope는 `(user_id, operation, idempotency_key)`이며 operation은 `capture.commit`이다.

- 동일 key·동일 payload hash: 저장된 receipt를 `replayed`로 반환
- 동일 key·다른 payload hash: `idempotency_conflict`
- 동일 요청 20개 동시 실행: `committed` 1개, `replayed` 19개
- 최종 row: Capture 1, Source 2, link 1, outbox 1, idempotency 1

동시 요청은 batch unique constraint에서 경쟁할 수 있다. 패배한 요청은 실패 뒤 idempotency row를 다시 읽어 동일 payload면 성공 receipt로 수렴한다.

## 5. Failure injection 결과

fixture batch는 Capture 1 + Source 2 + link 1 + outbox 1 + idempotency 1, 총 6개 정상 statement로 구성됐다. 각 정상 statement 뒤에 존재하지 않는 table insert를 하나씩 삽입해 여섯 경계를 모두 검사했다.

모든 경우 결과는 다음과 같았다.

```text
v2_capture_bundles          0
v2_source_items             0
v2_source_attachment_links  0
v2_processing_outbox        0
v2_idempotency_records      0
```

따라서 local workerd에서 D1 `batch()`가 statement 실패 시 전체 sequence를 rollback한다는 gate를 통과했다.

## 6. Next·Cloudflare runtime 연결

`@opennextjs/cloudflare` `1.20.2`와 Wrangler `4.121.0`을 고정했다.

- `next.config.mjs`가 `initOpenNextCloudflareForDev()`로 root `wrangler.toml`의 local binding을 연결한다.
- runtime repository는 `getCloudflareContext().env.DB`만 사용한다.
- `/api/v2/spikes/d1-binding`은 `{ binding: "DB", ready: true, transport: "workers_binding" }`을 반환했다.
- Playwright가 이 route를 회귀 검증한다.

OpenNext static asset binding은 `ASSETS`를 사용하므로 기존 archive R2 binding은 `ARCHIVE_ASSETS`로 이름을 분리했다. I0-010 R2 repository는 이 binding을 사용한다.

## 7. 자동 검증

```text
npm.cmd run typecheck
→ PASS

npm.cmd test
→ 5 files, 32 tests PASS
→ D1 workerd contract 6 tests 포함

npm.cmd run build
→ PASS, Next.js 16.3.0
→ /api/v2/spikes/d1-binding dynamic route 포함

npm.cmd run test:e2e
→ 20 cases: 12 PASS, 8 expected project skips
→ D1 Workers binding route PASS

npm.cmd audit --omit=dev --json
→ production vulnerability 0
```

전체 audit은 transitive development tooling 4건(low 2, high 2, critical 0)이다.

## 8. Worker bundle 환경 경계

정식 OpenNext build는 Next production compilation과 server bundle 시작까지 성공했지만 Windows host에서 dependency symlink 생성이 `EPERM`으로 차단됐다. OpenNext도 Windows에서 WSL 사용을 권장한다.

이는 D1 binding이나 application build 실패가 아니다. local `next dev` binding route와 workerd transaction은 모두 통과했다. 최종 Worker artifact 생성은 WSL 또는 Linux CI에서 `npm run build:worker`를 실행하는 필수 배포 gate로 남긴다. 이 gate가 통과하기 전 production deploy 완료를 주장하지 않는다.

## 9. ADR-002 — D1 binding batch와 outbox

### 결정

- V2 write repository는 Worker `D1Database` binding을 주입받는다.
- source commit은 단 하나의 `batch()` 호출이다.
- AI provider 호출은 batch 밖이며 source commit 성공 뒤 outbox consumer에서만 시작한다.
- REST multi-call fallback을 만들지 않는다.
- idempotency receipt는 commit의 마지막 statement다.

### 결과

- provider·network 실패가 source 저장을 되돌리지 않는다.
- 부분 Capture나 orphan outbox가 생기지 않는다.
- route는 Cloudflare adapter에 의존하지만 domain/application contract는 binding interface와 분리된다.

## 10. 다음 작업

다음 작업은 `I0-010 R2 upload/verify spike`다. reservation, private direct upload, object metadata 검증, SHA-256 원본 round-trip, streaming read와 mismatch cleanup을 local R2 binding으로 검증한다.
