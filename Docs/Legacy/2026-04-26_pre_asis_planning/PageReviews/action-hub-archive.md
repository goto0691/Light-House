# Page Review: Action Hub Archive

## Summary
- Route: `/action-hub/archive`
- Domain: Action Hub
- Primary user job: 완료 태스크와 종료 프로젝트를 회고한다.
- Overall score: 19/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/action-hub/archive/page.tsx`, `apps/web/src/lib/server/action-hub.ts`

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
| Editing / Input | 0 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server page calls archive helper and renders completed tasks/closed projects.
- Server data / D1: archive is derived from `getActionHubSnapshot()` filtering `status=done` and `progress>=100` in memory.
- Contextual Connectivity: cards link back to task workspace or project board but omit source/evidence/context rail.
- Mobile UX: two-column archive collapses; cards are touch-friendly by code.

## Findings
### P0
- None.

### P1
- None.

### P2
- 도메인 layout이 이미 seed/snapshot을 수행하는데 페이지가 다시 `seed*SupportData()` 또는 snapshot 조회를 호출하는 곳이 있어 D1 count/query 왕복이 반복될 수 있다.
- Archive filtering happens after loading the full Action Hub snapshot, which is wasteful for a history page as data grows.
- ContextBundle/SourceTracePanel이 붙은 상세 화면 외에는 source relation과 migration review item을 직접 탐색하는 표준 진입점이 약하다.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Create a D1 archive query with limits/date ranges.
- [ ] Add review grouping by week/month and context evidence for completed work.
- [ ] Remove redundant seed calls once demo seeding is separated from production reads.

## Follow-up Opportunities
- None.
