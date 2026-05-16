# UI/UX System Criteria and Audit

Last updated: 2026-05-16

이 문서는 Project Light House의 전체 UI/UX 리팩토링 판단 기준과 현재 시스템 감사를 보존하기 위한 기준 문서다. 컨텍스트가 압축되어도 이 파일을 먼저 읽으면 이후 작업의 판단축을 복원할 수 있어야 한다.

## 0. 전체 진행 현황 체크리스트

현재 위치: 72차까지 완료. 큰 흐름은 "UI/UX 기준 정립 -> 레거시 라벨/화면 정리 -> delta command 전환 -> read model 분리 -> hydration scope 분리 -> 대량 데이터 성능 계측/최적화"까지 진행됐다.

문서 기준 판단: 핵심 화면 구조와 데이터 흐름 리팩토링은 대부분 완료됐고, 현재는 LifeOps entries/trends page payload 축소, LifeOps entries data API paging/summary 분리, PRM self-hydrated route bootstrap roundtrip 제거, PRM graph/detail context bundle initial payload compact, PRM home/focused home bootstrap roundtrip 제거까지 진행했다. 다음은 Vault/LifeOps 대량 목록 API 내부 read cost를 SQL where/limit 기반으로 더 낮출 수 있는지 재점검하는 단계다.

### 완료

- [x] UI/UX 판단 기준, 심각도, 감사 방법, 완료 기준 정리
- [x] 초기 시스템 감사와 도메인별 우선 개선안 정리
- [x] 전역 shell/loading/오류/공유 상태의 한국어 라벨 정리
- [x] Vault 지식 목록 경량 payload와 상세 fetch 분리
- [x] Vault 지식/미디어/자산/장소 mutation delta 응답 전환
- [x] Vault graph/search/context/ContextBundle read model 분리
- [x] AI 요약 prompt read model 분리
- [x] ActionHub task/capture/project/relation command delta 응답 전환
- [x] PRM person/gift/interaction/network command delta 응답 전환
- [x] LifeOps habit/workout/career/daily/health command delta 응답 전환
- [x] ActionHub project/task read model 분리
- [x] PRM/LifeOps read helper의 snapshot 의존 분리
- [x] Dashboard read model 분리
- [x] ActionHub/PRM/LifeOps/Vault layout hydration scope 분리
- [x] Vault zettel graph/read model 계측과 ContextBundle fan-out 최적화
- [x] Vault zettel list client filter index 최적화
- [x] Vault zettel list summary read model 분리와 목록 payload 축소
- [x] Vault zettel list/detail/API route 비용과 payload 크기 세분화 계측
- [x] Vault zettel page initial HTML/RSC payload 축소
- [x] Vault zettel list API server-side filtering/pagination 전환
- [x] Vault paged zettel list mutation/local merge smoke test 보강
- [x] ActionHub/PRM/LifeOps route payload와 bootstrap API 중복 후보 계측
- [x] LifeOps entries/trends initial page payload 축소
- [x] PRM graph/hit-them-up/detail bootstrap roundtrip 제거
- [x] PRM graph/detail context bundle initial payload compact
- [x] PRM gifts/edit bootstrap roundtrip 제거
- [x] LifeOps entries data API paging/summary 분리
- [x] PRM home/focused home bootstrap roundtrip 제거와 PRM home snapshot summary 축소
- [x] 주요 변경마다 `npm run typecheck`, `npm run lint`, 브라우저 smoke 검증 기록

### 최근 완료 및 진행 중

- [x] Vault zettel list read model을 list summary와 detail read model로 더 명확히 분리
- [x] 목록 카드에 불필요한 full content substring/source document property payload 제거
- [x] `/dev/vault-read-model-benchmark`에 zettel list payload 크기 계측 추가
- [x] `/dev/vault-read-model-benchmark`와 서버 로그 기준으로 zettel list/detail/API route별 render/read 비용 세분화
- [x] `/vault/zettels`와 detail page의 initial page props에서 449개 목록 payload 제거
- [x] zettel list 데이터가 수천 개로 커질 때를 대비해 `/api/vault/zettels`를 server pagination/server filtering 계약으로 전환
- [x] paged summary list에서 저장, 삭제, 관계 변경 후 local merge smoke test 보강
- [x] `/dev/domain-route-payload-benchmark`로 ActionHub/PRM/LifeOps의 page/bootstrap/hydration snapshot payload 계측
- [x] `/life-ops/entries`와 `/life-ops/trends`의 heavy initial page props를 전용 data API fetch로 분리
- [x] `/prm/graph`, `/prm/hit-them-up`, `/prm/{personId}`에서 layout bootstrap API 호출 없이 화면이 렌더되도록 self-hydrated route 처리
- [x] `/prm/graph`, `/prm/{personId}`의 context bundle 초기 전달을 compact summary로 줄이고 표시용 총계는 유지
- [x] `/prm/gifts`, `/prm/{personId}/edit`도 bootstrap gate 없이 page 데이터로 렌더되도록 정리
- [x] `/api/life-ops/entries`를 40개 summary page + detail lazy fetch 계약으로 분리
- [x] `/prm`, `/prm?detail=person:{id}`도 bootstrap gate 없이 page snapshot으로 렌더되도록 정리

### 다음 작업 추천 순서

- [x] 1순위: `getVaultZettelList()`를 목록용 summary read model로 축소하고, 상세 화면은 기존 `getVaultZettel(zettelId)`를 유지한다.
- [x] 2순위: `/dev/vault-read-model-benchmark`와 서버 로그 기준으로 zettel list/detail/API route별 render/read 비용을 더 세분화한다.
- [x] 3순위: `/vault/zettels`와 detail page의 HTML/RSC payload를 줄이기 위해 page props 구조, list initial window, server pagination 중 하나를 선택한다.
- [x] 4순위: `/api/vault/zettels`의 300KB 목록 fetch를 server pagination 또는 server-side filtering으로 나눌지 결정한다.
- [x] 5순위: Vault list/detail 저장, 삭제, 관계 변경 후 local merge가 paged list summary/detail 분리에서도 깨지지 않는지 smoke test를 보강한다.
- [x] 6순위: ActionHub/PRM/LifeOps도 현재 hydration scope 이후 남은 중복 fetch가 있는지 같은 방식으로 계측한다.
- [x] 7순위: LifeOps entries/trends의 큰 page payload를 우선 줄인다.
- [x] 8순위: PRM graph/detail/hit-them-up bootstrap 중복 후보를 먼저 줄인다.
- [x] 9순위: PRM graph/detail context bundle page payload를 compact summary로 낮춘다.
- [x] 10순위: PRM gifts/edit bootstrap 중복을 제거한다.
- [x] 11순위: LifeOps entries data API 자체의 payload를 summary/detail 또는 paging으로 낮춘다.
- [x] 12순위: PRM home/focused home bootstrap share를 제거하고, home snapshot을 summary로 축소한다.
- [ ] 13순위: Vault/LifeOps 대량 목록 API 내부 read cost가 아직 전체 read 후 slice인지 재점검하고 SQL where/limit 기반 read model로 낮춘다.

## 1. 핵심 판단문

사용자가 어떤 화면에 들어왔을 때, 지금 볼 정보와 지금 할 행동이 3초 안에 분리되어 보여야 한다.

이 기준을 통과하지 못하는 화면은 기능이 많아도 좋은 화면이 아니다. 특히 이 시스템은 Notion 기반 데이터에서 온 속성, 원본 필드, 관계, 작성 영역이 한 화면에 섞이기 쉬우므로, 모든 화면은 "목록", "읽기", "쓰기", "속성 확인", "속성 편집", "원본 확인"의 모드를 명확히 분리해야 한다.

## 2. 비가역 기준

### C1. 화면 목적성

각 화면은 하나의 주 목적을 먼저 가져야 한다.

- 목록 화면은 목록만 빠르게 훑고 고르게 해야 한다.
- 읽기 화면은 본문과 핵심 메타데이터를 먼저 보여야 한다.
- 쓰기 화면은 작성 흐름을 방해하지 않아야 한다.
- 관리 화면은 필터, 저장 뷰, 속성, 원본 매핑을 통제할 수 있어야 한다.

한 화면이 여러 목적을 품어야 한다면, 기본 상태에서는 하나만 열고 나머지는 접힌 보조 영역으로 둔다.

### C2. 정보 위계와 밀도

정보는 항상 다음 순서로 노출한다.

1. 사용자의 현재 목표에 필요한 정보
2. 다음 행동에 필요한 컨트롤
3. 판단을 돕는 요약 속성
4. 상세 속성 및 원본 데이터
5. 관계, 로그, 자동 연결, 분석 정보

상세 속성과 원본 데이터가 본문이나 목록을 가리거나 밀어내면 안 된다. 자세히 볼 수는 있어야 하지만 기본 화면을 장악하면 안 된다.

### C3. 모드 명확성

읽기와 편집은 같은 UI 안에 섞지 않는다.

- 읽기 모드: 본문, 핵심 속성 요약, 관계 요약 중심
- 편집 모드: 저장/되돌리기/삭제, 필드 편집, 본문 편집 중심
- 속성 상세 모드: 모든 속성 확인과 일부 수정
- 원본 모드: Notion/외부 데이터의 지저분한 필드를 검토하고 매핑

편집 가능한 컴포넌트는 편집 중임을 시각적으로 드러내야 하며, 읽기만 하는 화면에서 갑자기 입력 필드가 대량으로 나타나면 안 된다.

### C4. 속성 UX

속성 컴포넌트는 전 시스템에서 같은 모델을 따라야 한다.

- 기본: 핵심 속성 요약만 보여준다.
- 확장: 자세한 속성 목록을 보여준다.
- 편집: 필요한 경우에만 명시적으로 편집 모드로 들어간다.
- 원본: 외부 시스템의 원래 필드명과 값은 별도 영역에서 보여준다.

속성은 "분류", "상태", "날짜", "관계", "출처", "자동화/시스템 필드", "원본 필드"로 묶어 보여야 한다. 영문 컬럼명이나 Notion식 이름이 기본 UI에 그대로 노출되면 안 된다.

### C5. 이동과 상태 유지

메뉴나 버튼을 눌렀을 때 전체 새로고침처럼 느껴지면 실패다.

- 내부 이동은 클라이언트 라우팅으로 즉시 전환한다.
- 목록 선택은 가능한 한 화면 상태를 유지한다.
- 상세 열기, 속성 패널 열기, 저장 뷰 변경은 URL 상태 또는 명시적 상태로 복원 가능해야 한다.
- 로딩이 필요한 경우에도 기존 화면을 모두 지우지 말고 부분 로딩을 쓴다.

### C6. 명칭과 언어

사용자에게 보이는 기본 명칭은 한국어로 통일한다.

- Zettel은 "지식금고"로 부른다.
- Dashboard, Action Hub, Life Ops, Settings, Inbox 같은 레거시 영어명은 기본 노출에서 제거하거나 한국어 이름으로 대체한다.
- 개발자/원본 데이터 식별자는 상세 원본 모드에서만 보여준다.

로딩 중 잠깐 나타나는 영어명도 품질 문제로 본다. Hydrator, breadcrumb, command palette, sidebar, empty state까지 모두 같은 언어 기준을 적용한다.

### C7. 컴포넌트 일관성

도메인별로 다른 화면을 만들더라도 조작 모델은 같아야 한다.

- 저장 뷰: 보기, 저장, 수정, 삭제, 기본 뷰와 사용자 저장 뷰 구분
- 필터: 표시명, 활성 필터 요약, 초기화
- 속성: 요약, 상세, 편집, 원본
- 관계: 요약 카운트, 분류별 탐색, 필요 시 편집
- 목록/상세: 목록 먼저, 선택 후 상세

지식금고에서 만든 개선된 패턴은 기준 구현으로 삼되, 다른 도메인도 같은 구조로 맞춘다.

### C8. 마이크로 인터랙션

마이크로 인터랙션은 상태 변화의 이해를 돕는 경우에만 쓴다.

허용되는 경우:

- 저장 성공/실패
- 패널 열림/닫힘
- 필터 적용
- 드래그, 정렬, 선택
- 로딩 스켈레톤
- 포커스 이동

줄여야 하는 경우:

- 의미 없는 hover glow
- 반복 카드 전체의 과한 transition
- 작은 버튼마다 붙은 장식적 애니메이션
- 시선이 본문에서 벗어나는 장식 효과

정보 작업 도구는 차분해야 한다. 반응은 빠르게, 장식은 적게 둔다.

### C9. 레이아웃과 반응형

넓은 화면에서도 컬럼을 무조건 늘리지 않는다. 컬럼이 많아질수록 사용자는 어디를 봐야 할지 잃는다.

- 기본 화면은 1개의 주 영역과 1개의 보조 영역을 넘지 않는다.
- 세 번째 영역은 접힘, 탭, 드로어, 또는 별도 모드로 둔다.
- 오른쪽 속성 패널은 본문 폭을 과도하게 빼앗지 않아야 한다.
- 모바일/좁은 화면에서는 우선순위가 낮은 영역을 아래로 쌓기보다 접힌 보조 패널로 바꾼다.

### C10. 접근성과 조작성

버튼, 탭, 토글, 선택 상태는 키보드와 스크린 리더에도 의미가 있어야 한다.

- 아이콘 버튼은 접근 가능한 이름을 가진다.
- 선택된 탭/필터/세그먼트는 명확히 표시한다.
- 입력 필드의 label과 placeholder 역할을 혼동하지 않는다.
- 저장/삭제/되돌리기 같은 위험 동작은 위치와 색으로 구분한다.

### C11. 성능과 로딩 체감

데이터가 많아도 화면이 무겁게 느껴지지 않아야 한다.

- 목록은 필요 범위만 렌더링한다.
- 상세 패널은 선택 후 필요한 데이터를 가져온다.
- 저장 뷰와 필터 변경은 즉각 피드백을 준다.
- Hydration 동안 레거시 이름이나 임시 영어 UI가 깜빡이면 안 된다.

## 3. 심각도 기준

- P0: 데이터 손실, 저장 실패, 편집 모드 혼동, 주요 이동 불능
- P1: 자주 쓰는 작업 흐름을 느리게 하거나 화면 목적을 흐리는 문제
- P2: 일관성, 언어, 밀도, 애니메이션처럼 누적 피로를 만드는 문제
- P3: polish, 문구, 여백, 시각 정돈 문제

리팩토링은 P0/P1을 먼저 처리하고, P2/P3는 공통 컴포넌트 정리와 함께 묶어서 처리한다.

## 4. 감사 방법

2026-05-07 기준으로 다음을 확인했다.

- 주요 앱 라우트의 HTTP 응답 상태
- 주요 도메인 컴포넌트 구조
- 속성 컴포넌트 사용 위치
- 저장 뷰, 필터, 목록/상세 패턴
- 레거시 영어 문구
- 카드, radius, hover/transition, glow 사용량

로컬 Playwright 모듈이 없어 전체 브라우저 자동 시각 검사는 실행하지 못했다. 대신 실행 중인 개발 서버의 라우트 상태와 코드 구조를 기준으로 감사했다. 이후 시각 검증 도구가 준비되면 같은 기준표로 화면 캡처 기반 재검사를 진행한다.

## 5. 현재 시스템 감사 결과

### A1. 목적과 모드가 섞인 화면이 많다. P1

`TaskWorkspaceClient`, `DailyLogClient`, `PersonDrawer`는 읽기, 쓰기, 속성 편집, 관계, 원본 데이터, 자동 연결 정보를 한 화면에 크게 펼친다. 기능은 풍부하지만 기본 진입 시 사용자가 먼저 봐야 할 영역이 흐려진다.

개선 방향:

- 모든 주요 엔티티 화면에 `list -> detail(read) -> edit -> properties` 모드를 적용한다.
- 기본 진입은 목록 또는 읽기 모드로 둔다.
- 편집기는 명시적으로 편집 모드에 들어갔을 때만 크게 노출한다.

### A2. 속성 UX가 지식금고 외 도메인에서 아직 통일되지 않았다. P1

지식금고는 요약/상세/편집 패턴에 가까워졌지만, 작업, 사람, 일지, 자산, 장소, 미디어 등은 여전히 직접 편집 패널이나 원본 속성 패널이 기본 화면에서 크게 노출되는 경우가 많다.

개선 방향:

- 공통 `PropertySummary`, `PropertyDetail`, `PropertyEdit`, `SourcePropertyInspector` 계약을 명확히 한다.
- 도메인별 속성 패널이 이 계약을 따르도록 정리한다.
- 원본 필드는 기본 화면에서 감추고 "원본 보기"에서만 노출한다.

### A3. 레거시 영어명이 아직 전역에 남아 있다. P2

확인된 예시는 `Dashboard`, `Action Hub`, `Life Ops`, `Settings`, `Inbox`, `Command Palette`, `Notifications`, `Data Settings`, `Recent Runs` 등이다. Hydrator 문구와 breadcrumb, local navigation, command palette에도 남아 있다.

개선 방향:

- 사용자 표시명 사전을 중앙화한다.
- 라우트, breadcrumb, local nav, command palette, toast, loading text가 같은 표시명을 쓰도록 한다.
- 영어 식별자는 개발자/원본 모드에서만 사용한다.

### A4. 카드와 마이크로 인터랙션이 과하다. P2

여러 컴포넌트에서 `GlassCard`, `rounded-2xl`, `rounded-3xl`, hover transition, glow shadow가 반복된다. 정보 작업 도구에서 모든 카드가 반응하면 화면이 산만해진다.

개선 방향:

- hover/transition은 클릭 가능한 요소와 상태 변화가 있는 요소로 제한한다.
- 카드 radius와 shadow를 공통 토큰으로 정리한다.
- 반복 목록 카드에는 glow를 제거하고, 선택/포커스 상태만 명확히 둔다.

### A5. 3컬럼 레이아웃이 본문 집중을 방해한다. P1

작업 화면은 왼쪽 속성/체크리스트, 중앙 에디터, 오른쪽 컨텍스트 번들이 동시에 열린다. 지식금고도 개선 전에는 목록, 본문, 속성이 동시에 경쟁했다. 넓은 화면에서 가능한 모든 정보를 펼치는 방식은 효율이 아니라 인지 부담이 된다.

개선 방향:

- 기본은 목록+상세 또는 상세+보조 패널까지만 허용한다.
- 세 번째 정보군은 접힘 패널, 탭, 드로어, 별도 모드로 이동한다.
- 본문 읽기/쓰기 폭은 안정적으로 유지한다.

### A6. 저장 뷰와 필터의 조작 모델이 도메인별로 다르다. P2

지식금고, PRM, 일지, 설정 일부에는 저장 뷰 패턴이 있지만 편집 가능성, 기본 뷰와 사용자 뷰의 구분, 저장/삭제/수정 위치가 완전히 같지는 않다.

개선 방향:

- `SavedViewBar` 또는 동등한 공통 컴포넌트를 정의한다.
- 기본 뷰는 읽기 전용, 사용자 저장 뷰는 이름/조건/표시 속성 편집 가능으로 분리한다.
- 필터와 저장 뷰는 항상 활성 조건 요약을 제공한다.

### A7. 드로어가 너무 많은 책임을 가진다. P1

`PersonDrawer`는 프로필, 지표, 원본 속성, 상호작용 작성, 선물 작성, 속성 편집, 타임라인, 관계 정보를 모두 담는다. 드로어는 빠른 확인과 가벼운 수정에는 좋지만, 복잡한 편집과 기록 작성까지 모두 담당하면 과밀해진다.

개선 방향:

- 드로어는 요약 읽기와 핵심 액션만 맡긴다.
- 깊은 편집은 전용 상세 화면 또는 명시적 편집 모드로 이동한다.
- 원본/속성/기록 작성은 탭이나 별도 섹션으로 접는다.

### A8. Daily Log는 한 화면의 작업 범위가 너무 넓다. P1

일일 기록 화면은 습관, 저널, 개별 엔트리, 묵상/감사, 속성, 원본, 자동 연결, 컨텍스트, 히트맵을 함께 보여준다. 이 화면은 "오늘 작성하기"와 "하루 분석하기"와 "원본 데이터 관리하기"가 섞여 있다.

개선 방향:

- 오늘 작성 화면: 저널/체크인/핵심 습관 중심
- 하루 읽기 화면: 요약/타임라인/연결 정보 중심
- 관리 화면: 속성/원본/자동 연결/히트맵 중심

### A9. 새로고침처럼 느껴지는 이동을 계속 감시해야 한다. P1

일부는 이미 클라이언트 라우팅으로 개선되었지만, 쿼리 기반 상세 열기와 직접 경로 이동이 혼재한다. 사용자는 버튼을 누를 때 화면 전체가 다시 시작되는 느낌을 받으면 맥락을 잃는다.

개선 방향:

- 내부 이동은 `Link` 또는 router 기반 전환으로 통일한다.
- 상세 선택은 가능하면 목록 상태를 유지한다.
- 전체 로딩 대신 부분 로딩과 선택 상태 skeleton을 사용한다.

### A10. 지식금고는 기준 구현에 가까워졌지만 레이아웃 최적화가 더 필요하다. P1

지식금고는 목록 우선, 읽기/편집 분리, 속성 요약/상세/편집 방향이 잡혔다. 다만 속성 패널과 본문/목록의 공간 분배, 메모 목록과 지식 보기의 명확한 전환, 상세 속성의 편집 위치는 계속 다듬어야 한다.

개선 방향:

- 목록 화면은 목록만 보이도록 유지한다.
- 지식 상세는 본문 우선, 속성은 요약 기본으로 둔다.
- 상세 속성은 오른쪽 고정 패널보다 접힘 패널 또는 사이드 시트 방식이 적합하다.
- 속성 편집은 상세 속성 안에서만 명시적으로 가능하게 둔다.

## 6. 도메인별 우선 개선안

### 지식금고

- "지식금고" 명칭이 로딩, breadcrumb, command palette, sidebar에서 깜빡이지 않게 중앙 표시명으로 통일한다.
- 목록 화면과 지식 상세 화면의 목적을 더 강하게 분리한다.
- 속성은 요약 기본, 상세 접힘, 편집 명시 방식으로 고정한다.

### 작업

- 작업 상세를 읽기 기본으로 바꾸고, 편집기는 편집 모드에서만 연다.
- 속성/체크리스트/관계/컨텍스트를 하나의 왼쪽 컬럼에 모두 펼치지 않는다.
- Inbox의 쿼리 상세와 프로젝트 상세 경로의 조작감을 통일한다.

### 사람 관계

- `PersonDrawer`를 빠른 요약과 핵심 액션 중심으로 줄인다.
- 선물, 상호작용, 속성 편집, 타임라인은 탭 또는 전용 상세 화면으로 분리한다.
- 사람 속성도 공통 속성 요약/상세/편집 패턴을 따른다.

### 일상 기록

- 오늘 작성, 하루 읽기, 데이터 관리 모드를 분리한다.
- Daily Log 기본 화면은 작성에 필요한 것만 남긴다.
- 자동 연결, 히트맵, 원본 데이터는 보조 모드로 보낸다.

### 설정/데이터

- Source Mapping은 중요한 기반 기능이므로 유지하되 표시 언어를 한국어화한다.
- 원본 필드 관리 UI는 다른 도메인의 "원본 보기"와 연결되도록 한다.

### 셸/전역 레이어

- sidebar, local nav, breadcrumb, command palette, notification center의 표시명을 중앙화한다.
- Command Palette도 한국어 우선 검색어와 명칭을 제공한다.
- Shared Layer 안내 문구도 실제 기능 중심으로 줄인다.

## 7. 리팩토링 순서

1. 표시명/언어 사전 중앙화
2. 공통 속성 컴포넌트 계약 정리
3. 저장 뷰/필터 공통 조작 모델 정리
4. 지식금고 레이아웃 최종 정돈
5. 작업 상세 화면의 읽기/편집/속성 모드 분리
6. 사람 드로어 경량화
7. 일상 기록 화면 모드 분리
8. 카드, radius, shadow, transition 사용량 정리
9. 주요 라우트 시각 검증과 회귀 체크

## 8. 완료 기준

전체 UI/UX 리팩토링은 다음 조건을 만족하면 완료로 본다.

- 주요 도메인에서 목록/읽기/쓰기/속성/원본 모드가 구분된다.
- 속성 컴포넌트가 전 도메인에서 요약/상세/편집/원본 패턴을 따른다.
- 사용자에게 보이는 레거시 영어명이 기본 UI에서 사라진다.
- 저장 뷰와 필터가 공통 조작 모델을 가진다.
- 메뉴 클릭과 상세 선택이 새로고침처럼 느껴지지 않는다.
- 반복 카드의 불필요한 hover glow와 transition이 제거된다.
- 넓은 화면에서도 본문과 목록이 속성 패널에 밀리지 않는다.
- 주요 라우트가 HTTP 200으로 열리고, 대표 화면의 시각 검증에서 겹침/공백/과밀 문제가 없다.

