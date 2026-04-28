# Page Review: PRM Graph

## Summary
- Route: `/prm/graph`
- Domain: PRM
- Primary user job: 사람 간 관계선과 ContextBundle 관계망을 대조한다.
- Overall score: 19/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/prm/graph/page.tsx`, `apps/web/src/components/prm/prm-graph-client.tsx`, `apps/web/src/components/prm/prm-graph-canvas.tsx`

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
| UX/UI Polish | 1 |  |
| Editing / Input | 2 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server builds ContextBundle mini maps for first 8 people, then client renders relationship form and card-based graph canvas.
- Server data / D1: people/network_edges are D1-backed; per-person ContextBundle calls are D1-backed.
- Contextual Connectivity: mini maps show context, but `PRMGraphCanvas` is a card grid rather than spatial graph.
- Mobile UX: form and cards stack; graph readability on mobile is acceptable but not a true graph interaction.

## Findings
### P0
- None.

### P1
- None.

### P2
- Spec expects clustered graph behavior; current canvas is a per-person card grid with duplicate edge rendering.
- Page issues up to 8 depth-2 ContextBundle reads on initial load, which can be expensive.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Implement real graph visualization or rename to Relationship Edge Manager.
- [ ] Batch graph bundle data in one endpoint.
- [ ] Prevent self-edge source/target selection and duplicate edge creation in the form.

## Follow-up Opportunities
- None.
