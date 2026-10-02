# Project Light House V2 — Planning Index

> **작업 재개:** [루트 AGENTS.md](../../AGENTS.md) → [현재 상태](./CURRENT_WORK_STATE.md) → [50번 완료표](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md) → 해당 기능 계약/코드. GPT-6 Astra 실행 지침의 근거는 [56번](./56_ASTRA_EXECUTION_PROFILE.md)이다. 아래 전체 목록은 탐색용이며 매번 순서대로 통독하는 지시가 아니다.

> 상태: 제품·UX·구현 기획 기준선 v1.0 · I0~I8 coded vertical slice · 전체 완성 goal **active**(50번). 최신 구현·실행 핸들·검증 수치는 CURRENT_WORK_STATE를 단일 재개 진입점으로 사용한다. 이 색인의 과거 문서는 당시 evidence이며 현재 전체 제품 PASS를 대신하지 않는다. 수동/정리본 DB·HTTP·UI는58번, 새 API의 실제 V2 백업/ZIP 복원은59번, 명시 snapshot 이관은60번에 연결한다. 원격 migration·deploy·private cutover는 별도 권한 경계다.
> 작성일: 2026-08-12  
> 목적: 기존 백엔드 인프라는 재사용하되, 자유 입력과 AI 자동 구조화를 중심으로 제품을 다시 설계한다.

## 1. 제품 정의

Light House V2는 사용자가 텍스트·이미지·음성·파일을 분류하지 않고 넣어도 AI가 원문을 보존한 채 글의 유형, 개체, 사건, 관계, 평가, 속성, 주제를 구조화하고 다시 찾을 수 있게 만드는 개인 아카이브다.

핵심 문장:

> 사용자는 그냥 기록한다. 시스템은 이해하고, 조사하고, 구조화하고, 나중에 다시 찾을 수 있게 한다.

## 2. 확정 결정

