# 16. Planning Gaps and Completion Gates

## 1. 목적

현재 V2 기획은 제품 철학, 데이터 모델, AI 계약, 멀티모달, 검색, 작성, template, 컴포넌트, 심리적 안전, IA와 구현 운영 계약까지 연결되었다. 이 문서는 원래 남은 기획을 식별하기 위해 작성되었고, 2026-08-12에 문서 21~27로 결정이 닫혔다. 이제 남은 항목은 새 기획이 아니라 코드·기기·API·실제 자료로 통과해야 하는 gate다.

이 문서는 남은 기획을 끝없이 늘리지 않고 다음 세 부류로 구분한다.

1. 구현 기반 전에 확정한 운영 결정
2. 기술 spike와 prototype 결과로 보정할 값
3. 명시적으로 이후로 미룰 것

## 2. 현재 기획 범위 평가

| 영역 | 현재 문서 | 상태 |
| --- | --- | --- |
| 제품 목표와 원칙 | 00, README | 기준선 완료 |
| 실제 자료와 recall scenario | 01 | 설계 완료, 실제 corpus 선정 필요 |
| 정본 데이터와 동적 registry | 02, 03 | 설계 완료, D1 spike 필요 |
| Gemini 분석·보강 계약 | 04, 06 | 설계 완료, 실제 API 검증 필요 |
| 이미지·OCR·녹취 | 05 | 설계 완료, 실제 자료 spike 필요 |
| 검색·저장 뷰·리콜 | 07 | 설계 완료, relevance 검증 필요 |
| 기존 데이터 migration | 08 | 전략 완료, live inventory 필요 |
| 품질·roadmap | 09 | 기준 완료, test harness 필요 |
| Markdown 집필·revision | 10 | 설계 완료, editor spike 필요 |
| 동적 record 표시 | 11 | 계약 완료, visual prototype 필요 |
| 적응형 template | 12 | 계약 완료, fixation test 필요 |
| component architecture | 13 | 기준선 완료 |
| 심리적 UI/UX | 14 | 기준선 완료, 사용자 검증 필요 |
| IA와 responsive navigation | 15 | 기준선 완료, cross-device prototype 필요 |
| visual direction과 benchmark 채택 | 17 | 방향·component contract 완료, token·high-fidelity 검증 필요 |
| design system visual baseline | 18 | 정적 reference·token·layout 기준 완료, coded interaction QA 필요 |
| visual alternatives review | 19 | A+ 최종 선택 완료, coded 검증 필요 |
| icon·view extension | 20 | catalog·preset·module·fallback 결정 완료, coded registry 검증 필요 |
| architecture·security·lifecycle | 21 | 구현 계약 완료, fault/privacy test 필요 |
| offline·PWA·mobile share | 22 | MVP 범위·state 결정 완료, device spike 필요 |
| export·backup·restore | 23 | Bundle v1 계약 완료, round-trip spike 필요 |
| AI runtime·operations | 24 | topology·routing·retry 결정 완료, model capability probe 필요 |
| golden corpus·validation | 25 | harness·20 slot·gate 완료, 실제 private expected 작성 필요 |
| legacy inventory·cutover | 26 | runbook 완료, live inventory 필요 |
| implementation delivery | 27 | milestone·backlog·Definition of Done 완료 |

### 기획 감사 결론

- **제품·UX 개념 기획은 완료**했다. 새 feature category나 화면 철학을 더 결정할 필요는 없다.
- **구현 준비 기획도 완료**했다. P0-02~P0-07의 선택은 문서 21~27에 확정했으며, 남은 것은 구현 증거다.
- 이후 아이디어는 현재 source·recall·privacy 목표의 blocker가 아니면 P2 backlog로 보낸다.
- 다음 단계는 장기적인 기능 브레인스토밍이 아니라 [27_IMPLEMENTATION_DELIVERY_PLAN.md](./27_IMPLEMENTATION_DELIVERY_PLAN.md)의 `I0` coded prototype과 기술·운영 gate다.

## 3. P0 — 확정된 결정과 구현 gate

### P0-01. Visual Design System

`17_VISUAL_DESIGN_AND_BENCHMARK_ADOPTION.md`와 `19_DESIGN_ALTERNATIVES_AND_REVIEW.md`에서 A+를 최종 선택하고 `18_DESIGN_SYSTEM_VISUAL_BASELINE.md`에서 canonical reference, token, typography, layout metric, state 문법을 고정했다. 남은 일은 새 방향을 다시 고르는 것이 아니라 실제 component로 한글 본문·고밀도 목록·dark theme와 interaction state를 검증하고 v1로 승격하는 것이다.

