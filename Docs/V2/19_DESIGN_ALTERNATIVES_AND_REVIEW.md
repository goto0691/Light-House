# 19. Design Alternatives and Review

> 상태: A+ 최종 선택 완료  
> 기준일: 2026-08-12

## 1. 비교 방법

세 안은 같은 Library 정보구조, 같은 record, 같은 `RecordPeekPane`을 사용한다. 기능 차이가 아니라 색, 타이포그래피, 밀도, 표면, 선택 상태가 경험을 어떻게 바꾸는지 비교한다.

이미지는 분위기와 위계 reference다. 생성 과정의 글자 오탈자·임의 icon·spacing은 평가 대상이 아니며 [18_DESIGN_SYSTEM_VISUAL_BASELINE.md](./18_DESIGN_SYSTEM_VISUAL_BASELINE.md)의 contract가 우선한다.

## 2. 후보

### A. Warm Editorial Workbench — 현재안

![A. Warm Editorial Workbench](./assets/light-house-library-peek-concept-v01.png)

성격:

- warm ivory, forest green, restrained amber
- 편집물과 전문 도구 사이의 균형
- sans 중심, 읽기 mode에서만 선택적 serif
- 작성·탐색·근거 확인 어느 한쪽으로 과도하게 기울지 않음

### B. Calm Instrument — 정밀 도구형

![B. Calm Instrument](./assets/light-house-library-peek-calm-instrument-v01.png)

성격:

- fog white, ink blue, graphite
- compact row, 명확한 grid, 강한 keyboard focus
- command search와 출처 field의 구조적 정렬 강조
- 개인 기록보다 정밀한 검색·관리 도구의 인상이 강함

### C. Editorial Archive — 편집 아카이브형

![C. Editorial Archive](./assets/light-house-library-peek-editorial-archive-v01.png)

성격:

- parchment, oxblood, sage, brass
- title과 excerpt의 serif, 목차 같은 navigation
- 기록의 문학적 소유감과 장기 열람 정체성 강조
- utility UI까지 편집 언어가 침범하면 밀도와 접근성이 낮아질 위험

## 3. 휴리스틱 평가

점수는 `1~5`의 설계 가설을 가중치에 적용한 100점 환산값이다. 사용자 test 결과가 아니며 coded prototype 전 우선순위를 정하기 위한 review다.

| 기준 | 가중치 | A | B | C |
| --- | ---: | ---: | ---: | ---: |
| 저자성·개인적 애착 | 25 | 4.8 | 3.8 | 4.9 |
| 리콜·탐색 속도 | 20 | 4.5 | 4.9 | 4.1 |
| 인지 부담·주의 위계 | 15 | 4.4 | 4.6 | 4.2 |
| 출처 식별·신뢰 | 15 | 4.6 | 4.8 | 4.2 |
| 동적 type·field 확장성 | 10 | 4.6 | 4.8 | 4.1 |
| 모바일 변환 용이성 | 8 | 4.5 | 4.7 | 3.8 |
| 접근성·구현 위험 | 7 | 4.5 | 4.8 | 3.9 |
| **가중 합계 / 100** | **100** | **91.7** | **90.6** | **85.8** |

총점 차이보다 강점의 위치가 중요하다. B는 retrieval instrument로 가장 강하고 C는 authored archive로 가장 강하다. Light House는 자유 기록과 recall을 모두 핵심 목표로 하므로 A가 현재 가장 균형적이다.

## 4. 안별 Design Review

### A Review

강점:

- 본문, 사용자 명시값, 외부 정보의 위계가 자연스럽다.
- 식당, 운동, 에세이, 녹취처럼 성격이 다른 record를 같은 shell에 담기 쉽다.
- 따뜻하지만 장식적이지 않아 작성 시작의 심리적 문턱이 낮다.
- desktop과 mobile에 같은 semantic token을 적용하기 쉽다.

위험:

- ivory·green 조합만으로는 제품 고유성이 약해질 수 있다.
- raster 시안의 여유로운 row를 그대로 구현하면 대량 탐색에서 느리다.
- focus와 selected가 비슷해 keyboard 상태를 더 날카롭게 분리해야 한다.

판정: **기반으로 유지하되 B의 정밀성을 흡수할 가치가 가장 큼.**

### B Review

강점:

- 검색, row scan, 날짜 비교, source label 정렬이 가장 빠르다.
- focus·selected·active state의 구분이 분명하다.
- 동적 field와 table mode가 늘어날 때 시각적 확장성이 높다.
- compact desktop과 mobile utility UI로 축소하기 쉽다.

위험:

- 사용자를 기록자가 아니라 database operator처럼 느끼게 할 수 있다.
- 차가운 blue·white는 묵상·시·에세이 작성의 정서적 지속성을 낮출 수 있다.
- 완료·관리·업무 mode를 priming해 자유로운 초안에 자기검열을 만들 수 있다.

