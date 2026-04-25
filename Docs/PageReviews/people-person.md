# Page Review: People Alias Detail

## Summary
- Route: `/people/[personId]`
- Domain: PRM
- Primary user job: legacy/canonical alias에서 Person 360으로 진입한다.
- Overall score: 24/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/people/[personId]/page.tsx`, `apps/web/src/app/(app)/prm/[personId]/page.tsx`

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
| Contextual Connectivity | 3 |  |
| Data / D1 Accuracy | 3 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 1 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 3 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: page re-exports PRM person detail, keeping one implementation for person deep links.
- Server data / D1: same D1 path as `/prm/[personId]`.
- Contextual Connectivity: same Person 360 ContextBundle coverage.
- Mobile UX: same as Person 360.

## Findings
### P0
- None.

### P1
- None.

### P2
- Alias route is not represented in IA/LNB, so canonical path expectations can diverge between `/people/id` and `/prm/id`.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Document `/people/[personId]` as an alias or redirect it to `/prm/[personId]` for canonical URLs.

## Follow-up Opportunities
- None.