## 9. 이후 작업자가 반드시 확인할 체크리스트

새 UI/UX 변경을 하기 전에는 다음 질문에 답한다.

- 이 화면의 기본 목적은 무엇인가?
- 사용자는 3초 안에 다음 행동을 알 수 있는가?
- 읽기와 편집이 섞여 있지 않은가?
- 속성은 요약, 상세, 편집, 원본으로 분리되어 있는가?
- 원본/영문/시스템 필드가 기본 UI에 노출되지 않는가?
- 이 이동은 새로고침처럼 느껴지지 않는가?
- 이 애니메이션은 상태 이해에 실제로 도움이 되는가?
- 화면이 넓어졌다는 이유로 불필요한 컬럼을 펼치지 않았는가?
- 같은 기능이 다른 도메인과 같은 조작 모델을 쓰는가?

## 10. 2026-05-07 검사 로그

### 라우트 상태

개발 서버 `http://127.0.0.1:3000` 기준으로 다음 주요 라우트는 모두 HTTP 200으로 열렸다.

- `/dashboard`
- `/action-hub`
- `/action-hub/inbox`
- `/life-ops`
- `/life-ops/entries`
- `/prm`
- `/prm/gifts`
- `/settings/data`
- `/settings/data/source-mapping`
- `/vault/zettels`
- `/vault/media`
- `/vault/assets`
- `/vault/places`

라우트 접근성 자체보다는 화면 목적성, 언어 일관성, 속성 UX, 이동 체감, 시각 밀도가 다음 리팩토링의 핵심이다.

### 코드 스캔에서 확인한 대표 증거

레거시 영어명:

- `apps/web/src/components/shell/breadcrumb.tsx`: `Dashboard`, `Action Hub`, `Life Ops`, `Settings`, `Inbox`
- `apps/web/src/components/shell/local-nav.tsx`: `Dashboard`, `Action Hub`, `Life Ops`, `Settings`
- `apps/web/src/components/shared/command-palette.tsx`: `Dashboard`, `Command Palette`, `새 Task 만들기`
- `apps/web/src/components/shared/notification-center.tsx`: `Notifications`
- `apps/web/src/components/action-hub/action-hub-hydrator.tsx`: `Action Hub 데이터를 불러오는 중입니다.`
- `apps/web/src/components/life-ops/life-ops-hydrator.tsx`: `Life Ops 데이터를 불러오는 중입니다.`
- `apps/web/src/components/settings/source-mapping-workbench.tsx`: `Data Settings`

새로고침처럼 느껴질 수 있는 이동:

- `apps/web/src/components/dashboard/widgets/active-tasks-widget.tsx`: `window.location.assign("/action-hub")`
- `apps/web/src/components/dashboard/widgets/recent-zettels-widget.tsx`: `window.location.assign("/vault/zettels?new=1")`

속성 UX 불균일:

- `apps/web/src/components/action-hub/task-workspace-client.tsx`: 작업 제목/본문/속성/체크리스트/관계를 한 화면에서 직접 편집
- `apps/web/src/components/prm/person-drawer.tsx`: 사람 요약, 원본 속성, 상호작용, 선물, 속성 편집, 타임라인이 한 드로어에 집중
- `apps/web/src/components/life-ops/daily-log-client.tsx`: 오늘 작성, 일지 편집, 자동 연결, 컨텍스트, 히트맵이 한 화면에 공존
- `apps/web/src/components/vault/media-client.tsx`, `assets-client.tsx`, `places-client.tsx`: 지식금고의 요약/상세/편집 패턴이 아직 같은 수준으로 적용되지 않음

마이크로 인터랙션/카드 밀도:

- `GlassCard interactive`, `rounded-3xl`, `rounded-2xl`, `transition`, `hover:bg`, `hover:shadow-[var(--shadow-glow),var(--shadow-lg)]`가 반복 목록과 위젯에 넓게 쓰인다.
- `apps/web/src/components/action-hub/project-card.tsx`, `kanban-column.tsx`, 여러 dashboard widget, `life-ops/daily-log-client.tsx`가 우선 정리 대상이다.

### 다음 구현 순서의 현실적 묶음

1. 전역 표시명 사전과 shell 정리: breadcrumb, local nav, command palette, notification, hydrator의 영어 깜빡임 제거
2. 새로고침 체감 제거: `window.location.assign`을 라우터/링크 기반 동작으로 교체
3. 공통 속성 패턴 확정: 지식금고의 요약/상세/편집/원본 모델을 작업, 사람, 일지, 미디어, 자산, 장소로 확장
4. 과밀 화면 분리: 작업 상세, 사람 드로어, 일일 기록을 읽기/쓰기/속성/원본 모드로 나눔
5. 카드와 hover 정리: 반복 카드의 장식적 transition/glow 제거, 선택/포커스/저장 같은 의미 있는 상태만 남김

이 순서가 좋은 이유는 전역 표시명과 이동 체감은 사용자에게 즉시 드러나는 P1/P2 문제이고, 속성/모드 분리는 이후 모든 화면 리팩토링의 기반이기 때문이다.

## 11. 2026-05-07 전면 수정 1차 구현 로그

기준 문서를 바탕으로 다음 1차 수정을 진행했다.

### 완료한 것

- 전역 표시명 사전 `apps/web/src/constants/display-labels.ts`를 추가했다.
- `Dashboard`, `Action Hub`, `Life Ops`, `PRM`, `Command Palette`, `Notifications`, `Quick Capture` 등 주요 사용자 노출 영어명을 한국어 기준으로 교체했다.
- Shell의 breadcrumb, local nav, global nav가 같은 표시명 기준을 쓰도록 정리했다.
- 빈 상태 CTA의 `window.location.assign` 기반 이동을 제거하고 내부 링크 기반 이동으로 바꿨다.
- `GlassCard`의 기본 transition/glow를 줄이고, 반복 카드가 장식적으로 빛나는 느낌을 낮췄다.
- 작업 상세 화면은 3컬럼 전개를 줄이고 `본문 + 보조 탭(속성/연결/맥락)` 구조로 1차 정리했다.
- 사람 드로어는 요약/메트릭은 기본으로 유지하고, 기록/속성/타임라인을 탭으로 분리했다.
- 일일 기록 화면은 맥락 번들과 연간 히트맵을 기본 전개하지 않고 "맥락과 분석 보기" 접힘 영역으로 내렸다.
- 주요 대시보드 보조 페이지, 작업실 수신함/보관함, 관계 그래프/연락 필요 화면의 레거시 영어 문구를 정리했다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과
- HTTP 스모크 라우트: `/dashboard`, `/dashboard/this-week`, `/dashboard/yesterday-review`, `/action-hub`, `/action-hub/inbox`, `/action-hub/archive`, `/life-ops`, `/life-ops/entries`, `/prm`, `/prm/hit-them-up`, `/prm/graph`, `/settings/data`, `/settings/integrations`, `/settings/data/source-mapping`, `/vault/zettels` 모두 200

### 아직 남은 것

- 미디어, 자산, 장소의 속성 패널도 지식금고의 요약/상세/편집 패턴으로 더 맞춰야 한다.
- 작업 상세는 보조 탭 구조까지 정리했지만, 읽기 모드와 편집 모드를 완전히 분리하는 2차 수정이 필요하다.
- 사람 드로어도 탭으로 과밀은 줄였지만, 깊은 편집은 전용 상세 화면으로 넘기는 구조가 더 좋다.
- 일일 기록은 접힘 처리까지 했고, 이후에는 오늘 작성/하루 읽기/데이터 관리 모드를 더 명확히 분리해야 한다.
- 반복 카드의 `rounded-3xl`, `transition hover:*` 잔여 패턴은 공통 토큰 정리와 함께 계속 줄여야 한다.

## 12. 2026-05-07 전면 수정 2차 구현 로그

1차 수정 이후 남은 속성 과밀 문제를 줄이는 방향으로 다음 수정을 진행했다.

### 완료한 것

- 작업 상세 화면을 기본 읽기 모드와 명시적 편집 모드로 분리했다.
- 작업 본문은 기본 진입 시 `MarkdownView`로 읽고, 사용자가 `편집`을 누를 때만 `ZenEditor`가 열린다.
- 작업 속성은 기본적으로 `PropertySummary` 요약을 보여주고, 편집 모드에서만 `PropertyPanel`을 노출한다.
- 작업의 연결 문구는 지식금고 기준에 맞춰 `메모` 대신 `지식`으로 정리했다.
- 자산 속성 패널은 `요약 / 상세 / 편집 / 원본` 모드로 분리했다.
- 장소 속성 패널은 `요약 / 상세 / 편집 / 원본` 모드로 분리했다.
- 미디어 드로어도 같은 `요약 / 상세 / 편집 / 원본` 속성 모드를 적용해, 원본 매핑과 편집 폼이 기본 화면을 밀어내지 않도록 했다.
- 원본 모드에서 속성을 매핑한 뒤 저장할 수 있도록 자산/장소/미디어 모두 원본 모드에도 저장 액션을 제공한다.

### 판단

- 속성은 오른쪽 보조 정보로 두되, 기본값은 요약이어야 한다.
- 상세 속성과 원본 매핑은 같은 화면에 항상 펼치지 않고, 사용자가 목적을 선택했을 때만 나타나야 한다.
- 읽기 화면의 본문은 속성과 편집 도구보다 우선권이 높다. 따라서 편집기는 기본 진입 화면에서 내려야 한다.
- `토글`보다는 `요약 / 상세 / 편집 / 원본` 같은 목적형 세그먼트가 더 적합하다. 토글은 단일 상태 전환에는 좋지만, 여기서는 읽기 깊이와 편집 목적이 4가지로 갈라지기 때문이다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- HTTP 스모크 라우트: `/action-hub/project-modu-works/tasks/task-p1-shell`, `/vault/media/media-dune`, `/vault/assets/asset-bike`, `/vault/places/place-hotteok`, `/vault/media`, `/vault/assets`, `/vault/places` 모두 200

### 다음에 남은 것

- 미디어 상세 라우트 자체도 드로어와 같은 속성 패턴으로 맞춰야 한다.
- 일일 기록과 사람 상세의 깊은 편집은 아직 전용 모드/상세 화면으로 더 분리할 수 있다.
- 반복 카드의 잔여 `rounded-3xl`, 장식적 `transition hover:*` 패턴은 계속 줄여야 한다.

## 13. 2026-05-07 전면 수정 3차 구현 로그

2차 구현 이후 남은 상세 화면 불일치와 편집면 중복을 줄였다.

### 완료한 것

- 미디어 속성 패널을 `MediaPropertiesPanel`로 분리해 드로어와 상세 라우트가 같은 `요약 / 상세 / 편집 / 원본` UX를 쓰도록 했다.
- 미디어 상세 라우트 `/vault/media/[mediaId]`에 속성 패널을 붙이고, `Media Detail`, `screen`, `completed` 같은 노출값을 한국어 표시로 정리했다.
- 사람 드로어의 속성 탭을 `요약 / 편집 / 원본`으로 분리했다. 원본 속성과 편집 폼이 동시에 펼쳐지지 않는다.
- 사람 드로어의 주요 카드 radius를 줄여 반복 카드가 지나치게 둥글고 장식적으로 보이는 문제를 일부 완화했다.
- 일일 기록 화면은 기본을 `하루 읽기`로 두고, `기록하기`를 눌렀을 때만 일기/묵상/감사 편집기가 열린다.
- 일일 기록에서 `JournalingTabs`와 별도 묵상/감사 textarea가 중복되던 구조를 제거했다.
- 새로 만든 세그먼트 버튼에는 `aria-pressed`를 추가해 현재 선택 상태가 보조 기술에도 전달되도록 했다.

### 판단

- 상세 라우트와 드로어가 다른 속성 UX를 쓰면 사용자가 같은 엔티티를 다른 물건처럼 느낀다. 따라서 속성 컴포넌트는 상세/드로어에서 공유하는 것이 맞다.
- 사람 드로어는 관계를 확인하는 화면이지, 모든 원본 속성을 한 번에 검수하는 화면이 아니다. 원본 검수는 명시적으로 `원본`을 눌렀을 때만 열리는 편이 낫다.
- 일일 기록은 쓰기 도구가 중요하지만, 매번 편집기부터 보이면 하루를 읽고 회고하는 용도가 약해진다. 기본값은 읽기, 액션은 기록하기가 더 명확하다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- React TSX 체크: 훅 조건부 호출 없음, 신규 세그먼트 버튼에 `aria-pressed` 추가
- HTTP 스모크 라우트: `/vault/media/media-dune`, `/prm/person-jaemin`, `/life-ops/2026-05-07`, `/life-ops`, `/prm`, `/vault/media` 모두 200

### 다음에 남은 것

- 일일 기록의 보조 패널도 `속성 / 데이터 / 원본 / 자동 연결` 목적형 탭으로 더 나눌 수 있다.
- 사람 상세는 드로어 내부 개선은 됐지만, 깊은 편집을 전용 상세 페이지로 보내는 구조는 아직 남아 있다.
- 반복 카드와 버튼의 잔여 `rounded-2xl`, `rounded-full`, 불필요한 hover 스타일은 공통 토큰 기준으로 계속 줄여야 한다.

## 14. 2026-05-07 전면 수정 4차 구현 로그

3차 구현 이후 일일 기록의 오른쪽 보조 패널 과밀과 관계 상세의 잔여 용어/버튼 스타일을 정리했다.

### 완료한 것

- 일일 기록 보조 패널을 `속성 / 데이터 / 원본 / 자동 연결` 목적형 탭으로 분리했다.
- `DailyLogPropertiesPanel`은 `edit`와 `source` 모드를 받아 속성 편집과 원본 매핑을 동시에 펼치지 않도록 했다.
- 일일 데이터 카드와 자동 연결 피드의 과한 `rounded-3xl`을 줄였다.
- 자동 연결 피드의 `life`, `task`, `interaction`, `zettel` 타입 노출을 `생활`, `작업`, `상호작용`, `지식`으로 바꿨다.
- 사람 360 상세의 `메모` 렌즈/메트릭을 `지식`으로 바꾸고, 렌즈 버튼에 `aria-pressed`를 추가했다.
- 사람 360 렌즈 버튼의 장식적 `transition`과 `rounded-full`을 줄였다.

### 판단

- 일일 기록의 보조 패널은 항상 전체를 펼치는 정보창이 아니라, 사용자가 지금 하려는 관리 목적을 고르는 작업대가 되어야 한다.
- 속성과 원본 매핑은 같은 데이터를 다루지만 사용자의 의도가 다르다. 따라서 같은 카드 안에 동시에 펼치는 것보다 모드로 나누는 편이 이해 비용이 낮다.
- 관계 상세의 맥락 렌즈는 지식금고 용어와 맞춰 `지식`으로 통일해야 한다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- HTTP 스모크 라우트: `/life-ops/2026-05-07`, `/prm/person-jaemin`, `/life-ops`, `/prm` 모두 200

### 다음에 남은 것

- 사람 상세의 깊은 편집을 드로어가 아니라 전용 상세/편집 화면으로 보내는 구조를 설계해야 한다.
- 공통 버튼/카드 radius와 hover 토큰을 더 체계적으로 정리해 화면마다 임의 스타일이 생기는 문제를 줄여야 한다.
- 전체 앱에서 남은 `메모`, `노트`, 영어 enum 노출을 한 번 더 검색해 `지식`과 한국어 라벨 기준으로 맞춰야 한다.

## 15. 2026-05-07 전면 수정 5차 구현 로그

4차 구현 이후 사람 깊은 편집 구조와 남은 맥락 카드 영어 노출을 정리했다.

### 완료한 것

- 사람 속성 편집 로직을 `PersonPropertiesPanel` 공통 컴포넌트로 분리했다.
- 사람 드로어의 속성 탭은 기본 요약만 보여주고, 깊은 편집은 `편집 화면` 링크로 넘기도록 바꿨다.
- `/prm/[personId]/edit` 전용 관계 편집 페이지를 추가했다.
- 사람 360 상세에 `관계 편집` 진입 버튼을 추가했다.
- 맥락 노드 카드의 `Project`, `Task`, `Zettel`, `Record` 등 타입 라벨을 한국어로 정리했다.
- 관계 증거 카드의 `confidence`, `record` 등 영어 노출을 `신뢰도`, `원본` 중심으로 바꿨다.

### 판단

- 드로어는 빠른 확인과 가벼운 기록에 적합하고, 다수 속성/원본 매핑/연락처 편집은 전용 화면이 더 적합하다.
- 관계 상세는 맥락 탐색 화면이므로 그 안에 대형 편집 폼을 직접 넣기보다, 편집 화면으로 이동하는 명확한 CTA를 제공하는 편이 낫다.
- 맥락 카드의 엔티티 타입 라벨은 전 화면에서 반복 노출되므로 영어 enum을 가장 먼저 제거해야 하는 영역이다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- HTTP 스모크 라우트: `/prm/person-jaemin/edit`, `/prm/person-jaemin`, `/prm` 모두 200

### 다음에 남은 것

- 전체 앱에서 `메모`, `노트`, `note`, `record`, `confidence` 잔여 노출을 계속 검색해 도메인별로 `지식`, `원본`, `신뢰도`로 정리해야 한다.
- 공통 카드/버튼 스타일 토큰을 실제 컴포넌트 단위로 더 정리해야 한다.

## 16. 2026-05-07 전면 수정 6차 구현 로그

5차 구현 이후 지식금고 주변의 남은 영어/레거시 용어와 전역 짧은 표제들을 추가 정리했다.

### 완료한 것

- 빠른 입력과 작업실 수신함의 `task`, `zettel`, `confidence` 노출을 `작업`, `지식`, `신뢰도`로 변환하는 공통 라벨 함수를 추가했다.
- 지식금고 미디어 분류 페이지의 `Vault Media`, `지식 메모`, `관련 메모` 표현을 `지식금고 미디어`, `지식` 기준으로 정리했다.
- 지식 그래프의 `Zettel Graph`, `ContextBundle Maps`, `Link Index`, `Outgoing`, `Backlinks` 표기를 한국어로 바꾸고 지식 유형도 옵션 라벨로 표시하게 했다.
- 지식 목록/읽기/편집/드로어/연결 컴포넌트에서 `새 메모`, `메모 타입`, raw `zettel.type` 노출을 `새 지식`, `지식 유형`, 한국어 타입 라벨로 바꿨다.
- 지식금고, 설정, 대시보드, 맥락 컴포넌트 일부에서 장식적 `transition`과 과한 pill radius를 줄였다.
- 설정/대시보드/생활 흐름/맥락 카드의 `Settings`, `Appearance`, `Brain Energy`, `Hit Them Up`, `Context Map`, `Smart Attach` 등 짧은 영어 표제를 한국어로 정리했다.

### 판단

- 사용자가 가장 자주 보는 짧은 표제와 토스트 문구에 내부 enum이 남으면 로딩 중 레거시 영어명이 깜빡이는 것과 같은 불안감을 만든다. 따라서 데이터 값은 유지하되, 표시 직전 한국어 라벨로 변환해야 한다.
- `메모 목록`은 목록 표면의 성격을 설명할 때만 유지하고, 개별 zettel 엔티티와 편집/삭제/연결 행위는 `지식`으로 부르는 편이 낫다.
- 카드/버튼 hover는 즉각적 색상 변화만으로도 충분하다. 화면 전반의 `transition`은 상태 전달 목적이 분명한 경우를 제외하고 줄이는 쪽이 더 차분하다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- React TSX 체크: 신규 훅 조건부 호출 없음, 리스트 key 유지, 버튼은 `<button>`/`Link` 의미 요소 유지
- HTTP 스모크 라우트: `/vault/zettels`, `/vault/zettels/graph`, `/vault/media/books`, `/vault/media/games`, `/vault/media/screens`, `/settings`, `/settings/appearance`, `/dashboard`, `/action-hub/inbox` 모두 인증 미들웨어로 307 리다이렉트 확인

### 다음에 남은 것

- 액션허브, 생활기록, PRM에 남은 `transition`, `rounded-full`, raw 타입 라벨을 공통 토큰 기준으로 더 줄여야 한다.
- 공통 `FilterBar`, `CollectionColumnControls`, `SavedViewTabs`, `SavedViewManager`의 버튼/탭 radius와 전환 스타일도 동일 기준으로 정리해야 한다.
- 로그인/설정 일부와 대시보드의 브랜드성 영어 표기는 의도된 브랜드 표기인지, 단순 섹션 라벨인지 구분해 추가 정리해야 한다.

## 17. 2026-05-07 전면 수정 7차 구현 로그

6차 구현 이후 공통 컨트롤, 액션허브, 생활기록, PRM, 전역 오버레이 표면의 잔여 radius와 장식적 전환 효과를 기준에 맞춰 정리했다.

### 완료한 것

- `FilterBar`, `CollectionColumnControls`, `SavedViewTabs`, `SavedViewManager`의 pill 스타일과 불필요한 `transition`을 줄이고, 선택형 버튼에 `aria-pressed`를 보강했다.
- `Tag`, `PropertyPanel`, `SourcePropertyInspector`, `MarkdownEditor`, `ZenEditor`, `CommandPalette`, `QuickCaptureModal`, `OverlayFrame`, `SideDrawerHost`의 기본 표면을 `rounded-md`/`rounded-lg` 중심으로 낮췄다.
- 액션허브 프로젝트 카드, 칸반 컬럼, 태스크 카드, 수신함, 작업 상세의 hover glow/진행률 애니메이션/큰 radius를 정리했다.
- 생활기록의 습관, 운동, 일일 기록 카드와 편집 폼의 라운드와 전환을 줄이고, `day streak` 같은 잔여 영어를 `일 연속`으로 바꿨다.
- PRM의 사람 카드, 연락 필요 패널, 선물 보드, 관계 그래프, 사람 드로어에서 텍스트 칩과 폼 컨트롤을 같은 기준으로 맞췄다.
- 사람 카드의 `Relationship Health`, `cadence`, `d` 표기를 `관계 건강도`, `주기`, `일`로 바꿨다.
- 맥락 레일, 스마트 연결, 원본 추적, 관계 근거 카드의 텍스트 배지와 생성 버튼에서 장식적 radius/transition을 줄였다.
- 남은 `rounded-full` 검색 결과는 그래프 노드, 아이콘 배지, 아바타, 읽지 않음 점, 타임라인 점처럼 원형이 의미를 갖는 요소로 제한했다.

### 판단

- 필터, 저장 뷰, 속성 칩, 작은 CTA는 장식보다 조작 가능성이 먼저 보여야 한다. 따라서 pill과 hover motion을 기본값으로 두지 않는다.
- 진행률·상태 값은 애니메이션보다 즉시 읽히는 수치와 고정된 바가 더 낫다. 변화 자체가 데이터가 아닐 때는 `transition-all`을 제거한다.
- 오버레이와 드로어는 콘텐츠를 가리는 표면이다. 큰 반경과 강한 그림자가 겹치면 내부 본문보다 패널 장식이 먼저 보이므로 `rounded-lg` 수준으로 낮춘다.
- 원형은 아바타, 상태 점, 그래프 노드처럼 형태 자체가 의미를 갖는 경우에만 남긴다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- React TSX 체크: 조건부 훅 추가 없음, 리스트 key 유지, 선택 버튼 `aria-pressed` 보강
- 잔여 스타일 검색: `shared`, `action-hub`, `life-ops`, `prm` 범위에서 장식적 `transition`, `rounded-2xl`, `rounded-[28px]` 제거. 남은 `rounded-full`은 의미 있는 원형 요소로 판정
- HTTP 스모크 라우트: `/action-hub`, `/action-hub/inbox`, `/life-ops`, `/life-ops/entries`, `/prm`, `/prm/graph`, `/vault/zettels`, `/settings` 모두 인증 미들웨어로 307 리다이렉트 확인

### 다음에 남은 것

- 화면을 직접 띄워 지식금고, 작업 상세, 일일 기록, PRM 목록/드로어의 실제 밀도와 겹침을 브라우저에서 확인해야 한다.
- `dashboard`, `settings`, `vault`에 남은 radius/transition도 같은 기준으로 추가 검색하고, 원형이 의미 있는지 다시 분류해야 한다.
- 모든 도메인의 영어 잔여 문구는 짧은 표제, aria-label, 토스트, 로딩 UI까지 같은 방식으로 계속 훑어야 한다.