구현하며 검증할 것:

- typography scale과 한글 본문 font stack
- spacing, radius, border, elevation token
- light·dark theme
- focus, selected, proposed, disputed, source origin 상태
- sidebar, rail, sheet, dialog, field, editor primitive
- semantic icon catalog의 실제 renderer mapping과 empty state illustration 필요 여부 검증
- density와 long-form reading mode
- `RecordPeekPane`, `EvidenceGutter`, `ViewDisplayMenu`, `SelectionToolbar`, `RediscoveryDeck`의 focus·motion·responsive state

산출물:

- `Design Tokens v1`
- 핵심 primitive state sheet
- Library, Search/OmniSearch, Capture, Record Detail, Explore Rediscovery의 high-fidelity prototype

완료 gate:

- 색상 없이도 상태가 구분됨
- light·dark, 320·768·1180px에서 핵심 화면 검증
- 사용자 본문이 AI metadata보다 시각적으로 우선함
- Peek·evidence 왕복 뒤 scroll·selection·focus가 복원됨
- reduced motion에서 transition을 제거해도 계층과 상태 변화가 이해됨

### P0-02. Security, Privacy, and Data Lifecycle

결정은 [21_IMPLEMENTATION_ARCHITECTURE_AND_SECURITY.md](./21_IMPLEMENTATION_ARCHITECTURE_AND_SECURITY.md)에 닫혔다. restricted는 server-side recent reauthentication gate이며 unlock 전 payload를 client에 전송·cache하지 않는다. 아래 목록은 구현 검증 항목으로 유지한다.

구현하며 검증할 것:

- restricted record의 재인증·잠금 방식
- local IndexedDB에 민감한 draft를 저장하는 조건
- attachment signed URL과 cache 정책
- 삭제, 휴지통, 영구 삭제, 복구 기간
- account·device session과 분실 기기 대응
- 로그·telemetry에 원문과 AI payload를 남기지 않는 규칙
- Gemini 전송 기록과 재처리 이력의 사용자 확인·삭제 범위

산출물:

- threat model
- privacy level별 access matrix
- delete·restore lifecycle
- logging redaction contract

완료 gate:

- restricted가 단순 UI label인지 실제 접근 제어인지 모호하지 않음
- 원문·attachment·AI payload가 backup과 삭제에서 같은 정책을 따름

### P0-03. Offline, Sync, PWA, and Mobile Share

결정은 [22_OFFLINE_SYNC_AND_MOBILE_SHARE.md](./22_OFFLINE_SYNC_AND_MOBILE_SHARE.md)에 닫혔다. PWA와 offline text/image capture, Android Share Target을 MVP에 포함하고 IndexedDB outbox + foreground sync를 정본으로 한다. 아래 목록은 device 검증 항목으로 유지한다.

구현하며 검증할 것:

- PWA 설치를 MVP에 포함할지
- Web Share Target 지원 범위
- offline에서 text·image capture 가능한 한계
- upload queue와 재시도
- 여러 기기 충돌과 attachment 중복
- background sync가 불가능한 브라우저의 fallback
- mobile camera·photo permission과 취소 복구

산출물:

- offline state machine
- share target contract
- device conflict matrix
- mobile prototype test script

완료 gate:

- 네트워크가 끊겨도 source draft가 유실되지 않음
- 공유 시트로 들어온 자료가 강제 분류 없이 3단계 안에 저장됨

### P0-04. Export, Backup, Restore, and Portability

`Lighthouse Export Bundle v1`과 backup·restore 계약은 [23_EXPORT_BACKUP_RESTORE_CONTRACT.md](./23_EXPORT_BACKUP_RESTORE_CONTRACT.md)에 확정했다. 아래 목록은 구현·round-trip 검증 항목으로 유지한다.

구현하며 검증할 것:

- export directory layout과 manifest version
- internal link와 object ID 표현
- template, registry, evidence, revision 포함 범위
- incremental backup과 full backup
- restore 시 duplicate·conflict 처리
- 암호화 archive와 key 복구 여부
- migration export와 사용자-readable export의 분리

산출물:

- `Lighthouse Export Bundle v1`
- restore algorithm과 dry-run report
- round-trip golden test

완료 gate:

- 새 환경에서 원문, 첨부, revision, 핵심 관계를 복원 가능
- 앱이 없어도 Markdown과 원본 파일을 읽을 수 있음

### P0-05. Runtime Architecture and AI Operations

