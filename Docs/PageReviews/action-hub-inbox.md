# Page Review: Action Hub Inbox

## Summary
- Route: `/action-hub/inbox`
- Domain: Action Hub
- Primary user job: Quick Capture와 미분류 태스크를 검토하고 프로젝트로 보낸다.
- Overall score: 19/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/action-hub/inbox/page.tsx`, `apps/web/src/components/action-hub/inbox-client.tsx`, `apps/web/src/app/api/action-hub/captures/[captureId]/dismiss/route.ts`, `apps/web/src/app/api/action-hub/tasks/[taskId]/route/route.ts`

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
| Editing / Input | 1 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: page renders `InboxClient`; data arrives from ActionHub layout hydrator and store selectors.
- Server data / D1: pending captures come from `quick_captures`; inbox tasks are `tasks.project_id is null`. Mutations update capture status or task project.
- Contextual Connectivity: routing is task-to-project only; no person/zettel/source evidence is shown for capture suggestions.
- Mobile UX: two-column grid collapses, but action buttons and long capture text need 375px check.

## Findings
### P0
- None.

### P1
- `InboxClient` routes every inbox task to hard-coded `project-modu-works`; real users without that demo project can fail the mutation or create a misleading route outcome.

### P2
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.
- Capture “수락” and “삭제” both call dismiss, so acceptance does not create/confirm a canonical task/relation path.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] Replace the hard-coded project with a project selector populated from snapshot projects and validate target existence server-side.

### P2/P3 Actions
- [ ] Split accept/delete semantics: accept should route/create the suggested entity, delete should dismiss.
- [ ] Show AI suggested fields and source confidence before committing.
- [ ] Run 375px QA for long capture cards.

## Follow-up Opportunities
- None.
