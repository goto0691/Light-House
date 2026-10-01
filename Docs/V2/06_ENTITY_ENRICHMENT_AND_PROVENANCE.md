# 06. Entity Resolution, Enrichment, and Provenance

## 1. 목표

외부 보강의 목적은 글을 화려하게 만드는 것이 아니라 사용자가 언급한 현실의 대상을 정확한 정체성과 연결하는 것이다.

```text
“듄 파트 2”
→ 어떤 작품인지 resolve
→ 감독·배우·개봉 정보 보강
→ 사용자의 감상과 분리 저장
```

잘못된 개체 연결은 누락보다 위험하다. 애매하면 미확정 상태를 유지한다.

## 2. 식별 단계

```text
mention extraction
→ local candidate search
→ exact external ID match
→ grounded candidate search
→ candidate scoring
→ resolve / ask / unresolved
```

### Local candidate search

먼저 내부 DB를 검색한다.

- canonical name
- alias
- 외부 ID
- 장소 좌표·주소
- 작품 연도·유형
- 인물 관계 맥락

내부에서 확정되면 외부 호출을 생략한다.

## 3. 개체 종류별 식별 단서

### 장소

- 상호
- 지점명
- 지역·주소
- 지도 캡처
- EXIF 좌표
- 언급 메뉴
- 방문 날짜
- 전화번호

### 영화·드라마·애니

- 한국어 제목·원제
- 개봉·방영 연도
- 감독·배우
- 시즌·회차
- 포스터·타이틀 화면
- 플랫폼

### 게임

- 제목
- 플랫폼
- 출시 연도
- 개발사
- 에디션·리마스터·DLC
- 타이틀 화면

### 책

- 제목
- 저자·번역자
- 출판사
- ISBN
- 표지
- 판본·출간 연도
- 인용문 검색 단서

### 인물

- 이름·별명
- 대화 참여 맥락
- 기존 관계
- 함께 등장한 사건

외부 웹 검색으로 사적인 인물을 식별하지 않는다. 내부 자료와 사용자 확인을 사용한다.

## 4. 후보 점수

후보 점수는 모델의 단일 confidence만 사용하지 않는다.

```text
identity_score =
  name_match
  + kind_match
  + date_or_year_match
  + location_match
  + supporting_detail_match
  + external_id_match
  - conflict_penalty
```

외부 ID exact match는 가장 강한 신호다. 제목만 같은 경우에는 연도·유형·제작자 단서를 요구한다.

### 결과 정책

| 조건 | 결과 |
| --- | --- |
| 단일 고신뢰 후보, 충돌 없음 | resolved |
| 후보 2개 이상 유사 | multiple_candidates |
| 일부 단서만 있음 | candidate |
| 근거 부족 | unresolved |
| 사용자 확인 | user_confirmed |

## 5. 외부 조사 요청

3.6 Analyzer가 조사 목적과 필요한 필드를 지정하고 2.5 Enricher가 검색한다.

### Search Grounding

- 영화·드라마·애니
- 게임
- 책
- 공개 인물·조직
- 웹 스크랩 출처
- 현재 사실 확인

### Maps Grounding

- 장소 정체성
- 지점
- 주소·좌표
- 업종
- 영업시간
- 현재 영업 여부

한 요청에서 필요하지 않은 개인 원문을 전달하지 않는다. 검색 쿼리에 필요한 개체 단서만 제공한다.

## 6. 외부 필드 분류

### 안정 필드

- 영화 감독·개봉 연도
- 작품 원제
- 게임 개발사·출시일
- 책 저자·ISBN

개체가 정확히 resolve되면 장기간 재사용한다.

### 변동 필드

- 장소 영업시간
- 메뉴·가격
- 영업 상태
- 전화번호
- 스트리밍 제공 여부

`verified_at`, `valid_from`, `expires_at`을 기록하고 필요할 때 갱신한다.

### 과거 스냅샷

사용자가 방문했을 당시의 메뉴와 현재 메뉴는 별도 사실이다. 새 조사 결과로 과거 기록을 덮어쓰지 않는다.

## 7. 출처 클래스

| `source_class` | 의미 |
| --- | --- |
| `user_locked` | 사용자가 직접 수정하고 잠근 값 |
| `user_explicit` | 원문에서 직접 명시 |
| `user_context` | 문맥에서 강하게 해석 |
| `image_ocr` | 이미지 문자 추출 |
| `transcript_extract` | 녹취 발화에서 추출 |
| `exif` | 첨부 메타데이터 |
| `external_grounded` | 검색·지도 근거로 확인 |
| `calculated` | 다른 값에서 계산 |
| `ai_inferred` | 주제·정서·추천 맥락 등 추론 |
| `imported` | 이전 시스템에서 가져온 값 |