| ID | 결정 |
| --- | --- |
| D-001 | 입력의 기본 단위는 텍스트 한 건이 아니라 여러 첨부를 포함할 수 있는 `Capture Bundle`이다. |
| D-002 | 사용자가 제공한 원문과 원본 파일은 AI 결과와 분리해 불변 원본으로 보존한다. |
| D-003 | 기본 데이터 문법은 문서, 개체, 사건, 관계, 평가, 속성, 근거다. |
| D-004 | 글 유형과 세부 필드는 폐쇄 enum이 아니라 레지스트리에서 진화한다. |
| D-005 | AI는 새 유형과 필드를 제안하지만 데이터베이스 DDL을 직접 변경하지 않는다. |
| D-006 | `gemini-3.6-flash`를 주 분석기로, `gemini-3.5-flash-lite`를 검색·지도 보강기로 사용한다. 2.5 Flash 종료 시점에도 역할 분리는 유지한다. |
| D-007 | 사용자 수정값 > 사용자 명시값 > 외부 근거 사실 > AI 문맥 해석 > AI 추론 순으로 우선한다. |
| D-008 | 새 유형을 이해하지 못해도 입력은 실패하지 않고 `unclassified` 상태로 저장된다. |
| D-009 | 목록은 데이터를 복제하지 않고 타입·필드·관계·날짜·의미 조건을 실행하는 뷰로 만든다. |
| D-010 | 기존 D1·R2·인증·업로드·백업 기반은 재사용하되 기존 도메인 테이블은 V2 정본으로 간주하지 않는다. |
| D-011 | Gemini 무료 등급의 제품 개선 데이터 사용은 수용 가능한 조건으로 판단하며 설계 blocker로 두지 않는다. 다만 심리적 자율성을 위해 Capture에서 `저장 후 AI 정리` 여부를 항상 확인 가능한 조작으로 제공한다. |
| D-012 | 문서 본문의 정본은 Markdown이며 시각 문서·Markdown 소스·읽기 모드가 같은 `body_markdown`을 사용한다. |
| D-013 | AI는 본문 밖의 구조 정보를 자동 생성할 수 있지만 본문 변경은 명시 요청, diff, 사용자 승인, 새 revision을 거친다. |
| D-014 | 장소·게임·운동마다 전용 화면을 늘리지 않고 document·entity·event의 범용 화면과 제한된 값 renderer를 사용한다. |
| D-015 | 서버의 `Presentation Projector`가 동적 필드를 표시 계약으로 변환하며 프론트엔드는 원시 EAV 값을 직접 해석하지 않는다. |
| D-016 | AI 필드는 별도 AI 탭에 격리하지 않고 의미에 맞는 위치에 표시한다. confidence 숫자는 일반 화면에서 숨기되, 사용자 입력이 아닌 값에는 `원문에서 추출`, `이미지에서 읽음`, `외부 출처`, `AI 해석` 같은 의미적 출처 표지를 지속적으로 표시한다. |
| D-017 | 1차 편집기는 Milkdown, Markdown 소스 모드는 CodeMirror로 구현하며 기술 스파이크의 치명 실패가 있을 때만 Tiptap으로 전환한다. |
| D-018 | 템플릿은 문서 유형이나 DB 스키마가 아니라 동적 field·relation을 참조하는 선택적 입력 안내층이다. `빈 기록`은 항상 유지한다. |
| D-019 | 템플릿의 core cue는 초기 가설로 3~5개만 제공하며 빈칸 때문에 저장을 막거나 완료율을 강요하지 않는다. 최종 개수와 노출 시점은 빈 기록·3개·5개 조건의 사용자 실험으로 결정한다. |
| D-020 | 사용자 템플릿 입력값은 AI가 덮어쓰지 않으며, 공란은 item별 허용 정책과 근거가 있을 때만 AI가 보완한다. |
| D-021 | 기존 글에서 AI가 템플릿 초안을 만들 수 있지만 literal 제거와 레지스트리 reconcile을 거치며, 사용자가 `이 템플릿 유지`를 명시적으로 선택하기 전에는 active로 게시하지 않는다. 반복 사용은 승인으로 간주하지 않는다. |
| D-022 | 게시된 template version은 불변이며 상세 화면은 템플릿이 아니라 현재 데이터의 `RecordPresentation`으로 렌더링한다. |
| D-023 | 서로 다른 날짜의 유사 기록 3건 이상에서 검증된 반복 구조가 발견되면 시스템은 `generated_draft` 템플릿을 자동 생성한다. |
| D-024 | 자동 생성 템플릿은 전역 메뉴나 빈 Capture의 첫 주의 경로에 바로 추가하지 않는다. `도움받아 쓰기`, 저장 후 제안, Template Library에서 trial로 제안하며 사용자의 명시적 유지 선택으로만 active가 된다. |
| D-025 | V2 UI는 contract renderer와 semantic input을 공유하며 template·field·object type마다 전용 React 컴포넌트를 만들지 않는다. |
| D-026 | 자동 템플릿 제안은 오류 Review와 분리하고, pattern evidence와 반복 요소를 설명하되 confidence percentage는 표시하지 않는다. |
| D-027 | 빈 Capture는 본문에 즉시 focus하는 `memory-first` 흐름을 사용한다. 사용자가 고정한 템플릿 또는 직접 연 `도움받아 쓰기`를 제외하면 AI·템플릿 제안이 사용자의 첫 문장보다 앞서지 않는다. |
| D-028 | 감정·의도·동기·성격·관계 상태·인과·약속·합의·결정 같은 개인·사회적 주장은 직접 인용 또는 사용자 확인 없이 accepted fact가 될 수 없다. |
| D-029 | AI 생성 template의 질문은 게시 전에 전제·유도·감정 편향 검사를 통과한다. `누구와 있었나요?`처럼 사실을 전제하는 질문은 `함께한 사람이 있었나요?`처럼 중립적으로 바꾼다. |
| D-030 | `normal`, `sensitive`, `restricted` 기록은 미리보기·재노출·검색 snippet·AI 처리 정책이 다르며, 민감 기록은 예상하지 못한 표면에 자동 재노출하지 않는다. |
| D-031 | 안내 밀도는 `조용히`, `균형`, `안내 중심` 중 사용자가 선택한다. 시스템은 행동만 보고 이를 자동 변경하지 않는다. |
| D-032 | AI가 만든 자기 서사와 인물 요약은 `최근 N개 기록에서`처럼 근거 범위와 시간을 한정하며 영구적 성격·관계 label을 만들지 않는다. |
| D-033 | 심리적 품질을 source attribution, 저자성, template fixation, 민감 정보 재노출, 고위험 추론 자동 확정 지표로 평가하고 release gate에 포함한다. |
| D-034 | 사용자-facing 전역 IA는 `보관함`, `탐색`, `확인할 내용` 세 목적지와 `새 기록`, `검색` 두 전역 action을 중심으로 한다. `설정`은 utility 영역에 둔다. |
| D-035 | 기본 진입점은 Dashboard가 아니라 `보관함 > 모든 기록`이다. 최근 기록은 기본 정렬일 뿐 별도 Home 화면이나 widget dashboard를 만들지 않는다. |
| D-036 | 데스크톱 검색은 상단 `OmniSearch`와 `Ctrl/Cmd+K`로 어디서나 열고 결과는 `/search` route에서 유지한다. 모바일에서는 검색을 하단 navigation의 독립 목적지로 둔다. |
| D-037 | 데스크톱은 확장 가능한 왼쪽 sidebar와 상단 utility bar, 모바일은 `보관함 · 검색 · 새 기록 · 탐색 · 더보기`의 하단 navigation을 사용한다. |
| D-038 | `템플릿`, `내 목록`, `처리 상태`는 전역 1차 목적지가 아니다. 데스크톱에서는 보관함 하위 또는 utility, 모바일에서는 `더보기` sheet에서 접근한다. |
| D-039 | 데스크톱 sidebar의 `내 목록`은 사용자가 고정한 저장 뷰 최대 5개만 바로 표시한다. 나머지는 `모든 목록`에서 관리하여 동적 데이터가 전역 메뉴를 폭증시키지 않게 한다. |
| D-040 | 반응형 셸은 `wide ≥ 1180px`, `compact 768~1179px`, `mobile < 768px` 세 구간을 사용한다. 정보는 숨기지 않고 sidebar→rail→bottom navigation, inspector→drawer→sheet로 표현만 바꾼다. |
| D-041 | `확인할 내용`은 고영향 사용자 판단이 있을 때만 count를 표시하고, AI background job 수는 navigation badge로 사용하지 않는다. |
| D-042 | 모바일 메뉴와 핵심 action은 hover·swipe gesture에 의존하지 않는다. 모든 기능은 visible control, keyboard focus, browser history로 접근 가능해야 한다. |
| D-043 | 기술 문서의 `Library`, `Explore`, `Review` route 명칭은 유지하되 사용자 UI에는 `보관함`, `탐색`, `확인할 내용`을 사용한다. |
| D-044 | 시각 방향은 `따뜻한 편집형 워크벤치`로 한다. warm light document surface, 조용한 application chrome, 조밀한 Library를 기본으로 하고 3D·전면 glass·Bento·AI gradient·chat-first UI는 채택하지 않는다. |
| D-045 | Library·Search desktop은 Linear식 Peek interaction을 흡수한 `RecordPeekPane`을 사용한다. Space·화살표·Enter·Esc로 미리보기와 전체 열기를 수행하되 mobile은 full record route를 사용한다. |
| D-046 | `OmniSearch`는 빠른 이동, 기록·개체, 저장 뷰·설정, 명령, 전체 검색을 한 overlay에서 구분하고 선택 결과 preview를 제공한다. 자연어 질의를 chat transcript로 만들지 않는다. |
| D-047 | collection의 layout·sort·group·visible field·density 상태를 `ViewDisplayMenu`에서 조절하고 active filter를 `SaveViewAction`으로 저장할 수 있게 한다. 생성된 view는 사용자 선택 없이 sidebar에 자동 pin하지 않는다. |
| D-048 | `EvidenceGutter`와 `EvidencePeek`는 Inspector field와 원문 span·image region·transcript timecode·외부 출처 사이의 양방향 이동을 제공한다. evidence는 일반 화면에서 2번 이하의 동작으로 확인 가능해야 한다. |
| D-049 | `Connections`는 관련 제목만 나열하지 않고 정확한 언급 문맥과 relation origin을 보여주는 `MentionContextCard`를 사용한다. entity·event의 관련 collection은 `RelatedViewModule`로 투영한다. |
| D-050 | Markdown 편집기는 selection toolbar, 의도 중심 slash menu, focus mode를 제공하고 mode 전환 뒤 cursor·selection·scroll을 복원한다. 본문 주변 card 장식과 상시 AI panel은 사용하지 않는다. |
| D-051 | 이미지가 충분한 collection에만 `VisualMemoryGrid`를 제공하며 기본 보관함은 list를 유지한다. 이미지 비율을 보존하고 OCR text를 이미지 위에 덮지 않는다. |
| D-052 | 재발견은 `탐색 > 다시 보기`의 opt-in `RediscoveryDeck`으로 제공한다. 한 번에 한 record와 표시 이유를 보여주며 sensitive는 별도 허용, restricted는 항상 제외하고 자동 알림·Home dashboard를 만들지 않는다. |
| D-053 | template·saved view·type·field evolution의 AI 제안은 `ExplainableSuggestionCard` anatomy를 공유한다. 근거와 변화 범위를 설명하고 한 번 사용·계속 사용·수정·관심 없음을 제공하며 자동 active·pin·navigation 생성을 금지한다. |
| D-054 | 세 visual concept는 방향 reference이고 `18_DESIGN_SYSTEM_VISUAL_BASELINE`이 색·타입·간격·상태·반응형 수치의 정본이다. 충돌 시 데이터·privacy·interaction contract와 design token이 raster 이미지보다 우선한다. |
| D-055 | 첫 coded visual prototype은 Library+Peek, Record Detail+Evidence, mobile image Capture+receipt 세 surface로 제한하며 동일 token·focus·privacy projection을 공유해야 한다. |
| D-056 | 최종 visual direction은 A+다. A `Warm Editorial Workbench`를 기반으로 B의 조밀한 탐색·focus·field alignment와 C의 제한적 읽기 typography만 흡수한다. blue primary theme, oxblood primary action, 동적 record 순번은 채택하지 않는다. |
| D-057 | type·template·saved view icon은 `lucide-react` 이름이나 SVG가 아니라 stable semantic `icon_key`를 저장한다. AI는 허용 catalog에서 최대 3개 후보만 제안하고 사용자가 유지하기 전에는 확정하지 않는다. |
| D-058 | 전용 표현은 generic fallback → data-only view preset → repo-local context module → 예외적 dedicated route의 4단계로 확장한다. 새 type이라는 이유만으로 page shell이나 route를 만들지 않는다. |
| D-059 | template은 type icon을 상속할 수 있지만 record view를 결정하지 않는다. record의 표현은 primary type presentation profile과 `Presentation Projector`가 결정하며 secondary type은 main variant를 자동 교체하지 않는다. |
| D-060 | 개인·지인 배포 범위에서는 공개 plugin SDK·marketplace·runtime AI code execution을 만들지 않는다. 새 module은 Codex가 repo-local scaffold, manifest, projection schema, privacy·responsive fixture를 함께 추가한다. |
| D-061 | 배포 기준은 personal-first다. 한 계정의 개인 archive를 우선하며 지인 배포는 독립 account·data boundary로 제공한다. shared workspace, 공동 편집, 조직 권한 때문에 core model을 복잡하게 만들지 않는다. |
| D-062 | V2는 legacy domain table을 확장하지 않고 `v2_` additive schema와 `/api/v2` route에 구현한다. legacy는 source·read-only fallback이며 dual-write하지 않는다. |
| D-063 | source commit은 D1 binding의 batch transaction에서 Capture·Source·attachment link·idempotency result·processing outbox를 함께 생성한다. AI 호출은 이 transaction 밖에서 수행한다. |
| D-064 | 개인 규모의 초기 processing topology는 D1 lease queue다. 정본·job idempotency contract를 queue implementation과 분리하고 측정된 한계가 있을 때 Cloudflare Queues/Workflows로 옮긴다. |
| D-065 | `restricted`는 server-side recent reauthentication으로 잠근다. unlock 전 title·body·field·attachment·module payload를 client에 보내거나 cache하지 않으며, MVP에서 E2EE를 주장하지 않는다. |
| D-066 | PWA·offline text/image capture·Android Web Share Target을 MVP에 포함한다. IndexedDB는 미전송 draft/outbox만 보관하고 foreground sync를 정본으로 하며 Background Sync는 보조로 사용한다. |
| D-067 | portability는 사람이 읽는 `portable`, 무손실 `migration`, private 자동 `backup` profile로 분리하고 `Lighthouse Export Bundle v1`의 Markdown·JSONL·original·checksum 계약을 사용한다. |
| D-068 | MVP download ZIP에는 자체 password encryption을 넣지 않는다. restricted는 기본 제외·재인증 후 명시 선택하며, client-held encrypted archive는 streaming·key recovery spike 뒤 P1에서 판단한다. |
| D-069 | AI model은 role alias로 route한다. 3.6 main analyzer 실패를 2.5 grounded enricher로 자동 대체하지 않으며, 실패 시 원본을 unclassified로 보존한다. |
| D-070 | AI payload는 기본적으로 plaintext 저장하지 않는다. run에는 hash·version·token·latency·검증 결과만 남기고 normal record의 opt-in 진단 payload만 암호화하여 최대 7일 보관한다. |
| D-071 | 초기 golden corpus는 서로 다른 글·이미지·스크린샷·녹취·unknown type 20건으로 구성하고, 실제 source는 git 밖 private fixture로 관리한다. source loss·user overwrite·privacy leak는 총점과 무관한 fatal failure다. |
| D-072 | 구현 검증 stack은 Vitest, Playwright, axe-core, local D1/R2, fake Gemini gateway로 한다. 실제 Gemini 평가는 일반 CI와 분리한 private versioned evaluation으로 수행한다. |
| D-073 | 구현은 coded A+·editor·D1·R2·Gemini·PWA spike → Source Foundation → Authoring/AI → Offline → Adaptive Knowledge/Retrieval → Portability/Migration → private cutover 순서의 vertical slice로 진행한다. |
| D-074 | visual editor의 Markdown 왕복 계약은 byte 동일성이 아니라 의미 구조 보존이다. Milkdown이 list marker·표 공백 등을 canonical form으로 정규화할 수 있으며, 최초 Capture 원본과 과거 revision은 working copy와 별도로 보존한다. |
| D-075 | V2 write repository는 OpenNext Cloudflare context의 Worker binding을 사용하며 source commit은 D1 `batch()` 한 번으로 수행한다. V1 REST helper의 다중 호출 fallback은 만들지 않고 Worker bundle은 WSL/Linux CI gate로 검증한다. |
| D-076 | archive 원본은 `ARCHIVE_ASSETS` private R2 binding에 opaque user key로 저장한다. signed PUT 뒤 size·MIME·SHA-256·owner metadata를 server verify하며 mismatch object는 제거하고 public URL을 정본으로 만들지 않는다. |
| D-077 | Gemini main은 3.6 structured generateContent, grounded는 3.5 Flash-Lite Interactions `google_search`로 구현한다. citation 없는 외부 사실은 accepted로 승격하지 않는다. |
| D-078 | offline service worker는 정적 capture shell만 cache한다. record/API/search/attachment 응답은 cache하지 않으며 restricted는 IndexedDB payload를 즉시 제거한다. |
| D-079 | private corpus evaluation은 20/20 source hash와 human-approved expected가 일치할 때만 열린다. slot template이나 model 출력은 사람 승인을 대체하지 않는다. |
| D-080 | grounded external fact는 resolved identity, requested canonical key, typed JSON value, 반환된 HTTPS citation URL의 fact별 참조가 모두 있을 때만 accepted로 승격한다. 자유 산문과 포괄 인용은 구조 필드가 되지 않는다. |
| D-081 | 초기 전용 context module은 `workout.metrics.v1` 하나만 code-owned allowlist로 제공한다. 나머지 type은 preset과 generic fields를 사용하며 실제 반복 가치가 확인되기 전 module을 늘리지 않는다. |

