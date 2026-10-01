# 09. Evaluation and Delivery Roadmap

## 1. 평가 철학

완료는 테이블과 화면이 생겼다는 뜻이 아니다. 실제 자료가 원본 손실 없이 구조화되고, 사용자가 나중에 원하는 방식으로 다시 찾을 수 있어야 한다.

평가는 여덟 층으로 나눈다.

1. Source integrity
2. Extraction accuracy
3. Knowledge consistency
4. Recall quality
5. User correction cost
6. Source attribution and calibrated trust
7. Authorship, cognitive load, and template fixation
8. Psychological safety and safe resurfacing

## 2. 치명 실패

다음은 평균 점수와 무관하게 release blocker다.

- 저장 성공으로 표시했지만 원본이 유실됨
- 사용자 명시값이 AI나 외부 값으로 덮어써짐
- 다른 장소·작품·인물로 고신뢰 자동 병합됨
- 사용자가 잠근 값이 재처리로 변경됨
- 외부 사실에 출처가 없음
- 사용자 입력이 아닌 핵심값의 의미적 출처가 화면에서 구분되지 않음
- 감정·의도·성격·관계·인과·약속·합의를 직접 근거나 사용자 확인 없이 accepted로 저장함
- `sensitive` 또는 `restricted` 기록 본문이 preview·알림·자동 추천에 노출됨
- `restricted` 기록이 재발견에 나타나거나 `sensitive` 기록이 별도 opt-in 없이 재노출됨
- 반복 사용 횟수만으로 자동 template을 active로 전환함
- 새 유형 입력이 DB 오류로 거부됨
- export 후 원문 또는 첨부를 복원할 수 없음

## 3. 핵심 지표

### Source Integrity

| 지표 | MVP 목표 |
| --- | ---: |
| 원본 저장 성공률 | 100% |
| attachment hash 일치 | 100% |
| source → document 추적 가능 | 100% |
| export/restore 원본 왕복 | 100% |

### Extraction

| 지표 | MVP 목표 |
| --- | ---: |
| 명시 평점·숫자·단위 정확도 | ≥ 95% |
| 명시 날짜 정확도 | ≥ 95% |
| 상대 날짜 정확도 | ≥ 90% |
| OCR 중요 필드 정확도 | ≥ 95% |
| 복수 유형 수용률 | ≥ 90% |

### Entity and Knowledge

| 지표 | MVP 목표 |
| --- | ---: |
| 자동 resolve precision | ≥ 98% |
| 애매한 후보의 올바른 보류 | ≥ 95% |
| 중복 필드 생성률 | ≤ 3% |
| 외부 사실 provenance coverage | 100% |
| user-locked 보존 | 100% |

### Recall

| 지표 | MVP 목표 |
| --- | ---: |
| 기대 자동 목록 포함률 | ≥ 90% |
| 구조 질의 top-10 성공 | ≥ 95% |
| 불완전 기억 질의 top-10 성공 | ≥ 80% |
| 근거 원본 회귀 성공 | 100% |

### Experience

| 지표 | MVP 목표 |
| --- | ---: |
| 저장 UI 응답 | 원본 commit 후 즉시 |
| 일반 텍스트 AI 처리 p50 | 측정 후 기준 확정 |
| 필드당 사용자 수정 수 | 코퍼스 기준 하락 추세 |
| AI 실패 중 원문 열람 | 100% |

### Psychological UX

| 지표 | MVP 목표 |
| --- | ---: |
| 비사용자 핵심값의 의미적 출처 표시 | 100% |
| 고위험 개인·사회적 추론의 무근거 accepted | 0% |
| `sensitive`·`restricted` 예상 밖 preview 노출 | 0% |
| 반복 사용만으로 template active 전환 | 0% |
| AI-generated prompt의 미해결 전제·유도 경고 | 0건 |
| 자동 template이 첫 문장보다 먼저 펼쳐짐 | 0% |
| 고영향 값의 7일 후 source attribution | 초기 목표 ≥ 95% |
| Peek·evidence 왕복 후 selection·scroll·focus 복원 | 100% |
| 설명할 수 없는 자동 재발견 reason | 0건 |

source attribution 목표는 실제 사용자 baseline을 측정한 뒤 조정하되, 내려가기 쉬운 운영 지표가 아니라 release gate로 관리한다.