production topology, D1 lease queue, model role, retry·quota·payload retention은 [24_AI_RUNTIME_AND_OPERATIONS.md](./24_AI_RUNTIME_AND_OPERATIONS.md)에 확정했다. 아래 목록은 capability·failure drill 항목으로 유지한다.

구현하며 검증할 것:

- API transport와 secret 관리
- source commit, analyzer, enricher, indexer queue 경계
- idempotency key와 retry·dead letter
- Gemini quota 초과·model unavailable fallback
- 3.6 결과가 실패할 때 2.5 또는 deterministic extractor로 degrade할 범위
- processing run 비용·latency 관측
- prompt·schema·model version rollout과 rollback
- user-triggered reprocess와 stale result 처리

산출물:

- runtime sequence diagram
- queue and retry policy
- model routing table
- operational runbook

완료 gate:

- AI 장애가 source 저장을 막지 않음
- 같은 capture 재처리로 duplicate object·relation이 생기지 않음
- quota 초과 상태가 사용자에게 저장 실패처럼 보이지 않음

### P0-06. Golden Corpus and UX Validation Protocol

20개 corpus slot, private fixture 경계, test stack, scoring과 심리 test는 [25_GOLDEN_CORPUS_AND_VALIDATION_HARNESS.md](./25_GOLDEN_CORPUS_AND_VALIDATION_HARNESS.md)에 확정했다. 실제 private source 선정과 expected result 작성은 구현 준비 작업으로 남는다.

구현하며 검증할 것:

- 비공개 실제 자료 20건의 초기 corpus
- 각 사례의 expected object·field·evidence·recall result
- source attribution용 가상 자료
- blank·cue 3개·cue 5개 counterbalanced test
- desktop·mobile IA tree test task
- 실패 severity와 release decision 방식

산출물:

- golden corpus manifest
- expected output fixtures
- usability test script
- regression report format

완료 gate:

- 최소 20건 expected result가 사람에 의해 먼저 작성됨
- 심리 UX test가 실제 개인 기억에 거짓 정보를 주입하지 않음
- IA task와 Capture task의 성공 기준이 수치화됨

### P0-07. Legacy Inventory and Migration Mapping

inventory artifact, damage taxonomy, adapter coverage, source-only projection, cutover·rollback 절차는 [26_LEGACY_INVENTORY_AND_CUTOVER_RUNBOOK.md](./26_LEGACY_INVENTORY_AND_CUTOVER_RUNBOOK.md)에 확정했다. 실제 데이터 분포와 R2 orphan은 read-only live inventory로 확인해야 한다.

구현하며 검증할 것:

- D1 table·column·row count inventory
- R2 attachment ownership과 orphan
- legacy category→source preservation mapping
- duplicate entity와 document shell 판정
- historical timestamp와 current import timestamp 분리
- dry-run 결과를 사용자가 확인하는 방법
- cutover와 rollback 범위

산출물:

- live inventory report
- table adapter mapping
- dry-run manifest
- rollback drill

완료 gate:

- legacy row를 삭제하거나 원본 의미를 덮어쓰지 않음
- 대표 record가 V2에서 검색·원문 회귀됨

## 4. P1 — 첫 private beta 전에 닫을 기획

### P1-01. Onboarding and Empty States

- 첫 기록을 넣기 전 보관함
- Gemini 연결 전·quota 초과 상태
- 검색 결과 없음
- Explore 데이터 부족
- Review 없음
- 첫 template 생성
- import 시작

Onboarding은 카테고리 설정 wizard가 아니라 첫 capture, source 저장, AI 결과 출처 이해의 세 경험을 설명해야 한다.

### P1-02. Search Relevance and Saved View Builder

- typed filter, FTS, relation, embedding의 ranking
- 자연어 query plan explanation
- zero result relaxation
- saved view 이름·condition summary·pin UX
- `ViewDisplayMenu`의 layout·sort·group·visible fields·density 저장 범위
- `SaveViewAction` 이후 자동 pin 없이 sidebar에 고정하는 명시적 흐름
- Library·Search `RecordPeekPane`의 keyboard 이동과 context recovery
- sensitive record match의 snippet 차단
- 결과 inclusion reason의 표현

### P1-03. Accessibility Verification

- keyboard navigation
- screen reader names와 state announcement
- Korean IME
- reduced motion
- 200% zoom
- contrast와 color-independent state
- mobile screen reader와 sheet focus

### P1-04. Performance Budgets

초기 목표를 spike로 확정한다.

- app shell interactive time
- Quick Capture open latency
- local save latency
- 5만 자 editor responsiveness
- 10k·100k record Library query
- image thumbnail and preview memory
- RecordPresentation payload size

