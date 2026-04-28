# AS-IS to TO-BE Schema Alignment Plan

> 작성일: 2026-04-25  
> 목적: 원본 export에 남아 있는 속성/관계/본문 구조를 먼저 분석한 뒤, 현행 Light House 스키마와 UI를 보강하고 그 다음 문서별 연결 마이그레이션을 수행하기 위한 기준서.

---

## 0. 결론

현재 데이터 정제는 "표면 노출 정리"와 "대략적 분류"까지는 진행되었지만, 원본 속성이 현행 스키마에 모두 흡수되지는 않았다. 따라서 남은 마이그레이션은 다음 순서로 진행해야 한다.

1. AS-IS 속성 인벤토리 확정
2. TO-BE 스키마 갭 보강
3. UI/컴포넌트 표시 규칙 재기획
4. 원본 zip을 staging source로 재색인
5. 규칙 기반 자동 연결
6. 가벼운 LLM 에이전트로 애매한 문서만 판정
7. 낮은 confidence 항목은 수동 검수

핵심 원칙은 "기존 데이터를 현행 스키마에 억지로 끼워 넣지 않는다"이다. 원본 AS-IS 사용성이 현행 스키마에 없으면, 먼저 TO-BE 스키마를 바꾼다.

---

## 1. 현재 진단

### 1.1. 현재 DB 상태에서 확인된 문제

| 영역 | 현재 상태 | 문제 |
|---|---:|---|
| 활성 zettel | 326 | 원본형 zettel이 다수 남아 있음 |
| 원본형 category | 222 | `Notion Markdown`, `Notion Import` 형태가 canonical Vault와 섞임 |
| raw Markdown 본문 | 199 | `# 제목`, `생성 일시`, `카테고리` 등이 본문에 그대로 남음 |
| media_logs | 503 | 318개가 `media_type = other`, 게임/영상/도서 속성 정규화 미흡 |
| daily_logs | 92 | 날짜는 있으나 일기/묵상 본문과 사람 관계가 불완전 |
| workouts | 3 | 실제 운동 로그는 적지만 title/루틴 속성 표현이 약함 |
| people | 10 | PRM canonical은 있으나 긴 인물 프로필/원본 zettel 중복이 남음 |
| daily_people 관계 | 0 | 일기/라이프 로그의 관련 인물 관계가 거의 복원되지 않음 |
| media_people 관계 | 1 | 영상 로그의 `3. 네트워크` 관계가 거의 복원되지 않음 |
| zettel_media 관계 | 19 | 미디어 원본 문서와 media_logs 연결이 일부만 남음 |

### 1.2. 본문에 남은 원본 속성 라벨

| 라벨 | 활성 zettel 내 잔존 수 | 해석 |
|---|---:|---|
| 한 줄 요약 | 187 | `zettels.summary` 또는 detail meta로 흡수 필요 |
| 생성 일시 | 107 | `original_created_at` 보존 필요 |
| 유형 | 107 | `type`, `document_kind`, media subtype 등으로 분리 필요 |
| 카테고리 | 101 | `category`/tag/saved view로 정규화 필요 |
| 상태 | 66 | Vault status 또는 media/project status로 흡수 필요 |
| 날짜 | 65 | Life Ops/media/project 날짜 필드로 흡수 필요 |
| 태그 | 21 | `tags`/`taggings`로 흡수 필요 |
| 관련인물 | 5 | PRM relation으로 흡수 필요 |
| 감독/크리에이터 | 2 | `media_logs.creator` |
| 시청상태 | 2 | `media_logs.status` |
| 플랫폼 | 2 | `media_logs.platform_or_publisher` |
| 감정 | 1 | `daily_log_entries.emotion` 또는 `daily_logs.emotions` |

---

## 2. AS-IS Source Inventory

### 2.1. 원본 zip

| 파일 | 역할 | 비고 |
|---|---|---|
| `migrations/Master DB-from notion.zip` | 전체 MASTER DB export | CSV 361개, Markdown 1011개, 이미지 9개 |
| `migrations/Pneos' Master Dashboard-from notion.zip` | Dashboard export | CSV 11개, Markdown 10개 |

