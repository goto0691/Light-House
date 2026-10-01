# 39. I5 Adaptive Knowledge, Presentation, Review 구현 근거

> 상태: I5 coded implementation 완료 · 실제 Gemini 및 인증된 배포 환경 검증은 private cutover gate  
> 검증일: 2026-08-12

## 구현 결과

### 가변 지식 모델과 이력

- `v2_` additive migration 0011~0013으로 type, field, property, evidence, entity, event, predicate, relation, unit, presentation profile, review receipt 구현
- 처음 보는 type과 field는 candidate로 저장되며 generic record view에서 즉시 열림
- 사용자가 새 type을 확인하면 assignment와 type이 active/user-pinned 상태가 되고 거절하면 assignment만 제외
- 명시값, 외부 사실, AI 해석, 사용자 고정값을 `source_class`로 분리
- accepted, proposed, disputed, rejected, superseded lifecycle 구현
- 사용자가 AI 값을 정정하면 이전 proposal과 기존 accepted 값을 supersede하고 새 `user_locked` 값을 생성
- accept, reject, correct, dismiss마다 immutable receipt와 content-free audit event 기록
- entity/event 제안은 별도 object와 proposed relation으로 만들고 사용자 확인 뒤에만 active connection에 표시
- social high-risk 해석은 자동 accepted 0건이며 명시적 확인 checkbox 없이는 승인 API와 UI가 모두 거부

### 외부 검색의 구조화 승격

- grounded role 출력은 `grounded-result-v1` JSON만 허용
- identity 상태가 `resolved`일 때만 요청한 canonical field key를 승격
- 각 fact가 실제 반환된 HTTPS citation URL을 하나 이상 직접 참조해야 함
- 자유 산문, 미요청 field, 중복 field, 잘못된 타입, 인용 없는 fact, ambiguous/not-found identity의 fact는 commit하지 않음
- 통과한 외부 fact는 `external_grounded` property와 `external_url` evidence로 저장
- 사용자 accepted 값과 다른 외부 fact는 disputed Review로 보내고 자동 덮어쓰지 않음
- Record 화면에서 외부 출처 badge와 원문 URL을 직접 열 수 있음

### 안전한 적응형 표현

- DB 값은 `RecordKnowledgePresentation`이라는 결정적 표시 계약으로 투영
- unknown type은 문서형 generic fallback으로 source, body, accepted fields를 계속 표시
- semantic icon catalog와 record preset allowlist 밖의 key는 실행하지 않고 안전한 fallback으로 교체
- AI가 JSX, SVG URL, renderer code, runtime module을 저장하거나 실행할 경로 없음
- 첫 전용 module은 반복 가치 검증용 `workout.metrics.v1` 하나만 제공
- module은 accepted field가 최소 2개일 때만 본문 뒤에 표시하고 restricted에서는 항상 차단
- rating, number, boolean, date, JSON renderer와 origin badge, evidence details 구현
- Highlight는 본문 위에 최대 4개, 구조화 section과 module, connection, Review는 본문 뒤에 배치
- field → source → field anchor round-trip 구현

### Review IA와 반응형 UI

- 실제 Record 화면에서 type badge, accepted knowledge, source evidence, connection, Review action 제공
- `/v2/review`에 open item이 있는 기록만 모으는 전역 확인 화면 추가
- desktop은 기록 목록과 선택 상세, mobile은 수평 record selector와 단일 판단 영역 사용
- restricted review record는 active recent reauthentication grant 없이는 목록과 payload에서 제외
- Review card는 보관하지 않기, 숨기기, 표현 수정, 내 기록으로 확인을 제공
- 고위험 card는 의미 설명과 별도 확인 checkbox를 제공
- 적응형 기록 lab fixture에서 desktop/mobile 실제 컴포넌트와 정보 위계를 검증

## 검증 결과

- TypeScript typecheck 통과
- Drizzle schema check 통과
- Vitest 16 files, 93 tests 통과
  - 처음 보는 type의 candidate 저장과 사용자 승격
  - user-locked precedence와 conflict supersede
  - 값 정정 뒤 이전 proposal 보존과 immutable correction receipt
  - entity resolution과 accepted relation projection
  - structured grounded fact와 fact별 HTTPS citation
  - cited prose의 구조 필드 승격 차단
  - restricted Review 목록 비노출
  - social high-risk explicit confirmation과 replay-safe receipt
  - unknown icon, preset, module fallback
- Playwright 34 cases: 21 pass, 13 의도적 project skip
  - body 전후의 Highlight, module, Review 순서
  - evidence source 왕복 focus
  - high-risk 확인 전 승인 disabled
  - correction editor 접근
  - context module 1개 제한
  - mobile horizontal overflow 0
  - 기존 Capture, PWA, Library, editor, axe 회귀 없음
- Next.js production build 통과; `/v2/review`와 Review resolve API route 포함

## 남은 외부 release gate

- 실제 configured Gemini 2.5 grounded response가 JSON과 fact별 citation annotation을 안정적으로 반환하는지 private corpus에서 측정
- 배포된 Cloudflare 인증·D1 환경에서 `/v2/review` populated 화면과 resolve action end-to-end 확인
- Windows/Android 실제 화면 판독기로 evidence details, correction input, Review 순서 수동 확인
- private corpus에서 workout module의 반복 조회 가치가 입증되지 않으면 generic fields로 되돌림

위 항목은 기능 부재가 아니라 외부 계정·실자료·실기기가 필요한 release gate다. I6 구현은 현재 deterministic property, relation, evidence projection을 retrieval index의 입력으로 사용한다.
