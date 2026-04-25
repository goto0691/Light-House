# Page Review: Settings Data

## Summary
- Route: `/settings/data`
- Domain: Settings / Data
- Primary user job: Notion import, 관계 복원, export/restore dry run, migration health를 관리한다.
- Overall score: 27/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/settings/data/page.tsx`, `apps/web/src/components/settings/data-settings-client.tsx`, `apps/web/src/lib/server/settings.ts`, `apps/web/src/app/api/settings/data/notion/*`, `apps/web/src/app/api/export/route.ts`

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
| Data / D1 Accuracy | 3 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 3 |  |
| Responsive / A11y | 1 |  |
| Code Architecture | 2 |  |
| Verifiability | 3 |  |

## Analysis
- Route / components: server reads data overview; client handles import preview/import/repair, export, restore dry-run, entity/relation/review health, duplicate media, import jobs.
- Server data / D1: extensive D1 queries cover entity counts, backup/import jobs, relation health, migration review items, duplicates, saved views.
- Contextual Connectivity: strongest settings surface for migration/source health, with link to QA dashboard.
- Mobile UX: multiple dense grids/tables/cards; code uses responsive grids but needs manual 375px QA.

## Findings
### P0
- None.

### P1
- None.

### P2
- Data settings page is very dense and mixes import execution, restore dry-run, QA stats, and repair controls in one scroll; repeated operational actions could benefit from confirmation and clearer state partitioning.
- Some migration health queries catch and return empty arrays, which keeps the page alive but can hide schema/query drift.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add visible degraded-data warnings when migration QA queries fail.
- [ ] Separate dangerous/long-running import/repair actions with confirmations and progress state.
- [ ] Run 375px QA for import wizard, export panel, and review queue cards.

## Follow-up Opportunities
- None.
