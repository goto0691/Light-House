# main 통합 기록 · 2026-10-01

## 출처와 보존

- 원격 기준: `460e0581627af12393d9c2793f493f7910f545b9`
- 공통 조상: `e8b2b74bf209c461ded371d4e20d7a9356f2428d`
- V2 원본 snapshot: `71ec611db16ea8dd8ba625c3c541655673ff944f`
- cloud 검증 checkpoint: `e2ba1e9faf937491dffd4ba4e3c918e2a09c900e`

원격의 22개 커밋과 V2 snapshot을 공통 조상 기준으로 3-way 통합했다. 원격 main을 V2 파일 전체로 덮어쓰거나 history를 강제로 교체하지 않는다. 원격의 Notion 재분류/curation, 출처·속성 매핑, zettel 편집/리더, 도메인 readmodel, 한국어·모바일 UI를 보존한다. 기존 원격의 제외된 archive blob은 변경하지 않았으며 새 개인 자료·자격 증명·평가 corpus를 추가하지 않았다. source transfer manifest는 내부 전달용이므로 공개 소스에 포함하지 않는다.

## 충돌 해결

- 현행 V2 문서 정본과 원격의 04~05월 역사 문서를 별도 안내한다
- 로컬 고정 글꼴, 현재 dependency/타입/검사, V2 service worker를 유지한다
- legacy 모바일 탐색·한국어·store 갱신·zettel 표시를 보존하면서 V2 cutover prop과 빠른 입력 차단을 연결한다
- 원격의 `/api/context`, `/api/source-property-mappings` mutation도 `FLAG_V2_LEGACY_READONLY`에 포함한다
- 하나의 `/sw.js`가 V2 offline capture와 legacy navigation fallback을 제공한다. 인증 attachment나 일반 페이지를 광범위하게 cache하지 않는다
- legacy 페이지 진입이 다른 기능의 service worker와 local cache를 삭제하지 않도록 한다

## 검증 구분

이전 checkpoint의 172파일/3528 PASS는 통합 전 결과다. 통합본의 결과는 아래에 별도로 기록한다.

- 1차 통합 focused: cutover32 + shared service worker7 + legacy adapter3 + local fonts2 = **44 PASS**
- 1차 통합 typegen + root typecheck: **exit0**
- 전체 regression, lint, Worker build: 최종 검증 중. 완료된 결과만 후속 기록한다

독립 로컬 SQLite 검사는 remote→V2, V2→remote, 합친 filename 순서 모두 FK ON에서 성공했다(167 tables, FK 위반0). 47개 remote adapter 대상 table에 미분류 column이 없었다. migration의 같은 번호 prefix는 전체 filename이 다르므로 그대로 보존한다.

## 게시와 운영 경계

사용자는 main commit/push를 요청했다. 기존 main에 Vercel deployment status가 연결되어 있어 자동 배포 영향은 별도로 확인한다. 일반 `npm run build`에는 migration/deploy/provider 호출 hook이 없고 Wrangler flag·cron은 Vercel로 자동 반영되지 않는다.

V2는 Cloudflare native D1/R2 binding을 요구한다. 일반 Vercel Node에서 V2 flag를 활성화하는 것은 Worker 배포를 대신하지 못한다. 기본 flag OFF면 legacy 탐색을 유지하지만 일부 기존 portability API는 직접 요청 시 binding 오류를 반환할 수 있다. 원격 DB 상태/ledger, V2 설정 모델/실제 corpus, 브라우저/실기기, Worker 배포·운영 cutover gate는 남는다.

원격에서 추가한 `scripts/apply-d1-migration.ts`는 단순 semicolon 분리로 V2 trigger SQL을 실행할 수 없고 migration ledger를 기록하지 않는다. V2 migration에 이 스크립트를 사용하지 않는다. 이 통합 과정에서 원격 migration이나 실제 AI 호출을 수행하지 않는다.
