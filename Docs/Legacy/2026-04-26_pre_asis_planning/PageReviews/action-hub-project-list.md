# Page Review: Project List

## Summary
- Route: `/action-hub/[projectId]/list`
- Domain: Action Hub
- Primary user job: 프로젝트 태스크를 테이블로 훑고 상세로 이동한다.
- Overall score: 16/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/action-hub/[projectId]/list/page.tsx`, `apps/web/src/components/action-hub/project-list-client.tsx`, `apps/web/src/components/action-hub/task-data-grid.tsx`

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
| Contextual Connectivity | 1 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 1 |  |
| Editing / Input | 0 |  |
| Responsive / A11y | 1 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server validates project and filters tasks, client renders filter bar and `TaskDataGrid`.
- Server data / D1: task rows are D1-backed through `getActionHubSnapshot`; no pagination or server-side sort is used.
- Contextual Connectivity: task title links to workspace, but table does not show connected people/zettels/source evidence.
- Mobile UX: table has six columns inside `overflow-hidden`, not horizontal scroll, so 375px can clip important fields.

## Findings
### P0
- None.

### P1
- `TaskDataGrid` uses a wide table wrapped by `overflow-hidden`; on 375px, columns/actions can be clipped with no horizontal scroll or card alternative.

### P2
- Spec calls for richer data-grid behavior such as sort/resize/hide/infinite scroll, but current table is static.
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.

### P3
- None.

## Required Actions
### P0/P1 Actions
- [ ] Change the table wrapper to `overflow-x-auto` with a min-width table or render mobile task cards below `md`.

### P2/P3 Actions
- [ ] Add server/query-backed sort and pagination before large project usage.
- [ ] Add columns for linked people/zettels and context count.
- [ ] Run 375px table QA after layout change.

## Follow-up Opportunities
- None.