### 저자성과 인지 부담

글자 수와 template 완료율을 성공 지표로 사용하지 않는다. 빈 기록, cue 3개, cue 5개 조건에서 다음을 비교한다.

- 첫 의미 있는 문장까지 걸린 시간
- 저장 전 이탈률
- prompt에 없던 고유 세부사항의 수
- `내가 쓴 글 같다`는 소유감
- 작성 흐름이 끊겼다는 평가
- AI·template 제안을 닫거나 되돌린 비율
- session당 고영향 Review 항목 수

템플릿 조건이 구조화 필드 수를 늘리더라도 고유 세부사항과 소유감을 의미 있게 낮추면 실패로 본다.

## 4. 평가 데이터셋

### Golden Corpus

- 기획 기준 40건
- 실제 텍스트·이미지·녹취 포함
- 사람이 먼저 기대 결과 작성
- 모든 릴리스에서 회귀 실행

### Adversarial Set

- 흐린 이미지
- 잘린 제목
- 여러 지점의 장소
- 동명 작품
- 상대 날짜가 여러 개
- 외부 평균과 사용자 평점 혼재
- 대화에서 타인의 평점을 인용
- 서로 무관한 여러 첨부
- 새로운 유형과 새로운 단위
- 긍정·부정 감정을 전제하는 template prompt
- 동행자·합의·갈등이 있었다고 전제하는 질문
- AI가 타인의 의도와 관계 상태를 추론하기 쉬운 녹취
- 올바른 값과 그럴듯한 AI 오정보가 섞인 통제 자료
- `sensitive`·`restricted` 기록의 최근·검색·추천 노출

### Migration Set

- legacy table별 대표 샘플
- 잘못 분류된 row
- 중복·자동화 shell
- relation이 많은 row
- 첨부가 있는 row

## 5. 오류 분류

| 분류 | 예 | 담당 해결층 |
| --- | --- | --- |
| model understanding | 글 유형 오판 | 3.6 prompt/model |
| OCR | 숫자 오독 | crop/vision 처리 |
| registry | 같은 필드 중복 | reconciler/registry |
| entity resolution | 다른 지점 선택 | 2.5 query/scoring |
| validator | 잘못된 단위 수용 | 서버 |
| projection | 목록 누락 | query/index |
| UX | 수정 경로를 찾기 어려움 | 화면 |
| migration | 출처 mapping 누락 | adapter |

모든 실패를 프롬프트 문제로 취급하지 않는다.

## 6. 개발 단계

### Phase 0 — Planning Baseline

산출물:

- 제품 헌장
- 골든 코퍼스 계획
- 개념 데이터 모델
- 동적 레지스트리
- AI 계약
- 멀티모달·근거 정책
- 검색·UX 명세
- 마이그레이션 전략
- Markdown 집필·저장·revision 명세
- 범용 레코드 UI와 AI 필드 표시 계약
- 회상 단서형 capture template과 공란 보완 계약
- V2 component architecture와 interaction 명세
- 심리적 안전과 memory-first component UI/UX 명세
- 전반 IA와 desktop·mobile responsive navigation 명세
- visual direction, benchmark 채택, core interaction component 명세
- semantic icon, view preset, context module, Codex 확장·fallback 계약
- 남은 기획 gap과 planning completion gate

완료 조건:

- 문서 간 핵심 용어와 불변 조건 일치
- 미결정 항목이 명시됨

### Phase 1 — Golden Corpus and Technical Spikes

작업:

- 실제 자료 40건 선정
- 기대 결과 작성
- Gemini 3.6 structured output spike
- 2.5 search/maps grounding spike
- 이미지 OCR·영역 근거 spike
- D1 typed property query 성능 spike
- R2 다중 첨부 round-trip
- Milkdown Markdown 왕복·한국어 IME·시 줄바꿈 spike
- 동적 필드 → `RecordPresentation` projection spike
- 리뷰 템플릿의 field binding·공란 상태·AI 보완 spike
- 반복 기록 pattern signature와 자동 template 중복 억제 spike
- Capture·Template Library·Record Detail 저해상도 prototype
- memory-first Capture와 assistance rail의 desktop·mobile prototype
- 지속적 의미 출처 label과 Evidence Viewer prototype
- 민감 기록 preview·재노출 정책 prototype
- 통제 자료를 사용한 24시간·7일 source attribution test 설계
- wide sidebar·compact rail·mobile bottom navigation IA prototype
- list → record → back의 filter·sort·scroll 복구 test
- `RecordPeekPane`·grouped `OmniSearch`·`ViewDisplayMenu` high-fidelity prototype
- `EvidenceGutter`의 field-source 양방향 이동과 exact backlink context prototype
- normal·sensitive·restricted를 포함한 opt-in `RediscoveryDeck` prototype
- icon inheritance, generic preset, registered module, unknown-key fallback spike

