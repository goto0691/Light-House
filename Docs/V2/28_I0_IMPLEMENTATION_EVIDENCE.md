# 28. I0 Implementation Evidence

> 상태: I0-001~013 coded baseline 완료 · live provider/device/private gates 대기  
> 검증일: 2026-08-12  
> 범위: `I0-001`~`I0-013`의 격리된 fixture와 검증 기반

## 1. 이번 구현의 경계

이번 변경은 V1 데이터나 mutation route를 건드리지 않는다. `/v2-lab`은 `FLAG_V2_ROUTES`가 켜진 환경에서만 열리는 동적 route이며, production 기본값은 off다. write·AI·legacy 전환 flag도 모두 server-only 기본 off다.

구현한 것은 실제 저장 제품이 아니라 다음 milestone에서 재사용할 수 있는 coded contract다.

- A+ `따뜻한 편집형 워크벤치` token과 light/dark theme
- stable semantic `icon_key` catalog, context allowlist, unknown fallback
- Library list, keyboard selection, Peek, sensitive preview 차단
- Record Detail, evidence 선택, desktop panel과 mobile evidence sheet
- mobile image Capture, AI on/off, offline 상태, source commit receipt
- server/client feature flag 경계
- fake Gemini gateway와 timeout·quota·provider·schema failure
- Milkdown visual/read mode와 CodeMirror source mode가 공유하는 Markdown editor fixture
- Vitest, Playwright, axe-core 실행 기반

## 2. 구현 위치

| 계약 | 구현 |
| --- | --- |
| gated coded surface | `apps/web/src/app/v2-lab/` |
| A+ fixture component | `apps/web/src/components/v2/lab/` |
| semantic icon catalog/renderer | `apps/web/src/lib/v2/presentation/`, `apps/web/src/components/v2/semantic-icon.tsx` |
| feature flag boundary | `apps/web/src/lib/v2/config/` |
| model gateway/fake | `apps/web/src/lib/v2/ai/` |
| unit/contract test | `apps/web/tests/unit/v2/`, `apps/web/tests/contract/v2/` |
| browser/accessibility test | `apps/web/tests/e2e/v2-lab.spec.ts` |
| editor contract/fixture | `apps/web/src/lib/v2/editor/`, `apps/web/src/components/v2/editor/` |
| runner config | `apps/web/vitest.config.mts`, `apps/web/playwright.config.ts` |

## 3. Backlog 상태

| ID | 상태 | 증거와 남은 경계 |
| --- | --- | --- |
| I0-001 | 완료 | clean install 뒤 typecheck/build 성공. 시작 시 존재한 `.gitignore`, `Docs/README.md`, `Docs/V2/` 변경은 보존했다. |
| I0-002 | 완료 | public projection에는 `routes`, `offline`만 포함. parser/projection 11 tests. |
| I0-003 | 완료 | Vitest·Playwright·axe-core·fake gateway scaffold와 sample green test. |
| I0-004 | 1차 완료 | CSS token, light/dark, semantic catalog 16 keys, context allowlist와 fallback. 최종 v1 승격은 전체 responsive QA 뒤다. |
| I0-005 | fixture 완료 | ArrowUp/Down, Enter, Space, Escape contract와 sensitive row. Peek→route→back 복원은 I2에서 실제 router와 검증한다. |
| I0-006 | fixture 완료 | evidence 선택과 mobile `근거와 정보` sheet. 실제 source span·image region 양방향 focus는 I2/I5 대상이다. |
| I0-007 | fixture 완료 | 390px visual QA, mobile receipt와 source/AI 상태 분리. 320px·실기기 QA는 I0 후속이다. |
| I0-008 | 완료 | Milkdown+CodeMirror semantic round-trip, selection toolbar, IME shortcut guard, selection 복원, 5만 자 fixture와 mobile editor QA. 상세는 [29_I0_EDITOR_SPIKE_EVIDENCE.md](./29_I0_EDITOR_SPIKE_EVIDENCE.md). |
| I0-009 | 완료 | local workerd D1 binding, 6개 batch 경계 rollback, 20개 동시 retry의 단일 commit, attachment verify trigger와 OpenNext binding route. 상세는 [30_I0_D1_TRANSACTION_SPIKE_EVIDENCE.md](./30_I0_D1_TRANSACTION_SPIKE_EVIDENCE.md). |
| I0-010 | 완료 | private key, signed PUT, MIME·size·SHA-256 verify, mismatch cleanup, streaming original과 user isolation. 상세는 [31_I0_R2_UPLOAD_VERIFY_SPIKE_EVIDENCE.md](./31_I0_R2_UPLOAD_VERIFY_SPIKE_EVIDENCE.md). |
| I0-011 | coded 완료 | 3.6 structured main, 2.5 grounded citation, no-fallback 11 tests. 실제 key probe는 대기. 상세는 [32](./32_I0_GEMINI_ROLE_CAPABILITY_EVIDENCE.md). |
| I0-012 | browser spike 완료 | IndexedDB restart, PWA share POST, offline shell 통과. Android/iOS 실기기는 대기. 상세는 [33](./33_I0_OFFLINE_SHARE_SPIKE_EVIDENCE.md). |
| I0-013 | harness 완료 | private 20 slot·5 expected draft, traversal/hash/approval fail-closed gate. 실제 source ready는 0/20. 상세는 [34](./34_I0_PRIVATE_CORPUS_MANIFEST_EVIDENCE.md). |

