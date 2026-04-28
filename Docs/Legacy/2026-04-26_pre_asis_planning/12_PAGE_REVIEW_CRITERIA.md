# Page Review Criteria

> 목적: Project Light House의 각 페이지와 기능을 리뷰할 때 공통으로 적용할 실무 기준이다. 단순 UI 품질이 아니라 실제 사용자 사용성, 맥락적 연결성, D1 데이터 연동, 성능, 유지보수성을 함께 평가한다.

## 1. 평가 원칙

Project Light House의 페이지 리뷰는 다음 질문에서 출발한다.

- 사용자가 실제 생활/작업 데이터를 더 빠르고 덜 힘들게 다룰 수 있는가?
- 페이지가 Action Hub, Vault, PRM, Life Ops 사이의 맥락적 연결성을 강화하는가?
- D1에 저장된 실제 데이터와 AS-IS 마이그레이션 데이터가 화면에서 정확히 살아나는가?
- 모바일과 데스크톱 모두에서 반복 사용 가능한 밀도와 흐름을 제공하는가?
- 구현이 기존 아키텍처와 디자인 시스템을 해치지 않고 확장 가능한가?

## 2. 점수 체계

각 항목은 0~3점으로 평가한다.

| 점수 | 기준 |
| --- | --- |
| 0 | 미구현, 사용 불가, 또는 명백한 결함 |
| 1 | 동작은 하나 실사용/데이터/UX/성능상 큰 결함 존재 |
| 2 | 실사용 가능, 일부 개선 여지 존재 |
| 3 | 제품 기준에 부합하며 유지보수 가능 |

## 3. Hard Gate

아래 항목 중 하나라도 실패하면 해당 페이지는 완료로 보지 않는다.

- `npm run typecheck` 실패
- `npm run build` 실패
- 주요 페이지에서 실제 D1 데이터가 렌더링되지 않음
- Contextual Connectivity 핵심 화면에서 관계 탐색이 끊김
- 375px 모바일 화면에서 주요 조작이 불가능함
- 마이그레이션 데이터, SourceTrace, 원본 관계 확인 흐름을 깨뜨림
- 사용자가 저장/삭제/이동 같은 주요 행동의 결과를 확인할 수 없음

## 4. 평가 항목

### 4.1 제품 가치 적합성

- 화면이 `Action Hub / Vault / PRM / Life Ops` 중 어떤 도메인 문제를 해결하는지 명확한가?
- 단순 목록이나 카드 나열이 아니라 다음 행동을 자연스럽게 유도하는가?
- 사용자가 프로젝트, 문서, 사람, 날짜, 장소, 미디어 사이를 끊김 없이 이동할 수 있는가?
- 페이지가 Project Light House의 핵심 가치인 맥락적 연결성을 강화하는가?

### 4.2 실 사용자 사용성

실제 사용자가 매일 반복해서 쓸 수 있는지를 별도 핵심 항목으로 평가한다.

- 첫 5초 안에 사용자가 이 화면에서 무엇을 할 수 있는지 이해할 수 있는가?
- 가장 자주 쓰는 행동이 1~2번의 클릭 또는 탭 안에 가능한가?
- 긴 텍스트, 많은 카드, 많은 관계 데이터가 있을 때도 피로감 없이 훑고 조작할 수 있는가?
- 사용자가 실수했을 때 되돌리기, 취소, 재시도, 상태 확인이 가능한가?
- 저장 중, 저장 완료, 실패, 오프라인 대기 상태가 명확히 보이는가?
- Empty state가 막다른 길이 아니라 다음 행동을 제안하는가?
- 페이지 이동 없이 확인해야 하는 정보는 Drawer, ContextRail, Preview로 즉시 볼 수 있는가?
- 화면 용어가 사용자의 실제 사고 흐름과 맞는가? 예: “관계”, “오늘”, “다음 작업”, “원본”, “연결된 메모”
- 반복 업무에서 불필요한 스크롤, 모달, 카드 중첩, 확인 클릭이 과도하지 않은가?
- 신규 사용자와 장기 사용자 모두에게 충분한 단서와 효율성을 제공하는가?

### 4.3 정보 구조와 라우팅

- Docs의 IA와 실제 라우트가 일치하는가?
- GNB, LNB, Breadcrumb가 현재 위치와 상위 맥락을 명확히 보여주는가?
- 목록, 상세 페이지, Drawer, ContextRail 간 진입/복귀 흐름이 끊기지 않는가?
- 딥링크로 직접 진입해도 필요한 데이터와 UI 상태가 정상 복원되는가?
- 같은 엔티티를 여러 경로에서 열 때 canonical 상세 경로가 유지되는가?

### 4.4 Contextual Connectivity

- 주요 엔티티가 `ContextBundle`, `ContextRail`, `ContextMapMini`, `ContextTimeline`, `SourceTracePanel`과 적절히 연결되는가?
- 사람, 태스크, Zettel, 날짜, 선물, 장소, 미디어, 커리어가 고립된 카드로 끝나지 않는가?
- 관계 추가, 해제, 원본 관계 확정, 멘션 동기화가 UI와 데이터 양쪽에서 일관적인가?
- 연결 정보가 과도하거나 부족하지 않고, 사용자의 다음 탐색을 돕는 밀도로 표시되는가?
- unresolved relation, duplicate, 동명이인, source-only entity가 혼란 없이 표시되는가?

### 4.5 데이터 정확성 및 D1 연동

