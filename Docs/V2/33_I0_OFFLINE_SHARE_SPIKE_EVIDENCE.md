# 33. I0 Offline and Share Target Spike Evidence

> 상태: `I0-012` browser spike 완료 · 실제 Android/iOS device matrix 대기  
> 검증일: 2026-08-12  
> 범위: IndexedDB restart, PWA shell, Web Share Target, restricted local policy

## 1. 결론

IndexedDB `lighthouse_capture_v1`을 미전송 source draft·Blob·outbox·content-free receipt의 내구성 계층으로 채택했다. D1/R2가 정본이며 Library/record/API 응답은 service worker cache에 넣지 않는다.

- normal: IndexedDB checkpoint
- sensitive: device opt-in 없으면 저장하지 않고 기존 payload 제거
- restricted: persistent local payload를 즉시 제거하고 저장 거부
- source commit receipt: draft·Blob·outbox를 같은 transaction에서 제거한 뒤 본문 없는 receipt만 유지
- foreground sync가 정본, Background Sync는 필수 조건이 아님

## 2. 구현 위치

| 계약 | 구현 |
| --- | --- |
| local types/state | `apps/web/src/lib/v2/offline/local-capture.ts` |
| IndexedDB repository | `apps/web/src/lib/v2/offline/indexeddb-capture-store.ts` |
| share form parser | `apps/web/src/lib/v2/offline/share-target.ts` |
| PWA manifest/share target | `apps/web/src/app/v2-manifest.webmanifest/route.ts` |
| service worker | `apps/web/public/sw.js` |
| offline capture shell | `apps/web/public/offline-capture.html`, `offline-capture.js` |
| browser registration | `apps/web/src/components/v2/pwa-registration.tsx` |
| tests | `apps/web/tests/contract/v2/indexeddb-share-target.test.ts`, `tests/e2e/v2-lab.spec.ts` |

## 3. 검증 결과

```text
npm.cmd run test:offline-spike --workspace @light-house/web
→ 6 tests PASS
→ 한국어 text+3 Blob restart, current outbox 1개, restricted purge,
  sensitive opt-in gate, receipt purge, share source order

npm.cmd run build
→ PASS, manifest dynamic route 포함

Playwright desktop Chromium isolated offline flags
→ IndexedDB checkpoint 후 reload 복구 PASS
→ service worker ready와 controller PASS
→ synthetic title→text→URL→image share 순서 PASS
→ network offline /capture shell PASS
```

in-app browser에서도 한국어 합성 draft를 저장하고 새로고침한 뒤 같은 본문과 `이 기기에 임시 저장됨` 상태가 복구되는 것을 확인했다.

## 4. Cache 경계

service worker cache allowlist는 offline shell JS/HTML과 두 app icon뿐이다. `/api/**`, record HTML/RSC, search, attachment, signed URL, export는 runtime cache 대상이 아니다. `/sw.js`는 `no-cache, no-store`와 self-only script CSP로 제공된다.

## 5. 남은 device gate

desktop Chromium의 동등 browser 환경은 통과했지만, Android installed PWA의 OS share sheet와 iOS installed web app fallback은 실제 기기에서 확인해야 한다. 다음은 I4 승격 전 필수다.

- Android text/URL/image 공유 대상 노출과 process kill resume
- iOS image picker, offline draft, 공유 fallback
- Windows/macOS/Firefox storage quota·install 차이
- sensitive device-key encryption 구현과 threat test
