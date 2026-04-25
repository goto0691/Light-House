# Page Review: Task Workspace

## Summary
- Route: `/action-hub/[projectId]/tasks/[taskId]`
- Domain: Action Hub
- Primary user job: 태스크 본문, 체크리스트, 사람/문서 연결, 컨텍스트를 편집한다.
- Overall score: 24/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/action-hub/[projectId]/tasks/[taskId]/page.tsx`, `apps/web/src/components/action-hub/task-workspace-client.tsx`, `apps/web/src/components/shared/zen-editor.tsx`, `apps/web/src/components/shared/context/context-bundle-panel.tsx`, `apps/web/src/app/api/action-hub/tasks/[taskId]/*/route.ts`

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
| Editing / Input | 2 |  |
| Responsive / A11y | 1 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server validates task, then client receives IDs and reads project/task from Action Hub store; editor, checklist, attach controls, and ContextBundlePanel compose the workspace.
- Server data / D1: title/content/checklist/status/person/zettel mutations write D1 and return snapshots; ContextBundle reads `/api/context/task/id`.
- Contextual Connectivity: strongest Action Hub page for connectivity: SmartAttachPanel, ContextMapMini, ContextRail, and SourceTrace via context shell are available.
- Mobile UX: 3-column layout collapses, but the meta panel, editor, and context rail create a long dense page; tiny checklist toggles are under 44px.

## Findings
### P0
- None.

### P1
- None.

### P2
- Server already loaded the task but `TaskWorkspaceClient` does not receive it, so direct links can momentarily render “태스크를 찾지 못했습니다” until the store hydrator runs.
- Checklist toggle buttons are visual dots (`h-4 w-4`) without accessible labels and are too small for comfortable mobile touch.
- Person/zettel detach uses display name/title, which is unsafe for duplicates.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Pass server-loaded project/task as initial props or expose a hydration-ready loading state.
- [ ] Increase checklist toggle tap targets to at least 44px and add `aria-label`.
- [ ] Detach relations by canonical IDs instead of names/titles.
- [ ] Run 375px workspace QA for editor, meta panel, and context accordion order.

## Follow-up Opportunities
- None.