판정: **전체 theme보다는 list density, search, focus, field alignment의 donor로 적합.**

### C Review

강점:

- 세 안 중 가장 기억에 남고 고유한 제품 정체성이 있다.
- title과 excerpt가 metadata보다 강해 저자성과 장기 읽기에 유리하다.
- 개인 기록을 임시 데이터가 아니라 보관 가치가 있는 글로 느끼게 한다.
- essay·poetry·reflection detail과 reading mode에 특히 어울린다.

위험:

- 작은 한글 serif가 반복되면 scan speed와 저시력 접근성이 떨어진다.
- oxblood primary action은 저장 실패·위험 color와 혼동될 수 있다.
- index number는 sort가 바뀌는 동적 collection에서 영구 번호처럼 오해될 수 있다.
- mobile sheet·form·Review 같은 utility surface에 같은 어법을 유지하기 어렵다.
- 지나치게 완성된 출판물처럼 보여 rough capture에 부담을 줄 수 있다.

판정: **전체 shell보다 Record Detail title, reading mode, quote, long-form typography의 donor로 적합.**

## 5. 심리학적 비교

| 관점 | A | B | C |
| --- | --- | --- | --- |
| 인지 유창성 | 균형적 | 목록 탐색에 가장 높음 | 긴 글 읽기에 높고 utility에는 낮음 |
| encoding specificity | warm context와 안정된 위치 | 구조 단서 중심 | 타이포·편집 단서가 가장 풍부 |
| source monitoring | origin이 자연스럽게 보임 | 가장 명시적 | 편집 표현이 근거 label을 약화할 수 있음 |
| 저자성 | 작성과 정리가 균형 | 관리 도구 느낌이 강함 | 가장 높지만 완성 압박 위험 |
| attentional residue | Peek 복귀가 자연스러움 | focus 복귀가 가장 명료 | 미적 요소가 현재 과업보다 기억에 남을 수 있음 |
| autonomy | neutral assistance | system control 인상이 약간 강함 | 글의 주인은 사용자라는 인상이 강함 |

핵심 해석:

- B의 정밀함은 recall과 Review에서 이점이지만 Capture의 자유도를 시각적으로 좁힐 수 있다.
- C의 아름다움은 기록 애착을 높이지만 rough draft도 잘 다듬어야 한다는 요구로 느껴질 수 있다.
- A는 감정적·도구적 mode 사이의 전환 비용이 가장 낮다.

## 6. 권고안 A+

단순 평균 theme을 만들지 않는다. A를 명확한 기반으로 선택하고, 두 대안에서 과업별 강점만 가져온다.

### A에서 유지

- warm ivory document surface
- forest green primary와 amber user rating
- quiet border, 낮은 card 사용량
- sans 중심의 Capture·Library
- 사용자 body가 우선하는 Peek anatomy

### B에서 채택

- Library 기본 row `88px`, compact `72px`
- command hint가 있는 `OmniSearch`
- selected와 focus의 분리
- tabular date·number
- Inspector field의 column alignment
- dense table·Review surface의 cool neutral sub-surface

### C에서 제한 채택

- Record Detail title과 읽기 mode의 선택적 Korean serif
- long-form excerpt의 더 넓은 line-height
- section 간 editorial rule
- reading mode의 조용한 brass accent

### 채택하지 않음

- B의 blue primary theme 전체
- C의 oxblood primary button
- 모든 record에 순번 부여
- 작은 serif metadata와 navigation
- 여러 accent palette의 동시 사용

## 7. 결정 전 Test

세 static image에 대한 취향 투표만으로 결정하지 않는다. A+ coded prototype에서 다음 task를 검증한다.

1. 20개 목록에서 특정 식당 record 찾기
2. `Space`로 세 record를 연속 preview하고 원래 위치로 복귀
3. 평점 field가 원문의 어느 문장에서 왔는지 확인
4. 이미지와 한 문장만 넣고 저장
5. 1,500자 essay 읽기와 한 문장 수정

측정:

- task time과 navigation error
- `내 글 같다`, `다시 쓰고 싶다`, `정리해야 할 것 같다` 평가
- user input·source extraction·external fact 구분
- 10분 사용 후 시각 피로
- mobile에서의 동일 component 인식

## 8. 현재 권고

현재 권고는 **A+**다.

> A의 따뜻한 편집형 워크벤치를 유지하고, B의 조밀한 탐색·focus 문법과 C의 제한적 읽기 타이포그래피를 흡수한다.

A+를 implementation baseline으로 확정한다. 이후 visual 변경은 새로운 전체 theme 탐색이 아니라 [18_DESIGN_SYSTEM_VISUAL_BASELINE.md](./18_DESIGN_SYSTEM_VISUAL_BASELINE.md)의 token·primitive 단위 변경으로 관리한다.
