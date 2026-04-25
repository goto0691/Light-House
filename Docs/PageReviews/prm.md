# Page Review: PRM People

## Summary
- Route: `/prm`
- Domain: PRM
- Primary user job: 관계 목록을 필터링하고 연락 리듬을 관리한다.
- Overall score: 24/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/prm/layout.tsx`, `apps/web/src/app/(app)/prm/page.tsx`, `apps/web/src/components/prm/prm-client.tsx`, `apps/web/src/components/prm/person-card.tsx`, `apps/web/src/stores/use-prm-store.ts`

## Hard Gate
- [x] typecheck/build pass - `npm run typecheck`, `npm run build` passed on 2026-04-25.
- [~] D1 data renders - D1-backed query path found, runtime D1 session not manually exercised.
- [~] Contextual navigation works - route links exist; context rail coverage varies by page.
- [ ] Mobile 375px usable - not manually browser-tested; assessed from responsive classes and layout code.
- [~] Source/migration trace safe - no mutation risk found; SourceTrace coverage depends on context components.

## Scores
| Category | Score | Notes |
| --- | ---: | --- |
| Product Value | 3 |  |
| Real User Usability | 3 |  |
| IA / Routing | 3 |  |
| Contextual Connectivity | 2 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 1 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: PRM layout hydrates people/gifts/network edges; client renders filter tabs, search, cards, and HitThemUpPanel.
- Server data / D1: people/gifts/interactions/network edges are D1-backed through `getPRMSnapshot`.
- Contextual Connectivity: cards deep-link to Person 360; list itself shows health/timeline counts but no context rail.
- Mobile UX: card grid collapses; spec expected PRM 2-column mobile cards, likely okay but unverified.

## Findings
### P0
- None.

### P1
- None.

### P2
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.
- No create-person flow is visible despite IA/spec mentioning `+ 새 인물`.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add create person action or make import-only status explicit.
- [ ] Show source/unresolved counts on person cards for migration cleanup.
- [ ] Run 375px PRM card grid QA.

## Follow-up Opportunities
- None.