## 18. 2026-05-07 전면 수정 8차 구현 로그

7차 구현 이후 `dashboard`, `settings`, `vault` 범위의 남은 장식적 radius/transition과 일부 영어/레거시 문구를 정리했다.

### 완료한 것

- 대시보드 위젯의 `rounded-[24px]`, `rounded-3xl`, 작은 pill 스타일을 `rounded-lg`/`rounded-md` 중심으로 정리했다.
- 오늘 앵커 위젯의 `Mood`, `Energy` 표기를 `기분`, `에너지`로 바꿨다.
- 온보딩과 지식금고 빈 상태의 `원석 메모`, `첫 메모`, `메모가 없습니다` 표현을 `지식` 기준으로 바꿨다.
- 설정의 AI, 사용량, 데이터 내보내기, 프로필, 연동, 단축키, 원본 컬럼 정리 화면에서 반복 카드와 입력/버튼의 큰 radius를 줄였다.
- 연동 카드의 `Configured`, `Pending`을 `연동됨`, `대기`로 바꾸고, `Hit-Them-Up`, `Cron 테스트`를 `연락 필요`, `예약 작업 테스트`로 정리했다.
- 데이터 설정의 `No query`를 `검색어 없음`으로 바꾸고, 연결 표기는 `작업 → 지식`처럼 사람이 읽는 표기로 맞췄다.
- 지식금고의 장소 드로어, 역링크 패널, 미디어 카드, 지식 카드, 지식 읽기 상태 칩의 잔여 pill/large radius를 정리했다.

### 판단

- 대시보드는 첫 화면이므로 작은 영어 값과 과한 장식이 남으면 전체 제품 언어가 다시 흔들린다. 위젯은 짧은 한국어 상태와 안정적인 카드 표면을 우선한다.
- 설정 화면은 작업 도구 성격이 강하므로 큰 둥근 카드보다 같은 크기의 입력/버튼 리듬이 더 중요하다.
- `AI`, `JSON`, `ZIP`, `Cloudflare`, `Gemini`처럼 제품명/기술명은 유지하되, 상태와 액션은 한국어로 바꾸는 기준을 적용했다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- React TSX 체크: 조건부 훅 추가 없음, 리스트 key 유지, 의미 요소 유지
- 잔여 스타일 검색: `dashboard`, `settings`, `vault` 범위에서 장식적 `transition`, `rounded-2xl`, `rounded-3xl`, `rounded-[24px]`, `rounded-[28px]`, `rounded-[32px]` 제거. 남은 `rounded-full`은 로딩 점처럼 의미 있는 원형 요소로 판정
- HTTP 스모크 라우트: `/dashboard`, `/dashboard/yesterday-review`, `/settings`, `/settings/appearance`, `/settings/data`, `/settings/data/source-mapping`, `/settings/integrations`, `/settings/shortcuts`, `/settings/ai`, `/vault/zettels`, `/vault/media`, `/vault/places` 모두 인증 미들웨어로 307 리다이렉트 확인

### 다음에 남은 것

- 브라우저에서 실제 인증 세션이 있는 화면을 열어 지식금고 읽기, 일일 기록, 작업 상세, PRM 드로어의 겹침/밀도/스크롤 피로도를 확인해야 한다.
- 전역 `app` 라우트와 `shell` 컴포넌트의 남은 짧은 영어 표제, 로딩 UI, aria-label을 한 번 더 검색해야 한다.
- 실제 화면 확인 결과에 따라 속성 요약/상세 토글이 콘텐츠를 가리는 지점이 있으면 레이아웃을 추가 조정해야 한다.

## 19. 2026-05-09 실제 화면 검증 및 PRM 원본 토큰 정리

8차 구현 이후 개발 서버를 다시 띄우고 실제 인증 세션이 있는 브라우저에서 PRM, 일일 기록, 작업 상세, 지식 읽기 화면을 확인했다.

### 완료한 것

- PRM 목록/드로어에서 Notion `page ref`와 긴 원본 컬럼 덤프가 사람 카드와 관계 요약에 그대로 노출되는 문제를 정리했다.
- `getPersonSummaryText` 표시 헬퍼를 추가해 읽기 표면에서는 원본 토큰을 숨기고, 원본 정리가 필요한 관계는 짧은 안내 문장으로 표시하게 했다.
- 사람 속성 요약에서도 `소개`와 `프로필 본문`이 긴 원본 덤프로 펼쳐지지 않도록 요약 표시값을 덮어썼다.
- 사람 속성 그룹의 `메모` 라벨을 `프로필`로, `생일 메모`를 `생일 기록`으로 바꿨다.
- PRM 선물 컬럼의 `메모` 라벨을 `선물 기록`으로 정리했다.
- PRM 드로어에 남아 있던 삭제 버튼의 큰 radius를 `rounded-md` 기준으로 낮췄다.

### 판단

- 원본 데이터는 편집/원본 탭에서 다루되, 목록과 드로어 같은 빠른 읽기 표면에는 원본 식별자와 컬럼 덤프를 그대로 노출하지 않는 편이 맞다.
- 실제 D1 데이터는 mock보다 훨씬 길고 지저분하므로, 시각 QA는 HTTP 스모크보다 브라우저 확인이 더 큰 결함을 잘 드러낸다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/prm?detail=person:{id}`, `/prm/{id}/edit`, `/life-ops/2026-05-07`, `/action-hub/prj_ad8c23fedf8277ce57055018c5/tasks/01KR10TXXA5KM4BAW8HZ1778C6`, `/vault/zettels/{id}` 확인
- 브라우저 콘솔: 최종 새로고침 기준 신규 error 없음

### 다음에 남은 것

- 전역 `app` 라우트와 `shell` 컴포넌트의 짧은 영어 표제, 로딩 UI, aria-label을 추가 검색해야 한다.
- 실제 데이터 기준으로 PRM 외 도메인에도 원본 컬럼 덤프가 읽기 표면에 남는지 더 훑어야 한다.

## 20. 2026-05-09 전역 shell/loading 라벨 정리

19차 구현에서 남긴 전역 `app` 라우트와 `shell` 컴포넌트의 짧은 영어/레거시 라벨, 로딩 UI 접근성 문구를 추가 정리했다.

### 완료한 것

- 앱 메타 설명을 한국어 제품 설명으로 바꿨다.
- 404 화면의 복귀 안내를 `대시보드` 기준에서 `오늘 보기` 기준으로 바꿨다.
- 전역 내비게이션 tooltip의 원문 단축키 `mod+k`, `mod+shift+n` 표기를 `컨트롤/⌘`, `시프트` 기반 한국어 설명으로 바꿨다.
- 접이식 로컬 내비게이션의 `Cmd+\` 표기를 `단축키 \` 기준으로 바꿨다.
- 주요 route loading UI에 `role="status"`, `aria-live`, 한국어 `aria-label`, `sr-only` 로딩 문장을 추가했다.
- skeleton 묶음에는 `aria-hidden="true"`를 추가해 시각 placeholder가 스크린리더에 중복으로 읽히지 않게 했다.

### 판단

- `Light House`, `404`처럼 브랜드/표준 코드는 유지하되, 상태와 이동 안내, 단축키 설명은 한국어 인터페이스 언어로 맞췄다.
- 로딩 화면은 보이는 skeleton보다 실제 상태 문장이 먼저 전달되어야 하므로, route별로 짧은 한국어 status region을 두는 기준을 적용했다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dashboard`에서 `오늘 보기로 이동`, `단축키` 표기 확인. `Cmd`, `mod+`, `대시보드로` 미노출
- 브라우저 확인: `/does-not-exist-codex-check`에서 `오늘 보기로 돌아가기`, `오늘 보기에서 다시` 확인. 기존 `대시보드로` 미노출
- 브라우저 콘솔: 대시보드와 404 검증 중 신규 error 없음

### 다음에 남은 것

- API error payload, toast, empty/error shared component에서 사용자가 직접 보는 영어 오류 문구를 실제 화면 기준으로 더 훑어야 한다.
- PRM 외 도메인, 특히 작업/지식/생활기록 읽기 표면에 원본 컬럼 덤프가 남는지 실제 데이터로 계속 확인해야 한다.

## 21. 2026-05-09 API 오류/공유 상태 문구 정리

20차 구현에서 남긴 API error payload, toast description, shared empty/error 표면의 영어 fallback을 추가 정리했다.

### 완료한 것

- API route의 `Unauthorized`, `required`, `failed` 계열 error fallback을 한국어 문장으로 바꿨다.
- 공용 snapshot mutation helper의 `Mutation failed.` fallback을 `변경 사항 저장에 실패했습니다.`로 바꿨다.
- Cloudflare D1, R2, Vectorize, Gemini, 오프라인 큐의 인프라 fallback 오류를 한국어로 바꿨다.
- 맥락 패널, 빠른 연결, 커맨드 팔레트, 지식 관계 검색에서 내부 영어 실패 문구가 화면/토스트로 흘러가지 않도록 바꿨다.
- `KeyHint`가 `Cmd`/`Shift`를 각각 `⌘`/`⇧`로 표시하게 했고, 단축키 치트시트의 `Cmd` 설명을 컨트롤/⌘ 안내로 바꿨다.
- 공용 `EmptyState`의 큰 `rounded-[32px]`를 `rounded-lg` 기준으로 낮췄다.
- 지식금고 미디어/드로어 관련 visible copy의 `Drawer` 표기를 `드로어`로 바꿨다.

### 판단

- API error payload는 최종적으로 toast description에 그대로 들어가는 경우가 많으므로, 서버 fallback부터 한국어로 유지하는 것이 가장 안정적이다.
- `AI`, `D1`, `R2`, `Gemini`, `Vectorize`처럼 제품/서비스명은 유지하되, 실패 상태와 조치 문장은 한국어로 둔다.
- 단축키 원본 값은 내부 바인딩 데이터로 남길 수 있지만, 사람이 읽는 힌트/치트시트에서는 `Cmd` 원문보다 기호와 한국어 설명이 덜 거칠다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- 검색 확인: API route에서 영어 `Unauthorized`, `required`, `failed` fallback 미노출. `AI`처럼 의도적으로 남긴 제품명은 유지
- 브라우저 확인: `/vault/media`에서 `상세 드로어` 표시, 기존 `상세 Drawer` 미노출
- 브라우저 확인: `/dashboard`에서 단축키 치트시트 열기. `컨트롤/⌘ 계열`, `⌘+K` 표시 확인, `Cmd 계열`, `Cmd+K` 미노출
- 브라우저 콘솔: 검증 중 신규 error 없음

### 다음에 남은 것

- 실제 데이터 기준으로 작업/지식/생활기록 읽기 표면에 원본 컬럼 덤프나 내부 ID가 남는지 계속 확인해야 한다.
- 설정 단축키 편집 화면처럼 내부 바인딩 값을 사용자가 직접 편집하는 표면은, 원본 값과 표시용 값을 분리할지 별도 기준을 정해야 한다.

## 22. 2026-05-09 실제 데이터 생활기록 목록 복구

21차 구현에서 남긴 실제 데이터 기준 원본 덤프/내부 ID 노출 검사를 작업 상세, 지식 목록, 생활기록 화면으로 이어서 진행했다.

### 완료한 것

- 실제 인증 세션이 있는 브라우저에서 작업 상세, 지식 목록, 일일 기록, 생활기록 아카이브를 확인했다.
- 작업 상세, 지식 목록, 일일 기록에서는 읽기 표면에 Notion `page ref`, 원본 컬럼 덤프, raw source token이 새로 노출되는 지점은 발견하지 못했다.
- 생활기록 아카이브(`/life-ops/entries`)에서 실제 데이터량 때문에 `too many SQL variables` 오류가 발생하는 문제를 확인했다.
- `getPeopleForDailyEntries`가 모든 daily entry id를 한 번의 `IN (...)` 쿼리에 넣던 부분을 80개 단위 배치 조회로 바꿨다.
- 전역 `app/error.tsx`가 App Router error boundary 안에서 다시 `<html>`/`<body>`를 렌더링하던 구조를 제거했다.

### 판단

- 원본 덤프 노출은 현재 확인한 작업/지식/생활기록 읽기 표면에서는 추가로 발견되지 않았지만, 실제 데이터량은 mock과 다르게 SQL 한계와 N+1 조회 문제를 바로 드러낸다.
- D1/SQLite의 변수 한계는 데이터가 늘면 재발할 수 있으므로, 대량 id 기반 조회는 작은 배치로 고정하는 편이 안정적이다.
- error boundary는 루트 레이아웃이 아니므로 document shell을 다시 만들지 않고, 오류 상태 컴포넌트만 렌더링해야 한다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/life-ops/entries`에서 `생활기록 아카이브` 제목 렌더링 확인
- 브라우저 확인: `/life-ops/entries`에서 `too many SQL variables` 오류, 중첩 `<html>/<body>` 오류, 원본 덤프 문구 미노출
- 브라우저 콘솔: `/life-ops/entries` 최종 새로고침 기준 신규 error 없음

### 다음에 남은 것

- 생활기록 아카이브의 source document 조회가 entry별 반복 조회로 남아 있어, 실제 데이터가 더 커지면 느려질 수 있다. 다음 작업은 source document도 배치 조회로 바꾸는 것이 가장 체계적이다.
- 설정의 source trace/source mapping 표면은 내부 원본 값을 다루는 목적이 있으므로, 원본 값과 읽기용 표시값의 기준을 별도로 확정해야 한다.

## 23. 2026-05-10 생활기록 원본 문서 배치 조회

22차 구현에서 남긴 생활기록 아카이브의 source document N+1 조회 위험을 정리했다.

### 완료한 것

- 생활기록 서버 데이터 계층에서 원본 문서를 단건으로 조회하던 `getSourceDocumentForEntity` 흐름을 제거했다.
- `getSourceDocumentsForEntities` 배치 헬퍼를 추가해 canonical entity id 목록을 80개 단위로 나눠 source document를 조회하게 했다.
- source document properties도 source document id 목록 기준으로 80개 단위 배치 조회하도록 바꿨다.
- 일일 기록 스냅샷과 생활기록 아카이브 모두 source document를 배열 인덱스가 아니라 entity id 맵으로 붙이도록 정리했다.
- source document URL도 생활기록 쪽 원본 문서 정보에 포함되도록 맞췄다.

### 판단

- 실제 데이터가 100개 이상으로 늘어난 상태에서는 화면 오류만 고치는 것보다 조회 패턴 자체를 안정화하는 것이 우선이다.
- 원본 문서와 원본 속성은 각각 별도 테이블이므로, entry별 단건 조회를 유지하면 데이터가 커질수록 네트워크/DB 왕복이 불필요하게 커진다.
- 배치 조회 결과를 id 맵으로 붙이면 정렬 변경이나 필터 추가에도 source document가 잘못 붙을 가능성이 낮다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check -- apps/web/src/lib/server/life-ops.ts`: 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/life-ops/entries`에서 `일일 기록`, `전체 기록`, `날짜 로그 보기` 렌더링 확인
- 브라우저 확인: `/life-ops/2026-05-07`에서 일일 기록 화면 렌더링 확인
- 브라우저 확인: 두 화면 모두 `too many SQL variables`, 중첩 `<html>/<body>` 오류, 원본 덤프 문구 미노출
- 브라우저 콘솔: 최종 새로고침 기준 신규 error 없음

### 다음에 남은 것

- 설정의 source trace/source mapping 표면은 원본 데이터를 다루는 목적이 있으므로, 어디까지 원본 값을 그대로 보여주고 어디부터 읽기용 표시값으로 감출지 기준을 확정해야 한다.
- 다음 작업은 `/settings/data/source-mapping`과 실제 source trace 패널을 브라우저로 확인하며 원본 값/표시 값 경계를 정리하는 것이 가장 체계적이다.

## 24. 2026-05-10 원본 값 표시 경계 정리

23차 구현에서 남긴 source mapping/source trace의 원본 값 표시 경계를 실제 브라우저 화면 기준으로 확인하고 정리했다.

### 완료한 것

- `/settings/data/source-mapping`은 원본 컬럼을 정리하는 관리 화면으로 두고, 원본 컬럼명과 샘플 값은 의도된 관리 정보로 유지했다.
- `/prm` 실제 목록에서 일부 사람 카드에 `이름 | | | ... | Yes/No |` 형태의 원본 행 덤프가 소개 문장처럼 노출되는 문제를 확인했다.
- 사람 요약 표시 헬퍼가 파이프 구분 원본 행을 감지해 `원본 속성 정리가 필요한 관계입니다.`로 접도록 보강했다.
- source trace 패널에서 source id, canonical entity id, resolved entity id, review entity id가 직접 보이지 않도록 `원본 식별자 보관됨`, `기준 항목 연결됨` 같은 표시용 문구로 바꿨다.
- 맥락 레일의 근거 버튼과 근거 카드에 `zettel`, `daily_entry` 같은 내부 타입명이 그대로 보이던 부분을 `지식`, `개별 기록` 같은 한국어 라벨로 바꿨다.
- 사람 맥락 카드에서 source document id를 `원본 {id}`로 표시하던 fallback을 `원본 문서 연결됨`으로 바꿨다.

### 판단

- source mapping은 관리자가 원본 컬럼을 정리하는 화면이므로 원본 컬럼명/샘플 값 노출이 필요하다.
- PRM 목록, 맥락 레일, source trace의 요약/상태 영역은 일반 읽기 표면에 가깝기 때문에 내부 id와 원본 행 덤프를 직접 보여주지 않는다.
- source trace에서도 원본 속성 값 자체는 감사 목적상 유지하되, source id와 canonical id 같은 내부 식별자는 상태 문구로 대체한다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/prm`에서 파이프 구분 원본 행 덤프, `page ref`, raw table name, raw source label 미노출
- 브라우저 확인: `/prm/per_f5dde5a775ec63512eaab273ca`에서 source trace 렌더링, 내부 타입명 버튼 미노출
- 브라우저 확인: `/settings/data/source-mapping`에서 관리 화면 렌더링, raw table name/source id 계열 문구 미노출
- 브라우저 콘솔: 세 화면 최종 새로고침 기준 신규 error 없음

### 다음에 남은 것

- 맥락 패널의 근거/타임라인/빠른 연결 표면을 더 넓게 훑어, 내부 테이블명이나 raw relation label이 남는지 확인해야 한다.
- 다음 작업은 `ContextRail`, `ContextTimeline`, `SmartAttachPanel`, `RelationEvidenceCard`를 실제 작업/지식/생활기록 상세 화면에서 순회 검증하는 것이 좋다.

## 25. 2026-05-10 맥락 패널 내부 라벨 정리

24차 구현에서 남긴 맥락 패널의 근거/타임라인/빠른 연결 표면을 실제 상세 화면 기준으로 순회 확인했다.

### 완료한 것

- `SmartAttachPanel` 검색 결과에서 동명이인/동명 항목 구분용으로 `ID {id}`를 직접 붙이던 표시를 제거했다.
- 빠른 연결 검색 결과의 fallback 타입 표시를 `zettel`, `daily_log` 같은 내부 타입명 대신 `지식`, `하루` 같은 표시용 라벨로 바꿨다.
- `RelationEvidenceCard`의 relation label 변환 범위를 넓혀 `linked person`, `linked note`, `daily context query`, `record trace`, `record review` 같은 내부/영문 라벨을 한국어로 표시하게 했다.
- 근거 카드의 테이블명 표시도 `task_people_relations`, `task_zettel_relations`, `zettel_links`, `daily_log_people_relations` 등을 사람이 읽는 관계명으로 바꿨다.
- source trace 관계 resolver가 target source id를 근거 snippet으로 그대로 넘기지 않고 `원본 관계 대상 보관됨`으로 접도록 정리했다.
- 빠른 연결 select의 남은 `rounded-xl`을 `rounded-md`로 낮춰 맥락 패널의 조작부 radius 기준을 맞췄다.

### 판단

- 내부 id는 실제 연결 요청 payload에는 필요하지만, 검색 결과/근거 카드 같은 일반 조작 표면에는 직접 보일 필요가 없다.
- relation label은 데이터 소스마다 `linked note`, `daily_entry`, `source_document_relations`처럼 섞여 들어오므로, 공용 근거 카드에서 한 번 더 표시용 라벨로 정규화하는 것이 안정적이다.
- source trace는 원본 감사 표면이지만 target source id 자체는 사람이 바로 이해할 값이 아니므로 상태 문구로 접는 편이 낫다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: 작업 상세 `/action-hub/prj_ad8c23fedf8277ce57055018c5/tasks/01KR10TXXA5KM4BAW8HZ1778C6`에서 내부 타입 버튼, relation table name, raw source label, ID 라벨, 파이프 덤프, `page ref` 미노출
- 브라우저 확인: 사람 상세 `/prm/per_f5dde5a775ec63512eaab273ca`에서 빠른 연결 검색 결과에 `ID {id}`와 raw type 미노출
- 브라우저 확인: 생활기록 상세 `/life-ops/2026-05-07`에서 내부 타입 버튼, relation table name, raw source label 미노출
- 브라우저 확인: 지식 상세 `/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f?view=all`에서 내부 타입 버튼, relation table name, ID 라벨, 파이프 덤프, `page ref` 미노출
- 브라우저 콘솔: 검증 중 신규 error 없음

### 다음에 남은 것

- 지식금고의 지식 관계 편집 패널은 자체 관계 UI를 가지고 있으므로, 검색 결과와 관계 그룹에서 원본 id/내부 타입 fallback이 남는지 별도로 더 훑어야 한다.
- 다음 작업은 `ZettelRelationsPanel`, `ZettelReaderPane`, `BacklinkPanel`을 실제 지식 상세 화면에서 조작 없이 검증하고 필요한 표시 라벨을 정리하는 것이다.

## 26. 2026-05-10 지식 관계 UI 표시 라벨 정리

25차 구현에서 남긴 지식금고 자체 관계 편집 UI를 코드와 실제 지식 상세 화면 기준으로 확인했다.

### 완료한 것

- `ZettelRelationsPanel`의 관계 검색 결과가 `zettel`, `task` 같은 raw entity type을 그대로 fallback으로 보여주지 않도록 표시용 라벨을 거치게 했다.
- 지식 관계 그룹 row의 subtitle에 `Outgoing link`, `Backlink` 같은 영문 fallback이 남아도 `나가는 링크`, `역링크`로 표시되게 했다.
- 서버 맥락 bundle 생성 단계에서도 지식 outgoing/backlink subtitle을 한국어로 바꿨다.
- 사람 검색 disambiguation fallback이 `ID {id}`로 떨어지지 않도록 `동명 인물`, `인물 정보 정리 중`으로 바꿨다.
- source relation evidence snippet에 target source id가 직접 들어가지 않도록 `원본 관계 대상 보관됨`으로 접었다.
- `BacklinkPanel`은 현재 호출부가 없는 컴포넌트지만, 들여쓰기/구조를 정리해 이후 재사용 시 읽기 표면이 흔들리지 않게 했다.

### 판단

- 지식 관계 UI는 공용 맥락 패널과 별도로 움직이므로, 검색 결과와 관계 row에도 같은 표시용 라벨 기준을 적용해야 한다.
- 서버에서 한국어 subtitle을 내려주고 클라이언트에서 한 번 더 fallback을 정리하면, 기존 캐시나 다른 호출 경로가 섞여도 화면 노출이 덜 흔들린다.
- 동명이인 구분은 필요하지만 내부 id는 사용자에게 의미가 낮으므로 상태 문구로 대체한다.

### 검증