두 zip 모두 `_all.csv` 파일이 중요하다. `_all.csv`에는 관계형 속성이 더 많이 남아 있다.

### 2.2. 핵심 CSV와 헤더

| AS-IS 소스 | 대략 row | 주요 헤더 | TO-BE 도메인 |
|---|---:|---|---|
| `1 지식 창고_all` | 129 | 이름, 2. 프로젝트, 관련인물, 묵상 로그, 상태, 생성 일시, 유형, 출처, 카테고리, 한 줄 요약 | Vault, Life Ops, PRM, Action Hub |
| `2 프로젝트_all` | 1 | 이름, 1. 지식 창고, 4. 라이프 오퍼레이션, 관련 인물, 뇌 에너지 소모, 대분류, 산출물 링크, 상태, 작업기간, 중요도 | Action Hub |
| `3 네트워크_all` | 6 | 이름, 1. 지식 창고, 2. 프로젝트, 4. 라이프 오퍼레이션, 그룹, 마지막 연락일, 사건, 상태, 생일, 선물, 영상 로그, 일기, 주소, 즐겨찾기 1, 핵심 가치 | PRM |
| `라이프 로그_all` | 107 | 이름, 날짜, 묵상, 오늘 묵상, 오늘 운동, 오늘 일기, 운동 로그, 일기 | Life Ops |
| `일기_all` | 54 | 제목, 감정, 관련인물, 날짜, 라이프 로그, 사건, 태그 | Life Ops, PRM |
| `묵상_all` | 43 | 본문말씀, 날짜, 라이프 로그, 배경지식 | Life Ops, Vault |
| `운동 로그_all` | 3 | 이름, 날짜, 라이프 로그, 운동 종류 | Life Ops |
| `컨텐츠 로그_all` | 327 | 이름, 감독, 게임 로그, 날짜, 도서 로그, 영상 로그, 유형, 장르, 제작사, 평가, 플랫폼, 한줄평 | Media |
| `게임 로그_all` | 172 | 이름, 개발사, 날짜, 리뷰, 상태, 장르, 컨텐츠 로그, 평점, 플랫폼, 플레이 타임 | Media/Game |
| `영상 로그_all` | 145 | 이름, 3. 네트워크, 감독/크리에이터, 날짜, 다시 볼 가치, 리뷰, 시청상태, 유형, 장르, 제작사, 컨텐츠 로그, 평점, 플랫폼 | Media/Screen, PRM |
| `도서 로그_all` | 1 | 이름, 날짜, 리뷰, 분류, 상태, 장르, 저자, 출판사, 컨텐츠 로그, 평점 | Media/Book |
| `선물_all` | 1 | 품목명, 날짜, 만족도, 비용, 사람, 사이즈/옵션, 선물 사유, 이미지 | PRM/Gifts |
| `커리어&히스토리_all` | 1 | 이름, 근무기간, 조직/소속, 카테고리 | Life Ops/Career |
| `에피소드 DB_all` | 1 | 이름, 작품 | Action Hub/Tasks |

### 2.3. 제외 또는 저우선 소스

| 소스 | 판단 |
|---|---|
| `국군수도병원 DEMIS 3.0` | 이전 직장/업무성 문서. 기본적으로 archive 또는 Vault reference 후보. 운영 도메인 핵심 데이터로 연결하지 않음 |
| `외출자 특이사항` | 이전 직장 문서. 정제 대상에서 제외 또는 archive |
| 제목 없음 CSV | 원본 relation rollup 파편일 가능성. 확실한 매핑이 될 때만 사용 |

---

## 3. 속성 매핑 결정표

### 3.1. Vault: `1 지식 창고`

| AS-IS 속성 | 현재 수용 가능 | TO-BE 처리 |
|---|---|---|
| 이름 | 가능 | `zettels.title` |
| 카테고리 | 가능 | `zettels.category` + saved view filter |
| 유형 | 부분 가능 | `zettels.type`만으로 부족. `zettels.document_kind` 추가 권장 |
| 상태 | 불충분 | `zettels.status` 추가 |
| 한 줄 요약 | 가능 | `zettels.summary` |
| 출처 | 가능 | `zettels.source`, `source_url` |
| 생성 일시 | 불충분 | `zettels.original_created_at` 추가 |
| 관련인물 | 관계 필요 | `zettel_people_relations` + relation metadata |
| 묵상 로그 | 관계 필요 | `zettel_daily_log_relations` 또는 `entity_links` |
| 2. 프로젝트 | 관계 필요 | `project_zettel_relations` 또는 `entity_links` |

