# Page Review: Settings Shortcuts

## Summary
- Route: `/settings/shortcuts`
- Domain: Settings
- Primary user job: 키보드 단축키를 확인하고 커스텀 바인딩을 관리한다.
- Overall score: 19/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/settings/shortcuts/page.tsx`, `apps/web/src/components/settings/shortcuts-settings-client.tsx`, `apps/web/src/components/settings/shortcut-table.tsx`, `apps/web/src/app/api/settings/shortcuts/route.ts`

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
| Real User Usability | 2 |  |
| IA / Routing | 2 |  |
| Contextual Connectivity | 0 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 2 |  |
| Editing / Input | 2 |  |
| Responsive / A11y | 1 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server reads shortcut bindings and renders shortcut settings client/table.
- Server data / D1: shortcut bindings are D1-backed via ui-state helpers.
- Contextual Connectivity: operational shell behavior, not entity context.
- Mobile UX: shortcut table needs horizontal/stacked validation.

## Findings
### P0
- None.

### P1
- None.

### P2
- Shortcut settings are only useful if command palette/global handlers consume the same D1 bindings; that cross-check is not visible on the page.
- Settings domain fallback issue applies.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Trace global hotkey consumers to the same binding source or document current fixed shortcuts.
- [ ] Add mobile table/card layout for shortcut rows.
- [ ] Add Settings shell handling.

## Follow-up Opportunities
- None.
