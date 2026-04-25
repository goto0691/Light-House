# Page Review: Vault Places

## Summary
- Route: `/vault/places`
- Domain: Vault
- Primary user job: 장소와 방문 메모를 관리한다.
- Overall score: 20/33
- Review method: 2026-04-25 static code review; `npm run typecheck` pass; `npm run build` pass. Runtime browser/D1 session QA was not performed.
- Reviewed code: `apps/web/src/app/(app)/vault/places/page.tsx`, `apps/web/src/components/vault/places-client.tsx`, `apps/web/src/app/api/vault/places/[placeId]/review/route.ts`

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
| Contextual Connectivity | 1 |  |
| Data / D1 Accuracy | 2 |  |
| Performance | 2 |  |
| UX/UI Polish | 1 |  |
| Editing / Input | 2 |  |
| Responsive / A11y | 2 |  |
| Code Architecture | 2 |  |
| Verifiability | 2 |  |

## Analysis
- Route / components: client page reads places from vault store, renders list and textarea-on-blur review saving, plus map placeholder.
- Server data / D1: places hydrate from D1; review writes to `places.notes` via API.
- Contextual Connectivity: place detail/drawer use ContextBundle, but list does not show companions, visits, or related daily logs.
- Mobile UX: two-column layout collapses; onBlur saving can be fragile on mobile navigation.

## Findings
### P0
- None.

### P1
- None.

### P2
- 클라이언트 중심 페이지가 persisted Zustand mock 초기값을 먼저 가질 수 있고, layout hydrator `useEffect` 이후 D1 snapshot으로 교체된다. 실제 D1 데이터는 연결되지만 첫 렌더/오프라인 복귀에서 stale local state가 잠깐 노출될 수 있다.
- Map area is an explicit placeholder, so the page does not meet the spec for map + list.
- Place review saves on blur with no visible dirty/saving state.

### P3
- 375px 실기기/브라우저 검증은 수행하지 않았다. 코드상 responsive grid와 하단 GNB는 있으나 dense table/drawer/toolbar는 별도 QA가 필요하다.

## Required Actions
### P0/P1 Actions
- [ ] No P0/P1 action required.

### P2/P3 Actions
- [ ] Add explicit Save/dirty state for place notes or autosave feedback.
- [ ] Replace map placeholder with real map or remove the map claim until integration exists.
- [ ] Show related people/daily log counts on place cards.

## Follow-up Opportunities
- None.