### 3.2. PRM: `3 네트워크`

| AS-IS 속성 | 현재 수용 가능 | TO-BE 처리 |
|---|---|---|
| 이름 | 가능 | `people.name` |
| 그룹 | 가능 | `people.groups` |
| 생일 | 가능 | `people.birth_date` |
| 마지막 연락일 | 가능 | `people.last_contacted_at` |
| 상태 | 가능 | `people.status` |
| 나이/생일까지/생일체크 수식 | 저장하지 않음 | 생일 기반 계산 UI |
| 주소 | 가능 | `people.address` |
| 즐겨찾기 1 | 가능 | `people.is_favorite` |
| 핵심 가치 | 가능 | `people.core_value` |
| 긴 인물 본문 | 불충분 | `people.profile_body` 추가 |
| 1. 지식 창고 | 관계 필요 | `zettel_people_relations` 또는 `entity_links` |
| 2. 프로젝트 | 관계 필요 | `project_people_relations` |
| 4. 라이프 오퍼레이션 | 관계 필요 | `daily_log_people_relations` 또는 `entity_links` |
| 선물 | 가능 | `gifts` |
| 영상 로그 | 관계 필요 | `media_people_relations` + context |
| 일기 | 관계 필요 | `daily_entry_people_relations` 권장 |

### 3.3. Life Ops: `라이프 로그`, `일기`, `묵상`, `운동 로그`

| AS-IS 속성 | 현재 수용 가능 | TO-BE 처리 |
|---|---|---|
| 라이프 로그.날짜 | 가능 | `daily_logs.date` |
| 오늘 일기 | 가능 | `daily_logs.journal` rollup |
| 오늘 묵상 | 가능 | `daily_logs.meditation` rollup |
| 오늘 운동 | 부분 가능 | `workouts`와 relation 필요 |
| 일기.제목 | 불충분 | `daily_log_entries.title` 추가 |
| 일기.감정 | 부분 가능 | `daily_log_entries.emotion` + daily rollup |
| 일기.사건 | 불충분 | `daily_log_entries.event_summary` 또는 `body` |
| 일기.태그 | 가능 | `taggings` on daily entry or daily log |
| 일기.관련인물 | 관계 필요 | `daily_entry_people_relations` 권장 |
| 묵상.본문말씀 | 가능 | `daily_logs.meditation_verse`, entry-level verse |
| 묵상.배경지식 | 불충분 | `daily_log_entries.background` 추가 |
| 운동.이름 | 불충분 | `workouts.title` 추가 |
| 운동.운동 종류 | 가능 | `workouts.categories` |

결정: `daily_logs`는 날짜 단위 컨테이너로 유지하고, 원본 일기/묵상/기도/감사 같은 개별 문서는 `daily_log_entries`로 보존한다.

### 3.4. Media: `컨텐츠 로그`, `게임 로그`, `영상 로그`, `도서 로그`

| AS-IS 속성 | 현재 수용 가능 | TO-BE 처리 |
|---|---|---|
| 이름 | 가능 | `media_logs.title` |
| 유형 | 가능 | `media_logs.media_type`, `screen_kind` |
| 날짜 | 가능 | `started_at`/`completed_at`/`logged_at` 중 규칙 필요 |
| 평가/한줄평 | 가능 | `evaluation`/`review` |
| 플랫폼 | 가능 | `platform_or_publisher` |
| 장르 | 가능 | `genre` |
| 감독/감독/크리에이터 | 가능 | `creator` |
| 제작사/개발사 | 가능 | `studio` |
| 저자/출판사 | 가능 | `author`, `platform_or_publisher` |
| 평점 | 가능 | `rating` |
| 플레이 타임 | 가능 | `play_time` |
| 상태/시청상태 | 가능하지만 정규화 필요 | status map 적용 |
| 다시 볼 가치 | 가능 | `rewatch_value` |
| 3. 네트워크 | 관계 필요 | `media_people_relations` + context/source/confidence |
| 컨텐츠 로그 relation | 불충분 | parent-child media relation 또는 `entity_links` |

