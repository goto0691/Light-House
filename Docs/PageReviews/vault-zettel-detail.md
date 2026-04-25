# Page Review: Zettel Detail

## Summary
- Route: `/vault/zettels/[zettelId]`
- Domain: Vault
- Primary user job: 공유 가능한 전체화면 메모 상세와 문맥을 본다.
- Overall score: 24/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/vault/zettels/[zettelId]/page.tsx`, `apps/web/src/lib/server/vault.ts`, `apps/web/src/components/shared/context/context-bundle-panel.tsx`

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
| Editing / Input | 1 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: server loads zettel detail, renders content cards, and client-loads ContextBundlePanel with attach enabled.
- Server data / D1: `getVaultZettel` reads D1 snapshot and selected zettel; context is fetched from `/api/context/zettel/id`.
- Contextual Connectivity: rail/source trace are present after client context load; main body is read-only Markdown.
- Mobile UX: stacked cards and context accordion should fit; very long Markdown needs runtime check.

## Findings
### P0
- None.

### P1
- None.

### P2
- 도메인 layout이 이미 seed/snapshot을 수행하는데 페이지가 다시 `seed*SupportData()` 또는 snapshot 조회를 호출하는 곳이 있어 D1 count/query 왕복이 반복될 수 있다.
- Context loads client-side after the article, so source/relationship evidence is not available in the initial server response.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Consider server-loading `getContextBundle("zettel", id)` for first paint on detail pages.
- [ ] Remove duplicate seed from detail pages once layout seeding is centralized.
- [ ] Add edit/open-in-split affordance back to `/vault/zettels`.

## Follow-up Opportunities
- None.
