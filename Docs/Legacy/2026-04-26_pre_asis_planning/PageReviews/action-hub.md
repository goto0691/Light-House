# Page Review: Action Hub Projects

## Summary
- Route: `/action-hub`
- Domain: Action Hub
- Primary user job: 프로젝트/영역을 만들고 작업 보드로 진입한다.
- Overall score: 23/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/action-hub/layout.tsx`, `apps/web/src/app/(app)/action-hub/page.tsx`, `apps/web/src/components/action-hub/action-hub-home-client.tsx`, `apps/web/src/stores/use-action-hub-store.ts`, `apps/web/src/app/api/action-hub/projects/route.ts`

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
| IA / Routing | 2 |  |
| Contextual Connectivity | 2 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 2 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: domain layout seeds and hydrates D1 snapshot; page renders `ActionHubHomeClient` project directory and creation form.
- Server data / D1: `getActionHubSnapshot` reads projects/tasks/captures/references. Project creation posts to `/api/action-hub/projects` and returns a fresh snapshot.
- Contextual Connectivity: project cards enter project workbench; ContextBundle is not shown on landing, but project detail provides context.
- Mobile UX: card grid and aside collapse through `PageBody`; creation form remains usable but needs visual QA.

## Findings
### P0
- None.

### P1
- None.

### P2
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.
- Archived filter tab currently hides all rows instead of routing to `/action-hub/archive` or showing archived projects inline.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add an explicit loading/hydration state or pass initial snapshot into the client page to avoid mock/stale flashes.
- [ ] Make the Archived tab route to archive or include archived project data.
- [ ] Run 375px QA on project creation form and filter buttons.

## Follow-up Opportunities
- None.