| D-082 | 기본 검색은 deterministic FTS와 typed filter를 사용하고 embedding은 private recall에서 측정 가능한 추가 이득이 있을 때만 보조 후보 생성기로 도입한다. |
| D-083 | template 입력은 source commit과 같은 transaction에서 `user_explicit`·`user_locked` 값으로 저장한다. 자동 발견 template은 `generated_draft`로만 만들고 사용자 선택 전에는 활성화하지 않는다. |
| D-084 | 다시 보기는 일반 기록 opt-in과 민감 기록의 별도 opt-in을 요구하며 `restricted` 기록은 항상 제외한다. |
| D-085 | 정제 recall baseline과 private corpus gate를 분리한다. 정제 fixture 통과는 사람 승인 private expected가 준비되지 않은 상태를 대체하지 않는다. |
| D-086 | export는 읽기용 portable과 무손실 migration을 분리하고, password encryption이 없는 ZIP의 제한을 생성·다운로드·복원 UI에서 지속적으로 알린다. |
| D-087 | private backup은 검증된 full/incremental chain과 content-addressed blob을 사용한다. daily 30·weekly 12·monthly 12·pin/manual 및 chain ancestor를 보존하고 unreferenced blob은 7일 grace 뒤에만 삭제한다. |
| D-088 | ZIP과 선택 backup은 같은 verify·dry-run·명시 승인·additive import·batch rollback 엔진을 사용한다. 기존 row 자동 overwrite와 의미 중복 자동 merge는 하지 않는다. |
| D-089 | 2026-08-28 live inventory의 migration 대상 source table 56개와 현재 in-code registry의 56개 versioned adapter가 56/56으로 일치한다. 모든 row를 immutable envelope로 보존하되 글·명확한 typed value만 deterministic projection하고 운영/UI/관계 raw archive는 restricted export에서만 내보낸다. 인증 table과 파생 FTS table은 migration source에서 제외한다. |
| D-090 | legacy migration은 AI 없이 수행한다. 실행 전에 legacy write를 잠그고, 모든 비어 있지 않은 table의 source-only와 현재 schema/row/projection hash 대조를 완료한 뒤 같은 dry-run의 knowledge pass를 연다. |
| D-091 | private cutover는 `capture_default` → `library_default` → `closure` 세 단계의 fail-closed evidence gate로 진행한다. 도구는 플래그를 직접 변경하지 않고 모든 gate가 통과했을 때만 추천 환경변수를 출력한다. |
| D-092 | V1 archive mutation은 `FLAG_V2_LEGACY_READONLY`가 켜지면 명시적 route allowlist 기반 API network boundary에서 409로 거부한다. 인증 session·계정 설정·export·notification·preview는 archive mutation이 아니므로 유지하고 V2 API는 같은 guard에서 제외한다. |
| D-093 | Capture 기본 전환은 owner 14일 관찰·private corpus·live runtime·device·migration·snapshot gate 뒤에만 가능하다. Library/Search 기본 전환은 그 뒤 7일 관찰과 top-10 recall 90%를 추가로 요구하며 rollback은 UI route만 되돌린다. |
| D-094 | production Next/OpenNext build는 Windows의 Turbopack traced junction 문제를 피하고 재현 가능한 Worker bundle을 만들기 위해 Webpack을 사용한다. Next 16 Node Proxy를 OpenNext가 지원할 때까지 작은 V1 write guard만 deprecated Edge middleware에 격리한다. |
| D-095 | Worker 배포 전 Wrangler dry-run으로 binding과 gzip 크기를 검증한다. Next immutable static asset은 1년 cache하고 service worker는 no-store로 갱신한다. |
| D-096 | migration 성공은 persisted batch manifest·item progress·mapping dependency·reconciliation receipt를 D1에서 다시 검증해야 한다. 손상된 `succeeded` 표식이나 client offset은 성공 근거가 아니다. |
| D-097 | source-only object와 knowledge 결과는 archived/`knowledge_pending`으로 격리한다. 한 요청은 projection 1개만 처리하고, batch finalization에서 이전 mapping supersede와 새 projection 승격을 원자적으로 수행한다. |
| D-098 | migration export와 private backup의 현재 로컬 구현 schema는 `v2-032`다. 지원 archive revision은 `v2-017`, `v2-018`, `v2-020`, `v2-030`, `v2-031`, `v2-032`이며 공개·지원된 적 없는 `v2-019`는 건너뛴다. 실제 값은 `portability-contract-v1.ts`와 canonical registry를 기준으로 확인한다. 누적 metadata와 DB 고유 `schema_version`을 보존하며, 과거 archive에서 이미 소실된 값은 추정 복원하지 않는다. 기본 호환 계약은 23번, 0031/0032 후속 계약·검증 경계는 52·54·58번을 따른다. 원격 적용이나 새 정리본 API의 전체 복원 검증 완료를 뜻하지 않는다. |
| D-099 | legacy importer가 만든 object는 연결 mapping이 모두 `projected`일 때만 일반 Library·Search·Record·AI·template 표면에 나타난다. 하나라도 미승격 또는 알 수 없는 상태면 fail-closed로 숨기며 원본 envelope와 migration workbench는 보존한다. |
| D-100 | `portable` export는 사용자가 고른 privacy·trash·history·original 범위를 따르는 읽기용 묶음이다. `migration` export는 계정 왕복 복구용이므로 normal·sensitive·restricted, trash, history, originals를 항상 포함하고 생성·재개·download에 recent reauthentication을 요구한다. |
| D-101 | canonical export는 row의 `user_id`만 검사하지 않고 같은 owner와 선택 scope 안의 필수 parent가 존재하는 child만 포함한다. cross-owner 또는 orphan foreign reference를 archive에 싣지 않으며 restore도 referential closure를 검증한다. |
| D-102 | 반복 패턴으로 생성하는 template은 template·immutable version·source link·관찰 outcome을 한 D1 batch에 기록하고 검증된 마지막 단계에서만 `current_version_id`를 게시한다. 중간 실패는 draft provenance까지 함께 rollback한다. |
| D-103 | analysis·grounded provider 호출은 입력 visibility를 읽은 뒤 gateway 호출 직전에 object별 invocation lease를 원자적으로 얻는다. 유효 lease 동안 mapping 격리·object archive/delete·batch quarantine으로 그 입력을 숨길 수 없고 terminal 처리와 같은 batch에서 lease를 해제한다. |
| D-104 | 손상되거나 중단된 migration batch는 원본 envelope를 삭제하는 rollback이 아니라 revision-CAS와 provenance assertion을 거치는 quarantine으로 격리한다. 이전 source-only/projected basis가 증명되는 mapping만 복구하고 receipt를 남긴다. |
| D-105 | 링크 수집은 URL 원본 저장과 비동기 원문 확보를 분리한다. `link_only`·`partial`·`captured`를 구분하고 접근 실패 시 원문 붙여넣기/첨부로 이어간다. |
| D-106 | 프롬프트 레퍼런스는 예시 이미지와 원문 fragment를 연결하며 작성자의 이어쓰기와 타인 답글을 구분한다. AI 요약·번역은 원문을 덮지 않고 `원문 복사`는 검증된 source 범위만 복사한다. |
| D-107 | 영상 기억은 분석 구간·timecode·자막/영상 근거를 보존한다. 링크나 요약만 저장된 상태를 원본 영상 보관으로 부르지 않으며 provider capability 확인 전 자동 수집을 활성화하지 않는다. |
| D-108 | 링크의 provider는 수집 방법만 결정한다. 보관 목적·확보된 내용·사용자 선택으로 대표 화면과 보조 모듈을 조합하며 미지원 유형도 범용 자료로 저장한다. |
| D-109 | 여러 게시물의 prompt는 조각별 원문과 관계·순서·누락을 보존한다. 같은 작성자라는 이유로 합치지 않고 이어 복사는 추적 가능한 파생 조립본으로 구분한다. |
| D-110 | 외부 인사이트는 글쓴이의 주장과 내 의견을, 구도 팁은 저자의 설명과 AI 시각 해석을, 추천 자료는 관심과 내 실제 경험을 분리한다. |
| D-111 | 링크 입력은 한 기록의 여러 source와 파생 카드를 기본으로 하며 독립 문서 추출은 사용자가 요청한다. 같은 URL의 다른 선택 구간·메모는 중복 제거로 소실시키지 않는다. |
| D-112 | 원문 확보·AI 분석·첨부 보관을 별도 상태로 표시한다. 목적 변경은 원문 재수집을 강제하지 않으며 옛 인용·조립본·사용자 메모는 당시 snapshot 근거를 유지한다. |
| D-113 | 첫 실제 경로는 기존 source metadata의 versioned namespace로 수동 원문을 보존한다. 이어 수집이 없는 단계에서 snapshot/fragment 전체 구현을 주장하지 않으며, 후속 job/CAS·이동성 계약과 함께 확장한다. |
| D-114 | 수동 링크의 외부 저자·확보 범위를 이해하는 전용 loader 전에는 해당 기록의 AI 분석을 비활성화한다. 링크만 저장한 상태를 외부 원문·이미지·영상 분석 완료로 표시하지 않는다. |

