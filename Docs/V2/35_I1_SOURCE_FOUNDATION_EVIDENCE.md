# 35. I1 Source Foundation Evidence

> 상태: coded vertical slice 완료 · private deployment promotion gate 대기  
> 검증일: 2026-08-12  
> 범위: additive V2 source/document schema, 인증·privacy 경계, 원본 commit과 최소 제품 UI

## 1. 완료 경계

I1은 기존 V1 테이블과 route를 변경하거나 dual-write하지 않는다. `v2_` additive schema와 `/api/v2` route만 추가했고 `FLAG_V2_ROUTES`, `FLAG_V2_WRITE`는 기본 off다. AI key 또는 provider가 없어도 source commit은 독립적으로 완료된다.

한 번의 D1 `batch()`가 다음 정본을 함께 만든다.

- Capture Bundle과 불변 Source Item
- Document object, working body, 최초 immutable revision
- source/document/verified attachment link
- AI opt-in일 때 content-free processing outbox
- content-free audit event
- idempotency receipt

AI 호출과 R2 upload는 이 transaction 안에서 실행하지 않는다. direct upload는 예약·private signed PUT·서버 검증을 마친 원본만 source와 연결한다.

## 2. 구현 위치

| 계약 | 구현 |
| --- | --- |
| Drizzle schema | `packages/db/schema/v2.ts` |
| additive SQL migration | `migrations/0006_v2_source_and_document_foundation.sql` |
| capture validation·canonical hash | `apps/web/src/lib/v2/domain/capture-source.ts` |
| user-scoped source repository | `apps/web/src/lib/v2/infrastructure/d1/source-foundation-repository.ts` |
| attachment reservation repository | `apps/web/src/lib/v2/infrastructure/d1/attachment-reservation-repository.ts` |
| Origin·content-type·auth request gate | `apps/web/src/lib/v2/http/` |
| V2 source/attachment API | `apps/web/src/app/api/v2/` |
| 실제 blank Capture | `apps/web/src/app/v2/capture/`, `apps/web/src/components/v2/capture-composer.tsx` |
| generic Record·trash/restore | `apps/web/src/app/v2/records/`, `apps/web/src/components/v2/record-lifecycle-actions.tsx` |
| D1 계약 검증 | `apps/web/tests/contract/v2/source-foundation.test.ts` |

## 3. API와 사용자 경로

구현된 API:

```text
POST /api/v2/attachments/reservations
POST /api/v2/attachments/{reservationId}/verify
POST /api/v2/captures/commit
GET  /api/v2/captures/{captureId}/receipt
GET  /api/v2/records/{recordId}
POST /api/v2/records/{recordId}/trash
POST /api/v2/records/{recordId}/restore
```

Capture는 자유 Markdown, 선택 제목, 최대 20개 파일, 공개 범위, `저장 후 AI 정리`를 받는다. 파일 선택뿐 아니라 스크린샷 붙여넣기와 drag/drop도 attachment tray로 들어간다. 로컬 checkpoint와 서버 receipt를 구분하며 restricted payload는 IndexedDB에 남기지 않는다.

Record는 제목·원문 본문·source/attachment 목록을 표시하고 복구 가능한 휴지통/복원을 제공한다. restricted 잠금 projection은 제목, 본문, revision id/version, source와 attachment를 전송하지 않는다.

## 4. 원본·동시성·격리 검증

로컬 workerd D1에 실제 migration을 적용한 계약 테스트에서 다음을 확인했다.

- 한국어와 공백을 포함한 Markdown exact round-trip
- 20개 동시 동일 retry가 capture/document/source 각 1개로 수렴
- idempotency key의 다른 payload 재사용은 `409` 계약
- user B repository에서 user A record·reservation 조회 0
- unverified attachment 연결 거부와 전체 rollback
- batch 각 경계 fault injection에서 partial row 0
- trash/restore 뒤 source와 revision 보존
- audit metadata에 원문·제목을 쓰지 않음

단일 text-only local commit은 반복 실행에서 약 0.8~1.0초로 관찰됐다. 이는 local workerd를 포함한 개발 환경 수치이며 p95 1초 목표의 통계적 승격 증거는 아니다. copied staging D1에서 별도 측정한다.

## 5. 자동 검증

2026-08-12 실행 결과:

```text
npm.cmd run typecheck
→ PASS

npm.cmd test
→ 11 files, 63 tests PASS

npm.cmd run build
→ PASS, Next.js 16.3.0
→ /v2/capture, /v2/records/{id}, 7개 /api/v2 source route 포함

npm.cmd run test:e2e
→ 26 cases: 15 PASS, 11 intentional project skips

npx.cmd playwright test --grep "Product Capture"
→ desktop + mobile 2 PASS
→ pasted screenshot tray와 restricted local-persistence 차단

npm.cmd audit --omit=dev --json
→ production vulnerability 0
```

runtime schema validator는 공개된 취약 버전을 피하기 위해 Ajv `8.20.0` exact로 갱신했다. 전체 audit의 잔여 7건은 build/DB tooling transitive dependency이며 production graph에는 0건이다.

## 6. 보안 경계

- 모든 mutation은 로그인 session, same-origin `Origin`, 허용 `Content-Type`을 요구한다.
- repository는 생성 시 `userId` scope가 필수이며 읽기·쓰기 SQL에도 owner predicate를 둔다.
- 새 로그인은 현재 cookie session을 교체하고 logout·만료 session은 서버 row를 제거한다.
- archive key는 filename을 포함하지 않는 user별 opaque private namespace다.
- reservation의 size, MIME, SHA-256, owner metadata가 R2 object와 일치해야 verified가 된다.
- record와 receipt는 `private, no-store`; service worker는 API/record/attachment를 cache하지 않는다.
- restricted unlock 전 projection에는 민감 payload가 없다.

## 7. 승격 전 남은 gate

다음은 coded 완료가 아니라 private deployment에서 통과해야 하는 승격 조건이다.

- copied staging과 live D1에 `0006` migration dry-run·apply·row reconciliation
- 실제 archive R2 bucket CORS direct PUT, checksum, mismatch cleanup
- owner account 로그인 session으로 7개 API end-to-end 실행
- 20회 이상 text-only source commit의 staging p95 측정
- restricted 최근 재인증·grant·expiry UX는 I2에서 구현
- Android/iOS 실제 paste/share/offline 확인은 I4 promotion gate

따라서 I1은 다음 개발 slice가 의존할 수 있는 coded foundation으로 완료됐지만, production owner write를 켤 수 있는 상태라고 주장하지 않는다.

## 8. 다음 구현 단위

다음은 I2 Authoring, revisions, generic Record다. I0 editor spike를 실제 record에 연결하고 autosave revision, optimistic concurrency, Library privacy row, restricted reauthentication을 구현한다. I1 source와 immutable 최초 revision은 이후 AI 결과나 사용자 편집이 덮어쓰지 않는 기준점으로 유지한다.
