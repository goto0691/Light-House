# Page Review: Zettel Graph

## Summary
- Route: `/vault/zettels/graph`
- Domain: Vault
- Primary user job: 지식 그래프와 문서별 ContextBundle 맵을 훑는다.
- Overall score: 18/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/vault/zettels/graph/page.tsx`, `apps/web/src/components/shared/context/context-map-mini.tsx`, `apps/web/src/lib/server/context.ts`

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
| Real User Usability | 1 |  |
| IA / Routing | 2 |  |
| Contextual Connectivity | 2 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 1 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 0 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server reads vault snapshot, builds ContextBundle for first 9 zettels, and renders mini maps plus link index.
- Server data / D1: zettels/links/source relations are D1-backed; graph is limited to first 9 zettels for maps, all zettels for link index.
- Contextual Connectivity: ContextMapMini gives evidence density, but no interactive zoom/pan graph or focused node search.
- Mobile UX: mini maps stack; link index can become long.

## Findings
### P0
- None.

### P1
- None.

### P2
- Spec expects a real network graph with zoom/pan/search; current page renders static mini maps and a card index.
- The page performs up to 9 ContextBundle calls at depth 2 on initial load, which can be expensive with source/semantic includes.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add a real graph surface or rename the page as context map index until graph behavior exists.
- [ ] Batch graph data into one D1 read model instead of per-zettel bundle calls.
- [ ] Add filters/search for graph node focus.

## Follow-up Opportunities
- None.