## 3. 문서 지도

| 순서 | 문서 | 산출물 |
| ---: | --- | --- |
| 1 | [00_PRODUCT_CHARTER.md](./00_PRODUCT_CHARTER.md) | 제품 목표, 범위, 성공 조건 |
| 2 | [01_GOLDEN_CORPUS_AND_RECALL_SCENARIOS.md](./01_GOLDEN_CORPUS_AND_RECALL_SCENARIOS.md) | 실제 자료 기반 테스트셋 계획 |
| 3 | [02_CONCEPTUAL_DATA_MODEL.md](./02_CONCEPTUAL_DATA_MODEL.md) | 정본 데이터 구조와 불변 조건 |
| 4 | [03_DYNAMIC_TYPE_FIELD_REGISTRY.md](./03_DYNAMIC_TYPE_FIELD_REGISTRY.md) | 새 유형·필드 발견과 승격 규칙 |
| 5 | [04_AI_PROCESSING_CONTRACTS.md](./04_AI_PROCESSING_CONTRACTS.md) | Gemini 이원화 처리와 JSON 계약 |
| 6 | [05_MULTIMODAL_CAPTURE_AND_EVIDENCE.md](./05_MULTIMODAL_CAPTURE_AND_EVIDENCE.md) | 이미지·OCR·녹취·근거 처리 |
| 7 | [06_ENTITY_ENRICHMENT_AND_PROVENANCE.md](./06_ENTITY_ENRICHMENT_AND_PROVENANCE.md) | 개체 식별, 외부 조사, 출처 정책 |
| 8 | [07_RETRIEVAL_VIEWS_AND_UX.md](./07_RETRIEVAL_VIEWS_AND_UX.md) | 검색, 자동 목록, 핵심 화면 흐름 |
| 9 | [08_MIGRATION_AND_BACKEND_REUSE.md](./08_MIGRATION_AND_BACKEND_REUSE.md) | 기존 데이터와 백엔드 전환 계획 |
| 10 | [09_EVALUATION_AND_ROADMAP.md](./09_EVALUATION_AND_ROADMAP.md) | 품질 기준, 단계별 개발 로드맵 |
| 11 | [10_AUTHORING_AND_DOCUMENT_LIFECYCLE.md](./10_AUTHORING_AND_DOCUMENT_LIFECYCLE.md) | Markdown 편집, 저장, revision, AI 본문 경계 |
| 12 | [11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md](./11_ADAPTIVE_RECORD_UI_AND_AI_FIELDS.md) | 범용 화면 컴포넌트와 AI 필드 표시 계약 |
| 13 | [12_ADAPTIVE_CAPTURE_TEMPLATES.md](./12_ADAPTIVE_CAPTURE_TEMPLATES.md) | 회상 단서형 템플릿, 공란 의미, AI 보완 계약 |
| 14 | [13_COMPONENT_ARCHITECTURE_AND_INTERACTIONS.md](./13_COMPONENT_ARCHITECTURE_AND_INTERACTIONS.md) | 화면·컴포넌트 계층, 상태, 상호작용, 구현 순서 |
| 15 | [14_PSYCHOLOGICAL_UI_UX_SPEC.md](./14_PSYCHOLOGICAL_UI_UX_SPEC.md) | 기억 우선 Capture, 의미적 출처, 민감 기록, 컴포넌트 UI/UX 상세 |
| 16 | [15_INFORMATION_ARCHITECTURE_AND_RESPONSIVE_NAVIGATION.md](./15_INFORMATION_ARCHITECTURE_AND_RESPONSIVE_NAVIGATION.md) | 전반 IA, 데스크톱·모바일 메뉴, 반응형 셸과 화면 패턴 |
| 17 | [16_PLANNING_GAPS_AND_COMPLETION_GATES.md](./16_PLANNING_GAPS_AND_COMPLETION_GATES.md) | 남은 기획 파트, 우선순위, 결정 시점과 기획 완료 조건 |
| 18 | [17_VISUAL_DESIGN_AND_BENCHMARK_ADOPTION.md](./17_VISUAL_DESIGN_AND_BENCHMARK_ADOPTION.md) | 웹 디자인 방향, 벤치마크 채택, Peek·evidence·backlink·재발견 계약 |
| 19 | [18_DESIGN_SYSTEM_VISUAL_BASELINE.md](./18_DESIGN_SYSTEM_VISUAL_BASELINE.md) | canonical visual reference, token, typography, layout metric, component state와 coded prototype gate |
| 20 | [19_DESIGN_ALTERNATIVES_AND_REVIEW.md](./19_DESIGN_ALTERNATIVES_AND_REVIEW.md) | 현재안·정밀 도구형·편집 아카이브형 비교, 심리학적 review와 A+ 권고 |
| 21 | [20_ICON_AND_VIEW_EXTENSION_CONTRACT.md](./20_ICON_AND_VIEW_EXTENSION_CONTRACT.md) | semantic icon catalog, view preset, context module, Codex 확장과 fallback 계약 |
| 22 | [21_IMPLEMENTATION_ARCHITECTURE_AND_SECURITY.md](./21_IMPLEMENTATION_ARCHITECTURE_AND_SECURITY.md) | source-first runtime, D1·R2 경계, 인증, privacy, 삭제 lifecycle |
| 23 | [22_OFFLINE_SYNC_AND_MOBILE_SHARE.md](./22_OFFLINE_SYNC_AND_MOBILE_SHARE.md) | PWA, IndexedDB outbox, device conflict, Web Share Target와 fallback |
| 24 | [23_EXPORT_BACKUP_RESTORE_CONTRACT.md](./23_EXPORT_BACKUP_RESTORE_CONTRACT.md) | Export Bundle v1, backup retention, restore dry-run과 round-trip |
| 25 | [24_AI_RUNTIME_AND_OPERATIONS.md](./24_AI_RUNTIME_AND_OPERATIONS.md) | model role, queue, retry, idempotency, quota, observability와 runbook |
| 26 | [25_GOLDEN_CORPUS_AND_VALIDATION_HARNESS.md](./25_GOLDEN_CORPUS_AND_VALIDATION_HARNESS.md) | private corpus 20건, test stack, scoring, UX·privacy release gate |
| 27 | [26_LEGACY_INVENTORY_AND_CUTOVER_RUNBOOK.md](./26_LEGACY_INVENTORY_AND_CUTOVER_RUNBOOK.md) | live inventory, adapter coverage, source-only migration, cutover·rollback |
| 28 | [27_IMPLEMENTATION_DELIVERY_PLAN.md](./27_IMPLEMENTATION_DELIVERY_PLAN.md) | implementation milestone, first backlog, feature flag, Definition of Done |
| 29 | [28_I0_IMPLEMENTATION_EVIDENCE.md](./28_I0_IMPLEMENTATION_EVIDENCE.md) | I0-001~008 구현 상태, 자동 검증, 시각 QA, 보안 기준선과 다음 spike |
| 30 | [29_I0_EDITOR_SPIKE_EVIDENCE.md](./29_I0_EDITOR_SPIKE_EVIDENCE.md) | Milkdown·CodeMirror 편집기 spike, Markdown 왕복, IME, 대용량·responsive QA |
| 31 | [30_I0_D1_TRANSACTION_SPIKE_EVIDENCE.md](./30_I0_D1_TRANSACTION_SPIKE_EVIDENCE.md) | D1 binding batch, rollback injection, concurrent idempotency와 OpenNext runtime 경계 |
| 32 | [31_I0_R2_UPLOAD_VERIFY_SPIKE_EVIDENCE.md](./31_I0_R2_UPLOAD_VERIFY_SPIKE_EVIDENCE.md) | private R2 key, signed PUT, checksum verify, streaming read와 mismatch cleanup |
| 33 | [32_I0_GEMINI_ROLE_CAPABILITY_EVIDENCE.md](./32_I0_GEMINI_ROLE_CAPABILITY_EVIDENCE.md) | 3.6 structured main, 3.5 Flash-Lite grounded citation, failure boundary와 live probe gate |
| 34 | [33_I0_OFFLINE_SHARE_SPIKE_EVIDENCE.md](./33_I0_OFFLINE_SHARE_SPIKE_EVIDENCE.md) | IndexedDB restart, PWA shell, Share Target와 restricted local policy |
| 35 | [34_I0_PRIVATE_CORPUS_MANIFEST_EVIDENCE.md](./34_I0_PRIVATE_CORPUS_MANIFEST_EVIDENCE.md) | private 20 slot, 5 expected draft, hash·approval evaluation gate |
| 36 | [35_I1_SOURCE_FOUNDATION_EVIDENCE.md](./35_I1_SOURCE_FOUNDATION_EVIDENCE.md) | additive V2 source/document 정본, user 격리, capture·attachment API와 실제 Capture/Record UI |
| 37 | [36_I2_AUTHORING_AND_LIBRARY_EVIDENCE.md](./36_I2_AUTHORING_AND_LIBRARY_EVIDENCE.md) | 실제 Library·편집기, immutable revision, conflict fork, restricted 재인증과 private 원본 |
| 38 | [37_I3_AI_PIPELINE_BASELINE_EVIDENCE.md](./37_I3_AI_PIPELINE_BASELINE_EVIDENCE.md) | outbox·D1 lease queue, AnalysisEnvelope validation, retry·stale 보호 coded baseline |
| 39 | [38_I4_OFFLINE_PWA_AND_SHARE_EVIDENCE.md](./38_I4_OFFLINE_PWA_AND_SHARE_EVIDENCE.md) | encrypted local draft, exact-once foreground sync, PWA·Share Target 구현 근거 |
| 40 | [39_I5_ADAPTIVE_KNOWLEDGE_AND_REVIEW_EVIDENCE.md](./39_I5_ADAPTIVE_KNOWLEDGE_AND_REVIEW_EVIDENCE.md) | 가변 registry, 구조화 grounded fact, 안전한 presentation, Review와 evidence 왕복 구현 근거 |
| 41 | [40_I6_RETRIEVAL_TEMPLATES_AND_REDISCOVERY_EVIDENCE.md](./40_I6_RETRIEVAL_TEMPLATES_AND_REDISCOVERY_EVIDENCE.md) | deterministic 검색·저장된 뷰, 적응형 template, opt-in 다시 보기와 recall baseline 구현 근거 |
| 42 | [41_I7_PORTABILITY_BACKUP_RESTORE_AND_MIGRATION_EVIDENCE.md](./41_I7_PORTABILITY_BACKUP_RESTORE_AND_MIGRATION_EVIDENCE.md) | streaming export, backup chain·retention, restore·rollback, 36개 legacy adapter와 live gate 근거 |
| 43 | [42_I8_PRIVATE_CUTOVER_IMPLEMENTATION_AND_RELEASE_GATES.md](./42_I8_PRIVATE_CUTOVER_IMPLEMENTATION_AND_RELEASE_GATES.md) | staged cutover state machine, V1 read-only guard, Worker package와 아직 남은 private release gate |
| 44 | [43_I8_LEGACY_MIGRATION_HARDENING_EVIDENCE.md](./43_I8_LEGACY_MIGRATION_HARDENING_EVIDENCE.md) | `0018`~`0025` 시점의 persistent migration manifest·reconciliation, global source gate, restore lease hardening 근거 |
| 45 | [44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md](./44_I8_VISIBILITY_PORTABILITY_AND_INVOCATION_HARDENING_EVIDENCE.md) | `0026`~`0029`, nonprojected visibility, quarantine, export owner·scope closure, template 원자 게시, provider invocation fence와 당시 remote pending 경계 |
| 46 | [45_LINK_CAPTURE_AND_PROMPT_LIBRARY.md](./45_LINK_CAPTURE_AND_PROMPT_LIBRARY.md) | Threads 작성자 이어쓰기·텍스트 첨부, 예시 이미지/원문 prompt 복사, 영상 기억과 adapter 접근 경계 |
| 47 | [46_AUDIT_REMEDIATION_EVIDENCE.md](./46_AUDIT_REMEDIATION_EVIDENCE.md) | 저장·권한·백업·AI·탐색 감사 개선, `0030` 로컬 migration 및 통합 검증 경계 |
| 48 | [47_LINK_CAPTURE_CASEBOOK_AND_ROUTING.md](./47_LINK_CAPTURE_CASEBOOK_AND_ROUTING.md) | 18개 보관 사례, 분할 prompt·인사이트·Instagram 구도 팁·영상 목적별 처리, 혼합 입력·공통 컴포넌트·검증 조건 |
| 49 | [48_LINK_CAPTURE_WORKED_EXAMPLES_AND_UI_REVIEW.md](./48_LINK_CAPTURE_WORKED_EXAMPLES_AND_UI_REVIEW.md) | 대표 입력 4개·변형 12개, 출처 기반 예상 결과와 상호작용 시연, 합성 검증 및 실제 기능 미구현 경계 |
| 50 | [49_MANUAL_LINK_CAPTURE_IMPLEMENTATION_EVIDENCE.md](./49_MANUAL_LINK_CAPTURE_IMPLEMENTATION_EVIDENCE.md) | 수동 URL·원문 정본 저장, metadata·권한·오프라인·백업 왕복, Record 개별 복사와 후속 snapshot/AI 경계 |
| 51 | [50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md) | 전체 완성 goal, 실행·종료 지침, G01–G11 완료표와 남은 승인/검증 경계 |
| 52 | [51_EXPLICIT_SHARE_CONVERSION_EVIDENCE.md](./51_EXPLICIT_SHARE_CONVERSION_EVIDENCE.md) | OS 공유 draft의 명시적 출처 전환, 원본 보존·중복/undo, 데스크톱·모바일 검증 |
| 53 | [52_LINK_SNAPSHOT_AND_ANALYSIS_FOUNDATION.md](./52_LINK_SNAPSHOT_AND_ANALYSIS_FOUNDATION.md) | 0031 snapshot·membership·조각·근거, 원문 블록 선택 AI, lease/CAS와 backup/restore 연결·현재 한계 |
| 54 | [53_LINK_RECORD_VERTICAL_INTEGRATION.md](./53_LINK_RECORD_VERTICAL_INTEGRATION.md) | Record 원문 버전·명시 분석·발췌 확인 API/UI, 재시도·재분석, 기존 restricted 검토 개선과 통합 증거 |
| 55 | [54_PROMPT_CURATION_IMPLEMENTATION_CONTRACT.md](./54_PROMPT_CURATION_IMPLEMENTATION_CONTRACT.md) | G06 정밀 발췌·버전 있는 정리본·조각 순서/이미지 대응·역할별 복사·이관/undo·이동성 구현 계약 |
| 56 | [55_EDITOR_RECOVERY_PRIVACY_HARDENING.md](./55_EDITOR_RECOVERY_PRIVACY_HARDENING.md) | 기존 편집 복구의 탭 간 privacy 경합, 서버 정책 문맥·조회 중 grant 만료 보강과 검증 경계 |
| 57 | [56_ASTRA_EXECUTION_PROFILE.md](./56_ASTRA_EXECUTION_PROFILE.md) | Astra 지침 감사·자율 실행·병렬 소유권·검증 범위 정비 근거 |
| 58 | [57_REGRESSION_AND_WORKER_INTEGRATION.md](./57_REGRESSION_AND_WORKER_INTEGRATION.md) | 잔여 회귀 4건·늦은 실패 저장·retention 전체·secret-safe Worker 통합 근거 |
| 59 | [58_MANUAL_FRAGMENT_STORAGE_AND_CURATION_PROGRESS.md](./58_MANUAL_FRAGMENT_STORAGE_AND_CURATION_PROGRESS.md) | 실제 수동 발췌 DB/API·정확 범위·읽기/쓰기 fence·0032 정리본 이동성 진행 |
| 60 | [59_PROMPT_CURATION_API_PORTABILITY.md](./59_PROMPT_CURATION_API_PORTABILITY.md) | 실제 HTTP 생성/edit/undo·V2 full/delta/ZIP 동일성·fresh/repeat 복원 결합 |
| 61 | [60_PROMPT_CURATION_SNAPSHOT_MIGRATION.md](./60_PROMPT_CURATION_SNAPSHOT_MIGRATION.md) | 명시 이관 미리보기·정확 후보·새 수동 발췌/그룹 atomic 저장·권한/receipt 검증 |
| 62 | [61_PROMPT_CURATION_MIGRATION_UI.md](./61_PROMPT_CURATION_MIGRATION_UI.md) | 명시 이관 확인 화면·정확 응답 검증·권한/재시도/모바일 회귀 |
| 63 | [62_LINK_SNAPSHOT_DRAFT_RECOVERY.md](./62_LINK_SNAPSHOT_DRAFT_RECOVERY.md) | 분리된 링크 기기 사본·공유 개인정보 정책·명시 snapshot 초안 복구 |
| 64 | [63_LINK_DRAFT_SESSIONS_AND_MANUAL_RECOVERY_CONTRACT.md](./63_LINK_DRAFT_SESSIONS_AND_MANUAL_RECOVERY_CONTRACT.md) | 여러 초안 park·저장 완료 token·수동 발췌 복구 parser/receipt 계약 |
| 65 | [64_MANUAL_FRAGMENT_RECOVERY_AND_REPLAY.md](./64_MANUAL_FRAGMENT_RECOVERY_AND_REPLAY.md) | 실제 수동 발췌 복구·인증 오류 후 명시 복귀·과거 pending 읽기 재생 |
| 66 | [65_PROMPT_CURATION_DRAFT_CONTRACT.md](./65_PROMPT_CURATION_DRAFT_CONTRACT.md) | 정리본 create/edit/undo/archive/unarchive 초안·pending 순수 복구 계약 |
| 67 | [66_PROMPT_CURATION_RECOVERY_AND_RECEIPTS.md](./66_PROMPT_CURATION_RECOVERY_AND_RECEIPTS.md) | 실제 정리본 초안·미확인 요청 복구와 원문/이미지/전이 receipt 검증 |
| 68 | [67_EXACT_HISTORICAL_AI_EVIDENCE.md](./67_EXACT_HISTORICAL_AI_EVIDENCE.md) | 과거 AI 조각의 정확 인증 근거 조회·재시도 및 병렬 읽기 권한 오류 우선 처리 |
| 69 | [68_PROMPT_CURATION_MIGRATION_RECOVERY.md](./68_PROMPT_CURATION_MIGRATION_RECOVERY.md) | 이관 검토/미확인 요청 기기 복구·과거 target 재생·독립 park와 권한 처리 |
| 70 | [69_MIGRATED_CURATION_PORTABILITY.md](./69_MIGRATED_CURATION_PORTABILITY.md) | 이관 그룹·base-present 삭제 증분의 실제 이동성, 원본/대상 ID 충돌 복원 보완 |
| 71 | [70_ORIGIN_AWARE_SEARCH_LOCATIONS.md](./70_ORIGIN_AWARE_SEARCH_LOCATIONS.md) | 출처별 canonical 검색·정확 locator·과거 원문/발췌/AI/정리본 조회와 로컬 UI 검증 |
| 72 | [71_SAVED_VIEW_DISPLAY.md](./71_SAVED_VIEW_DISPLAY.md) | 저장 뷰 실제 레이아웃·밀도·그룹·필드 표시와 content-CAS 설정 편집 |
| 73 | [72_SAVED_FIELD_READ_BUDGET.md](./72_SAVED_FIELD_READ_BUDGET.md) | 긴 필드의 명시적 읽기 예산·정확 복사·선택 필드 이름 복구와 경계 검증 |
| 74 | [73_COMPLETE_CATALOG_DISCOVERY.md](./73_COMPLETE_CATALOG_DISCOVERY.md) | 분류·대상·시간과 내 목록 전체 검색/페이지·모바일 More 진입과 경계 검증 |
| 75 | [74_RECORD_MODULE_BOUNDARIES.md](./74_RECORD_MODULE_BOUNDARIES.md) | Record 맞춤 보기의 개인정보 projection·연결 대상 권한·version/shape/오류 격리 검증 |
| 76 | [75_GLOBAL_PROCESSING_STATUS.md](./75_GLOBAL_PROCESSING_STATUS.md) | 전역 처리 상태의 저장/분석 구분·읽기 전용 목록·현재 입력별 집계, 로컬 검증 완료 |
| 77 | [76_ASTRA_SOL_DELIVERY_HANDOFF.md](./76_ASTRA_SOL_DELIVERY_HANDOFF.md) | Astra/Sol 책임 분리, 기존 체크아웃 Sol 인계, S0/S1 첫 전달 범위와 종료 기준 |
| 78 | [77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md) | 글·이미지 분석에서 Record/Review/검색 연결, 출처·권한 보완과 실제 제공자 확인 경계 |
| 79 | [78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md) | 성공 분석 후 3문서·3일 패턴 관찰, 비활성 초안·사용자 선택·새 Capture 연결과 검증 범위 |
| 80 | [79_S3_PUBLIC_WEB_COLLECTION.md](./79_S3_PUBLIC_WEB_COLLECTION.md) | 정확 호스트 허용 공개 웹 텍스트 수집, 불변 원문/부분 상태·수동 보완과 로컬 검증 범위 |
| 81 | [80_S4_YOUTUBE_VIDEO_ANALYSIS.md](./80_S4_YOUTUBE_VIDEO_ANALYSIS.md) | 공개 YouTube 구간의 명시적 AI 영상 노트, 시각 근거·출처 증명·할당량 공유와 검증 범위 |
| 82 | [81_S5_NATURAL_LANGUAGE_RECALL.md](./81_S5_NATURAL_LANGUAGE_RECALL.md) | 자연어 질문을 허용된 query plan으로 해석하는 명시적 리콜, 카탈로그·위험 필드 경계와 검증 범위 |
| 83 | [82_CLOUD_LINUX_COMPLETION_EVIDENCE.md](./82_CLOUD_LINUX_COMPLETION_EVIDENCE.md) | Cloud Linux 재현, 분석/템플릿/정렬/평가 gate 보완과 통합 검증·운영 한계 |
| 84 | [83_PRIVATE_EVALUATOR_FOUNDATION.md](./83_PRIVATE_EVALUATOR_FOUNDATION.md) | 오프라인 기록 관측의 결정적 비교·20/20 private gate·내용 없는 보고서와 승격 차단 |
| 85 | [85_WINDOWS_COMPLETION_CANDIDATE.md](./85_WINDOWS_COMPLETION_CANDIDATE.md) | 현재 Windows 통합 후보·사용자 위임 Notion 평가·원격 준비와 Android 확인 경계 |
| 현재 | [CURRENT_WORK_STATE.md](./CURRENT_WORK_STATE.md) | 재개 위치·종료 프로세스·최신 검사 범위·미해결 실패·다음 작업 |

