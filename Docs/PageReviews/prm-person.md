# Page Review: Person 360

## Summary
- Route: `/prm/[personId]`
- Domain: PRM
- Primary user job: 한 사람을 중심으로 timeline, media, projects, notes, gifts, source를 탐색한다.
- Overall score: 27/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/prm/[personId]/page.tsx`, `apps/web/src/components/prm/person-360-client.tsx`, `apps/web/src/components/shared/context/entity-context-shell.tsx`, `apps/web/src/lib/server/context.ts`

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
| Contextual Connectivity | 3 |  |
| Data / D1 Accuracy | 3 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 2 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server seeds/loads person and ContextBundle in parallel, then renders `Person360Client` with EntityContextShell.
- Server data / D1: `getPRMPerson` validates person; `getContextBundle("person", id)` reads explicit/source/inferred relations across people/tasks/zettels/media/daily/gifts/interactions.
- Contextual Connectivity: one of the strongest implementations: lenses, mini map, SmartAttachPanel, SourceTracePanel, and detach edge path exist.
- Mobile UX: EntityContextShell rail switches to accordion; lens chips and node grids still need runtime tap/overflow validation.

## Findings
### P0
- None.

### P1
- None.

### P2
- 도메인 layout이 이미 seed/snapshot을 수행하는데 페이지가 다시 `seed*SupportData()` 또는 snapshot 조회를 호출하는 곳이 있어 D1 count/query 왕복이 반복될 수 있다.
- Detach edge fetch does not handle non-OK responses or show user feedback, so relation-removal failure can silently leave stale UI.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add toast/error handling and rollback for `onDetachEdge`.
- [ ] Remove redundant seed call where PRM layout already seeded.
- [ ] Run mobile QA for lens chip wrapping and SourceTrace readability.

## Follow-up Opportunities
- None.