결정: `media_logs`는 single table 전략을 유지하되, UI에서 media_type별 필드 라벨을 다르게 보여준다. 컨텐츠 로그와 게임/영상/도서 로그의 parent-child 관계는 `entity_links`로 보존한다.

### 3.5. Action Hub: `2 프로젝트`, `에피소드 DB`

| AS-IS 속성 | 현재 수용 가능 | TO-BE 처리 |
|---|---|---|
| 이름 | 가능 | `projects.title` |
| 상태 | 가능 | `projects.status` |
| 대분류 | 가능 | `projects.category` |
| 작업기간 | 부분 가능 | `projects.start_date`, `target_date`로 파싱 |
| 중요도 | 불충분 | `projects.importance` 추가 |
| 뇌 에너지 소모 | 불충분 | `projects.brain_energy` 추가 |
| 산출물 링크 | 불충분 | `projects.artifact_url` 추가 |
| 1. 지식 창고 | 관계 필요 | `project_zettel_relations` 또는 `entity_links` |
| 4. 라이프 오퍼레이션 | 관계 필요 | `entity_links` |
| 관련 인물 | 관계 필요 | `project_people_relations` |
| 에피소드 DB | 가능 | `tasks` 또는 child project/task |

---

## 4. TO-BE Schema 보강안

### 4.1. 새 테이블

#### `daily_log_entries`

날짜 단위 `daily_logs` 아래에 여러 개의 원본 일기/묵상/기도/감사 문서를 보존한다.

| 컬럼 | 타입 | 목적 |
|---|---|---|
| id | text | ULID |
| user_id | text | 사용자 |
| daily_log_id | text | `daily_logs.id` |
| source_document_id | text nullable | staging source 연결 |
| kind | text | `journal`, `meditation`, `gratitude`, `prayer`, `event`, `note` |
| title | text nullable | 원본 제목 |
| date | text | 날짜 |
| body | text nullable | 본문 |
| emotion | text nullable | 감정 |
| event_summary | text nullable | 사건 요약 |
| verse | text nullable | 본문말씀 |
| background | text nullable | 배경지식 |
| tags_snapshot | text nullable | 원본 태그 스냅샷 |
| created_at / updated_at / deleted_at | text | 표준 타임스탬프 |

#### `daily_entry_people_relations`

일기/묵상 단위로 사람 관계를 붙인다.

| 컬럼 | 타입 | 목적 |
|---|---|---|
| daily_entry_id | text | `daily_log_entries.id` |
| person_id | text | `people.id` |
| context | text | `mentioned`, `about`, `with`, `prayer_for` |
| source_document_id | text nullable | 관계 근거 |
| confidence | real nullable | 자동 연결 신뢰도 |
| raw_value | text nullable | 원본 relation 값 |

#### `entity_links`

기존 bridge table로 표현하기 어려운 AS-IS 관계를 공통 그래프 레이어에 보존한다.

| 컬럼 | 타입 | 목적 |
|---|---|---|
| id | text | ULID |
| user_id | text | 사용자 |
| source_type | text | `project`, `zettel`, `person`, `daily_log`, `daily_entry`, `media`, `gift`, `workout` |
| source_id | text | source entity id |
| target_type | text | target entity type |
| target_id | text | target entity id |
| relation_type | text | `mentions`, `about`, `related`, `parent_of`, `recommended_by`, `watched_with`, `evidence` |
| context | text nullable | UI 표시용 문맥 |
| source_document_id | text nullable | 원본 source 근거 |
| confidence | real nullable | 자동 연결 신뢰도 |
| raw_value | text nullable | 원본 relation 텍스트 |
| created_at | text | 생성일 |

이 테이블은 기존 domain bridge를 대체하지 않는다. `media_people_relations`, `zettel_people_relations` 같은 핵심 bridge는 유지하고, `entity_links`는 근거/그래프/비정형 관계 보존용이다.

