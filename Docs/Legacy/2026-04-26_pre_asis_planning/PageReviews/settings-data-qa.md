# Page Review: Migration QA

## Summary
- Route: `/settings/data/qa`
- Domain: Settings / Data
- Primary user job: source_documents, source relations, migration_review_items 상태를 검수한다.
- Overall score: 26/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/settings/data/qa/page.tsx`, `apps/web/src/components/settings/migration-qa-dashboard.tsx`, `apps/web/src/lib/server/settings.ts`

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
| Editing / Input | 1 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 3 |  |

## Analysis
- Route / components: server loads Migration QA overview and renders summary, DB table, duplicate source IDs, issue source documents, review item cards.
- Server data / D1: source_documents, source_document_relations, migration_review_items, duplicate source queries are D1-backed and guarded with catch fallbacks.
- Contextual Connectivity: explicit QA surface for SourceTrace/migration health; canonical links pivot to entity detail routes.
- Mobile UX: large tables use `overflow-x-auto`, which is better than hidden clipping but needs 375px table QA.

## Findings
### P0
- None.

### P1
- None.

### P2
- QA dashboard is read-only; unresolved source relation resolution happens elsewhere in SourceTracePanel, so repair workflow is split across screens.
- Catch fallbacks can hide query failures as empty QA data.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add direct links from unresolved source relation rows to SourceTrace resolution panels.
- [ ] Show query failure banners instead of silent empty fallback.
- [ ] Run mobile QA for wide source document table.

## Follow-up Opportunities
- None.