### P1-05. Observability and Product Evidence

- source save failure
- upload retry
- AI pipeline duration·failure class
- correction and provenance-open event
- search success proxy
- template dismiss·explicit keep
- privacy policy violation test

원문, search query 전문, sensitive metadata를 telemetry에 기본 수집하지 않는다. 측정 항목은 event taxonomy와 retention 정책을 함께 가져야 한다.

### P1-06. Data Management UX

- import progress와 partial failure
- duplicate preview
- trash와 restore
- backup status
- export scope selection
- AI 재처리 범위
- account deletion

### P1-07. Context and Safe Rediscovery Validation

- `MentionContextCard`가 정확한 문장·timecode로 돌아가는지
- `EvidenceGutter`의 field-source 양방향 이동과 focus 복원
- `RediscoveryDeck`의 surfacing reason 이해도
- sensitive opt-in과 restricted 제외가 모든 projection에서 일관적인지
- dismiss한 record·reason 조합이 다시 나오지 않는지
- `ExplainableSuggestionCard`가 적용 범위와 비적용 범위를 구분하는지

## 5. P2 — 명시적으로 이후로 미룰 기획

MVP와 private beta의 성공을 확인하기 전에는 다음을 상세 설계하지 않는다.

- 자동 회고 notification과 `이날의 기록`
- 공개 publish와 공유 link
- 공동 편집·댓글·권한
- 사람 관계 점수와 personality profile
- AI가 먼저 쓰는 essay generation
- 장소·게임·운동별 전용 dashboard
- 자동 건강 진단·운동 처방
- graph visualization 자체를 목적화한 화면
- plugin marketplace와 third-party automation
- CRDT 실시간 공동 편집

P2 자료가 들어와도 원본과 generic renderer로 저장·열람할 수 있어야 한다.

## 6. 결정 시점

| 결정 | 시점 | 선행 증거 |
| --- | --- | --- |
| provisional token의 v1 승격과 shell density | IA prototype 후 | 320·768·1180px, light·dark visual QA |
| Milkdown 유지 여부 | editor spike 후 | IME·Markdown round-trip |
| PWA·Share Target의 device별 지원·fallback | mobile spike 후 | 실제 Android·iOS 흐름 |
| restricted 15분 grant의 session·cache 세부값 | threat test 후 | device/session capability |
| model config promotion·rollback | API spike 후 | schema success·quota·latency |
| 신규 유형·field 승격 threshold | corpus 실행 후 | 반복 분포와 correction |
| 검색 ranking | recall test 후 | top-10 success와 false inclusion |
| migration cutover | dry-run 후 | count·hash·recall verification |

threshold를 문서 논리만으로 확정하지 않는다.

## 7. 기획 종료 순서

```text
구현 계약 21~27 확정
→ I0 coded A+·editor·Gemini·D1·R2·PWA technical spikes
→ security·offline·export contract test
→ golden corpus 20건 expected result와 UX test
→ live legacy inventory·dry-run
→ architecture ADR 증거 기록
→ I1 Source Foundation 구현
```

병렬로 할 수 있는 것:

- Design System과 golden corpus 선정
- security threat model과 export contract
- editor spike와 Gemini schema spike
- IA prototype과 mobile share prototype

## 8. Definition of Phase 1 Ready

큰 기획은 완료했다. 다음 조건은 `I0`에서 본 구현으로 넘어가기 전에 증명할 readiness gate다.

- product, data, AI, UX, IA의 불변조건이 서로 충돌하지 않음
- route map과 desktop·mobile navigation·Peek·evidence·rediscovery prototype 통과
- Design Tokens v1과 핵심 primitive state 확정
- icon catalog·view preset·context module의 generic fallback과 privacy fixture 통과
- source save·offline·sync·delete·export lifecycle 확정
- Gemini runtime, retry, idempotency, quota fallback 확정
- golden corpus 20건 expected result 완료
- editor·AI·D1·R2 spike의 치명 blocker 없음
- restricted privacy level의 실제 보호 의미 확정
- legacy inventory와 dry-run 계획 승인
- P2 deferred list가 명시되어 scope creep을 막음

이 시점 이후 새로운 아이디어는 현재 milestone의 blocker인지 판단하고, 아니라면 P2 backlog로 이동한다. 구현 순서와 실제 완료 정의는 [27_IMPLEMENTATION_DELIVERY_PLAN.md](./27_IMPLEMENTATION_DELIVERY_PLAN.md)를 정본으로 한다.