### 4.2. 기존 테이블 보강

#### `zettels`

| 추가 컬럼 | 목적 |
|---|---|
| status | 원본 `상태` 보존. `raw`, `processed`, `evergreen`, `archived` 등 |
| document_kind | 원본 `유형` 정규화. `sermon`, `sermon_note`, `essay`, `poem`, `profile_note`, `worldbuilding`, `reference` 등 |
| original_created_at | 원본 `생성 일시` |
| source_document_id | staging source 연결 |

#### `people`

| 추가 컬럼 | 목적 |
|---|---|
| profile_body | 긴 인물 프로필 본문 |
| aliases | 별칭/호칭 JSON. 일기 relation 매칭에 사용 |
| birthday_memo | 생일 관련 원본 메모가 필요할 경우 |
| source_document_id | staging source 연결 |

#### `media_logs`

| 추가 컬럼 | 목적 |
|---|---|
| logged_at | 원본 `날짜`가 완료일이 아닌 기록일인 경우 보존 |
| subtype | 영화/드라마/애니/웹소설/고전문학 등 세부 유형 |
| relation_note | `누구와 봤는지`, `누가 추천했는지` 같은 relation 맥락 |
| source_document_id | staging source 연결 |

#### `projects`

| 추가 컬럼 | 목적 |
|---|---|
| importance | 원본 `중요도` |
| brain_energy | 원본 `뇌 에너지 소모` |
| artifact_url | 원본 `산출물 링크` |
| source_document_id | staging source 연결 |

#### `workouts`

| 추가 컬럼 | 목적 |
|---|---|
| title | 원본 `이름` |
| source_document_id | staging source 연결 |

### 4.3. relation bridge metadata 보강

다음 기존 bridge table에는 공통적으로 `source_document_id`, `confidence`, `raw_value`를 추가하는 것을 권장한다.

| 테이블 | 이유 |
|---|---|
| zettel_people_relations | `관련인물` 근거 보존 |
| zettel_media_relations | 미디어 원본 zettel 병합 근거 |
| media_people_relations | `영상 로그.3 네트워크` 관계 복원 |
| daily_log_people_relations | 날짜 단위 사람 relation |
| task_people_relations | 프로젝트/작업 관련 인물 relation |
| task_zettel_relations | 프로젝트/작업 관련 지식 relation |

---

## 5. UI/컴포넌트 반영안

### 5.1. Settings/Data: Reconciliation Workbench

운영 사용 화면이 아니라 데이터 정비용 화면이다.

| 섹션 | 목적 |
|---|---|
| Source Inventory | 원본 zip의 DB별 row/header/문서 수 표시 |
| Schema Gap Matrix | AS-IS 속성이 TO-BE 어디에 들어가는지 표시 |
| Auto Mapping Queue | 규칙 기반으로 바로 연결 가능한 항목 |
| LLM Review Queue | LLM이 판정했지만 confidence가 낮은 항목 |
| Apply Batches | dry-run/apply 배치 실행 |
| Health Metrics | raw label 잔존 수, duplicate source, unlinked relations |

UI 문구에서는 특정 이전 플랫폼명을 전면에 노출하지 않고 `Legacy Source`, `Source Inventory`, `Reconciliation`을 사용한다.

### 5.2. Life Ops

| 화면 | 변경 |
|---|---|
| `/life-ops/[date]` | 상단은 daily summary, 하단에 `DailyEntryTimeline` 추가 |
| `/life-ops/diaries` | `daily_log_entries.kind = journal` 목록. 제목/감정/관련인물/tag 필터 |
| `/life-ops/meditations` | `kind = meditation` 목록. 본문말씀/배경지식/본문 표시 |
| `/life-ops/workouts` | workout title, category, source day 연결 표시 |

핵심 UX: 같은 날짜에 일기, 묵상, 운동이 분리되어 보이되 날짜 페이지에서는 하나의 하루로 합쳐져야 한다.

### 5.3. PRM