- `npm run typecheck --workspace @light-house/web`: 통과
- `npm run lint --workspace @light-house/web`: 통과
- `git diff --check`: 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f?view=all` 관계 패널 렌더링 확인
- 브라우저 확인: 지식 관계 기본 상태에서 내부 타입 버튼, relation table name, `ID` 라벨, 파이프 덤프, `page ref`, `Outgoing link`, `Backlink` 미노출
- 브라우저 확인: 지식 관계 검색 상태에서 `ID {id}`, raw type label, 영문 fallback 미노출
- 브라우저 콘솔: 검증 중 신규 error 없음

### 다음에 남은 것

- 원본 값/내부 라벨 정리는 주요 읽기 표면에서 상당히 줄었으므로, 다음은 성능/데이터량 검증으로 넘어가는 것이 좋다.
- 다음 작업은 PRM, 지식, 생활기록 목록의 대량 데이터 화면에서 느린 쿼리나 과도한 클라이언트 필터링이 남는지 실제 브라우저와 서버 로그 기준으로 훑는 것이다.

## 27. 2026-05-10 대량 목록 성능 1차 안정화

26차 구현에서 남긴 PRM, 지식, 생활기록 목록의 대량 데이터 화면을 실제 브라우저 기준으로 확인하고, 우선순위가 높은 렌더링 비용을 줄였다.

### 완료한 것

- `/vault/zettels`, `/prm`, `/life-ops/entries`를 브라우저로 직접 열어 목록 렌더링 시간, 콘솔 오류, 오류 boundary, SQL 변수 오류, 원본 덤프 노출 여부를 확인했다.
- 지식 목록은 449개 문서를 매 렌더마다 저장 뷰 필터, 속성 필터, 검색어 필터, 정렬, 선택 항목 탐색까지 다시 계산하고 있어 가장 먼저 안정화했다.
- `ZettelsClient`의 저장 뷰 결과, 표시 목록, 선택 항목, 화면 표시 slice를 `useMemo`로 고정해 필터 상태가 바뀌지 않는 렌더에서 전체 목록 재계산을 피하게 했다.
- `DailyEntriesClient`도 저장 뷰 결과, 검색/종류 필터 결과, 통계 카운트, 렌즈 종류 분포를 `useMemo`로 고정했다.
- 일일 기록 저장 뷰 정렬이 원본 `entries` 배열을 직접 `sort`하지 않도록 복사본 정렬로 바꿨다.
- `PRMClient`의 전체 뷰 주입, 연락 필요 목록, 저장 뷰 결과, 표시 목록도 memoized 파생 데이터로 정리했다.
- `/life-ops/entries`는 목록 데이터가 서버 prop으로 이미 내려오는 화면이므로, 상위 Life Ops 하이드레이터가 스토어 준비 대기 화면으로 본문 렌더링을 막지 않도록 예외 처리했다.

### 판단

- 현재 개발 서버의 HTML 응답 자체는 세 목록 모두 약 0.6~0.8초 수준으로 측정되어, 첫 병목은 단순 서버 라운드트립보다 클라이언트 하이드레이션/파생 데이터 계산 쪽에 더 가까웠다.
- 지식 목록은 데이터량이 가장 크고 검색 텍스트/원본 속성 텍스트 생성 비용이 반복되므로, 전체 스냅샷 구조를 바꾸기 전에 memoization으로 먼저 흔들림을 줄이는 것이 안전했다.
- 일일 기록은 목록 자체보다 상위 하이드레이터의 렌더 차단 영향이 커 보였고, 해당 화면은 스토어 없이도 자체 `entries` prop으로 표시 가능하므로 좁게 예외를 두었다.
- PRM은 현재 6명 규모라 체감 병목은 작지만, 같은 저장 뷰/필터 패턴을 쓰므로 이후 데이터 증가를 대비해 함께 정리했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 확인: `/vault/zettels`에서 `지식 목록`과 449개 목록 상태 렌더링, 신규 콘솔 error 없음
- 브라우저 확인: `/prm`에서 6명 관계 목록 렌더링, 신규 콘솔 error 없음
- 브라우저 확인: `/life-ops/entries`에서 `일일 기록`과 124개 기록 상태 렌더링, `생활기록 데이터를 불러오는 중입니다` 대기 화면 미노출, 신규 콘솔 error 없음
- 브라우저 확인: 세 화면 모두 `too many SQL variables`, 오류 boundary, 파이프 원본 덤프, `page ref` 미노출

### 다음에 남은 것

- 지식금고는 여전히 vault layout에서 지식, 미디어, 자산, 장소, 원본 문서 속성을 한 번에 하이드레이션하므로, 데이터가 더 커지면 목록 payload와 상세 payload를 분리해야 한다.
- 다음 작업은 `/vault/zettels`를 목록용 경량 snapshot과 상세용 단건 fetch로 나누는 구조를 설계하고, 먼저 지식 목록에서 full `content`와 비사용 도메인 데이터를 빼는 것이 좋다.

## 28. 2026-05-10 지식 목록 경량 payload와 상세 fetch 분리

27차 구현에서 남긴 `/vault/zettels`의 목록 payload와 상세 payload 분리를 실제 코드 경계로 적용했다.

### 완료한 것

- `getVaultZettelList()`를 추가해 지식 목록 화면이 미디어, 자산, 장소 데이터를 함께 끌고 오지 않도록 분리했다.
- 지식 목록 쿼리는 full `content` 대신 검색용 짧은 본문 조각만 내려주고, 상세 화면은 `getVaultZettel(id)`로 단건 full content를 가져오게 했다.
- `/vault/zettels` 페이지는 저장 뷰와 경량 지식 목록을 병렬로 받아 `ZettelsClient`에 전달한다.
- `/vault/zettels/[zettelId]` 페이지는 경량 목록과 선택된 지식 상세를 병렬로 받아 초기 상세 진입이 별도 전체 snapshot 없이 열리게 했다.
- `/api/vault/zettels/[zettelId]/details`에 `GET`을 추가해 목록에서 카드를 클릭할 때 필요한 상세만 불러올 수 있게 했다.
- `VaultLayout`은 더 이상 모든 vault 진입마다 전체 snapshot을 서버에서 만들지 않고, `VaultHydrator`는 `/vault/zettels*` 경로에서는 전체 vault bootstrap을 기다리지 않는다.
- `ZettelsClient`는 서버에서 받은 경량 목록을 로컬 목록 상태로 쓰고, 상세를 열면 단건 상세를 병합한다. 생성/수정/삭제 mutation 후에는 기존 full snapshot 응답을 받아 로컬 목록과 store를 함께 갱신한다.
- `ZettelReaderPane`은 snapshot writer를 부모가 주입할 수 있게 해, 저장 후 경량 목록 상태도 함께 최신화할 수 있게 했다.

### 판단

- 지식 목록은 목록 카드, 필터, 저장 뷰가 필요로 하는 데이터와 읽기/편집 상세가 필요로 하는 데이터가 다르다.
- 전체 vault snapshot을 layout에서 먼저 만드는 방식은 모든 vault 하위 화면에 균일하지만, 지식 목록처럼 데이터량이 큰 화면에서는 첫 표시를 불필요하게 늦춘다.
- 상세 단건 fetch를 먼저 붙여두면 다음 단계에서 생성/수정/삭제 mutation 응답도 전체 snapshot이 아닌 목록/상세 delta로 줄일 수 있다.
- 미디어/자산/장소 화면은 아직 store bootstrap에 의존하므로, 지식 경로만 전체 bootstrap 대기를 건너뛰고 나머지 vault 화면은 기존 hydrator fetch 흐름을 유지했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/vault/zettels`에서 `지식 목록`, 449개 목록 상태 렌더링, `지식금고 데이터를 불러오는 중입니다` 미노출, 신규 콘솔 error 없음
- 브라우저 확인: 목록 카드 클릭 시 `/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f?view=all` 상세로 이동, `저장됨`/`목록` 표시, `지식을 열 수 없습니다` 미노출, 신규 콘솔 error 없음
- 브라우저 확인: 상세 URL 직접 진입 시 전체 vault bootstrap 대기 없이 상세 렌더링, 신규 콘솔 error 없음
- 브라우저 확인: `/vault/media/books`는 hydrator 대기 후 미디어 화면으로 정상 전환, 신규 콘솔 error 없음

### 다음에 남은 것

- 지식 생성/수정/삭제와 관계 연결 mutation은 아직 full vault snapshot을 응답으로 돌려준다.
- 다음 작업은 지식 mutation API 응답을 `snapshot` 전체가 아니라 `zettel`, `zettels`, `deletedId` 같은 작은 payload로 나눠, 저장/삭제/관계 변경 후에도 전체 vault 데이터를 다시 받지 않게 만드는 것이 좋다.

## 29. 2026-05-10 지식 mutation delta 응답 전환

28차 구현에서 남긴 지식 생성/수정/삭제/관계 연결 후 full vault snapshot 재수신 문제를 지식 도메인부터 줄였다.

### 완료한 것

- `createVaultZettel()`은 전체 snapshot 대신 `{ selectedZettelId, zettel }`을 반환하게 했다.
- `updateVaultZettelDetails()`, `updateVaultZettelTitle()`, `updateVaultZettelContent()`는 저장된 단건 지식만 반환하게 했다.
- `deleteVaultZettel()`은 전체 snapshot 대신 `{ deletedId }`만 반환하게 했다.
- `linkVaultZettels()`와 `unlinkVaultZettels()`는 변경 영향이 있는 source/target 지식만 `{ zettels }`로 반환하게 했다.
- 지식 관련 API route의 응답도 `snapshot` 중심에서 `zettel`, `zettels`, `deletedId` 중심으로 바꿨다.
- `ZettelsClient`는 삭제 응답의 `deletedId`로 로컬 목록에서 항목을 제거하고, 저장/관계 변경 응답의 지식만 병합한다.
- `ZettelReaderPane`은 `postSnapshotMutation` 의존을 제거하고, 저장 후 받은 단건 지식을 부모 로컬 목록에 전달한다.
- `ZettelRelationsPanel`은 지식 링크 추가/삭제 후 전체 store를 갈아끼우지 않고 변경된 지식만 부모에 전달한다.
- 구형 `ZettelEditorClient`도 새 delta 응답 계약에 맞춰 저장/링크 요청을 직접 처리하게 했다.

### 판단

- 28차에서 목록/상세 fetch를 분리했더라도 mutation 응답이 full snapshot이면 저장 한 번마다 같은 병목이 되살아난다.
- 지식 저장은 단건 지식만, 지식 삭제는 삭제 id만, 지식 간 링크는 양 끝 지식만 영향을 받으므로 전체 vault 데이터가 필요하지 않다.
- 미디어/자산/장소 mutation은 아직 기존 store bootstrap 모델에 기대고 있어 이번 범위에서는 건드리지 않았다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: 지식 zettel/zettel-link API와 지식 클라이언트에서 `postSnapshotMutation`, `VaultSnapshotState`, `applyVaultSnapshot` 잔여 참조 없음
- 브라우저 확인: `/vault/zettels` 목록 렌더링, 전체 vault loading 미노출, 신규 콘솔 error 없음
- 브라우저 확인: 목록 카드 클릭으로 상세 진입, `저장됨`/`관계` 렌더링, 상세 loading/error 미노출, 신규 콘솔 error 없음
- 브라우저 확인: 상세 URL 직접 진입 시 `관계` 패널 포함 렌더링, 신규 콘솔 error 없음

### 다음에 남은 것

- 실제 저장/관계 변경 버튼까지 포함한 mutation smoke test를 하려면 테스트용 지식 fixture나 되돌림 가능한 테스트 API가 필요하다.
- 다음 작업은 지식 mutation smoke test를 안전하게 수행할 수 있도록 개발 전용 테스트 지식 생성/정리 흐름을 만들거나, 미디어/자산/장소 mutation도 같은 delta 응답 구조로 옮기는 것이다.

## 30. 2026-05-10 지식 mutation smoke test 경로 추가

29차 구현에서 남긴 "실제 mutation 버튼까지 검증하려면 되돌림 가능한 테스트 흐름이 필요하다"는 과제를 개발 전용 smoke test로 먼저 해결했다.

### 완료한 것

- 지식 mutation smoke test 서버 헬퍼를 추가했다.
- smoke test는 임시 지식 2개를 만들고, source 지식 상세를 수정한 뒤, source -> target 링크를 만들고, 링크 row를 확인하고, 링크를 해제하고, 두 지식을 삭제한 다음 hard cleanup까지 수행한다.
- cleanup 기준은 `source = lh-zettel-mutation-smoke-test`로 한정해 이전 실패 실행에서 남은 테스트 지식도 다음 실행 시작 전에 정리한다.
- `/api/vault/zettels/smoke-test`와 `/dev/zettel-smoke-test`를 같은 헬퍼에 연결했다.
- 브라우저 자동화가 JSON route 직접 열기를 막는 상황을 고려해 `/dev/zettel-smoke-test?format=html`에서 결과 JSON을 `<pre data-testid="smoke-result">`로 렌더링하게 했다.
- 프로덕션에서는 404를 반환하고, 개발 모드에서도 세션이 없으면 localhost 요청에서만 configured admin 세션을 만들어 자기 자신으로 한 번 리다이렉트한다.
- 로컬 dev server는 루트 `.env.local`을 주입해 다시 띄웠다. 기본 화면의 비밀번호 안내와 실제 env 비밀번호가 다를 수 있어, 브라우저에 비밀번호를 직접 입력하지 않는 방식으로 검증했다.

### 판단

- 지식 mutation delta 전환은 타입/화면 렌더링만으로는 충분하지 않고, 실제 D1에 쓰고 되돌리는 작은 회귀 검증이 필요하다.
- 테스트 fixture를 사용하되 cleanup을 서버가 책임지게 하면 사용자 데이터 목록에 smoke 데이터가 남는 위험을 줄일 수 있다.
- route 자체는 mutation을 실행하므로 일반 UI에는 노출하지 않고, `NODE_ENV !== production`과 localhost 조건으로 범위를 좁힌다.
- `/dev/...` HTML 검증 경로를 둔 것은 브라우저 확인을 안정적으로 남기기 위한 장치이고, 실제 mutation 로직은 공용 헬퍼 한 곳만 유지한다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 확인: `/dev/zettel-smoke-test?format=html`에서 `ok: true` 반환
- 브라우저 확인: create source, create target, update source details, link source to target, persist link row, unlink source from target, cleanup smoke rows가 모두 `ok: true`
- 브라우저 확인: cleanup 결과 `remainingRows: 0`
- 브라우저 확인: `/vault/zettels`로 돌아간 뒤 `[SMOKE]`와 `lh-zettel-mutation-smoke-test` 문구 미노출
- 브라우저 콘솔: 재시작 전 env 미주입 상태의 로그인 오류 로그가 남아 있었지만, smoke test와 지식 목록 확인 자체는 정상 렌더링

### 다음에 남은 것

- 지식 도메인은 목록/상세 분리, mutation delta 응답, 되돌림 가능한 smoke test까지 한 사이클이 닫혔다.
- 다음 작업은 같은 패턴을 미디어/자산/장소 mutation에 적용해 full vault bootstrap 의존을 줄이는 것이 가장 체계적이다.

## 31. 2026-05-10 미디어/자산/장소 mutation delta 응답 전환

30차 구현에서 남긴 "지식과 같은 패턴을 미디어/자산/장소에 적용"하는 작업을 vault 나머지 mutation route까지 확장했다.

### 완료한 것

- 미디어, 자산, 장소 row를 단건 mock 모델로 매핑하는 서버 mapper를 분리했다.
- `getVaultMedia(id)`, `getVaultAsset(id)`, `getVaultPlace(id)`를 추가해 mutation 후 전체 vault snapshot 대신 변경된 단건만 다시 조회하게 했다.
- `cycleVaultMediaStatus()`와 `updateVaultMediaDetails()`는 `{ media }` 응답으로 전환했다.
- `updateVaultAssetProperties()`는 `{ asset }` 응답으로 전환했다.
- `updateVaultPlaceProperties()`와 `updateVaultPlaceReview()`는 `{ place }` 응답으로 전환했다.
- vault store에 `upsertMedia`, `upsertAsset`, `upsertPlace`를 추가해 단건 응답을 로컬 배열에 병합하게 했다.
- 미디어 상태 버튼, 미디어 속성 패널, 자산 속성 패널, 장소 속성 패널, 장소 메모 inline 저장이 `postSnapshotMutation` 대신 JSON delta 응답을 처리하게 했다.
- `postJsonMutation()` 공용 클라이언트 helper를 추가해 snapshot이 없는 mutation도 같은 오류 처리 흐름을 쓰게 했다.

### 판단

- 지식 도메인에서 확인한 것처럼, mutation 후 전체 snapshot을 받는 구조는 payload와 클라이언트 store 갱신 비용을 다시 키운다.
- 미디어/자산/장소 속성 저장은 모두 단건 row만 영향을 받으므로 전체 `zettels/media/assets/places` 묶음을 다시 받을 필요가 없다.
- 자산/장소 목록은 아직 현재 데이터셋에서 0개라 실제 데이터 저장 UX까지 확인하지는 못했지만, API 응답 계약과 클라이언트 병합 경계는 같은 패턴으로 정리했다.
- 다음 단계에서 자산/장소 smoke fixture가 생기면 미디어와 같은 실제 mutation 회귀 검증으로 닫을 수 있다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: 미디어/자산/장소 mutation route와 vault 클라이언트에서 `snapshot` 응답, `postSnapshotMutation` 잔여 참조 없음
- 브라우저 확인: `/vault/media?view=all`에서 485개 미디어 목록 렌더링
- 브라우저 확인: 미디어 첫 항목 상태 버튼을 3회 순환해 `대기 -> ... -> 대기`로 되돌림, full snapshot 교체 없이 화면 유지
- 브라우저 확인: `/vault/media/med_ff114faa66c4e2e7701fd3963c` 상세에서 속성 편집 후 값 변경 없이 저장, `미디어 속성을 저장했습니다.` toast 확인
- 브라우저 확인: `/vault/assets?view=all`은 현재 데이터 0개 상태에서 빈 상태 정상 렌더링
- 브라우저 확인: `/vault/places?view=all`은 현재 데이터 0개 상태에서 빈 상태와 지도 placeholder 정상 렌더링
- 브라우저 콘솔: 재시작 전 env 미주입 로그인 오류 로그가 계속 남아 있으나, 이번 검증 흐름의 화면 렌더와 미디어 저장 자체는 정상

### 다음에 남은 것

- 자산/장소는 현재 데이터가 없어 실제 저장 버튼 회귀 검증이 비어 있다.
- 다음 작업은 미디어/자산/장소용 개발 전용 smoke fixture를 만들거나, vault layout의 나머지 도메인도 지식처럼 목록/상세 payload를 더 분리하는 것이다.

## 32. 2026-05-12 미디어/자산/장소 mutation smoke fixture 추가

31차 구현에서 남긴 "자산/장소 실제 저장 버튼 회귀 검증 공백"을 개발 전용 smoke fixture로 닫았다.

### 완료한 것

- 미디어/자산/장소 delta mutation을 한 번에 검증하는 서버 헬퍼를 추가했다.
- smoke test는 임시 미디어 2개, 자산 1개, 장소 2개를 생성한 뒤 미디어 상태 순환, 미디어 상세 저장, 자산 속성 저장, 장소 속성 저장, 장소 메모 저장을 실행한다.
- 각 검증은 mutation 응답의 변경된 단건이 기대 값으로 돌아왔는지 확인한다.
- cleanup 기준은 `lh_smoke_media_`, `lh_smoke_asset_`, `lh_smoke_place_` ID prefix로 한정했고, 시작 전/종료 후에 관련 relation row까지 정리한다.
- `/api/vault/delta-smoke-test`와 `/dev/vault-delta-smoke-test`를 같은 헬퍼에 연결했다.
- 브라우저 자동화 확인을 위해 `/dev/vault-delta-smoke-test?format=html`에서 결과 JSON을 `<pre data-testid="smoke-result">`로 렌더링하게 했다.

### 판단

- 서버의 단건 조회 함수는 React `cache()`로 감싸져 있어 같은 request 안에서 한 fixture를 여러 번 갱신하면 stale read가 생길 수 있다.
- 그래서 미디어 상태/미디어 상세/장소 속성/장소 메모를 서로 다른 fixture로 분리했다.
- 현재 실제 자산/장소 데이터가 0개인 상태에서도 mutation API와 client delta 계약을 회귀 검증할 수 있게 됐다.
- smoke fixture는 사용자 데이터 목록을 오염시키지 않도록 fixture 생성과 삭제를 서버 route 하나 안에서 닫는 구조로 유지한다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과
- 브라우저 확인: `/dev/vault-delta-smoke-test?format=html`에서 `ok: true` 반환
- 브라우저 확인: cycle media status, update media details, update asset properties, update place properties, update place review, cleanup smoke rows가 모두 `ok: true`
- 브라우저 확인: cleanup 결과 `remainingRows.media/assets/places`가 모두 0
- 브라우저 확인: `/vault/media?view=all`, `/vault/assets?view=all`, `/vault/places?view=all` 로딩 완료 후 `[SMOKE]`와 `lh_smoke_` 문구 미노출
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- mutation delta 응답과 smoke fixture는 지식/미디어/자산/장소까지 한 사이클이 닫혔다.
- 다음 작업은 vault bootstrap을 더 작게 쪼개 `/vault/media`, `/vault/assets`, `/vault/places`가 전체 vault snapshot에 덜 의존하도록 domain-specific bootstrap/list fetch를 분리하는 것이다.

## 33. 2026-05-12 Vault 미디어/자산/장소 domain list fetch 분리

32차 구현에서 남긴 "vault bootstrap 분리"를 미디어/자산/장소 목록과 상세 화면부터 적용했다.

### 완료한 것

- `getVaultMediaList()`, `getVaultAssetList()`, `getVaultPlaceList()`를 추가해 전체 vault snapshot 없이 각 도메인 목록만 조회하게 했다.
- source document mapping도 도메인 단위로 조회하는 helper를 추가했다.
- `/api/vault/media`, `/api/vault/assets`, `/api/vault/places`를 추가해 전체 bootstrap이 아닌 도메인별 list 응답을 받을 수 있게 했다.
- `/vault/media`, `/vault/assets`, `/vault/places` 페이지는 서버에서 각 도메인 목록과 saved view를 병렬 조회해 client에 넘긴다.
- `/vault/media/books`, `/vault/media/games`, `/vault/media/screens`는 전체 snapshot 후 필터링하지 않고 media type별 list fetch를 사용한다.
- 미디어/자산/장소 상세 페이지는 `getVaultSnapshot()` 대신 `getVaultMedia()`, `getVaultAsset()`, `getVaultPlace()` 단건 조회를 사용한다.
- `VaultHydrator`는 지식뿐 아니라 미디어/자산/장소 경로도 전체 bootstrap을 기다리지 않고 children을 먼저 렌더링하게 했다.
- vault store에는 `replaceMedia`, `replaceAssets`, `replacePlaces`를 추가했고, 각 클라이언트는 서버에서 받은 도메인 데이터를 local state와 store에 동시에 반영한다.

### 판단

- 미디어/자산/장소 화면은 지식 목록과 독립적으로 렌더링할 수 있으므로 전체 `zettels/media/assets/places` snapshot을 기다릴 필요가 없다.
- 목록 화면은 서버 컴포넌트에서 도메인 list를 받아 첫 화면을 구성하고, mutation은 단건 delta 응답으로 local list와 store를 갱신하는 구조가 가장 작고 안정적이다.
- 상세 페이지도 단건 조회로 충분하므로 전체 snapshot을 경유하지 않는 편이 payload와 쿼리 비용을 줄인다.
- 그래프나 전역 검색처럼 여러 도메인을 한 번에 비교하는 화면은 아직 full snapshot을 유지한다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- React TSX 변경점 점검: hook 순서, dependency, button semantics, local state 동기화 범위 이상 없음
- 코드 확인: `/vault/media`, `/vault/assets`, `/vault/places` 하위에서 `getVaultSnapshot()` 직접 참조 없음
- 브라우저 확인: `/vault/media?view=all`에서 loading 문구 없이 485개 미디어 목록 렌더링
- 브라우저 확인: `/vault/assets?view=all`에서 loading 문구 없이 0개 빈 상태 렌더링
- 브라우저 확인: `/vault/places?view=all`에서 loading 문구 없이 0개 빈 상태와 지도 placeholder 렌더링
- 브라우저 확인: `/vault/media/books`, `/vault/media/games`, `/vault/media/screens`가 loading 문구 없이 각각 렌더링
- 브라우저 확인: `/vault/media/med_ff114faa66c4e2e7701fd3963c` 상세가 loading 문구 없이 단건 데이터와 속성 패널 렌더링
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 vault 그래프와 전역 검색/컨텍스트처럼 여러 도메인을 묶어 쓰는 화면의 full snapshot 의존을 유지할지, 전용 read model로 분리할지 판단하는 것이다.
- 우선순위상으로는 `/vault/zettels/graph`가 가장 크고 눈에 띄는 남은 full snapshot 소비처다.

## 34. 2026-05-12 Vault 지식 그래프 read model 분리

33차 구현에서 남긴 `/vault/zettels/graph` full snapshot 의존을 그래프 전용 read model로 줄였다.

### 완료한 것

- `VaultZettelGraphNode` 타입을 추가했다.
- `getVaultZettelGraph()`를 추가해 지식 그래프 화면에 필요한 최소 필드만 조회한다.
- graph node는 `id`, `title`, `type`, `category`, `outgoingCount`, `backlinkCount`만 가진다.
- 나가는 연결/들어오는 연결 수는 `zettel_links` 기준 subquery로 계산한다.
- `/vault/zettels/graph`는 `getVaultSnapshot()` 대신 `getVaultZettelGraph()`를 사용한다.
- ContextBundle 미니맵은 그래프 노드 상위 9개의 id만 넘겨 기존 `getContextBundle()` 흐름을 유지한다.