## 4. 기획 원칙

1. 실제 자료가 추상적 분류표보다 우선한다.
2. 저장 실패보다 미분류 저장을 선택한다.
3. 원문, 추출, 외부 사실, AI 추론을 한 값으로 섞지 않는다.
4. 사용자가 자주 찾는 값만 고성능 필드로 승격한다.
5. 자동화는 입력을 방해하지 않고 저장 후 비동기로 진행한다.
6. 새 유형은 오류가 아니라 레지스트리의 성장 신호다.
7. AI 출력은 항상 서버 검증을 거친다.
8. 데이터는 Markdown, JSON, 원본 파일 묶음으로 내보낼 수 있어야 한다.
9. 템플릿은 자유 입력을 대체하지 않고 기억을 꺼내는 선택적 단서로 사용한다.
10. 사용자의 기억과 AI의 해석이 시간이 지나 섞이지 않도록 의미적 출처를 지속적으로 표시한다.
11. 사람에 관한 고위험 추론은 자동화의 편의보다 직접 근거와 사용자 확인을 우선한다.
12. 자동화는 사용자의 첫 문장, 저자성, 민감 기록의 노출 범위를 대신 결정하지 않는다.
13. 메뉴는 데이터 유형이 늘어날수록 함께 늘어나는 분류표가 아니라 사용자의 안정된 과업을 반영한다.
14. 데스크톱과 모바일은 같은 IA와 route를 공유하고 navigation container만 바꾼다.
15. 벤치마크의 장점은 새 전역 메뉴보다 기존 과업 컴포넌트의 상호작용으로 흡수한다.
16. 빠른 preview, source evidence, relation context, resurfacing reason은 사용자가 현재 위치와 판단 근거를 잃지 않게 해야 한다.

