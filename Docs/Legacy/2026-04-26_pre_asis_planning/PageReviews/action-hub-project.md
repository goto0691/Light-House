# Page Review: Project Kanban

## Summary
- Route: `/action-hub/[projectId]`
- Domain: Action Hub
- Primary user job: 프로젝트 태스크를 칸반으로 상태 이동하며 실행한다.
- Overall score: 23/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/action-hub/[projectId]/page.tsx`, `apps/web/src/components/action-hub/kanban-client.tsx`, `apps/web/src/components/action-hub/kanban-board.tsx`, `apps/web/src/app/api/action-hub/tasks/[taskId]/cycle-status/route.ts`, `apps/web/src/components/shared/context/context-bundle-panel.tsx`

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
| Contextual Connectivity | 2 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 2 |  |
| Responsive / A11y | 1 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server page validates project, client renders `ProjectHeader`, filters, `KanbanBoard`, and compact project `ContextBundlePanel`.
- Server data / D1: tasks and project come from cached `getActionHubSnapshot`; status mutation updates `tasks.status` and refreshes snapshot.
- Contextual Connectivity: project-level ContextBundle is present with attach enabled, but task cards still expose linked people/zettels mostly as card metadata.
- Mobile UX: Kanban columns likely stack rather than horizontal-swipe; established Action Hub mobile spec expects swipable columns.

## Findings
### P0
- None.

### P1
- None.

### P2
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.
- Kanban status movement is a button-driven cycle; drag/drop and explicit target status are not implemented.
- Mobile kanban is not a horizontal swipable board as specified.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add drag/drop or explicit status menu with optimistic update and rollback.
- [ ] Implement a mobile column switcher or horizontal scroll with stable column widths.
- [ ] Expose task context node cards or drawer entry directly from each card.

## Follow-up Opportunities
- None.