### 판단

- 그래프 페이지는 media/assets/places는 물론 zettel content, tags, source document properties까지 필요하지 않았다.
- 직접 링크 상태 패널도 전체 link 배열이 아니라 count만 보여주므로 count read model이 더 맞다.
- ContextBundle은 별도 관계 read model을 이미 갖고 있으므로 graph node query와 분리해 두는 편이 책임이 선명하다.
- 이 작업으로 `/vault/zettels/graph`는 full vault snapshot 소비처에서 빠졌다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: `/vault/zettels/graph` 페이지의 `getVaultSnapshot()` 직접 참조 제거
- 브라우저 확인: `/vault/zettels/graph`에서 `지식 그래프`, `문서별 맥락 미니맵`, `직접 링크 상태` 렌더링
- 브라우저 확인: `나가는 연결`, `들어오는 연결` count 렌더링
- 브라우저 확인: loading 문구와 bootstrap error 미노출
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- Vault 내부 주요 화면의 full snapshot 의존은 지식/미디어/자산/장소 목록/상세/그래프 기준으로 대부분 줄었다.
- 다음 작업은 전역 검색과 context/AI 서버 함수처럼 앱 전체 도메인을 묶어 읽는 곳에서 full snapshot을 계속 쓸지, 검색 전용/AI 전용 read model로 분리할지 판단하는 것이다.

## 35. 2026-05-12 전역 검색 read model 분리

34차 구현에서 남긴 "전역 검색의 full snapshot 의존"을 검색 전용 read model로 분리했다.

### 완료한 것

- `/api/search`에서 `getActionHubSnapshot()`, `getPRMSnapshot()`, `getVaultSnapshot()` 의존을 제거했다.
- `getSearchReadModelItems()`를 추가해 검색 결과에 필요한 `type`, `id`, `title`, `snippet`, `href`, `score`만 직접 조회하게 했다.
- read model은 task, person, zettel, media, place, tag를 지원한다.
- FTS가 없거나 빈 검색어일 때 전체 snapshot fallback 대신 read model fallback을 사용한다.
- FTS가 0개를 반환하는 경우에도 read model로 보강해 실제 데이터가 있는데 검색 결과가 비는 경계를 막았다.
- 장소는 FTS 테이블이 없으므로 FTS 성공 경로에서도 place read model을 보조로 병합한다.
- `/dev/search-read-model-smoke-test`를 추가해 브라우저에서 read model 결과를 HTML로 확인할 수 있게 했다.

### 판단

- 검색 결과는 전체 도메인 객체가 아니라 작은 결과 행만 필요하다.
- 기존 fallback은 task/person/vault 전체 snapshot을 만들었기 때문에 검색 실패 경로일수록 오히려 무거워졌다.
- FTS는 빠르지만 인덱스가 비어 있거나 일부 도메인이 빠질 수 있으므로, read model fallback은 성능뿐 아니라 검색 신뢰도에도 필요하다.
- Command Palette는 사용자가 바로 체감하는 표면이므로 FTS 0건 시 read model 보강까지 같은 작업에서 닫았다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: `/api/search`와 `server/search.ts`에서 `getActionHubSnapshot`, `getPRMSnapshot`, `getVaultSnapshot` 참조 없음
- 브라우저 확인: `/dev/search-read-model-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: read model이 `미션` media 결과 6개, 빈 검색 ranked suggestion 20개를 반환
- 브라우저 확인: Command Palette에서 `미션` 입력 시 `미션 임파서블` 결과 렌더링
- 브라우저 확인: Command Palette 검색 중 empty state 미노출, console error 없음

### 다음에 남은 것

- 다음 작업은 context 검색/관계 검색 쪽의 full snapshot 의존을 같은 방식으로 줄이는 것이다.
- 그 다음은 AI 서버 함수가 사용하는 Vault/PRM/ActionHub snapshot을 프롬프트 전용 read model로 분리할지 판단한다.

## 36. 2026-05-12 Context 검색 read model 보강

35차 구현에서 만든 검색 read model을 `/api/context/search` 경로에도 연결했다.

### 완료한 것

- `searchContextNodes()`가 FTS 결과만으로 빈 결과를 확정하지 않고 `getSearchReadModelItems()`로 fallback하도록 변경했다.
- context 검색 대상 타입은 `person`, `task`, `zettel`, `media`, `place`, `tag`로 정리했다.
- FTS가 결과를 반환하는 경우에도 장소처럼 FTS 범위 밖인 타입은 read model 보강 결과를 병합한다.
- semantic zettel 결과, FTS 결과, read model 결과는 `type:id` 기준으로 중복 제거 후 score 순으로 정렬한다.
- `/dev/context-search-smoke-test`를 추가해 브라우저에서 관계 검색 read model 경로를 HTML로 확인할 수 있게 했다.

### 판단

- 관계/맥락 검색은 전체 context bundle이 아니라 연결 후보 목록만 필요하다.
- FTS가 비어 있거나 일부 타입 인덱스가 빠진 경우에도 사용자는 빠른 연결 UI에서 결과를 기대한다.
- 전역 검색과 같은 read model을 재사용하면 검색 규칙과 ranking이 흩어지지 않는다.
- `getContextBundle()` 자체는 아직 상세 맥락 그래프 생성 책임이 있어 별도 작업으로 남긴다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/context-search-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: context media 검색 `미션` 결과 6개 반환
- 브라우저 확인: context person 검색 `양주영` 결과와 생일 기반 subtitle 반환
- 브라우저 확인: 작업 상세 `맥락` 탭의 빠른 연결 검색에서 `양주영` 결과 1건 렌더링
- 브라우저 확인: Command Palette에서 `양주영` 결과 렌더링, empty state 미노출, console error 없음

### 다음에 남은 것

- 다음 작업은 `getContextBundle()`이 아직 사용하는 `baseIndexes()`의 full snapshot 의존을 상세 화면별 read model로 나눌지 판단하는 것이다.
- 우선순위는 작업/인물/지식 상세의 ContextBundle 경로다. 사용자가 자주 여는 상세 화면이므로 snapshot 비용을 줄이면 체감 속도 개선 가능성이 가장 크다.

## 37. 2026-05-12 ContextBundle 상세 read model seed 분리

36차 구현에서 남긴 `getContextBundle()`의 full snapshot 의존 중 사용 빈도가 높은 작업/인물/지식 상세 경로를 먼저 분리했다.

### 완료한 것

- `getContextBundle()` 진입 시 `task`, `person`, `zettel`은 전용 read model seed를 먼저 생성하도록 했다.
- 세 타입이 read model seed로 처리되는 경우 `baseIndexes()`를 호출하지 않는다.
- 작업 seed는 작업 focus, 프로젝트 parent, due date anchor만 직접 조회한다.
- 인물 seed는 인물 focus와 daily entry relation만 직접 조회하고, 나머지 관계는 기존 explicit bridge query를 재사용한다.
- 지식 seed는 지식 focus, outgoing link, backlink를 직접 조회한다.
- 기존 fallback의 `task/person/zettel` snapshot branch와 `peopleByName`, `zettelsByTitle` map 생성을 제거했다.
- `/dev/context-bundle-smoke-test`를 추가해 브라우저에서 `task/person/zettel` ContextBundle focus와 node/edge 수를 확인할 수 있게 했다.

### 판단

- 작업/인물/지식 상세는 사용자가 가장 자주 여는 context 표면이므로, 전체 ActionHub/PRM/Vault/LifeOps snapshot을 매번 만드는 비용을 먼저 줄이는 것이 효율적이다.
- 관계 노드는 이미 `getExplicitBridgeRows()`가 도메인별 직접 쿼리로 수집하므로, seed는 focus와 보조 anchor 정도만 책임지는 편이 중복을 줄인다.
- media/place/workout/gift/career/daily_log는 아직 기존 fallback을 유지했다. 변경 범위를 한 번에 넓히면 세부 화면 회귀 가능성이 커지기 때문이다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/context-bundle-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: task/person/zettel ContextBundle이 각각 요청한 focus를 반환
- 브라우저 확인: 작업 상세 `/action-hub/.../tasks/01KR10TXXA5KM4BAW8HZ1778C6`에서 맥락 영역 렌더링, canonical missing 미노출
- 브라우저 확인: 인물 상세 `/prm/per_f5dde5a775ec63512eaab273ca`에서 관계/맥락 영역 렌더링, canonical missing 미노출
- 브라우저 확인: 지식 상세 `/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f`에서 관계/맥락 영역 렌더링, canonical missing 미노출
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 media/place 상세의 ContextBundle seed를 같은 방식으로 직접 조회로 분리하는 것이다.
- 그 다음은 workout/career/daily_log처럼 LifeOps 쪽 context seed를 `getLifeOpsSnapshot()` 대신 날짜/단건 read model로 나눌지 판단한다.

## 38. 2026-05-12 Media/Place ContextBundle seed 분리

37차 구현에서 남긴 media/place 상세의 ContextBundle seed도 direct read model로 분리했다.

### 완료한 것

- `getMediaContextSeed()`를 추가해 media focus를 `media_logs` 단건 조회로 만든다.
- `getPlaceContextSeed()`를 추가해 place focus를 `places` 단건 조회로 만든다.
- media/place도 `getContextReadModelSeed()` 대상에 포함했다.
- 기존 `getContextBundle()` fallback의 media/place branch를 제거했다.
- `baseIndexes()`에서 `getVaultSnapshot()` 호출을 제거했다.
- `/dev/context-bundle-smoke-test`가 media bundle focus까지 확인하도록 확장했다.
- place 후보가 없는 데이터셋에서는 missing bundle 안전성을 확인하도록 smoke를 보강했다.

### 판단

- media/place ContextBundle은 focus만 필요하고 관계 노드는 이미 explicit bridge query가 직접 수집한다.
- 따라서 전체 Vault snapshot을 만들 이유가 없어졌다.
- place는 현재 검증 데이터에서 후보가 없으므로, 실제 상세 대신 no-candidate/missing-safe 경로를 smoke에 포함했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: `context.ts`에서 `getVaultSnapshot`, `indexes.vault` 직접 참조 없음
- 브라우저 확인: `/dev/context-bundle-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: media ContextBundle focus가 `미션 임파서블: 로그네이션`으로 반환
- 브라우저 확인: place 후보 없음 상태에서도 missing bundle safe check 통과
- 브라우저 확인: `/vault/media/med_ff114faa66c4e2e7701fd3963c` 상세 렌더링, canonical missing 미노출
- 브라우저 확인: `/vault/places?view=all` 빈 상태 렌더링, canonical missing 미노출
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 `workout`, `career`, `daily_log` ContextBundle seed를 LifeOps snapshot 대신 직접 조회로 분리하는 것이다.
- 이 작업이 끝나면 `baseIndexes()`는 주로 `project`와 `gift` fallback에만 남으므로, 이후에는 fallback 자체를 타입별 direct loader로 해체할 수 있다.

## 39. 2026-05-12 LifeOps ContextBundle seed 분리

38차 구현에서 남긴 `workout`, `career`, `daily_log` ContextBundle seed를 direct read model로 분리했다.

### 완료한 것

- `getWorkoutContextSeed()`를 추가해 workout focus와 daily anchor를 직접 조회한다.
- `getCareerContextSeed()`를 추가해 career focus를 `career_history` 단건 조회로 만든다.
- `getDailyLogContextSeed()`를 추가해 daily_log focus와 timeline preview를 직접 조회한다.
- daily_log DB row가 없어도 날짜 id 기준 fallback focus를 만들도록 유지했다.
- `getContextReadModelSeed()`에 `workout`, `career`, `daily_log`를 포함했다.
- 기존 fallback의 LifeOps snapshot branch를 제거했다.
- `baseIndexes()`에서 `getLifeOpsSnapshot()` 호출을 제거했다.
- `/dev/context-bundle-smoke-test`가 workout/career/daily_log ContextBundle focus를 확인하도록 확장했다.

### 판단

- workout/career/daily_log 상세의 ContextBundle은 LifeOps 전체 snapshot이 아니라 단건 focus와 소량의 anchor/timeline만 필요하다.
- daily_log는 사용자가 날짜 URL로 직접 들어올 수 있으므로, DB row가 없어도 빈 focus를 안전하게 반환하는 편이 기존 동작과 맞다.
- 이 작업으로 ContextBundle의 Vault/LifeOps full snapshot 의존은 제거되었고, 남은 fallback은 주로 project/gift 쪽 ActionHub/PRM snapshot이다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: `context.ts`에서 `getLifeOpsSnapshot`, `indexes.lifeOps` 직접 참조 없음
- 브라우저 확인: `/dev/context-bundle-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: workout/career/daily_log ContextBundle이 각각 요청한 focus를 반환
- 브라우저 확인: `/life-ops/workouts/wko_2bda0d033dc6f5cbc30409a522` 상세 렌더링, canonical missing 미노출
- 브라우저 확인: `/life-ops/career/car_efab596486062e98273e0e6d3f` 상세 렌더링, canonical missing 미노출
- 브라우저 확인: `/life-ops/2026-04-23` 상세 렌더링, canonical missing 미노출
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 `project`와 `gift` ContextBundle fallback을 직접 조회로 분리하는 것이다.
- 그 작업까지 끝나면 `baseIndexes()`와 `getActionHubSnapshot()`/`getPRMSnapshot()` 의존을 ContextBundle에서 완전히 제거할 수 있다.

## 40. 2026-05-13 ContextBundle baseIndexes 제거

39차 구현에서 마지막으로 남은 `project`, `gift` ContextBundle fallback도 direct read model seed로 분리했다.

### 완료한 것

- `getProjectContextSeed()`를 추가해 project focus와 하위 task anchor를 직접 조회한다.
- `getGiftContextSeed()`를 추가해 gift focus와 연결된 person anchor를 직접 조회한다.
- `getContextReadModelSeed()`에 `project`, `gift`를 포함했다.
- `getContextBundle()`에서 `baseIndexes()` fallback을 제거했다.
- `context.ts`에서 `getActionHubSnapshot()`과 `getPRMSnapshot()` import를 제거했다.
- `/dev/context-bundle-smoke-test`가 project/gift 후보와 missing-safe 경로를 함께 확인하도록 확장했다.

### 판단

- project ContextBundle은 프로젝트 단건과 관련 task만 있으면 맥락 rail을 구성할 수 있다.
- gift ContextBundle은 현재 검증 데이터에 후보가 없지만, 코드 경로는 gift 단건과 person join만 조회하도록 준비했다.
- 이 작업으로 ContextBundle 경로에서는 ActionHub/PRM/Vault/LifeOps full snapshot 의존이 제거되었다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: `context.ts`에서 `baseIndexes`, `getActionHubSnapshot`, `getPRMSnapshot`, `getVaultSnapshot`, `getLifeOpsSnapshot`, `indexes.` 직접 참조 없음
- 브라우저 확인: `/dev/context-bundle-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: project ContextBundle focus가 `트라우마 수리공방 Re:building`으로 반환
- 브라우저 확인: gift 후보 없음 상태에서도 missing bundle safe check 통과
- 브라우저 확인: `/action-hub/prj_ad8c23fedf8277ce57055018c5` 상세 렌더링, 맥락 rail 연결 1개 표시, canonical missing 미노출
- 브라우저 확인: `/prm/gifts` 선물 보드 빈 상태 렌더링, canonical missing 미노출
- 서버 로그 확인: 현재 smoke/project/gift board 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 AI 서버 함수와 도메인 bootstrap/API route 쪽에서 아직 snapshot 단위로 읽는 경로를 read model/command 단위로 더 나누는 것이다.
- 우선순위는 사용자 체감이 큰 ActionHub/PRM/LifeOps mutation route의 응답 payload 축소와 prompt 입력용 snapshot 분리다.

## 41. 2026-05-14 AI 요약 prompt read model 분리

40차 구현에서 남긴 다음 우선순위 중 AI 요약 입력 경로를 먼저 분리했다.

### 완료한 것

- `buildAISummarySourceMaterial()`을 추가해 Gemini 호출 전 source material 생성 단계를 분리했다.
- daily/weekly/project 요약 source material에서 `getActionHubSnapshot()`, `getPRMSnapshot()`, `getVaultSnapshot()` 직접 호출을 제거했다.
- daily 요약은 active task count, overdue person count, recent zettel list만 직접 조회한다.
- weekly 요약은 7일 LifeOps log, completed task count, zettel count, overdue people list만 직접 조회한다.
- project 요약은 project 단건과 해당 project task list만 직접 조회한다.
- 기본 요약 날짜를 UTC `toISOString()` 기준에서 `Asia/Seoul` 기준으로 수정했다.
- `/dev/ai-summary-read-model-smoke-test`를 추가해 Gemini를 호출하지 않고 AI 요약 source material만 브라우저에서 검증할 수 있게 했다.

### 판단

- AI 요약 prompt에는 전체 ActionHub/PRM/Vault snapshot이 필요하지 않다.
- 요약에 실제로 쓰는 값만 직접 조회하면 prompt 입력 크기와 서버 조회량을 함께 줄일 수 있다.
- 한국 시간 오전에는 UTC 날짜가 전날로 밀리므로, daily/weekly 기본 날짜는 반드시 `Asia/Seoul` 기준이어야 한다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 코드 확인: `ai.ts`에서 `getActionHubSnapshot`, `getPRMSnapshot`, `getVaultSnapshot` 직접 참조 없음
- 브라우저 확인: `/dev/ai-summary-read-model-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: daily/weekly source material 기본 날짜가 `2026-05-14`로 반환
- 브라우저 확인: project source material이 `prj_ad8c23fedf8277ce57055018c5` 후보로 생성됨
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 ActionHub mutation route의 full snapshot 응답을 delta/affected read model 응답으로 줄이는 것이다.
- 우선 `tasks/[taskId]/title`, `content`, `properties`, `cycle-status`, `checklists`처럼 상세 화면에서 자주 발생하는 command부터 처리하는 편이 좋다.

## 42. 2026-05-14 ActionHub task command delta 응답 분리

41차 구현에서 남긴 ActionHub mutation 응답 축소 중 task command 경로를 먼저 분리했다.

### 완료한 것

- `ActionHubTaskMutationDelta`를 추가해 task command가 전체 `ActionHubSnapshot` 대신 `{ task, project }` delta를 반환하도록 했다.
- task 단건 read model을 추가해 task, checklist, linked people, linked zettel, project progress를 직접 조회한다.
- `tasks/[taskId]/title`, `content`, `properties`, `cycle-status`, `checklists` route가 `{ delta }`를 반환하도록 바꿨다.
- `checklists/[checklistId]/toggle`, `delete` route도 `{ delta }`를 반환하도록 바꿨다.
- ActionHub store에 `applyTaskDelta()`를 추가해 task/project만 병합하도록 했다.
- `postDeltaMutation()` client helper를 추가했다.
- task workspace, task drawer, kanban status move가 full snapshot replace 대신 delta apply를 사용한다.
- `/dev/action-hub-task-delta-smoke-test`를 추가해 disposable project/task로 command delta 흐름을 브라우저에서 검증할 수 있게 했다.

### 판단

- task 상세와 kanban에서 자주 발생하는 status/property/checklist command는 전체 ActionHub snapshot을 다시 받을 필요가 없다.
- project progress만 함께 갱신하면 task command 후 보드와 상세 화면의 핵심 상태는 유지된다.
- 사람/지식 attach/detach는 reference list와 context refresh까지 얽혀 있으므로 이번 차수에서는 기존 snapshot 응답을 유지했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 확인: `/dev/action-hub-task-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: title/status/properties/checklist create/toggle/delete delta check 전부 통과
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 ActionHub의 사람/지식 attach/detach, inbox routing, capture accept/dismiss 응답을 같은 delta 패턴으로 줄이는 것이다.
- 그 다음 PRM/LifeOps mutation route도 같은 방식으로 domain별 affected read model 응답을 만들 수 있다.

## 43. 2026-05-14 ActionHub relation/inbox command delta 확장

42차 구현에서 남긴 ActionHub task command delta 패턴을 사람/지식 연결과 inbox routing까지 확장했다.

### 완료한 것

- `attachTaskPerson()` / `detachTaskPerson()`이 전체 `ActionHubSnapshot` 대신 `ActionHubTaskMutationDelta`를 반환하도록 했다.
- `attachTaskZettel()` / `detachTaskZettel()`도 같은 delta 반환으로 바꿨다.
- `routeInboxTaskToProject()`가 routed task와 target project delta만 반환하도록 했다.
- `tasks/[taskId]/people`, `tasks/[taskId]/zettels`, `tasks/[taskId]/route` API route가 `{ delta }`를 반환하도록 바꿨다.
- Task Workspace의 사람/지식 연결 UI가 `postDeltaMutation()`과 `applyTaskDelta()`를 사용하도록 바꿨다.
- Inbox의 미분류 task routing도 전체 snapshot replace 대신 task/project delta 병합을 사용하도록 바꿨다.
- `/dev/action-hub-task-delta-smoke-test`를 확장해 disposable person/zettel/inbox task까지 생성하고 즉시 정리하도록 했다.

### 판단

