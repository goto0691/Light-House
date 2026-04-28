# Page Review: Vault Zettels

## Summary
- Route: `/vault/zettels`
- Domain: Vault
- Primary user job: 메모 목록, 편집, 백링크, 관련 맥락을 한 화면에서 다룬다.
- Overall score: 25/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/vault/zettels/page.tsx`, `apps/web/src/components/vault/zettels-client.tsx`, `apps/web/src/stores/use-vault-store.ts`, `apps/web/src/app/api/vault/zettels/*`, `apps/web/src/app/api/context/[entityType]/[entityId]/route.ts`

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
| Editing / Input | 3 |  |
| Responsive / A11y | 1 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: vault layout hydrates snapshot; client renders list/create form, markdown editor, link composer, BacklinkPanel, and zettel ContextBundlePanel.
- Server data / D1: zettels, links, media/assets/places come from `getVaultSnapshot`; create/update/delete/link mutations write D1.
- Contextual Connectivity: strong page-level connectivity with backlinks, semantic search, SmartAttachPanel, ContextMapMini, SourceTrace via context shell.
- Mobile UX: desktop 3-region split collapses to a long page; spec expected list/editor separation on mobile, not fully implemented.

## Findings
### P0
- None.

### P1
- None.

### P2
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.
- `Drawer` link uses `/vault?detail=zettel:id`, risking query loss through the `/vault` redirect.
- Semantic related results call `/api/search` whenever selected title changes; no debounce/cancellation beyond selected effect scope for large vaults.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Use `/vault/zettels?detail=zettel:id` for drawer links.
- [ ] Add mobile mode that separates list and editor or anchors the selected editor above the list.
- [ ] Debounce semantic search and expose loading/error state.
- [ ] Pass initial snapshot or hydration status to avoid mock/stale flashes.

## Follow-up Opportunities
- None.