외부 사실과 AI 추론을 한 클래스에 넣지 않는다.

## 8. Provenance 레코드

각 값은 다음 메타데이터를 가질 수 있다.

```yaml
value: Denis Villeneuve
source_class: external_grounded
provider: google_search_grounding
source_url: https://...
source_title: ...
verified_at: 2026-08-11T00:00:00Z
valid_from: null
expires_at: null
confidence: 0.99
processing_run_id: RUN_ID
```

사용자 명시값은 외부 URL 대신 원문 evidence span을 가진다.

## 9. 충돌 정책

### 같은 의미, 다른 값

예: 사용자가 방문 시각을 오후 7시라고 쓰고 이미지에는 19:10이 표시됨.

- 두 값을 보존
- 정밀도와 출처를 비교
- 사용자 명시값을 기본 표시
- 필요하면 `possible_conflict` review item 생성

### 다른 의미

예: 사용자 평점 4.5, 외부 평균 4.2.

- 별도 필드
- 충돌로 취급하지 않음

### 변동 사실

예: 식당 주소 이전.

- 유효 기간이 다른 사실로 저장
- 방문 사건에는 당시 장소 snapshot 연결
- 개체 상세에는 현재 주소 기본 표시

## 10. 개체 병합

### 병합 조건

- 동일한 신뢰 가능한 외부 ID
- 사용자 확인
- 이름·종류·연도·위치 등 강한 다중 일치

### 병합 결과

- 정본 `canonical_entity_id` 지정
- alias·외부 ID·관계·필드 이동
- 원래 ID는 redirect로 유지
- merge audit log 저장
- 원본 evidence 보존

### 자동 병합 금지

- 동명이인
- 체인점의 서로 다른 지점
- 리메이크·원작
- 게임 본편과 DLC
- 책의 의미 있는 다른 판본
- 현실 인물과 창작 인물

## 11. 캐시 정책

초기 기본값이며 운영 데이터로 조정한다.

| 필드군 | 기본 갱신 |
| --- | --- |
| 작품 제작 정보 | 수동 또는 1년 |
| 책 ISBN·저자 | 수동 |
| 장소 주소·상태 | 30일 |
| 장소 영업시간 | 14일 |
| 메뉴·가격 | 30일 |
| 스트리밍 제공 | 7일 |

사용자가 개체를 열거나 변동 필드를 검색할 때 만료 여부를 확인한다. 단순 목록 열람마다 외부 호출하지 않는다.

## 12. 조사 예산

무료 grounding 할당량을 개인 사용에서 효율적으로 쓰기 위한 규칙:

- 캡처별이 아니라 고유 개체별 캐시
- 동일한 조사 요청의 dedupe
- 안정 필드는 재조회하지 않음
- 목록 렌더링 중 자동 조사 금지
- 배치 이관 전에 개체 mention을 클러스터링
- 필수 필드와 장식 필드 구분
- background queue에 일일 호출 상한 적용

외부 조사가 실패해도 내부 개체와 사용자 글은 정상 사용 가능하다.

## 13. 사용자 확인 UX

질문은 저장 전에 막지 않고 결과 화면 또는 `확인 필요함`에서 제공한다.

```text
‘모모식당’ 후보가 두 곳입니다.

○ 모모식당 연남점 — 서울 마포구 ...
○ 모모식당 합정점 — 서울 마포구 ...
○ 아직 정하지 않음
```

선택 후 같은 alias·지역 단서가 반복되면 다음 기록에서 우선 후보로 사용할 수 있다.

## 14. 사용자 평가와 외부 정보

사용자의 경험은 외부 사실의 부속물이 아니다.

```text
Place Entity
├── current address      external_grounded
├── opening hours        external_grounded
├── external rating      external_grounded
└── Visit Event
    ├── visited_at       user_explicit
    ├── ordered_menu     user_explicit
    ├── user_rating      user_explicit
    └── recommended_for  user_context
```

외부 정보 갱신이 방문 당시의 경험과 평가를 변경하지 않는다.

## 15. 이관 시 외부 조사

과거 레코드를 한 건씩 검색하지 않는다.

1. 모든 mention과 기존 외부 ID를 수집한다.
2. 정규화 이름·유형·연도·지역으로 후보 그룹을 만든다.
3. 이미 확정 가능한 내부 개체를 병합한다.
4. 고유 미확정 개체만 2.5 조사 큐에 넣는다.
5. 조사 결과를 관련 모든 레코드가 공유한다.

이 방식은 비용을 줄이고 같은 대상을 서로 다른 외부 개체로 만드는 문제를 방지한다.