- 관계 attach/detach는 기존 reference list를 바꾸지 않고 task의 linkedPeople/linkedZettels만 바꾸므로 task delta로 충분하다.
- inbox routing은 task.projectId와 target project progress만 바뀌므로 task/project delta로 충분하다.
- capture accept/dismiss는 pending capture list 제거와 새 task/zettel 생성이 섞여 있어 별도 `captureDelta` 또는 domain-level delta가 필요하다. 그래서 다음 차수로 분리한다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 확인: `/dev/action-hub-task-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: person attach/detach, zettel attach/detach, inbox route delta check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 ActionHub capture accept/dismiss를 pending capture delta와 created entity delta로 분리하는 것이다.
- 그 다음에는 PRM mutation route의 gift/interaction/person profile 응답을 `PRMMutationDelta`로 줄이는 순서가 좋다.

## 44. 2026-05-14 ActionHub capture command delta 분리

43차 구현에서 남긴 ActionHub capture accept/dismiss 응답을 별도 delta 패턴으로 분리했다.

### 완료한 것

- `ActionHubCaptureMutationDelta`를 추가해 capture command가 전체 `ActionHubSnapshot` 대신 affected entity만 반환하도록 했다.
- `dismissPendingCapture()`가 pending capture 제거 delta만 반환하도록 했다.
- `acceptPendingCapture()`가 task capture일 때 created task와 project delta를 반환하도록 했다.
- `acceptPendingCapture()`가 zettel capture일 때 created reference zettel delta를 반환하도록 했다.
- `captures/[captureId]/accept`, `dismiss` API route가 `{ delta }`를 반환하도록 바꿨다.
- ActionHub store에 `ActionHubCaptureDelta`와 `applyCaptureDelta()`를 추가했다.
- Inbox capture accept/dismiss UI가 full snapshot replace 대신 `postDeltaMutation()`과 `applyCaptureDelta()`를 사용하도록 바꿨다.
- `/dev/action-hub-task-delta-smoke-test`를 확장해 disposable quick capture dismiss/task accept/zettel accept를 함께 검증하도록 했다.

### 판단

- dismiss는 pending capture list에서 해당 항목만 제거하면 되므로 전체 ActionHub snapshot 재조회가 필요하지 않다.
- task accept는 새 task와 관련 project progress만 있으면 현재 Inbox/ActionHub 상태를 갱신할 수 있다.
- zettel accept는 ActionHub reference list에 노출되는 최소 zettel 정보만 있으면 충분하다.
- quick capture 생성 route는 modal navigation, offline queue, domain routing이 더 얽혀 있어 다음 별도 차수에서 다루는 편이 안전하다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/action-hub-task-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: capture dismiss, capture task accept, capture zettel accept delta check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 ActionHub quick capture 생성 route의 응답/클라이언트 반영을 command delta로 줄이는 것이다.
- 그 다음에는 PRM mutation route의 gift/interaction/person profile 응답을 `PRMMutationDelta`로 줄이는 순서가 좋다.

## 45. 2026-05-14 ActionHub quick capture 생성 delta 분리

44차 구현에서 남긴 quick capture 생성 route도 full snapshot 응답에서 command delta 응답으로 분리했다.

### 완료한 것

- `ingestActionHubCapture()`가 더 이상 `ActionHubSnapshot`을 반환하지 않고 `ActionHubCaptureMutationDelta`를 반환하도록 바꿨다.
- task로 즉시 라우팅되는 quick capture는 created task와 project delta를 반환하도록 했다.
- 검토가 필요한 quick capture는 새 pending capture delta를 반환하도록 했다.
- 사용자가 저장 위치를 `task`로 직접 지정한 경우 AI의 auto-route 판단보다 사용자 지정을 우선해 task로 생성되도록 했다.
- `/api/action-hub/capture`와 `/api/capture` 응답에서 `snapshot`을 제거하고 `delta`를 반환하도록 했다.
- Quick Capture modal이 `postSnapshotMutation()` / `replaceSnapshot()` 대신 `postDeltaMutation()` / `applyCaptureDelta()`를 사용하도록 바꿨다.
- ActionHub store의 `ActionHubCaptureDelta`와 `applyCaptureDelta()`가 pending capture 추가와 제거를 모두 처리하도록 확장했다.
- `/dev/action-hub-task-delta-smoke-test`를 확장해 quick capture task ingest, pending ingest, snapshot omission을 함께 검증하도록 했다.

### 판단

- quick capture 생성은 두 갈래다. 즉시 task로 라우팅되면 task/project만 갱신하면 되고, 검토 대기면 pending capture 하나만 추가하면 된다.
- 따라서 생성 시에도 전체 ActionHub snapshot 재조회가 필요하지 않다.
- offline queue flush는 현재 사용자 화면 상태를 직접 갱신하지 않고 서버 동기화 성공 여부만 확인하므로, response shape 변경의 영향이 작다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/action-hub-task-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 25개 check 통과
- 브라우저 확인: quick capture task ingest, pending ingest, snapshot omission check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 PRM mutation route의 gift/interaction/person profile 응답을 `PRMMutationDelta`로 줄이는 것이다.
- ActionHub 내부에는 아직 project properties/create처럼 snapshot 응답이 일부 남아 있으나, 사용자 빈도가 높은 task/capture 흐름은 먼저 닫혔다.

## 46. 2026-05-14 PRM person/gift/interaction command delta 분리

45차 구현 다음 우선순위였던 PRM mutation route 중 사용자 빈도가 높은 person/gift/interaction 경로를 delta 응답으로 분리했다.

### 완료한 것

- `PRMMutationDelta`를 추가해 PRM command가 전체 `PRMSnapshot` 대신 affected person/gift/delete id만 반환하도록 했다.
- PRM person 단건 read model을 추가해 person profile, timeline, source document, count 값을 직접 조회하도록 했다.
- `markPersonContacted()`, `togglePersonFavorite()`, `updatePersonProfile()`이 person delta를 반환하도록 했다.
- `createPersonInteraction()`과 `deleteInteraction()`이 person delta와 deleted interaction id를 반환하도록 했다.
- `createGift()`와 `deleteGift()`가 gift/person delta 또는 deleted gift id를 반환하도록 했다.
- `people/[personId]/contact`, `favorite`, `profile`, `interactions`, `gifts`, `interactions/[interactionId]/delete`, `gifts/[giftId]/delete` API route가 `{ delta }`를 반환하도록 바꿨다.
- PRM store에 `applyMutationDelta()`를 추가해 person과 gift list를 부분 병합/삭제하도록 했다.
- Person Drawer, Person Properties Panel, Hit Them Up, Gifts Board가 `postDeltaMutation()`과 `applyMutationDelta()`를 사용하도록 바꿨다.
- `/dev/prm-mutation-delta-smoke-test`를 추가해 disposable person으로 profile/contact/favorite/interaction/gift delta 흐름을 검증하도록 했다.

### 판단

- PRM의 사람 상세, 연락 필요, 선물 보드는 대부분 한 사람 또는 한 선물만 바뀐다.
- 연락 완료, 즐겨찾기, 프로필 저장, 상호작용 기록, 선물 기록/삭제는 전체 PRM snapshot을 다시 받을 필요가 없다.
- network edge 생성/삭제는 그래프 전용 화면 상태와 함께 다루는 편이 안전하므로 다음 차수로 남겼다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/prm-mutation-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 19개 check 통과
- 브라우저 확인: profile/contact/favorite/interaction/gift delta와 snapshot omission check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 PRM network edge create/delete를 `PRMMutationDelta`에 포함해 그래프 화면 snapshot 응답을 줄이는 것이다.
- 이후 LifeOps habit/workout/career/daily mutation route도 같은 affected read model 패턴으로 옮기는 순서가 좋다.

## 47. 2026-05-14 PRM network edge command delta 확장

46차 구현에서 남긴 PRM graph 관계선 생성/삭제도 `PRMMutationDelta` 흐름으로 확장했다.

### 완료한 것

- `PRMMutationDelta`에 `networkEdge`, `deletedNetworkEdgeId`를 추가했다.
- `createNetworkEdge()`가 전체 `PRMSnapshot` 대신 created network edge delta를 반환하도록 했다.
- `deleteNetworkEdge()`가 deleted network edge id delta를 반환하도록 했다.
- `network-edges`, `network-edges/[edgeId]/delete` API route가 `{ delta }`를 반환하도록 바꿨다.
- PRM store의 `applyMutationDelta()`가 network edge 추가/삭제를 처리하도록 확장했다.
- PRM graph client가 `postSnapshotMutation()` / `replaceSnapshot()` 대신 `postDeltaMutation()` / `applyMutationDelta()`를 사용하도록 바꿨다.
- `/dev/prm-mutation-delta-smoke-test`를 확장해 disposable second person과 network edge create/delete를 함께 검증하도록 했다.

### 판단

- 관계선 생성/삭제는 people/gifts와 독립적인 graph edge 배열만 바꾸므로 edge delta만으로 충분하다.
- 이 작업으로 PRM의 주요 사용자 mutation route는 bootstrap/hydration을 제외하고 snapshot 응답에서 벗어났다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/prm-mutation-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 23개 check 통과
- 브라우저 확인: network edge create/delete delta와 snapshot omission check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 LifeOps habit/workout/career/daily mutation route를 affected read model delta로 줄이는 것이다.
- LifeOps는 화면별 상태가 넓으므로 habit/workout/career처럼 독립 collection부터 시작하고, daily log는 마지막에 별도 delta로 다루는 순서가 좋다.

## 48. 2026-05-14 LifeOps habit/workout/career command delta 분리

47차 구현에서 추천한 LifeOps mutation route 중 독립 collection 성격이 강한 habit/workout/career부터 delta 응답으로 분리했다.

### 완료한 것

- `LifeOpsMutationDelta`를 추가해 habit/workout/career command가 전체 `LifeOpsSnapshot` 대신 affected item 또는 deleted id만 반환하도록 했다.
- habit/workout/career row mapper를 분리하고, mutation 직후 필요한 단건 read model만 다시 조회하도록 했다.
- `createLifeOpsHabit()`, `updateLifeOpsHabitProperties()`, `toggleHabitActive()`가 habit delta를 반환하도록 했다.
- `createWorkout()`, `updateWorkoutProperties()`, `deleteWorkout()`이 workout delta 또는 deleted workout id를 반환하도록 했다.
- `createCareerEntry()`, `updateCareerEntryProperties()`, `deleteCareerEntry()`이 career entry delta 또는 deleted career id를 반환하도록 했다.
- LifeOps habit/workout/career API route가 `{ snapshot }` 대신 `{ delta }`를 반환하도록 바꿨다.
- LifeOps store에 `applyMutationDelta()`를 추가해 habits/workouts/career 배열을 부분 병합/삭제하도록 했다.
- Habits, Workouts, Career 화면과 속성 패널이 `postDeltaMutation()`과 `applyMutationDelta()`를 사용하도록 바꿨다.
- `/dev/life-ops-mutation-delta-smoke-test`를 추가해 disposable habit/workout/career create/update/toggle/delete와 snapshot omission을 검증하도록 했다.

### 판단

- habit/workout/career는 각 화면의 독립 배열만 바꾸므로 전체 LifeOps snapshot 재조회가 필요하지 않다.
- workout/career는 정렬 기준이 중요하므로 store delta 적용 시 date/startDate 기준으로 다시 정렬한다.
- daily log와 health metric은 `logs`, habit state, entries, timeline, metrics가 한 날짜 안에서 서로 얽혀 있어 별도 `DailyLogMutationDelta`로 분리하는 편이 안전하다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/life-ops-mutation-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 21개 check 통과
- 브라우저 확인: habit/workout/career create/update/toggle/delete delta와 snapshot omission check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 LifeOps daily log와 health metric mutation route를 `DailyLogMutationDelta` 또는 LifeOps 날짜 단위 delta로 줄이는 것이다.
- daily 쪽은 entries/habit logs/metrics/timeline이 함께 움직이므로, 우선 날짜 단위 log delta를 설계한 뒤 daily 화면부터 적용하는 순서가 좋다.

## 49. 2026-05-14 LifeOps daily/health command delta 분리

48차 구현에서 남긴 LifeOps daily log와 health metric mutation route도 날짜 단위 delta 응답으로 분리했다.

### 완료한 것

- `LifeOpsMutationDelta`에 `dailyLog`, `healthMetrics`를 추가했다.
- daily log read model 생성을 `getDailyLogReadModel()`로 분리해 날짜 하나만 다시 읽을 수 있게 했다.
- health metric 목록 생성을 `getHealthMetricsReadModel()`로 분리했다.
- `updateLifeOpsMood()`, `updateLifeOpsEnergy()`, `updateLifeOpsDailyProperties()`, `toggleLifeOpsHabit()`, `updateLifeOpsJournalField()`, `updateDailyEntry()`, `upsertHealthMetric()`이 전체 `LifeOpsSnapshot` 대신 날짜 단위 delta를 반환하도록 했다.
- daily/health API route가 `{ snapshot }` 대신 `{ delta }`를 반환하도록 바꿨다.
- LifeOps store의 `applyMutationDelta()`가 `logs[date]`와 `healthMetrics`를 부분 갱신하도록 확장했다.
- Daily Log 화면과 Daily Log Properties Panel이 `postDeltaMutation()` / `applyMutationDelta()`를 사용하도록 바꿨다.
- `/dev/life-ops-mutation-delta-smoke-test`를 확장해 disposable daily log, health metric, habit log, daily entry update까지 검증하도록 했다.

### 판단

- daily mutation은 하나의 날짜 화면만 갱신하면 되므로 전체 LifeOps snapshot을 다시 받을 필요가 없다.
- 다만 daily log 화면의 수면 그래프와 health metric route가 같은 데이터 흐름을 쓰므로 `dailyLog`와 `healthMetrics`를 함께 반환한다.
- 이 작업으로 LifeOps의 주요 사용자 mutation route는 bootstrap/hydration을 제외하고 snapshot 응답에서 벗어났다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/life-ops-mutation-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 40개 check 통과
- 브라우저 확인: mood/energy/properties/habit toggle/journal field/health metric/daily entry delta와 snapshot omission check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 ActionHub project create/properties처럼 아직 남아 있는 낮은 빈도의 snapshot mutation route를 domain별 delta로 줄이는 것이다.
- 또는 Vault/ActionHub/PRM/LifeOps의 남은 bootstrap/hydration payload를 화면별 read model로 더 쪼개는 작업으로 넘어갈 수 있다.

## 50. 2026-05-14 ActionHub project command delta 분리

49차 구현 다음 남은 낮은 빈도 mutation 중 ActionHub project create/properties route를 project delta 응답으로 분리했다.

### 완료한 것

- `ActionHubProjectMutationDelta`를 추가해 project command가 전체 `ActionHubSnapshot` 대신 affected project만 반환하도록 했다.
- `getActionHubProjectMutationDelta()`를 추가해 mutation 직후 project 단건 read model만 다시 조회하도록 했다.
- `createActionHubProject()`와 `updateActionHubProjectProperties()`가 project delta를 반환하도록 했다.
- `projects`, `projects/[projectId]/properties` API route가 `{ snapshot }` 대신 `{ delta }`를 반환하도록 바꿨다.
- ActionHub store에 `ActionHubProjectDelta`와 `applyProjectDelta()`를 추가해 projects 배열을 부분 병합하도록 했다.
- ActionHub home의 project 생성 UI와 Project Properties Panel이 `postDeltaMutation()` / `applyProjectDelta()`를 사용하도록 바꿨다.
- `/dev/action-hub-task-delta-smoke-test`를 확장해 disposable project create/properties delta와 snapshot omission을 함께 검증하도록 했다.

### 판단

- project 생성/속성 저장은 tasks, pending captures, reference lists를 바꾸지 않으므로 project delta 하나로 충분하다.
- 기존 task delta가 project progress 변경을 이미 포함하고 있으므로, 이번 project delta는 project 자체 속성 변경 전용으로 유지한다.
- 이 작업으로 ActionHub의 주요 사용자 mutation route 중 task/capture/project 흐름은 snapshot 응답에서 벗어났다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/action-hub-task-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 31개 check 통과
- 브라우저 확인: project create/properties delta와 snapshot omission check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 PRM/LifeOps/ActionHub에서 남은 bootstrap/hydration payload를 화면별 read model로 쪼갤지 점검하는 것이다.
- 별도 mutation 기준으로는 검색 결과에서 남은 snapshot 응답 route를 한 번 더 훑고, 사용자 빈도가 높은 경로부터 작은 delta로 정리하는 순서가 좋다.

## 51. 2026-05-14 ActionHub project/task read model 분리

50차 구현 후 남은 snapshot 의존을 다시 스캔했고, mutation snapshot 응답은 사실상 정리된 상태였다. 이번 차수에서는 ActionHub의 서버 read 경로가 전체 snapshot을 만들어 필요한 항목만 필터링하던 부분을 단건/목록 read model로 분리했다.

### 완료한 것

- `getActionHubProjectReadModel()`을 추가해 project 단건 조회가 전체 `ActionHubSnapshot`을 만들지 않도록 했다.
- `getActionHubTasksReadModel()`을 추가해 project task 목록, task 단건, done task 목록을 직접 조회하도록 했다.
- `getActionHubReferences()`를 추가해 project detail에서 필요한 people/zettel reference만 별도로 가져오도록 했다.
- `getActionHubProject()`, `getActionHubProjectDetail()`, `getActionHubArchive()`, `getActionHubTask()`가 full snapshot 대신 직접 read model을 사용하도록 바꿨다.
- ActionHub project list/calendar page가 `getActionHubSnapshot()`을 호출해 task를 필터링하지 않고 `getActionHubProjectDetail()`의 tasks를 사용하도록 바꿨다.
- `/dev/action-hub-task-delta-smoke-test`를 확장해 project/detail/task/archive read model을 disposable data로 검증하도록 했다.

### 판단

- mutation route는 더 이상 `postSnapshotMutation()`을 쓰지 않고, API의 `{ snapshot }` 응답도 bootstrap/hydration 용도로만 남았다.
- ActionHub project detail/list/calendar/task/archive는 사용자가 자주 여는 서버 페이지라, full snapshot 필터링보다 직접 read model이 더 적합하다.
- ActionHub layout hydration은 전역 store 초기화 용도이므로 이번 차수에서는 유지했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/action-hub-task-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 37개 check 통과
- 브라우저 확인: project/detail/task/archive read model check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 PRM의 `getPRMPerson()`, `getPRMGifts()`, `getPRMNetwork()`처럼 서버 read helper가 `getPRMSnapshot()`을 통해 필터링하는 경로를 직접 read model로 분리하는 것이다.
- 그 다음에는 LifeOps의 `getLifeOpsWorkouts()`, `getLifeOpsCareer()`, `getLifeOpsCareerEntry()`도 같은 방식으로 snapshot 의존을 줄일 수 있다.

## 52. 2026-05-14 PRM read helper snapshot 의존 분리

51차 구현에서 추천한 PRM 서버 read helper의 full snapshot 필터링 경로를 직접 read model로 분리했다.

### 완료한 것

- `getPRMPerson()`이 전체 `PRMSnapshot`을 만들지 않고 person 단건 read model을 직접 조회하도록 했다.
- `getPRMGifts()`, `getPRMGift()`, `getPRMNeedsContact()`가 필요한 gift/person 목록만 직접 조회하도록 했다.
- `getPRMNetwork()`와 `getPRMContextPeople()`를 추가해 graph/context seed 경로가 full PRM snapshot에 기대지 않도록 했다.
- PRM graph page가 `getPRMSnapshot()` 대신 context 대상 person id 목록만 읽도록 바꿨다.
- PRM person edit page가 full PRM hydration 없이 person 단건 read model만으로 열리도록 했다.
- `/dev/prm-mutation-delta-smoke-test`를 확장해 person/gift/network/contact/context read model과 snapshot omission을 함께 검증하도록 했다.

### 판단

- PRM mutation route는 이미 delta 중심으로 정리되어 있었고, 이번 차수에서는 서버 page/helper read 경로의 불필요한 full snapshot 생성을 줄였다.
- `getPRMNeedsContact()`는 hit-them-up 화면의 정렬/요약에 필요한 person summary만 쓰므로 timeline/source document를 생략하는 직접 read model이 적합하다.
- PRM layout hydration과 `/api/prm/bootstrap`은 전역 store 초기화 용도라 이번 차수에서는 유지했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 확인: `/dev/prm-mutation-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 34개 check 통과
- 브라우저 확인: person/gift/network/contact/context read model check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 LifeOps의 `getLifeOpsWorkouts()`, `getLifeOpsCareer()`, `getLifeOpsCareerEntry()`처럼 아직 full snapshot을 통해 필터링하는 서버 read helper를 직접 read model로 분리하는 것이다.
- 이후에는 대시보드와 bootstrap/hydration payload를 화면별 read model로 더 쪼개는 방향이 좋다.

## 53. 2026-05-14 LifeOps read helper snapshot 의존 분리

52차 구현에서 추천한 LifeOps 서버 read helper의 full snapshot 필터링 경로를 직접 read model로 분리했다.

### 완료한 것

- `getLifeOpsLog()`가 날짜 단건 daily log read model을 직접 반환하도록 했다.
- `getLifeOpsWorkouts()`가 전체 `LifeOpsSnapshot` 대신 workout 목록만 직접 조회하도록 했다.
- `getLifeOpsWorkout()`를 추가해 workout 상세 page가 full snapshot에서 workout을 필터링하지 않도록 했다.
- `getLifeOpsCareer()`와 `getLifeOpsCareerEntry()`가 career 목록/단건을 직접 조회하도록 했다.
- LifeOps workout 상세 page가 `getLifeOpsSnapshot()` 대신 `getLifeOpsWorkout()`을 사용하도록 바꿨다.
- `/dev/life-ops-mutation-delta-smoke-test`를 확장해 daily/workout/career read model과 snapshot omission을 함께 검증하도록 했다.

### 판단

