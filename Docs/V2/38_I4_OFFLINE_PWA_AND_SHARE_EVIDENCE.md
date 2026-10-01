# 38. I4 Offline, PWA, Mobile Share 구현 근거

> 상태: I4 coded implementation 완료 · 물리 Android/iOS 및 실제 Cloudflare 업로드는 최종 release gate  
> 검증일: 2026-08-12

## 구현 결과

### 로컬 draft와 개인정보 경계

- `lighthouse_capture_v1` IndexedDB schema version 2
- normal text, URL, Blob attachment, outbox, content-free receipt 보존
- 800ms idle checkpoint와 현재 URL의 `draftId` 복구 포인터
- browser restart 뒤 본문과 3개 Blob 복구
- sensitive는 사용자가 `이 기기에 암호화해 임시 저장`을 선택한 경우만 지속
- sensitive body, filename, attachment bytes는 non-extractable AES-GCM device key로 암호화
- normal object store에 sensitive plaintext 0건
- restricted 전환 즉시 normal/sensitive draft, attachment, outbox 모두 삭제
- 미전송 draft 최대 50개; 오래된 미전송 원본을 자동 삭제하지 않고 51번째 체크포인트를 거부
- storage estimate 70% 경고, 85% 이상에서 새 첨부 차단

### Foreground sync와 exact-once

- IndexedDB outbox의 stable payload hash와 idempotency key 사용
- attachment별 reservation, upload, verification 상태 체크포인트
- verified attachment는 browser restart 뒤 다시 업로드하지 않음
- 실패한 파일만 새 reservation으로 재전송하고 verified 파일을 건너뜀
- network/408/429/5xx는 exponential backoff, 인증 만료는 payload 유지 후 사용자 안내
- validation 오류는 자동 반복하지 않고 `partial_blocked`, 409는 `conflict`
- 동시에 발생한 online/foreground/manual trigger를 draft별 하나의 promise로 합쳐 provider call과 commit 중복 방지
- server receipt 수신 뒤에만 draft, Blob, outbox를 한 transaction에서 삭제
- `SyncQueueSheet`에서 다른 대기 draft 재전송과 2단계 로컬 삭제 제공
- 현재 작성 중 draft는 queue에서 자동 commit하거나 삭제할 수 없음

### PWA와 Web Share Target

- production `/v2/capture`를 manifest id/start URL로 사용
- share target의 title, text, URL, image/PDF를 IndexedDB draft로 먼저 보존
- service worker는 `/api/**`, record HTML/RSC, search, attachment, export를 cache하지 않음
- offline navigation은 allowlisted Capture 경로만 정적 offline shell로 fallback
- 새 service worker는 자동 `skipWaiting`하지 않음
- 사용자가 업데이트 버튼을 눌렀을 때만 교체하고, URL의 draft ID로 reload 뒤 작성 내용을 복구
- Background Sync API에 의존하지 않으며 online/visibility/manual foreground sync가 정본 경로

## 검증 결과

- TypeScript typecheck 통과
- service worker와 offline shell JavaScript syntax 통과
- Vitest 15 files, 87 tests 통과
- offline 관련 계약 11건 통과
  - encrypted sensitive persistence와 non-extractable key
  - restart 후 3 Blob 복구
  - 첫 미검증 파일부터 재개
  - 동시 trigger 10개에서 upload/commit 각 1회
  - 인증 중단 payload 유지
  - restricted persistence 0
  - source payload purge와 receipt 유지
  - 51번째 local draft 거부와 기존 50개 보존
- Playwright 30 cases: 18 pass, 12 의도적 project skip
  - 실제 `/v2/capture` restart recovery
  - pasted screenshot과 restricted local purge
  - SyncQueueSheet의 현재 draft 보호
  - installed PWA synthetic share와 offline navigation shell
  - desktop/mobile 기존 편집·Library·접근성 회귀 없음
- Next.js production build 통과

## 남은 외부 release gate

- Android Chrome 설치 앱에서 OS share text, URL, image 실기기 확인
- iOS installed web app의 image picker와 foreground fallback 확인
- 실제 Cloudflare R2 signed PUT 중 network interruption 및 reservation expiry drill
- 브라우저별 storage eviction과 `navigator.storage.persist()` 표시 확인

위 항목은 I8 private cutover 전에 실기기 표로 승인한다.