- Mock이 아니라 실제 D1 스키마 기반 데이터가 렌더링되는가?
- AS-IS 마이그레이션 데이터가 canonical entity와 source document로 추적 가능한가?
- bridge table, source document relation, review item 조회가 스키마와 일치하는가?
- soft delete, null 값, 오래된 데이터, 중복 데이터, 누락 관계를 안전하게 처리하는가?
- 서버 쿼리 결과와 클라이언트 store가 서로 어긋나지 않는가?

### 4.6 성능

- 초기 진입 시 불필요한 bootstrap/API 중복 호출이 없는가?
- 같은 request 안에서 동일 스냅샷을 반복 조회하지 않는가?
- D1 쿼리에 N+1 패턴, 인덱스 미활용, 날짜별 순차 조회가 없는가?
- 긴 목록, 큰 텍스트, 많은 관계 그래프에 페이지네이션 또는 점진 로딩이 적용되는가?
- client component가 과도하게 커지거나 불필요한 store subscription으로 리렌더링을 유발하지 않는가?
- 성능 개선 결과가 “API 왕복 감소”, “쿼리 수 감소”, “렌더 노드 수 감소”처럼 설명 가능한가?

### 4.7 UX/UI 완성도

- 화면의 정보 밀도가 도메인 성격에 맞는가?
- Action Hub는 작업 중심, Vault는 읽기/쓰기 중심, PRM은 관계 중심, Life Ops는 날짜/리듬 중심으로 보이는가?
- 카드, 패널, Drawer, Rail이 중첩되어 답답해지지 않는가?
- 버튼, 필터, 탭, 아이콘, 상태 표시가 디자인 시스템 패턴을 따르는가?
- Loading, Empty, Error, Offline 상태가 자연스럽고 실용적인가?
- 텍스트가 카드/버튼/모바일 화면에서 넘치거나 겹치지 않는가?

### 4.8 편집 및 입력 경험

- Quick Capture, Markdown/Zettel Editor, Task Editor에서 입력 손실 가능성이 낮은가?
- `@`, `[[`, `#` 멘션이 검색, 추천, 저장, 관계 동기화까지 이어지는가?
- 긴 텍스트 작성과 읽기에 충분한 폭, 줄간격, 여백, preview 기능이 있는가?
- 저장 성공/실패/오프라인 큐 상태가 명확히 피드백되는가?
- 작성 도중 페이지 이동, Drawer 열기, 관계 탐색을 해도 작업 흐름이 깨지지 않는가?

### 4.9 반응형 및 접근성

- 375px 모바일에서 GNB/LNB, ContextRail, Drawer Stack이 사용 가능한가?
- 터치 타겟이 충분하고 주요 버튼이 손가락으로 누르기 쉬운가?
- 키보드 탐색, focus ring, aria label, semantic heading 구조가 지켜지는가?
- 색 대비와 상태 색상이 다크/라이트 테마 모두에서 읽히는가?
- 모바일에서 중요 정보가 접히더라도 발견 가능성이 유지되는가?

### 4.10 코드 아키텍처

- 화면별 코드가 비대해지지 않고 재사용 가능한 컴포넌트로 분해되어 있는가?
- 서버 데이터 로직, API route, client component, store 책임이 분리되어 있는가?
- 기존 디자인 토큰과 공통 컴포넌트를 우선 사용했는가?
- 새 기능이 마이그레이션 정제 로직이나 ai-curation 스크립트를 불필요하게 건드리지 않는가?
- 타입이 UI, 서버, API 경계를 안정적으로 설명하는가?

### 4.11 검증 가능성

- 페이지별 핵심 사용자 흐름을 수동 QA할 수 있는 명확한 경로가 있는가?
- 위험도가 높은 데이터 변경에는 테스트 또는 검증 루틴이 있는가?
- 실패 케이스를 재현할 수 있는가?
- 리뷰 결과를 이후 작업자가 바로 수정 티켓으로 바꿀 수 있을 만큼 구체적인가?

## 5. 페이지 리뷰 템플릿

각 페이지 리뷰는 아래 형식으로 작성한다.

```md
# Page Review: {Page Name}

## Summary
- Route:
- Domain:
- Primary user job:
- Overall score: /33

## Hard Gate
- [ ] typecheck/build pass
- [ ] D1 data renders
- [ ] Contextual navigation works
- [ ] Mobile 375px usable
- [ ] Source/migration trace safe

## Scores
| Category | Score | Notes |
| --- | ---: | --- |
| Product Value | 0-3 | |
| Real User Usability | 0-3 | |
| IA / Routing | 0-3 | |
| Contextual Connectivity | 0-3 | |
| Data / D1 Accuracy | 0-3 | |
| Performance | 0-3 | |
| UX/UI Polish | 0-3 | |
| Editing / Input | 0-3 | |
| Responsive / A11y | 0-3 | |
| Code Architecture | 0-3 | |
| Verifiability | 0-3 | |

## Findings
- P0:
- P1:
- P2:
- P3:

## Required Actions
- [ ] 

## Follow-up Opportunities
- 
```

## 6. 리뷰 우선순위

우선순위는 다음 순서로 둔다.

1. 데이터 유실, 잘못된 저장, 잘못된 관계 연결
2. 주요 사용자 행동 불가
3. 모바일 사용 불가
4. 과도한 D1/API latency
5. 사용자가 다음 행동을 찾지 못하는 UX 문제
6. 디자인 시스템 불일치
7. 코드 중복 및 유지보수성 문제

## 7. 완료 기준

페이지는 다음 조건을 만족할 때 완료로 본다.

- Hard Gate 전부 통과
- 전체 평균 2점 이상
- `Real User Usability`, `Contextual Connectivity`, `Data / D1 Accuracy`가 각각 2점 이상
- P0/P1 findings 없음
- 남은 P2/P3 항목이 후속 작업으로 명확히 기록됨
