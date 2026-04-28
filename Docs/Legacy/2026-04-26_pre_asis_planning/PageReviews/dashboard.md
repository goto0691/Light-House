# Page Review: Dashboard

## Summary
- Route: `/dashboard`
- Domain: Dashboard
- Primary user job: 오늘의 작업, 관계, 기록, 에너지를 30초 안에 스캔한다.
- Overall score: 22/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/components/dashboard/dashboard-client.tsx`, `apps/web/src/components/dashboard/dashboard-grid.tsx`, `apps/web/src/lib/server/action-hub.ts`, `apps/web/src/lib/server/life-ops.ts`, `apps/web/src/lib/server/prm.ts`, `apps/web/src/lib/server/vault.ts`

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
| Editing / Input | 1 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server page seeds four domains, loads Action Hub, Life Ops, PRM, Vault snapshots, then renders `DashboardClient` widgets.
- Server data / D1: `getActionHubSnapshot`, `getLifeOpsLog(today)`, `getPRMSnapshot`, `getVaultSnapshot` are D1-backed. Heatmap and energy fallback still use `getHeatmapMock()` and synthetic series.
- Contextual Connectivity: widgets link to task/person/zettel/date surfaces, but no `ContextBundle` rail is present on the dashboard itself.
- Mobile UX: Bento grid collapses through shared grid classes; dense widget content still needs 375px visual verification.

## Findings
### P0
- None.

### P1
- None.

### P2
- `StreakHeatmapWidget` receives `getHeatmapMock()` instead of D1 habit history, so one prominent Life Ops signal is not real data.
- 도메인 layout이 이미 seed/snapshot을 수행하는데 페이지가 다시 `seed*SupportData()` 또는 snapshot 조회를 호출하는 곳이 있어 D1 count/query 왕복이 반복될 수 있다.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Replace dashboard heatmap/energy fallback with a D1-backed habit and health metric series.
- [ ] Split dashboard seed/snapshot calls into cached read helpers or remove redundant seed calls when demo data is no longer needed.
- [ ] Run 375px widget scan for text overflow and tap target density.

## Follow-up Opportunities
- Let `DashboardGrid` consume saved widget layouts from appearance settings.
