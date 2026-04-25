# Page Review: Life Ops Career

## Summary
- Route: `/life-ops/career`
- Domain: Life Ops
- Primary user job: 커리어 타임라인을 보고 항목을 추가/삭제한다.
- Overall score: 21/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/life-ops/career/page.tsx`, `apps/web/src/components/life-ops/career-client.tsx`, `apps/web/src/app/api/life-ops/career/route.ts`

## Hard Gate
- [x] typecheck/build pass - `npm run typecheck`, `npm run build` passed on 2026-04-25.
- [~] D1 data renders - D1-backed query path found, runtime D1 session not manually exercised.
- [~] Contextual navigation works - route links exist; context rail coverage varies by page.
- [ ] Mobile 375px usable - not manually browser-tested; assessed from responsive classes and layout code.
- [~] Source/migration trace safe - no mutation risk found; SourceTrace coverage depends on context components.

## Scores
| Category | Score | Notes |
| --- | ---: | --- |
| Product Value | 2 |  |
| Real User Usability | 2 |  |
| IA / Routing | 2 |  |
| Contextual Connectivity | 1 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 2 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: client reads career rows from LifeOps store, renders timeline/form controls.
- Server data / D1: career_history is D1-backed; create/delete APIs return LifeOps snapshot.
- Contextual Connectivity: career detail has ContextBundle; list has minimal relation/source visibility.
- Mobile UX: timeline/form need runtime check; likely stacked.

## Findings
### P0
- None.

### P1
- None.

### P2
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.
- Career list does not expose source documents or linked projects/tasks that would make career history contextually useful.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Show source/context counts on career nodes.
- [ ] Add links from career entries to detail pages.
- [ ] Run mobile timeline QA.

## Follow-up Opportunities
- None.