- LifeOps mutation route는 이미 날짜/항목 delta 중심으로 정리되어 있었고, 이번 차수에서는 서버 page/helper read 경로의 불필요한 full snapshot 생성을 줄였다.
- workout/career 목록과 상세는 daily log, habits, health metrics를 함께 읽을 이유가 없으므로 독립 read model이 적합하다.
- LifeOps layout hydration과 `/api/life-ops/bootstrap`은 전역 store 초기화 용도라 이번 차수에서는 유지했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 확인: `/dev/life-ops-mutation-delta-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 50개 check 통과
- 브라우저 확인: daily/workout/career read model check 모두 통과
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 dashboard page들이 `getActionHubSnapshot()`, `getPRMSnapshot()`, `getLifeOpsSnapshot()`을 한 번에 읽는 구조를 화면별 dashboard read model로 쪼개는 것이다.
- 이후에는 `/api/*/bootstrap`과 layout hydration payload를 각 도메인의 실제 초기 화면 요구량에 맞게 줄이는 순서가 좋다.

## 54. 2026-05-14 Dashboard read model 분리

53차 구현에서 추천한 dashboard page의 full domain snapshot 의존을 화면별 read model 조합으로 분리했다.

### 완료한 것

- `getActionHubTasks()`를 추가해 dashboard가 project/capture/reference까지 포함한 `ActionHubSnapshot`을 만들지 않고 task 목록만 읽도록 했다.
- `getPRMPeople()`를 추가해 dashboard home이 `PRMSnapshot` 대신 person summary 목록만 읽도록 했다.
- `getPRMPeopleTouchedOn()`를 추가해 yesterday review가 전체 PRM timeline snapshot을 필터링하지 않고 특정 날짜에 닿은 사람만 직접 조회하도록 했다.
- dashboard home이 `getActionHubSnapshot()`, `getPRMSnapshot()`, `getVaultSnapshot()` 대신 task/person/zettel/media read helper를 조합하도록 했다.
- dashboard this-week가 ActionHub/PRM snapshot 대신 task list와 needs-contact read model을 사용하도록 했다.
- dashboard yesterday-review가 ActionHub/PRM snapshot 대신 task list와 touched-people read model을 사용하도록 했다.
- `/dev/dashboard-read-model-smoke-test`를 추가해 dashboard가 쓰는 read model 조합을 독립 검증하도록 했다.

### 판단

- dashboard home은 summary widget에 필요한 목록만 있으면 되므로 각 도메인의 full bootstrap snapshot을 만들 필요가 없다.
- this-week와 yesterday-review는 task/person의 일부 subset만 쓰므로 직접 read model 조합이 더 적합하다.
- Vault는 이미 `getVaultZettelList()`와 `getVaultMediaList()`가 분리되어 있어 이번 차수에서는 해당 helper를 재사용했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/dashboard-read-model-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 12개 check 통과
- 브라우저 확인: `/dashboard`, `/dashboard/this-week`, `/dashboard/yesterday-review` 정상 로드
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 `/api/*/bootstrap`과 도메인 layout hydration payload를 실제 초기 화면 요구량에 맞게 줄이는 것이다.
- 우선순위는 사용자가 자주 여는 ActionHub/PRM/LifeOps layout hydration부터 잡고, 마지막에 Vault처럼 목록이 큰 도메인의 bootstrap payload를 분리하는 순서가 좋다.

## 55. 2026-05-14 ActionHub layout hydration scope 분리

54차 구현에서 추천한 layout hydration payload 축소를 ActionHub부터 시작했다.

### 완료한 것

- `getActionHubHydrationSnapshot(pathname)`을 추가해 ActionHub 경로별 bootstrap payload를 분리했다.
- `/action-hub` home scope는 projects만 내려주고 tasks/captures/references를 비운다.
- `/action-hub/inbox` scope는 projects, inbox tasks, pending captures만 내려준다.
- `/action-hub/[projectId]` scope는 해당 project와 해당 project tasks만 내려준다.
- `/action-hub/[projectId]/tasks/[taskId]` scope는 해당 project/task와 attach reference 목록만 내려준다.
- ActionHub layout이 서버에서 full `getActionHubSnapshot()`을 만들지 않고, `ActionHubHydrator`가 현재 pathname 기반 bootstrap을 호출하도록 바꿨다.
- `/api/action-hub/bootstrap`이 `path` query를 받아 scope별 hydration snapshot을 반환하도록 했다.
- `/dev/action-hub-hydration-smoke-test`를 추가해 home/inbox/project/task scope를 독립 검증하도록 했다.

### 판단

- ActionHub home은 project list만 필요하므로 full tasks/captures/references를 초기 HTML payload에 싣지 않아도 된다.
- task workspace는 relation attach UI 때문에 referencePeople/referenceZettels가 필요하지만, 이 payload는 task path에서만 받도록 분리하는 편이 맞다.
- archive page는 서버 read model로 자체 렌더링하므로 layout store hydration은 빈 snapshot으로 충분하다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/action-hub-hydration-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 9개 check 통과
- 브라우저 확인: `/action-hub`, `/action-hub/inbox`, `/action-hub/prj_ad8c23fedf8277ce57055018c5`, `/action-hub/prj_ad8c23fedf8277ce57055018c5/tasks/01KR10TXXA5KM4BAW8HZ1778C6` 정상 로드
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 PRM layout hydration을 path scope로 분리하는 것이다.
- PRM은 `/prm` home은 people만, `/prm/gifts`는 people+gifts만, `/prm/graph`는 people+networkEdges만 받도록 나누는 순서가 좋다.

## 56. 2026-05-14 PRM layout hydration scope 분리

55차 구현에서 추천한 PRM layout hydration payload 축소를 path scope로 분리했다.

### 완료한 것

- `getPRMHydrationSnapshot(pathAndSearch)`을 추가해 PRM 경로별 bootstrap payload를 분리했다.
- `/prm` home scope는 people만 내려주고 gifts/networkEdges를 비운다.
- `/prm?detail=person:...` scope는 people 목록에 focused person read model을 병합하고 gifts를 함께 내려준다.
- `/prm/gifts` scope는 people+gifts만 내려준다.
- `/prm/graph` scope는 people+networkEdges만 내려준다.
- `/prm/hit-them-up` scope는 연락 필요 people만 내려준다.
- `/prm/[personId]` 및 edit scope는 focused person만 내려준다.
- PRM layout이 서버에서 full `getPRMSnapshot()`을 만들지 않고, `PRMHydrator`가 현재 pathname/search 기반 bootstrap을 호출하도록 바꿨다.
- `/api/prm/bootstrap`이 `path` query를 받아 scope별 hydration snapshot을 반환하도록 했다.
- `/dev/prm-hydration-smoke-test`를 추가해 home/gifts/graph/hit/detail/person scope를 독립 검증하도록 했다.

### 판단

- PRM home/list는 people summary만 필요하므로 full gifts/networkEdges를 초기 payload에 실을 필요가 없다.
- gifts board와 graph는 서로 다른 collection이 필요하므로 path별로 분리하는 편이 맞다.
- home detail query는 PersonDrawer가 gifts를 참조할 수 있으므로 focused person과 gifts를 함께 받도록 보강했다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/prm-hydration-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 13개 check 통과
- 브라우저 확인: `/prm`, `/prm/gifts`, `/prm/graph`, `/prm/hit-them-up` 정상 로드
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 LifeOps layout hydration을 path scope로 분리하는 것이다.
- LifeOps는 `/life-ops` home은 오늘 daily log+habits/metrics 정도, `/life-ops/workouts`는 workouts, `/life-ops/career`는 career, daily date route는 해당 date log만 받도록 나누는 순서가 좋다.

## 57. 2026-05-14 LifeOps layout hydration scope 분리

56차 구현에서 추천한 LifeOps layout hydration payload 축소를 path scope로 분리했다.

### 완료한 것

- `getLifeOpsHydrationSnapshot(pathAndSearch)`을 추가해 LifeOps 경로별 bootstrap payload를 분리했다.
- `/life-ops` home scope는 오늘 daily log와 healthMetrics만 내려주고 habits/workouts/career를 비운다.
- `/life-ops/[date]` scope는 해당 날짜 daily log와 healthMetrics만 내려준다.
- `/life-ops/habits` scope는 habit definitions만 내려준다.
- `/life-ops/workouts` scope는 workout list만 내려준다.
- `/life-ops/workouts/[workoutId]` scope는 focused workout만 내려준다.
- `/life-ops/career` scope는 career list만 내려준다.
- `/life-ops/career/[careerId]` scope는 focused career entry만 내려준다.
- `/life-ops/trends`와 `/life-ops/entries`는 서버 read model로 자체 렌더링하므로 빈 store hydration payload를 받도록 했다.
- LifeOps layout이 서버에서 full `getLifeOpsSnapshot()`을 만들지 않고, `LifeOpsHydrator`가 현재 pathname 기반 bootstrap을 호출하도록 바꿨다.
- `/api/life-ops/bootstrap`이 `path` query를 받아 scope별 hydration snapshot을 반환하도록 했다.
- `/dev/life-ops-hydration-smoke-test`를 추가해 home/date/habits/workouts/career/trends/entries scope를 독립 검증하도록 했다.

### 판단

- daily 화면은 page server read model이 `initialLog`와 heatmap을 이미 전달하고, client store에는 현재 날짜 log와 metric list만 있으면 된다.
- habits/workouts/career는 각 client page가 서로 다른 top-level store slice를 쓰므로 path별 payload 분리가 자연스럽다.
- workout/career detail page는 서버에서 focused entity를 렌더링하지만 property panel이 store override를 볼 수 있으므로 focused item만 hydration한다.
- entries/trends는 서버 read model로 화면을 완성하므로 store hydration이 화면 표시를 막지 않도록 `LifeOpsHydrator`에서 선렌더 허용 범위를 넓혔다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/life-ops-hydration-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 15개 check 통과
- 브라우저 확인: `/life-ops`, `/life-ops/habits`, `/life-ops/workouts`, `/life-ops/career`, `/life-ops/trends`, `/life-ops/entries` 정상 로드
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 Vault layout/bootstrap hydration payload를 목록/검색/상세 scope로 분리하는 것이다.
- Vault는 zettel/media/source document 계열 목록이 커질 가능성이 높으므로, `/vault` home과 `/vault/zettels`, `/vault/media`, 상세 route의 초기 payload를 나누는 순서가 좋다.

## 58. 2026-05-14 Vault bootstrap hydration scope 분리

57차 구현에서 추천한 Vault layout/bootstrap hydration payload 축소를 path scope로 분리했다.

### 완료한 것

- `getVaultHydrationSnapshot(pathAndSearch)`을 추가해 Vault 경로별 bootstrap payload를 분리했다.
- `/vault`와 `/vault/zettels` scope는 zettel list만 내려주고 media/assets/places를 비운다.
- `/vault/zettels/[zettelId]` scope는 zettel list에 focused zettel read model을 병합하고 `selectedZettelId`를 세팅한다.
- `/vault/zettels/graph` scope는 서버 read model로 자체 렌더링하므로 빈 hydration payload를 반환한다.
- `/vault/media` scope는 media list만 내려준다.
- `/vault/media/books`, `/vault/media/games`, `/vault/media/screens` scope는 media type별 list만 내려준다.
- `/vault/media/[mediaId]` scope는 focused media만 내려준다.
- `/vault/assets`와 `/vault/assets/[assetId]` scope는 asset list 또는 focused asset만 내려준다.
- `/vault/places`와 `/vault/places/[placeId]` scope는 place list 또는 focused place만 내려준다.
- `/api/vault/bootstrap`이 `path` query를 받아 scope별 hydration snapshot을 반환하도록 했다.
- `VaultHydrator`가 bootstrap 호출 시 현재 pathname을 전달하도록 바꿨다.
- `/dev/vault-hydration-smoke-test`를 추가해 zettel/media/asset/place scope를 독립 검증하도록 했다.

### 판단

- Vault list/detail 화면은 이미 서버 read model과 client local state로 렌더링하므로, layout hydrator의 non-blocking 정책은 유지했다.
- 그럼에도 `/api/vault/bootstrap`이 full `getVaultSnapshot()`을 반환하면 future route나 수동 호출에서 큰 payload가 새어 나갈 수 있어 API 계층을 먼저 scope-safe하게 만들었다.
- zettel detail은 list navigation과 selected detail이 함께 필요하므로 list에 focused full zettel을 병합하는 방식이 가장 안전하다.
- media/assets/places detail은 property panel이 focused entity만 있으면 되므로 단건 payload로 충분하다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `git diff --check` 대상 파일 기준 통과. Windows 줄바꿈 경고만 표시됨
- 브라우저 확인: `/dev/vault-hydration-smoke-test?format=html`에서 `ok: true`
- 브라우저 확인: 16개 check 통과
- 브라우저 확인: `/vault/zettels`, `/vault/zettels/graph`, `/vault/media`, `/vault/assets`, `/vault/places` 정상 로드
- 브라우저 확인: `/vault/zettels` main heading 기준 정상 표시
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 에러 로그: 검증 중 신규 server error 없음

### 다음에 남은 것

- 다음 작업은 hydration scope 분리 후에도 서버 page와 client hydrator가 중복 fetch하는 구간을 계측하고 줄이는 것이다.
- 특히 Vault zettel graph와 zettel list는 데이터가 커진 상태에서 렌더 시간이 길어졌으므로, graph read model의 bundle 호출 수와 zettel list의 sourceDocument property join 비용을 우선 점검하는 것이 좋다.

## 59. 2026-05-14 Vault zettel graph/read model 계측과 최적화

58차 구현에서 추천한 hydration scope 이후 중복 fetch/느린 read model 점검을 Vault zettel graph부터 진행했다.

### 완료한 것

- `/dev/vault-read-model-benchmark`를 추가해 `getVaultZettelList()`, `getVaultZettelGraph()`, graph page bundle 후보 비용을 나눠 측정했다.
- baseline에서 zettel list 약 1.1s, graph count 약 0.4s, graph page의 9개 ContextBundle 호출 약 4.1s가 확인됐다.
- 현재 데이터는 zettel direct link count가 0이라 graph page의 bundle 호출이 실제 edge를 만들지 못하고 있었다.
- `getVaultZettelGraph()`의 per-row correlated count subquery를 zettel list + outgoing/backlink aggregate query 조합으로 바꿨다.
- `/vault/zettels/graph`가 연결이 있는 zettel만 최대 6개까지 light ContextBundle(depth 1, explicit/source, limit 6)을 만들도록 바꿨다.
- 연결이 없는 경우 ContextBundle 호출을 생략하고 빈 미니맵 안내를 표시하도록 했다.
- benchmark route의 heavy bundle 측정은 `?heavy=1`일 때만 실행하고 기본 측정은 실제 graph page 방식과 맞췄다.

### 판단

- 현재 병목은 zettel graph count query 자체보다 graph page의 무조건적인 ContextBundle fan-out이었다.
- 연결이 없는 zettel 9개에 bundle을 만드는 것은 UX 정보량 없이 D1 호출만 늘린다.
- 연결이 있는 zettel만 후보로 삼으면 데이터가 커져도 graph page가 관계가 있는 노드 위주로 비용을 쓴다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark baseline: `totalDurationMs: 11418`, heavyGraphBundles `durationMs: 4124`
- 브라우저 benchmark optimized: `totalDurationMs: 619`, zettelList `durationMs: 253`, graph `durationMs: 170`, pageGraphBundles `durationMs: 0`
- 브라우저 확인: `/vault/zettels/graph` 정상 로드, `직접 링크 상태`와 빈 미니맵 안내 표시
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: app runtime error 없음. `127.0.0.1` 검증으로 Next dev HMR `allowedDevOrigins` 경고 1건 기록됨

### 다음에 남은 것

- 다음 작업은 `/vault/zettels` list render와 client-side filter 비용을 줄이는 것이다.
- zettel list는 449개 카드 전체 SSR/CSR 렌더가 남아 있으므로 server pagination 또는 initial visible windowing을 적용하는 순서가 좋다.

## 60. 2026-05-14 Vault zettel list filter index 최적화

59차 구현에서 추천한 `/vault/zettels` list render와 client-side filter 비용 축소를 이어서 진행했다.

### 완료한 것

- `/vault/zettels` 목록이 449개 전체 카드 대신 40개씩 렌더되는 visible window 흐름을 기준으로 검증했다.
- 클라이언트 필터가 매번 `getZettelSearchText()`, `getSourcePropertySearchText()`, `normalizeZettelDocumentKind()`를 항목별로 다시 호출하던 구조를 zettel list index 기반으로 바꿨다.
- `createZettelListIndexItem()`을 추가해 검색 haystack, source property haystack, category haystack, normalized document kind, normalized saved-view 비교값, 정렬용 timestamp를 zettel 변경 시 한 번만 만든다.
- saved view 필터는 `createSavedViewMatcher()`에서 view 조건을 한 번 정규화하고, 각 zettel은 precomputed index 필드만 비교하도록 바꿨다.
- 정렬도 `sortZettelIndexItems()`에서 precomputed timestamp/documentKind를 쓰도록 바꿨다.
- 선택 zettel lookup은 `Map` 기반 `zettelById`로 바꿔 상세 전환 시 선형 탐색을 줄였다.

### 판단

- 현재 데이터 449개 기준에서는 DOM 렌더 비용을 40개 window로 제한하는 효과가 가장 크고, 그 다음은 검색/저장 뷰 필터의 문자열 재조합 비용을 줄이는 것이 맞다.
- 서버 pagination은 이후 데이터가 수천 개로 커질 때 적용하는 편이 낫다. 지금은 상세 이동/로컬 병합/저장 뷰 UX를 유지하면서 클라이언트 계산량을 줄이는 쪽이 리스크가 작다.
- saved view 조건은 view가 바뀔 때만 정규화하면 되므로, 항목별 filter callback 내부에서 조건 배열을 반복 생성할 필요가 없다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 확인: `/vault/zettels`에서 `40/449` visible window와 `더 보기` 버튼 표시
- 브라우저 확인: `/vault/zettels?view=sermons`에서 `40/66`으로 saved view 필터 적용, `설교` 탭 active
- 브라우저 확인: `/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f` 상세 정상 로드, 목록 복귀 버튼 표시
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: app runtime error 없음. `127.0.0.1` 검증으로 Next dev HMR `allowedDevOrigins` 경고 1건 유지

### 다음에 남은 것

- 다음 작업은 Vault zettel list read model 자체를 더 가볍게 나누는 것이다.
- 목록 카드에는 full `content` substring과 source document property 전체가 필요하지 않으므로, list summary read model과 detail read model을 타입부터 분리하는 순서가 좋다.

## 61. 2026-05-16 Vault zettel list summary read model 분리

60차 구현에서 추천한 `/vault/zettels` list summary/detail read model 분리를 이어서 진행했다.

### 완료한 것

- 05번 문서 최상단에 전체 진행 현황 체크리스트를 추가하고, 현재 완료/진행 중/다음 추천 작업을 한눈에 볼 수 있게 했다.
- `ZettelMock`에 `sourcePropertySearchText`를 추가해 source document property 배열 없이도 목록 검색용 compact 문자열을 전달할 수 있게 했다.
- `getVaultZettelList()`가 목록 카드에 필요한 summary read model만 반환하도록 바꿨다.
- 목록 query에서 `content` 1200자 substring을 제거하고 `content: ""`를 반환하도록 했다.
- 목록 summary는 `coalesce(summary, substr(content, 1, 180))`까지만 사용한다.
- source document는 summary map으로 전달하고, 목록 payload의 `sourceDocument.properties` 배열은 비우도록 했다.
- source document property는 full 배열 대신 SQL `group_concat` 기반 `sourcePropertySearchText`로 합쳐 검색 haystack에만 사용한다.
- `/dev/vault-read-model-benchmark`에 list payload bytes, first content length, source document property count, source property search text count를 추가했다.

### 판단

- 목록 카드와 저장 뷰 필터에는 full content와 원본 property 배열이 필요하지 않다.
- 상세 화면은 기존 `getVaultZettel(zettelId)`와 detail API가 full content/source properties를 유지하므로 읽기/편집 기능은 상세 read model에서 보장된다.
- 검색 보존을 위해 property 배열을 내려보내는 대신 compact search text만 유지하는 방식이 현재 리스크가 가장 작다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark: `zettelList.count: 449`, `firstContentLength: 0`, `payloadBytes: 300364`, `sourceDocumentPropertyCount: 0`, `sourcePropertySearchTextCount: 0`
- 브라우저 benchmark: `totalDurationMs: 801`, `zettelList.durationMs: 401`, `graph.durationMs: 198`
- 브라우저 확인: `/vault/zettels`에서 `40/449` visible window와 `더 보기` 버튼 표시
- 브라우저 확인: `/vault/zettels?view=sermons`에서 `40/66` saved view 필터 유지
- 브라우저 확인: `/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f` 상세 정상 로드
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: app runtime error 없음. `127.0.0.1` 검증으로 Next dev HMR `allowedDevOrigins` 경고는 유지됨

### 다음에 남은 것

- 다음 작업은 `/dev/vault-read-model-benchmark`와 서버 로그 기준으로 list/detail/API route별 render/read 비용을 더 세분화하는 것이다.
- 이후 zettel list 데이터가 수천 개로 늘어날 때를 대비해 server pagination 또는 virtualization 적용 여부를 판단한다.

## 62. 2026-05-16 Vault zettel list/detail/API route 비용 세분화

61차 구현에서 추천한 route별 render/read 비용 계측을 이어서 진행했다.

### 완료한 것

- `/dev/vault-read-model-benchmark`에 `getVaultZettel(firstId)` 상세 read model 비용과 payload 크기 계측을 추가했다.
- 같은 benchmark에서 실제 HTTP fetch로 `/vault/zettels`, `/vault/zettels?view=sermons`, `/vault/zettels/[zettelId]` page route를 호출해 route render 비용과 HTML payload 크기를 비교하도록 했다.
- 같은 benchmark에서 `/api/vault/bootstrap?path=/vault/zettels`, `/api/vault/bootstrap?path=/vault/zettels/[zettelId]`, `/api/vault/zettels/[zettelId]/details` API route를 호출해 API payload 크기를 비교하도록 했다.
- route fetch에는 현재 request cookie를 전달해 개발 세션 상태에서 실제 화면/API와 같은 인증 경로를 타도록 했다.
- `routes=0` query를 붙이면 route fetch 계측을 끄고 read model 계측만 볼 수 있게 했다.

### 판단

- 449개 기준 list read model 자체는 `payloadBytes: 300364`, `durationMs: 197`까지 내려왔다.
- detail read model은 full content를 유지해도 `payloadBytes: 10474`, `durationMs: 179`로 충분히 작다.
- 현재 더 큰 문제는 API 단건보다 page route HTML/RSC payload다. list page는 약 457KB, detail page는 약 410KB로 측정됐다.
- bootstrap list API는 약 300KB이고 detail API는 약 10KB라서, 상세 편집/읽기 API보다 page initial props와 목록 전달 방식이 다음 최적화 후보에 가깝다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark: `ok: true`, `totalDurationMs: 4108`
- 브라우저 benchmark read model: `zettelList.durationMs: 197`, `zettelList.payloadBytes: 300364`, `zettelDetail.durationMs: 179`, `zettelDetail.payloadBytes: 10474`
- 브라우저 benchmark route fetch: list page `699ms / 457075 bytes`, saved view page `655ms / 457857 bytes`, detail page `958ms / 410475 bytes`
- 브라우저 benchmark API fetch: bootstrap list `358ms / 300463 bytes`, bootstrap detail `516ms / 310158 bytes`, detail API `258ms / 10485 bytes`
- 서버 로그 대조: list page `688ms`, saved view page `651ms`, bootstrap list API `351ms`, detail page `927ms`, bootstrap detail API `511ms`, detail API `245ms`
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: app runtime error 없음. `127.0.0.1` 검증으로 Next dev HMR `allowedDevOrigins` 경고는 유지됨

### 다음에 남은 것

- 다음 작업은 `/vault/zettels`와 detail page의 HTML/RSC payload를 줄이는 방식 선택이다.
- 후보는 page props를 initial visible window로 제한하는 방식, server pagination을 도입하는 방식, 또는 detail page에서 목록 전체를 함께 SSR하지 않는 방식이다.
- 현재 수치 기준으로는 detail API보다 page initial payload를 줄이는 작업이 우선순위가 높다.

## 63. 2026-05-16 Vault zettel page initial payload 축소

62차 계측에서 확인한 page HTML/RSC payload 병목을 줄이는 작업을 진행했다.

### 완료한 것

- `/vault/zettels` page가 서버에서 449개 zettel list를 props로 내려주지 않도록 바꿨다.
- `/vault/zettels/[zettelId]` detail page도 full detail 1건만 SSR하고, 목록 전체는 클라이언트에서 별도 fetch로 합치도록 바꿨다.
- `ZettelsClient`에 `deferInitialZettels` 흐름을 추가해 initial page payload는 비운 상태로 시작하고 `/api/vault/zettels`에서 summary list를 받아 local list에 병합하도록 했다.
- detail page에서 먼저 받은 full zettel은 목록 summary fetch가 끝난 뒤에도 full content가 유지되도록, fetched summary 위에 현재 local detail을 다시 merge하는 방식으로 보존했다.
- `/api/vault/zettels` GET을 추가해 목록 summary read model을 클라이언트가 별도로 가져올 수 있게 했다.
- benchmark route에 `listApi` fetch를 추가해 page payload와 목록 API payload를 분리해서 볼 수 있게 했다.

### 판단

- 서버 pagination을 바로 도입하면 saved view/search/filter UX 전체를 함께 바꿔야 하므로, 이번 단계에서는 page initial payload와 list API payload를 분리하는 쪽이 리스크가 작았다.
- 이 변경으로 첫 HTML/RSC payload는 크게 줄고, 기존 `40/449`, saved view `40/66`, detail read/edit 흐름은 유지된다.
- 남은 300KB 목록 API payload는 데이터가 수천 개로 커질 때 server pagination 또는 server-side filtering으로 나눌 후보가 됐다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark: `ok: true`, `totalDurationMs: 7661`
- 브라우저 benchmark read model: `zettelList.durationMs: 222`, `zettelList.payloadBytes: 300364`, `zettelDetail.durationMs: 198`, `zettelDetail.payloadBytes: 10474`
- 브라우저 benchmark route fetch: list page `1195ms / 46310 bytes`, saved view page `1203ms / 46324 bytes`, detail page `2522ms / 76909 bytes`
- 브라우저 benchmark API fetch: list API `428ms / 300376 bytes`, bootstrap list API `486ms / 300463 bytes`, bootstrap detail API `629ms / 310158 bytes`, detail API `458ms / 10485 bytes`
- 이전 62차 수치 대비 page payload: list page 약 `457075 -> 46310 bytes`, saved view page 약 `457857 -> 46324 bytes`, detail page 약 `410475 -> 76909 bytes`
- 브라우저 확인: `http://localhost:3000/vault/zettels`에서 client fetch 후 `40/449` visible window와 `더 보기` 버튼 표시
- 브라우저 확인: `http://localhost:3000/vault/zettels?view=sermons`에서 `40/66` saved view 필터 유지
- 브라우저 확인: `http://localhost:3000/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f` 상세 정상 로드
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: app runtime error 없음. `127.0.0.1`에서는 Next dev HMR `allowedDevOrigins` 경고로 hydration 확인이 부정확해 `localhost` 기준으로 검증함

### 다음에 남은 것

- 다음 작업은 `/api/vault/zettels` 300KB 목록 fetch를 server pagination 또는 server-side filtering으로 나눌지 결정하는 것이다.
- UX를 유지하려면 saved view/search/filter가 서버 query와 같은 semantics를 갖도록 먼저 API contract를 정해야 한다.
- 그 다음 Vault list/detail 저장, 삭제, 관계 변경 후 local merge smoke test를 보강한다.

## 64. 2026-05-16 Vault zettel list API server pagination/filtering 전환

63차 구현에서 남긴 `/api/vault/zettels` 300KB 목록 fetch 축소를 진행했다.

### 완료한 것

- `/api/vault/zettels` GET을 page 단위 API로 바꿨다.
- API query contract에 `limit`, `offset`, `q`, `type`, `documentKind`, `status`, `sourceReliability`, `reviewCadence`, `category`, `tags`, `property`, `sort`를 추가했다.
- API 응답에 `total`, `limit`, `offset`, `nextOffset`을 포함해 클라이언트가 현재 page와 전체 결과 수를 분리해서 표시할 수 있게 했다.
- saved view/filter/search/sort 조건을 API query로 직렬화하는 `ZettelsClient` 경로를 추가했다.
- `ZettelsClient`의 `더 보기`를 client slice 증가가 아니라 `nextOffset` 기반 다음 page fetch로 바꿨다.
- detail page에서 SSR로 받은 full zettel은 page 목록 fetch 후에도 유지되도록, 새 page fetch 시 loaded detail item만 보존해서 병합한다.
- benchmark route의 JSON fetch summary에 `zettelCount`, `total`, `nextOffset`을 추가해 list API가 실제 몇 건을 반환하는지 같이 볼 수 있게 했다.
- `limit` query가 없을 때 `Number(null) === 0`으로 1건만 반환되던 기본값 버그를 고쳐 default limit 40이 적용되도록 했다.

### 판단

- 바로 DB SQL 동적 where/limit까지 쪼개기보다, 현재 `getVaultZettelList()` summary read model 위에서 서버 filtering/pagination을 먼저 적용하는 것이 UX 리스크가 작다.
- 이 단계만으로도 네트워크 payload는 full 449개에서 첫 40개 page로 줄어든다.
- 클라이언트는 여전히 같은 필터 semantics를 한 번 더 적용하므로, 서버/클라이언트 조건이 조금 어긋나도 화면이 과하게 넓어지는 위험은 작다.
- 다음 병목은 API 내부에서 여전히 전체 summary list를 만든 뒤 자르는 비용이다. 데이터가 더 커지면 SQL where/limit 기반 read model로 한 번 더 내려야 한다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark: `ok: true`, `totalDurationMs: 6163`
- 브라우저 benchmark list API: `595ms / 29128 bytes`, `zettelCount: 40`, `total: 449`, `nextOffset: 40`
- 이전 63차 수치 대비 list API payload: 약 `300376 -> 29128 bytes`
- 브라우저 확인: `http://localhost:3000/vault/zettels`에서 첫 page `40/449` 표시
- 브라우저 확인: `더 보기` 클릭 후 `80/449` 표시
- 브라우저 확인: `http://localhost:3000/vault/zettels?view=sermons`에서 server-side saved view query 후 `40/66` 표시
- 브라우저 확인: `http://localhost:3000/vault/zettels/ztl_cb888aa78d43dfbee6935fa21f` 상세 정상 로드
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: `/api/vault/zettels?limit=40&offset=0&sort=updated-desc`, `/api/vault/zettels?limit=40&offset=40&sort=updated-desc`, `/api/vault/zettels?limit=40&offset=0&sort=updated-desc&documentKind=sermon&documentKind=sermon_note` 모두 200
- 서버 로그: app runtime error 없음. `127.0.0.1` 검증으로 Next dev HMR `allowedDevOrigins` 경고는 유지됨

