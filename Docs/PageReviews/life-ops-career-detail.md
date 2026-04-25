# Page Review: Career Detail

## Summary
- Route: `/life-ops/career/[careerId]`
- Domain: Life Ops
- Primary user job: 커리어 항목의 기간/설명/source context를 확인한다.
- Overall score: 23/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/life-ops/career/[careerId]/page.tsx`, `apps/web/src/lib/server/life-ops.ts`, `apps/web/src/components/shared/context/entity-context-shell.tsx`

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
| Contextual Connectivity | 3 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 0 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server loads career entry and ContextBundle, renders EntityContextShell with dates lens.
- Server data / D1: career_history and source/context queries are D1-backed.
- Contextual Connectivity: context rail/source trace available.
- Mobile UX: simple content with accordion rail.

## Findings
### P0
- None.

### P1
- None.

### P2
- 도메인 layout이 이미 seed/snapshot을 수행하는데 페이지가 다시 `seed*SupportData()` 또는 snapshot 조회를 호출하는 곳이 있어 D1 count/query 왕복이 반복될 수 있다.
- No edit/delete action in detail despite delete API existing.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add edit/delete or return-to-career affordance.
- [ ] Remove redundant seed call.
- [ ] Surface linked projects/tasks if available in ContextBundle.

## Follow-up Opportunities
- None.
