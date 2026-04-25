# Page Review: Project Calendar

## Summary
- Route: `/action-hub/[projectId]/calendar`
- Domain: Action Hub
- Primary user job: 마감일이 있는 프로젝트 태스크를 날짜 관점으로 본다.
- Overall score: 18/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/action-hub/[projectId]/calendar/page.tsx`, `apps/web/src/components/action-hub/project-calendar-client.tsx`, `apps/web/src/components/action-hub/task-calendar.tsx`

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
| UX/UI Polish | 2 |  |
| Editing / Input | 0 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server filters project tasks with `dueAt`, client filters/searches and renders `TaskCalendar` cards.
- Server data / D1: uses full Action Hub snapshot then filters by project/due date in server memory.
- Contextual Connectivity: task cards show status/priority/energy but are not links to task workspace or context drawer.
- Mobile UX: responsive card grid is safer than table, but it is not a true calendar or swipe/drag surface.

## Findings
### P0
- None.

### P1
- None.

### P2
- Calendar cards are not clickable, so users cannot drill into a task from the calendar view.
- The view is a due-date card grid, not a calendar with date buckets or drag-to-reschedule behavior.
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Wrap calendar task cards in links to `/action-hub/[projectId]/tasks/[taskId]`.
- [ ] Group tasks by date/week and add reschedule mutation before calling it complete.
- [ ] Add date range filters to avoid loading the full project snapshot for large projects.

## Follow-up Opportunities
- None.