완료 조건:

- API 조합과 quota가 실제로 동작
- 데이터 모델의 치명적 공백이 없음
- 코퍼스 자동 실행 harness 존재

### Phase 2 — Source Foundation

작업:

- capture bundle/source item/attachment
- 원본 저장과 processing queue
- object/document 기본 모델
- export/restore v2
- audit·processing run

완료 조건:

- AI 없이 모든 입력 저장·열람·내보내기
- 다중 첨부와 hash 검증

### Phase 3 — Analyzer and Dynamic Registry

작업:

- 3.6 AnalysisEnvelope
- type/field registry
- property values and evidence
- validator/reconciler
- 신규 유형 후보 UI
- 이미지 OCR·녹취 처리

완료 조건:

- 알려진 유형과 신규 유형 모두 처리
- 사용자 명시값 목표 달성
- 실패 안전 경로 검증

### Phase 4 — Entity Resolution and Enrichment

작업:

- local candidate search
- 2.5 search/maps enrichment
- provenance·cache·expiry
- merge/alias/external identity
- 확인 필요함

완료 조건:

- entity precision 목표 달성
- 외부 사실 provenance 100%
- quota 초과 시 background 복구

### Phase 5 — Recall Product

작업:

- document/entity FTS
- typed property index
- relation/timeline query
- embeddings
- natural-language Query Plan
- Library/Explore/Search/Saved Views
- 결과 이유와 근거 UI
- `RecordPeekPane`, saved display state, visual memory layout
- exact-context backlink와 opt-in rediscovery

완료 조건:

- 리콜 시나리오 목표 달성
- 구조 검색 실패 시 의미 검색 fallback

### Phase 6 — Legacy Projection

작업:

- inventory and snapshot
- table adapters
- dry-run report
- safe projection
- entity clustering
- search/UI cutover

완료 조건:

- 배치 count/hash 검증
- 무삭제·rollback drill
- 대표 과거 자료 리콜 성공

### Phase 7 — Hardening

작업:

- background worker 안정화
- quota·retry·dead letter 운영
- 성능·비용 관측
- 접근성·모바일 입력
- backup/restore drill
- 전체 회귀

완료 조건:

- 치명 실패 0
- 운영 기준과 지원 절차 문서화

## 7. 우선 기술 스파이크

코딩 전 설계를 증명하기 위한 최소 실험 순서:

1. 텍스트 1건과 이미지 2장을 3.6에 보내 `AnalysisEnvelope` 생성
2. 운동 화면에서 동적 measurement field 추출
3. 장소 mention을 2.5 maps grounding으로 resolve
4. 검색 결과와 source citation을 `EnrichmentEnvelope`로 정규화
5. D1에서 `field=distance AND value_number>=5` 쿼리
6. 이미지 영역 evidence를 UI에서 highlight
7. 같은 필드를 다른 이름으로 제안했을 때 registry merge
8. 에세이·시·이미지를 Milkdown에서 Markdown으로 무손실 왕복
9. 장소 리뷰와 운동 기록을 같은 `RecordPresentation` 계약으로 렌더링
10. 리뷰 템플릿에서 사용자 값은 보존하고 허용된 공란만 근거 기반으로 보완
11. 유사 기록 3건에서 template draft를 생성하고 기존 template duplicate를 억제
12. Capture → 저장 → AI 보완 → Record Detail의 component 상태 전이를 prototype으로 검증
13. 빈 기록·cue 3개·cue 5개의 시작 시간, 고유 세부사항, 방해감, 소유감을 비교
14. 통제된 비개인 자료에서 24시간·7일 후 사용자 입력과 AI 추가값의 출처 구분을 검증
15. normal·sensitive·restricted 기록이 Library, Search, Preview, 추천에서 올바르게 가려지는지 검증
16. Library·Search Peek를 연속 탐색한 뒤 selection·scroll·focus가 복원되는지 검증
17. field→source→field 왕복과 OCR box·timecode 근거 이동을 검증
18. 재발견 reason 이해도, sensitive opt-in, restricted 제외, dismiss 영속성을 검증
19. unknown type·icon·preset·module이 generic renderer로 열리고 restricted module payload가 차단되는지 검증

