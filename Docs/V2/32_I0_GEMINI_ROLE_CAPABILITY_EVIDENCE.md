# 32. I0 Gemini Role Capability Evidence

> 상태: `I0-011` coded contract 완료 · live provider gate 부분 통과  
> 검증일: 2026-08-13  
> 범위: main analyzer 3.6 Flash와 grounded enricher 3.5 Flash-Lite의 역할·schema·citation 경계

## 1. 결론

V2는 `gemini-3.6-flash`를 멀티모달 구조 분석기로, `gemini-3.5-flash-lite`를 Google Search 기반 외부 사실 보강기로 고정한다. 한 역할의 실패를 다른 역할 모델로 넘기는 일반 fallback은 없다.

초기 계획의 `gemini-2.5-flash`는 2026-08-13 신규 사용자 API 호출에서 `404 model no longer available`을 반환했다. Google의 현재 안정판과 2.5 Flash 마이그레이션 경로에 맞춰 저비용 검색 역할만 `gemini-3.5-flash-lite`로 교체했다.

- main analyzer: Google GenAI SDK `generateContent`, JSON Schema response, text+inline image
- grounded enricher: Interactions API, `google_search`, URL citation과 UTF-8 byte range envelope
- application validation: Ajv로 provider JSON을 다시 검사
- citation이 없는 외부 응답: accepted external fact로 사용 금지
- quota·timeout·provider·schema error: typed error로 정규화하며 다른 역할 model로 전환하지 않음

## 2. 구현 위치

| 계약 | 구현 |
| --- | --- |
| provider-independent interface | `apps/web/src/lib/v2/ai/gateway.ts` |
| model role route | `apps/web/src/lib/v2/ai/model-routing.ts` |
| Gemini SDK adapters | `apps/web/src/lib/v2/ai/gemini-role-gateways.ts` |
| deterministic contract tests | `apps/web/tests/contract/v2/gemini-role-gateways.test.ts` |
| synthetic live probe | `apps/web/scripts/probe-gemini-v2.ts` |

SDK는 `@google/genai` `2.14.0`, validator는 Ajv `8.17.1`로 고정했다. 환경 이름은 `GEMINI_MAIN_MODEL`, `GEMINI_GROUNDED_MODEL`이다.

## 3. 자동 검증

```text
npm.cmd run typecheck
→ PASS

npm.cmd run test:gemini-spike --workspace @light-house/web
→ 2 files, 11 tests PASS
→ Korean text+image request, schema reject, quota no-fallback,
  search query, UTF-8 citation range, citation absence reject
```

## 4. Live gate

`npm.cmd run probe:gemini-live --workspace @light-house/web`는 개인 자료를 전송하지 않고 1px PNG와 합성 한국어, Google 공식 문서 검색만 사용한다. 2026-08-13 실제 키로 3.6 구조화 이미지 호출 단계가 통과했으며, 기존 2.5 검색 호출에서 모델 종료를 확인했다. 3.5 Flash-Lite 검색 재시험은 무료 할당량 `429` 해제 후 남은 live gate다.

다음은 live key가 있는 배포 환경에서 반드시 통과해야 한다.

- configured model ID의 실제 availability
- 3.6 JSON Schema + image response
- 3.5 Flash-Lite search citation metadata
- token usage와 timeout behavior

이 gate 전에는 모델 capability를 production-confirmed로 표시하지 않는다.