## 5. 구현 중 실제 증거로 보정할 값

- 링크 Capture의 파생 카드 제안·대표 화면 선택 품질과 명시적 독립 문서 추출 UX(기본 자동 분할은 하지 않음)
- 신규 유형 자동 승격의 반복 횟수와 사용자 승인 시점
- 장소·작품·책 외부 개체의 기준 데이터 소스와 캐시 기간
- 녹취록 화자 식별 UX
- 자연어 검색 결과에서 구조 필터와 의미 검색의 가중치
- 기존 레코드의 중복 판정과 정본 선택 기준
- visual baseline token의 실제 contrast·font loading·density와 coded responsive interaction QA
- Milkdown·CodeMirror의 실제 OS 한글 IME 수동 QA와 visual canonicalization 허용 범위
- Gemini configured model의 실제 runtime capability, remote R2 CORS PUT과 Linux Worker bundle gate
- Android·iOS에서 offline draft와 share fallback의 device별 한계
- provisional upload·queue·latency·retention budget
- live legacy representative sample의 orphan·손상 유형 분포와 substantive projection 승인

큰 방향 결정은 완료했다. 세부 threshold는 [25_GOLDEN_CORPUS_AND_VALIDATION_HARNESS.md](./25_GOLDEN_CORPUS_AND_VALIDATION_HARNESS.md)와 [27_IMPLEMENTATION_DELIVERY_PLAN.md](./27_IMPLEMENTATION_DELIVERY_PLAN.md)의 spike·fixture·live inventory 증거로 보정한다. 구현 결과가 가설을 반박하면 기술 선택과 수치를 수정하되 source preservation, user precedence, provenance, privacy, generic fallback은 유지한다.