| 화면 | 변경 |
|---|---|
| `/prm/[personId]` | `profile_body`, 핵심 가치, 그룹, 생일, 마지막 연락일을 프로필 카드로 표시 |
| Timeline | 일기/미디어/선물/프로젝트/지식 문서와의 연결을 시간순으로 표시 |
| Connected Docs | 해당 사람과 연결된 zettel, daily entry, media, project를 탭으로 표시 |
| Alias editor | 수동으로 별칭 추가. 이후 relation 자동 연결에 사용 |

핵심 UX: 사람은 단순 연락처가 아니라 "기억과 문서의 중심 노드"로 보여야 한다.

### 5.4. Media

| 화면 | 변경 |
|---|---|
| `/vault/media` | game/screen/book/other 탭과 saved view 필터 강화 |
| `/vault/media/[mediaId]` | media_type별 필드 카드 분기 |
| Game detail | 개발사, 플랫폼, 플레이타임, 상태, 평점 |
| Screen detail | 감독/크리에이터, 제작사, 시청상태, 다시 볼 가치, 함께 본 사람 |
| Book detail | 저자, 출판사, 분류, 읽기 상태, 평점 |
| Related source | 원본 zettel이 있으면 "related note"로 연결하되 원본 덤프처럼 보이지 않게 표시 |

핵심 UX: media_type이 다르면 같은 데이터 카드가 아니라 다른 의미의 카드로 보여야 한다.

### 5.5. Vault

| 화면 | 변경 |
|---|---|
| `/vault/zettels` | category/type뿐 아니라 document_kind/status 필터 추가 |
| `/vault/zettels/[zettelId]` | Metadata rail: category, document_kind, status, original_created_at, related people/project/media |
| Raw-property cleanup | 본문 상단의 `생성 일시`, `카테고리`, `유형`, `한 줄 요약` 라벨은 canonical 필드로 흡수 후 본문에서 제거 |

핵심 UX: Vault에는 최종 지식/글/설교문/창작물이 남아야 하고, 원본 import 덤프는 보이지 않아야 한다.

### 5.6. Action Hub

| 화면 | 변경 |
|---|---|
| Project detail | importance, brain_energy, artifact_url 표시 |
| Related panel | 관련 인물, 지식 창고, 라이프 로그, 에피소드 표시 |
| Task detail | episode DB가 있으면 task/episode card로 표현 |

---

## 6. LLM 에이전트 사용 계획

### 6.1. 사용 판단

Gemini 3.1 Flash Lite Preview 같은 가벼운 LLM 에이전트는 적합하다. 다만 LLM은 결정 보조자이지 원본 속성 파서가 아니다.

### 6.2. 규칙 기반으로 처리할 것

| 작업 | 이유 |
|---|---|
| CSV 헤더/값 파싱 | 결정적 데이터 |
| 날짜/평점/플랫폼/장르/생일 추출 | deterministic |
| 원본 relation 문자열 기반 exact match | deterministic |
| 기존 people/media/zettel title exact match | deterministic |
| status 정규화 | mapping table로 충분 |
| DB write | 검증 가능해야 함 |

### 6.3. LLM에 맡길 것

| 작업 | 이유 |
|---|---|
| 문서의 최종 domain 판정 | 제목/본문 의미 판단 필요 |
| 원본 zettel과 canonical row 중 어느 쪽을 남길지 판단 | 중복/본문 품질 판단 필요 |
| `document_kind` 세분화 | 설교문/설교노트/묵상/편지/시/세계관 등 의미 분류 |
| 낮은 confidence relation 후보 판정 | 동명이인/별칭/문맥 판단 필요 |
| 본문 정리 요약 | raw property 제거 후 자연스러운 summary 생성 |

### 6.4. LLM 출력 JSON

```json
{
  "sourceDocumentId": "string",
  "targetDomain": "vault|life_ops|prm|media|action_hub|archive|ignore",
  "targetEntityType": "zettel|daily_entry|person|media|project|task|gift|workout",
  "targetEntityId": "string|null",
  "fieldUpdates": {},
  "relations": [
    {
      "targetType": "person|media|zettel|project|daily_entry",
      "targetId": "string|null",
      "relationType": "mentions|about|watched_with|recommended_by|related",
      "confidence": 0.0,
      "rawValue": "string"
    }
  ],
  "hideOriginalZettel": true,
  "confidence": 0.0,
  "reason": "short Korean explanation"
}
```