이 열아홉 가지 실험이 실패하면 전체 UI 개발 전에 계약을 수정한다. 실제 개인 기억에 의도적인 오정보를 주입하지 않고 가상의 사건·작품·대화 자료를 사용한다.

## 8. Definition of Ready for Implementation

다음이 준비되어야 Phase 2 구현에 들어간다.

- 골든 코퍼스 최소 20건의 기대 결과 작성
- `AnalysisEnvelope v1` JSON Schema 확정
- `EnrichmentEnvelope v1` JSON Schema 확정
- 핵심 table과 invariant 합의
- 단위·필드 타입 레지스트리 초안
- 외부 조사 실제 호출 검증
- 원본 저장·내보내기 실패 정책 합의
- V2 route를 legacy와 병행하는 전환 방법 합의
- Markdown editor 왕복과 revision 충돌 처리 검증
- `RecordPresentation v1`과 필드 renderer 허용 목록 확정
- `TemplateDefinition v1`, 공란 상태, AI operation 허용 목록 확정
- `TemplatePresentation v1`과 Capture component 상태 계약 확정
- `ValueOriginMark`, `claimRisk`, `previewPolicy` presentation 계약 확정
- 고위험 개인·사회적 주장 commit 금지 규칙의 서버 validator 확정
- template `PromptSafetyLint` 규칙과 명시적 active 전환 확정
- 심리 UX test protocol과 release gate 확정
- route map, responsive navigation, URL state contract 확정
- `RecordPeekPane`, `EvidenceGutter`, `ViewDisplayMenu`, `RediscoveryDeck`의 keyboard·privacy·responsive contract 확정
- semantic `IconCatalog`, view preset, `ContextModuleRegistry`와 generic fallback contract 확정
- Design Tokens v1, security·offline·export·runtime planning gate 확정

## 9. 구현 순서에서 금지할 것

- 전용 장소·운동·미디어 화면부터 만들기
- 실제 코퍼스 없이 프롬프트를 “완성”했다고 판단
- 기존 전체 데이터를 먼저 이관
- AI가 DDL 또는 임의 SQL을 실행
- 외부 검색 결과를 출처 없이 정본으로 저장
- 모든 후보 유형을 내비게이션에 노출
- 벡터 검색 하나로 리콜 문제를 해결

## 10. 미결정 사항과 결정 시점

| 항목 | 결정 시점 | 검증 방법 |
| --- | --- | --- |
| 3.6/2.5 API transport | Phase 1 | structured output + tools spike |
| 후보 승격 threshold | Phase 3 | 코퍼스 유형 반복 분포 |
| typed property 인덱스 구조 | Phase 1 | D1 query benchmark |
| attachment 최대 크기·개수 | Phase 1 | R2/Gemini limit spike |
| 녹취 분할 크기 | Phase 3 | 실제 긴 녹취 테스트 |
| 캐시 만료 기본값 | Phase 4 | 개인 사용 패턴·quota |
| 모바일 PWA/공유 방식 | Phase 5~7 | 모바일 capture prototype |
| legacy UI 종료 시점 | Phase 6 | cutover 기준 통과 |

## 11. 첫 실행 작업

기획 이후 즉시 진행할 작업은 다음이다.

1. 실제 골든 코퍼스 20건을 먼저 선정한다.
2. 각 사례의 기대 유형·필드·근거·리콜 목록을 작성한다.
3. 그중 텍스트, 운동 화면, 장소 리뷰, 책 페이지, 대화 캡처 각 1건으로 기술 스파이크를 만든다.
4. 결과를 보고 `AnalysisEnvelope v1`과 테이블 정의를 수정한다.
5. 수정된 계약을 기준으로 Source Foundation 구현 계획을 확정한다.

대규모 구현은 이 다섯 작업 이후 시작한다.
