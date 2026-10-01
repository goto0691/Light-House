# 31. I0 R2 Upload and Verify Spike Evidence

> 상태: `I0-010` 기술 spike 완료 · private R2 lifecycle 채택  
> 검증일: 2026-08-12  
> 범위: ADR-004의 reservation, direct PUT, object verify, streaming read, mismatch cleanup

## 1. 결론

V2 attachment 원본은 public URL이 아니라 `ARCHIVE_ASSETS` R2 binding의 private object로 저장한다. local workerd R2에서 원본 byte·MIME·size·SHA-256의 streaming round-trip이 일치했고, size·MIME·checksum·owner metadata 불일치는 verify 실패와 object 제거로 수렴했다.

브라우저 direct upload는 R2 S3 endpoint의 10분짜리 signed PUT을 사용한다. filename은 object key에 포함하지 않고 표시 메타로만 유지한다.

## 2. 구현 위치

| 계약 | 구현 |
| --- | --- |
| reservation 정책·private key | `apps/web/src/lib/v2/domain/attachment-reservation.ts` |
| R2 put/head/verify/private read | `apps/web/src/lib/v2/infrastructure/r2/attachment-object-repository.ts` |
| signed browser PUT | `apps/web/src/lib/v2/infrastructure/r2/direct-upload-url.ts` |
| local R2 binding fixture | `apps/web/tests/fixtures/v2/wrangler.d1-spike.toml` |
| R2 contract test | `apps/web/tests/contract/v2/r2-attachment-object.test.ts` |
| Next runtime probe | `apps/web/src/app/api/v2/spikes/r2-binding/route.ts` |

## 3. Object key와 upload policy

original key 형식은 다음과 같다.

```text
users/{user_id}/originals/{yyyy}/{mm}/{reservation_id}
```

- user ID와 reservation ID는 opaque safe identifier만 허용한다.
- filename을 path에 넣지 않아 traversal·encoding·개인정보 노출 범위를 줄인다.
- image는 JPEG, PNG, WebP를 허용한다.
- audio는 M4A/MP3/WAV/WebM, video는 MP4/WebM을 허용한다.
- document는 PDF/plain text/Markdown을 허용한다.
- executable, HTML, SVG는 차단한다.
- 개별 파일 provisional limit는 100 MB다.

HEIC/HEIF는 실제 decoder·device fixture를 통과하기 전까지 허용하지 않는다.

## 4. Direct PUT 계약

signed URL은 다음을 고정한다.

- method: `PUT`
- endpoint: Cloudflare R2 S3 endpoint
- expiry: 기본 900초, 허용 범위 60~3600초
- key: private opaque original key
- required upload metadata: reservation ID, user ID
- checksum: reservation의 SHA-256
- content type: reservation의 claimed MIME

checksum과 owner metadata header는 signature에 포함된다. size는 browser가 `Content-Length`를 임의로 설정할 수 없으므로 signed header에 넣지 않고 verify 단계에서 R2 object size와 비교한다.

I0에서는 fake credential로 signature shape를 검증하고 local R2 binding으로 object put/verify를 실행했다. 실제 remote R2 CORS PUT은 production data를 쓰지 않는 I0 경계 때문에 호출하지 않았다. I1 attachment API의 live-secret test에서 별도 bucket 또는 isolated prefix로 검증한다.

## 5. Verify와 cleanup

verify는 R2 `head()` 결과를 reservation과 비교한다.

1. object 존재
2. exact size
3. exact content type
4. exact SHA-256
5. reservation ID metadata
6. user ID metadata

하나라도 다르면 object를 제거하고 attachment를 verified/committed로 승격하지 않는다. object가 맞으면 key·size·MIME·SHA-256만 담은 검증 결과를 반환한다.

다른 사용자는 reservation을 알고 있어도 private original을 받을 수 없다. read repository에서 requesting user와 reservation user를 먼저 비교하고 object metadata도 다시 확인한다.

## 6. Streaming round-trip

한국어 screenshot payload를 local workerd R2에 넣은 뒤 `ReadableStream` reader로 전부 읽었다.

- input bytes = streamed bytes
- input SHA-256 = R2 checksum = streamed SHA-256
- input length = R2 object size
- input MIME = R2 HTTP metadata content type

application repository는 원본 전체를 Buffer로 바꾸지 않고 stream을 반환한다. preview/OCR 변형은 이후 background job이 만들며 원본 verify 성공을 뒤집지 않는다.

## 7. 자동 검증

```text
npm.cmd run typecheck
→ PASS

npm.cmd test
→ 6 files, 39 tests PASS
→ R2 workerd contract 7 tests 포함

npm.cmd run build
→ PASS, Next.js 16.3.0
→ /api/v2/spikes/r2-binding dynamic route 포함

npm.cmd run test:e2e
→ 22 cases: 13 PASS, 9 expected project skips
→ ARCHIVE_ASSETS Workers binding route PASS

npm.cmd audit --omit=dev --json
→ production vulnerability 0
```

## 8. ADR-004 — private R2 reservation lifecycle

### 결정

- static asset binding `ASSETS`와 archive original binding `ARCHIVE_ASSETS`를 분리한다.
- reservation은 D1, binary original은 R2가 정본이다.
- client upload metadata는 신뢰하지 않고 R2 object를 server verify한다.
- failed verification은 orphan object를 제거한다.
- private read는 authorization 뒤 stream으로 반환한다.
- public bucket URL을 DB 정본으로 저장하지 않는다.

### 남은 I1 경계

- D1 reservation 상태 `reserved → uploaded_unverified → verified → committed`
- 24시간 만료 cleanup job
- 실제 browser CORS PUT과 session expiry recovery
- image magic-byte와 HEIC/HEIF decoder capability
- capture 단위 20 files / 250 MB aggregate enforcement

## 9. 다음 작업

다음 작업은 `I0-011 Gemini role capability spike`다. main analyzer와 grounded enricher를 서로 대체하지 않는 role alias로 구성하고 JSON Schema, multimodal input, search citation, timeout·quota·invalid schema를 synthetic fixture로 검증한다.