## 4. 자동 검증 결과

2026-08-12 현재 다음 명령을 깨끗한 dependency install 뒤 실행했다.

```text
npm.cmd run typecheck
→ PASS

npm.cmd test
→ 6 files, 39 tests PASS

npm.cmd run build
→ PASS, Next.js 16.3.0
→ /v2-lab = dynamic server route

npm.cmd run test:e2e
→ 22 cases: 13 PASS, 9 expected project skips
→ desktop 1440×1000 + mobile Pixel 7
→ 기존 fixture + editor 왕복, IME, selection 복원, 5만 자, mobile editor
→ Library와 Editor의 WCAG 2 A/AA critical axe violation 0

npm.cmd audit --omit=dev --json
→ production vulnerability 0
```

전체 audit에는 개발 도구 transitive dependency 4건이 남는다: low 2, high 2, critical 0. 현재 production dependency에는 포함되지 않는다. upstream fix 경로가 명확해질 때 별도 tooling update로 처리하며 `npm audit fix --force`는 실행하지 않았다.

## 5. 시각·상호작용 검토 결과

in-app browser에서 1440×1000 light/dark와 390px mobile을 직접 검토했다.

- warm paper surface와 조용한 chrome이 A+ 방향을 유지한다.
- desktop Library는 sidebar→list→Peek의 밀도와 위계가 분명하다.
- Record의 근거 panel은 본문보다 우세하지 않고 선택된 근거를 추적할 수 있다.
- 최초 mobile projection에서 evidence가 숨겨지는 문제가 보여 `근거와 정보` bottom sheet를 추가했다.
- mobile lab navigation은 작은 폭에서 제품 fixture를 압박해 identity label을 숨기고 surface tab에 전체 폭을 배정했다.
- AI off 상태의 sparkle와 작성 도움의 magic-wand icon을 제거하고 상태·목록 의미 icon으로 교체했다.
- Editor는 desktop 개요·본문·inspector 3열과 focus mode를 사용하고 mobile에서는 본문 내부 scroll과 고정 save footer로 투영했다.
- Milkdown은 task marker와 표 공백을 canonical form으로 정규화하지만 task·표 값·hard break·custom URI의 의미 구조는 유지했다.

## 6. 보안 기준선 보정

초기 설치 감사에서 direct runtime dependency의 고위험 권고를 발견해 다음처럼 갱신하고 회귀 검증했다.

- Next.js `16.3.0`
- Drizzle ORM `0.45.2`
- Sharp `0.35.3`
- PostCSS `8.5.23`
- AWS S3 SDK `3.1108.0`

이 변경 뒤 production audit은 0건이다. V2 write·AI flag는 여전히 off이고 fixture는 production data에 접근하지 않는다.

## 7. 다음 구현 단위

다음 작업은 `I1 Source Foundation`이다. additive `v2_` schema, 인증 경계, capture·source·attachment reservation API와 source receipt를 vertical slice로 구현한다. I0에서 남은 live Gemini, remote R2, Android/iOS, private corpus gate는 해당 promotion 시점의 release blocker로 유지한다.