### 다음에 남은 것

- 다음 작업은 paged summary list에서 저장, 삭제, 관계 변경 후 local merge가 깨지지 않는지 smoke test를 보강하는 것이다.
- 그 다음 데이터가 더 커졌을 때 API 내부 비용을 줄이기 위해 SQL where/limit 기반 zettel list read model을 별도 구현할지 판단한다.

## 65. 2026-05-16 Vault paged zettel list mutation/local merge smoke test 보강

64차 구현에서 남긴 paged summary list의 mutation merge 검증을 보강했다.

### 완료한 것

- `mergeZettelList`, `mergeZettelListItems`, `mergePagedZettelPage`, `removeZettelFromList`를 `apps/web/src/lib/vault/zettel-list-state.ts`로 추출했다.
- `ZettelsClient`가 page replace/append, detail merge, relation merge, delete remove에서 같은 helper를 쓰도록 정리했다.
- `/dev/zettel-smoke-test` 기존 mutation smoke에 paged local merge 시뮬레이션을 추가했다.
- smoke test가 initial page replace, detail merge, append page, detail update, empty replace에서 loaded detail 보존, link/unlink relation merge, delete remove를 검증한다.

### 판단

- paged list에서는 목록 summary와 detail full data가 같은 배열에 공존하므로, 병합 규칙이 흩어지면 full content가 summary로 덮이거나 삭제된 항목이 다시 살아날 수 있다.
- 공용 helper를 client와 smoke test가 같이 쓰면 UI local merge 회귀를 서버 smoke에서도 잡을 수 있다.
- 이 smoke는 mutation 결과와 page fetch를 같은 순서로 시뮬레이션하므로 빠르고 반복 가능하다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 smoke: `/dev/zettel-smoke-test?format=html`에서 `ok: true`
- 브라우저 smoke: 17개 check 통과, failed check 0개
- paged merge checks: initial page 40 items, append 후 80 local items, loaded detail content preserved, updated detail title preserved, link merge 1, unlink merge 0, delete source/target removed
- cleanup: `remainingRows: 0`
- 브라우저 확인: `/vault/zettels`에서 `40/449` 정상 유지
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: `/dev/zettel-smoke-test?format=html` 200, app runtime error 없음. `127.0.0.1` HMR allowedDevOrigins 경고는 유지됨

### 다음에 남은 것

- 다음 작업은 ActionHub/PRM/LifeOps도 현재 hydration scope 이후 남은 중복 fetch와 route payload를 같은 방식으로 계측하는 것이다.
- 이후 Vault bootstrap API의 zettel scope가 여전히 full list를 반환하는 문제를 실제 호출 필요성 기준으로 제거/축소할지 판단한다.

## 66. 2026-05-16 ActionHub/PRM/LifeOps route payload와 bootstrap 중복 후보 계측

65차 이후 남은 6순위 작업인 세 도메인 route/API payload 계측을 진행했다.

### 완료한 것

- `/dev/domain-route-payload-benchmark`를 추가했다.
- benchmark가 ActionHub, PRM, LifeOps의 주요 page route와 해당 bootstrap API를 같은 표본 경로로 fetch해 `durationMs`, `payloadBytes`, status, JSON summary를 기록한다.
- 같은 benchmark에서 server hydration snapshot 자체의 payload와 count summary도 별도로 측정한다.
- page payload와 bootstrap API payload를 path별로 묶어 `duplicateFetchCandidates`를 계산하도록 했다.

### 판단

- ActionHub hydration snapshot은 대부분 1KB 이하라 bootstrap 중복 비용이 작다.
- LifeOps는 bootstrap payload보다 page HTML/RSC payload가 크다. 특히 entries와 trends는 bootstrap이 거의 비어 있는데 page payload가 크므로, 중복 fetch보다 page props/read model 축소가 우선이다.
- PRM은 graph/detail/hit-them-up/edit에서 page payload가 이미 큰데 bootstrap API도 14KB~17KB가 추가된다. 이쪽은 client bootstrap roundtrip을 없애거나 initial hydration 전달 방식을 바꾸는 후보가 됐다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark: `/dev/domain-route-payload-benchmark?format=html`에서 `ok: true`
- 브라우저 benchmark: `targetCount: 23`, `totalDurationMs: 82670`
- 큰 page payload: `/life-ops/entries?view=journal` `383509 bytes`, `/prm/graph` `192209 bytes`, `/prm/{personId}` `177099 bytes`, `/life-ops/trends` `164725 bytes`
- bootstrap 중복 후보: `/prm/graph` page `192209 bytes` + bootstrap `17126 bytes`, `/prm/{personId}` page `177099 bytes` + bootstrap `14761 bytes`, `/prm/hit-them-up` page `60196 bytes` + bootstrap `17126 bytes`, `/prm/{personId}/edit` page `59804 bytes` + bootstrap `14761 bytes`
- hydration snapshot 상위: PRM focused home `17810 bytes`, PRM home/gifts/graph/hit-them-up `17126 bytes`, PRM person detail/edit `14761 bytes`
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: `/dev/domain-route-payload-benchmark?format=html` 200, app runtime error 없음. 첫 실행은 여러 route compile이 섞여 86초가 걸림

### 다음에 남은 것

- 다음 작업은 LifeOps entries/trends의 큰 page payload를 먼저 줄이는 것이다.
- 그 다음 PRM graph/detail/hit-them-up/edit에서 bootstrap API roundtrip을 유지할지, server initialSnapshot 전달로 바꿀지 결정한다.

## 67. 2026-05-16 LifeOps entries/trends initial page payload 축소

66차 계측에서 가장 크게 나온 LifeOps entries/trends page payload를 줄였다.

### 완료한 것

- `/life-ops/entries` page가 `getDailyEntryArchive()` 결과 전체를 서버 props로 내려주지 않도록 바꿨다.
- `DailyEntriesClient`에 `deferInitialEntries` 흐름을 추가해 초기 렌더는 저장 뷰만 받고, `/api/life-ops/entries`에서 archive 데이터를 client fetch로 가져오게 했다.
- `/life-ops/trends` page가 trend series와 371일 heatmap을 서버 props로 내려주지 않도록 바꿨다.
- `TrendsGrid`에 `deferInitialData` 흐름을 추가하고, `/api/life-ops/trends`에서 sleep/deepWork/heatmap 데이터를 client fetch로 가져오게 했다.
- `/dev/domain-route-payload-benchmark`가 entries/trends data API payload도 같이 측정하도록 확장했다.

### 판단

- entries/trends는 LifeOpsHydrator에서 이미 store hydration 전 렌더를 허용하던 화면이라, page initial payload에서 heavy props를 빼도 전체 layout 계약이 흔들리지 않는다.
- 이번 변경은 page HTML/RSC payload를 빠르게 낮추는 1차 작업이다.
- `/api/life-ops/entries`는 여전히 247KB라서, 다음에는 archive summary/detail 분리나 server-side saved view filtering/pagination을 적용해야 한다.
- PRM graph/detail bootstrap 중복 후보는 아직 남아 있으므로 다음 우선순위로 유지한다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark: `/dev/domain-route-payload-benchmark`에서 `ok: true`, `targetCount: 23`, route fetch entry `48`
- page payload 개선: `/life-ops/entries?view=journal` `383509 -> 65110 bytes`
- page payload 개선: `/life-ops/trends` `164725 -> 38746 bytes`
- 새 data API payload: `/api/life-ops/entries` `247076 bytes`, `entries: 124`
- 새 data API payload: `/api/life-ops/trends` `11936 bytes`, `heatmap: 371`, `sleep: 7`, `deepWork: 7`
- 브라우저 확인: `/life-ops/entries?view=journal`에서 client fetch 후 전체 기록 `124`, 표시 중 `71` 정상 표시
- 브라우저 확인: `/life-ops/trends`에서 client fetch 후 `기분, 수면, 에너지`, `수면 패턴`, `깊은 작업 흐름`, `습관 활동` 정상 표시
- 브라우저 콘솔: 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 PRM graph/detail/hit-them-up/edit에서 bootstrap API roundtrip을 줄이는 것이다.
- 그 다음 `/api/life-ops/entries`를 summary/detail 또는 paging/filtering API로 나눠 247KB data API payload를 낮춘다.

## 68. 2026-05-16 PRM self-hydrated route bootstrap roundtrip 축소

67차 이후 남은 PRM bootstrap 중복 후보 중 graph, hit-them-up, person detail을 먼저 정리했다.

### 완료한 것

- `PRMHydrator`가 `/prm/graph`, `/prm/hit-them-up`, `/prm/{personId}`, `/prm/gifts/{giftId}`처럼 page 자체가 필요한 데이터를 이미 가져오는 self-hydrated route에서는 bootstrap API fetch 없이 children을 렌더하도록 했다.
- `PRMGraphPage`가 graph 화면용 `initialSnapshot`을 직접 가져와 `PRMGraphClient`에 전달하도록 했다.
- `PRMGraphClient`가 전달받은 초기 snapshot을 store에 반영하고, 관계선 추가/삭제 mutation delta도 local snapshot에 같이 반영하도록 했다.
- `HitThemUpClient`는 store bootstrap 없이 page props 기반 local state로 표시하고, 연락 완료 mutation delta를 local state와 PRM store에 함께 반영하도록 했다.
- graph page의 context preview 범위를 8명/depth 2/inferred 포함에서 4명/depth 1/explicit+source 중심으로 줄였다.
- `/dev/domain-route-payload-benchmark`가 self-hydrated PRM route에서는 bootstrap API를 중복 후보로 계산하지 않도록 `skipBootstrap` 경로를 반영했다.

### 판단

- 이 변경은 bootstrap API roundtrip 제거가 목적이다. graph/detail은 children을 바로 렌더하고 graph는 initial snapshot을 page에 싣기 때문에, 순수 page payload 바이트가 줄지는 않았다.
- 대신 사용자 관점에서는 `관계 데이터를 불러오는 중입니다` gate와 bootstrap API 왕복이 없어져 graph/hit/detail이 page fetch 이후 바로 표시된다.
- 남은 큰 병목은 graph/detail의 context bundle 자체다. 특히 graph page는 bootstrap 제거 후에도 `225586 bytes`, person detail은 `199131 bytes`라서 다음 단계에서는 context bundle summary/detail 분리가 더 중요하다.
- 남은 bootstrap 후보는 `/prm/gifts`와 `/prm/{personId}/edit`이다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 브라우저 benchmark: `/dev/domain-route-payload-benchmark`에서 `ok: true`, route fetch entry `45`
- benchmark: `/prm/graph` bootstrap `17126 -> 0 bytes`, duplicate candidate 해제
- benchmark: `/prm/hit-them-up` bootstrap `17126 -> 0 bytes`, duplicate candidate 해제
- benchmark: `/prm/{personId}` bootstrap `14761 -> 0 bytes`, duplicate candidate 해제
- benchmark 현재 page payload: `/prm/graph` `225586 bytes`, `/prm/hit-them-up` `72155 bytes`, `/prm/{personId}` `199131 bytes`
- 남은 PRM bootstrap 후보: `/prm/gifts` page `65945 bytes` + bootstrap `17126 bytes`, `/prm/{personId}/edit` page `59804 bytes` + bootstrap `14761 bytes`
- 브라우저 확인: `/prm/graph`에서 `사람 관계 맥락맵`, `관계선 관리` 표시, bootstrap loading 문구 없음
- 브라우저 확인: `/prm/hit-them-up`에서 `연락 필요`와 카드/빈 상태 표시, bootstrap loading 문구 없음
- 브라우저 확인: `/prm/{personId}`에서 `관계 상세`과 context 영역 표시, bootstrap loading 문구 없음
- 브라우저 콘솔: 검증 중 error 로그 없음
- 서버 로그: 브라우저에서 `/prm/graph`, `/prm/hit-them-up`, `/prm/{personId}` 이동 직후 해당 경로의 `/api/prm/bootstrap` 호출 없음

### 다음에 남은 것

- 다음 작업은 PRM graph/detail의 context bundle page payload를 summary/detail로 줄이는 것이다.
- 그 다음 `/prm/gifts`, `/prm/{personId}/edit`의 bootstrap 중복을 처리하고, `/api/life-ops/entries` 247KB payload를 paging/filtering API로 낮춘다.

## 69. 2026-05-16 PRM graph/detail context bundle initial payload compact

68차에서 남긴 PRM graph/detail의 context bundle page payload 자체를 줄였다.

### 완료한 것

- `ContextBundle`에 선택적 `summary.nodeCount`, `summary.edgeCount`를 추가해 초기 payload를 줄여도 화면의 총 연결 수 표시는 유지되게 했다.
- `compactContextBundleForMini()`와 `compactContextBundleForPage()`를 추가했다.
- graph의 context preview 카드는 mini map에 필요한 focus, 첫 10개 node, 그릴 수 있는 edge만 받도록 했다.
- person detail은 첫 화면에 필요한 page/group/timeline node와 제한된 edge만 받도록 하고, evidence snippet과 node preview를 짧게 줄였다.
- `ContextMapMini`, `ContextRail`, `Person360Client`가 compact bundle에서는 `summary.edgeCount`를 우선 표시하도록 바꿨다.

### 판단

- PRM graph의 4개 context preview는 전체 bundle을 모두 가질 필요가 없고, 미니맵 표시에는 작은 subset이면 충분하다.
- person detail은 렌즈/rail/timeline 첫 화면을 유지하되, 전체 148개 edge와 149개 node의 긴 preview/evidence를 전부 SSR payload에 싣는 것은 낭비다.
- load more나 source trace처럼 더 자세한 정보가 필요한 흐름은 기존 API fetch로 이어질 수 있으므로, 초기 payload는 "읽을 수 있는 첫 화면" 중심으로 줄이는 것이 안전하다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- benchmark/direct route fetch: `/prm/graph` page payload `225586 -> 94768 bytes`
- benchmark/direct route fetch: `/prm/{personId}` page payload `199131 -> 115207 bytes`
- 브라우저 확인: `/prm/graph`에서 `사람 관계 맥락맵`, `맥락 지도`, `관계선 관리` 표시, `불러오는 중` 0건
- 브라우저 확인: `/prm/{personId}`에서 `관계 상세`, `맥락`, `원본 추적`, `관계선` 표시, `불러오는 중` 0건
- 브라우저 콘솔: graph/detail 검증 중 error 로그 없음

### 다음에 남은 것

- 다음 작업은 `/prm/gifts`, `/prm/{personId}/edit`의 bootstrap 중복을 줄이는 것이다.
- 그 다음 `/api/life-ops/entries` 247KB payload를 archive summary/detail 또는 server-side paging/filtering API로 낮춘다.

## 70. 2026-05-16 PRM gifts/edit bootstrap roundtrip 제거

69차 이후 남은 PRM bootstrap 중복 후보인 `/prm/gifts`와 `/prm/{personId}/edit`를 정리했다.

### 완료한 것

- `PRMHydrator`의 self-hydrated route 판정에 `/prm/gifts`와 `/prm/{personId}/edit`를 추가했다.
- `/prm/gifts` page가 `people/gifts/savedViews`를 서버에서 직접 읽어 `GiftsBoardClient`에 전달하도록 바꿨다.
- `GiftsBoardClient`가 store bootstrap 없이 props 기반 local state로 즉시 렌더되고, gift/person mutation delta를 local state와 PRM store에 함께 반영하도록 바꿨다.
- `/prm/{personId}/edit`은 page에서 이미 읽은 person 데이터로 바로 렌더되도록 하고, 원본 속성은 `source` 탭을 열 때 `/api/prm/people/{personId}/source-document`로 lazy fetch하도록 분리했다.
- `/dev/domain-route-payload-benchmark`에서 gifts/edit을 self-hydrated route로 표시해 bootstrap API를 중복 후보에서 제외했다.

### 판단

- gifts 화면은 PRM store bootstrap에 의존할 이유가 없고, page가 필요한 people/gifts만 직접 넘기는 편이 화면 계약이 더 분명하다.
- edit 화면은 bootstrap gate를 제거하면 실제 편집 UI가 초기 HTML에 포함되므로 page payload는 이전의 loading shell보다 커진다. 대신 사용자는 bootstrap API 왕복과 `관계 데이터를 불러오는 중입니다` gate 없이 바로 편집 폼을 본다.
- 원본 속성은 기본 편집 모드에서 보이지 않으므로 초기 payload에 싣지 않고, 원본 탭 진입 시 lazy fetch하는 것이 UX와 payload 사이의 균형이 좋다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- benchmark: `/prm/gifts` bootstrap `17126 -> 0 bytes`, duplicate candidate 해제
- benchmark: `/prm/{personId}/edit` bootstrap `14761 -> 0 bytes`, duplicate candidate 해제
- benchmark 현재 page payload: `/prm/gifts` `81863 bytes`, `/prm/{personId}/edit` `83760 bytes`
- 브라우저 확인: `/prm/gifts`에서 `선물 보드`, `준 선물`, `받은 선물`, `새 선물 속성` 표시, bootstrap loading 문구 없음
- 브라우저 확인: `/prm/{personId}/edit`에서 `관계 편집`, `프로필 저장`, `원본` 표시, bootstrap loading 문구 없음
- 브라우저 확인: edit 원본 탭 클릭 후 lazy fetch가 완료되고 `연결된 원본 속성이 없습니다` 상태 표시
- 브라우저 콘솔: 수정 중 HMR effect dependency 경고가 한 번 남았으나, 이후 새 탭 재검증에서 화면 동작과 lazy fetch는 정상이다.

### 다음에 남은 것

- 다음 작업은 `/api/life-ops/entries` 247KB payload를 summary/detail 또는 server-side paging/filtering API로 낮추는 것이다.
- 그 다음 PRM 홈/focused home의 bootstrap share가 아직 28% 수준인 부분을 실제 체감 병목인지 다시 판단한다.

## 71. 2026-05-16 LifeOps entries data API paging/summary 분리

70차 이후 남은 큰 data API payload인 `/api/life-ops/entries`를 줄였다.

### 완료한 것

- `/api/life-ops/entries`가 전체 archive를 한 번에 반환하지 않고 `limit`, `offset`, `kind`, `q`, `hasPeople`, `hasEmotion` query를 받는 summary page API로 동작하게 했다.
- 기본 응답은 40개 entry summary와 `total`, `nextOffset`만 반환한다.
- entry summary에서는 full body, background, source document properties를 빼고 `bodyPreview`, `backgroundPreview`, `hasBody`, `hasBackground`, `hasSourceDocument` 표시 플래그만 유지했다.
- `/api/life-ops/entries/{entryId}` detail API를 추가해 본문/배경/원본 속성이 필요한 카드에서 lazy fetch로 가져오게 했다.
- `DailyEntriesClient`가 active saved view/search/kind filter를 API query로 직렬화하고, `더 보기`로 다음 page를 병합하도록 바꿨다.
- `DailyEntryArchiveCard`가 본문/원본 details를 열거나 배경 컬럼이 보일 때 단건 detail을 가져오도록 바꿨다.
- benchmark JSON summary가 entries API의 `total`, `nextOffset`도 표시하도록 보강했다.

### 판단

- 기존 entries page는 initial page payload는 이미 줄었지만, client fetch data API가 247KB라서 네트워크 부담이 뒤로 이동한 상태였다.
- 기본 화면에서 body/background/source properties는 닫힌 보조 정보이므로 첫 API에는 필요하지 않다.
- saved view와 검색은 서버 query로 먼저 줄이고, 클라이언트는 받은 page를 렌더/병합하는 쪽이 데이터가 커졌을 때 더 안전하다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- benchmark: `/api/life-ops/entries` `247076 -> 32333 bytes`
- benchmark: entries data API `entries: 40`, `total: 124`, `nextOffset: 40`
- direct API: `/api/life-ops/entries?kind=journal&limit=40&offset=40` `23948 bytes`, `entries: 31`, `total: 71`, `nextOffset: null`
- direct API: `/api/life-ops/entries?q=기도&limit=40` `20143 bytes`, `entries: 23`, `total: 23`
- detail API: `/api/life-ops/entries/{entryId}` `701 bytes`, status 200
- page payload 유지: `/life-ops/entries?view=journal` 약 `65067 bytes`
- 브라우저 확인: `/life-ops/entries?view=journal`에서 loading 종료 후 `더 보기 (40/71)` 표시
- 브라우저 확인: 기존 HMR 경고 로그가 콘솔 히스토리에 남아 있었지만, entries 화면 자체의 새 runtime error는 확인되지 않았다.

### 다음에 남은 것

- 다음 작업은 PRM home/focused home의 bootstrap share가 아직 28% 수준인 부분을 실제 체감 병목인지 재계측하는 것이다.
- 그 다음 Vault zettel list API와 LifeOps entries API 내부가 아직 전체 read 후 slice인지, SQL where/limit 기반 read model로 더 내려야 하는지 판단한다.

## 72. 2026-05-16 PRM home/focused home bootstrap roundtrip 제거

71차 이후 남은 PRM 홈 계열의 bootstrap share를 정리했다.

### 완료한 것

- `/prm` page가 `searchParams`를 포함한 현재 경로를 기준으로 `getPRMHydrationSnapshot()`을 서버에서 읽고, `PRMClient`가 이 snapshot으로 즉시 렌더되도록 했다.
- `PRMHydrator`가 `/prm`과 `/prm?detail=person:{id}`를 bootstrap gate 없이 통과시키도록 했다.
- PRM home/focused home의 사람 목록 snapshot을 list summary 형태로 줄여 기본 홈 snapshot payload를 낮췄다.
- `HitThemUpPanel`의 연락 완료 mutation delta가 PRM home local snapshot에도 반영되도록 연결했다.
- `/dev/domain-route-payload-benchmark`에서 PRM home/focused home을 self-hydrated route로 표시해 중복 bootstrap 후보에서 제외했다.

### 판단

- 기존 `/prm`과 `/prm?detail=person:{id}`는 page payload와 별도로 `/api/prm/bootstrap`을 한 번 더 호출했고, combined payload 중 bootstrap share가 약 28%였다.
- bootstrap roundtrip은 제거됐지만, Next dev 기준 raw page payload는 RSC 직렬화 영향으로 증가했다. 따라서 이 작업은 "네트워크 왕복 제거"로는 완료이고, "raw HTML/RSC payload 최소화"는 별도 판단거리로 남긴다.
- PRM home snapshot 자체는 summary projection으로 `/prm` 기준 `17126 -> 4152 bytes`까지 줄었다.

### 검증

- `npm run typecheck`: 통과
- `npm run lint`: 통과
- smoke: `/dev/prm-hydration-smoke-test` 통과
- benchmark: `/prm` bootstrap `17126 -> 0 bytes`
- benchmark: `/prm?detail=person:{id}` bootstrap `17810 -> 0 bytes`
- benchmark: PRM home hydration snapshot `/prm` `17126 -> 4152 bytes`
- benchmark: PRM focused home hydration snapshot `/prm?detail=person:{id}` `17810 -> 16470 bytes`
- benchmark 참고: Next dev raw page payload는 `/prm` `43105 -> 93586 bytes`, focused home `44069 -> 107612 bytes`로 증가했다.
- 브라우저 확인: `/prm`에서 bootstrap fetch 0건, loading 문구 없음, 관계 카드 표시
- 브라우저 확인: `/prm?detail=person:{id}`에서 bootstrap fetch 0건, `관계 상세` 드로어 표시, 인물 누락 문구 없음
- 브라우저 콘솔: 이전 PRM edit 작업 중 남은 HMR effect dependency error가 히스토리에 남아 있으나 timestamp가 과거 로그이고, 이번 검증 경로의 새 runtime error는 확인되지 않았다.

### 다음에 남은 것

- 다음 작업은 Vault zettel list API와 LifeOps entries API 내부 read cost가 아직 전체 read 후 slice인지 확인하고, 필요하면 SQL where/limit 기반 read model로 더 낮추는 것이다.
- PRM home은 raw page payload까지 줄이고 싶다면 RSC snapshot 전달 대신 전용 compact data API + skeleton/streaming 전략을 비교한다.