### 6.5. 적용 기준

| confidence | 처리 |
|---:|---|
| >= 0.92 | 자동 적용 가능 |
| 0.75 ~ 0.91 | review queue에 올리고 사람이 승인 |
| < 0.75 | 적용 금지. 수동 검수 |

---

## 7. Migration Execution Plan

### Phase A. Source 재색인

1. `migrations/*.zip`을 읽는다.
2. CSV row와 Markdown 파일을 `source_documents`, `source_document_properties`, `source_document_relations`에 staging으로 적재한다.
3. `source_type`은 UI 노출용이 아니라 내부값으로 `legacy_export`를 사용한다.
4. source table은 Settings/Data/Reconciliation 외 일반 화면에서 노출하지 않는다.

### Phase B. Schema migration

1. 위 §4의 schema 보강안을 Drizzle schema에 반영한다.
2. SQL migration을 추가한다.
3. D1에 적용 전 local/typecheck/build를 통과한다.
4. 기존 데이터는 삭제하지 않고 nullable 컬럼부터 추가한다.

### Phase C. Deterministic mapper

1. CSV source별 mapper를 만든다.
2. exact match로 canonical row를 찾는다.
3. 날짜/제목/사람 이름/미디어 제목 기반으로 confidence를 계산한다.
4. 1.0 confidence만 자동 업데이트한다.
5. 변경은 반드시 dry-run report를 먼저 생성한다.

### Phase D. LLM classifier

1. deterministic mapper가 처리하지 못한 source만 큐에 넣는다.
2. Gemini 호출은 분당/일일 제한을 지키며 batch 처리한다.
3. LLM 결과는 바로 DB에 쓰지 않고 `migration_review_items` 또는 별도 curation table에 저장한다.
4. confidence 기준으로 자동 적용/수동 검수를 분기한다.

### Phase E. Apply & cleanup

1. canonical 필드와 relation을 적용한다.
2. canonical에 병합된 원본형 zettel은 soft-hide 또는 archive한다.
3. Vault 본문에서 raw property header를 제거한다.
4. FTS와 vector index를 갱신한다.

### Phase F. Verification

| 지표 | 목표 |
|---|---:|
| active raw category (`Notion Markdown`, `Notion Import`) | 0 |
| active zettel raw property labels | 0에 수렴 |
| media `other` 비율 | 의도된 other만 남김 |
| daily entries linked to daily_logs | 100% |
| diary/meditation source with body | entry body로 보존 |
| people with duplicate raw zettels | 0 |
| daily people relation from original related people | 가능한 항목 95%+ |
| media people relation from video log network | 가능한 항목 95%+ |
| source document canonical mapping | 95%+ |
| destructive delete | final verification 전 금지 |

---

## 8. 구현 우선순위

1. `daily_log_entries`, `daily_entry_people_relations`, `entity_links` 추가
2. `zettels`, `people`, `media_logs`, `projects`, `workouts` 컬럼 보강
3. source zip 재색인 스크립트 작성
4. source별 deterministic mapper 작성
5. Settings/Data Reconciliation Workbench 기획 반영
6. Life Ops/PRM/Media/Vault 상세 화면에서 새 필드 표시
7. LLM classifier queue 재가동
8. raw zettel hide/merge cleanup

---

## 9. 다음 작업 지시

Backend 작업자는 이 문서를 기준으로 먼저 `03_DATABASE_SCHEMA.md`와 `packages/db/schema/*`를 동기화한다. Frontend 작업자는 schema migration 이후 `05_PAGE_SPECIFICATIONS.md`, `08_COMPONENT_SPECIFICATIONS.md`를 업데이트하고 각 도메인 화면에 새 필드 표시를 연결한다.

마이그레이션 작업자는 schema migration이 적용되기 전에는 더 이상 raw zettel 삭제/숨김을 진행하지 않는다. 지금은 데이터를 더 지우는 단계가 아니라, 받을 그릇을 정확히 만드는 단계다.
