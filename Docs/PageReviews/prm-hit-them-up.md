# Page Review: Hit Them Up

## Summary
- Route: `/prm/hit-them-up`
- Domain: PRM
- Primary user job: 연락 주기가 지난 사람을 우선순위로 확인한다.
- Overall score: 22/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/prm/hit-them-up/page.tsx`, `apps/web/src/lib/server/prm.ts`

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
| Real User Usability | 2 |  |
| IA / Routing | 3 |  |
| Contextual Connectivity | 1 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 1 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server page reads `getPRMNeedsContact` and renders overdue contact cards.
- Server data / D1: people rows and cadence are D1-backed through PRM snapshot.
- Contextual Connectivity: links to Person 360; no inline timeline/source context for why contact is due.
- Mobile UX: simple cards should work, not manually verified.

## Findings
### P0
- None.

### P1
- None.

### P2
- No “mark contacted” action is available from the queue; users must open Person 360/drawer to complete the core job.
- ContextBundle/SourceTracePanel이 붙은 상세 화면 외에는 source relation과 migration review item을 직접 탐색하는 표준 진입점이 약하다.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add inline mark-contacted action with D1 mutation and toast feedback.
- [ ] Show last interaction/gift/source evidence snippet for each due person.

## Follow-up Opportunities
- None.
