# S5 자연어 리콜

최초 구현 2026-09-28, sensitive 카탈로그 정책 확정 2026-10-01. 범위: [76번 인계](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 S5 중 **자연어 질문 → 허용된 query plan → 기존 검색 실행**이다. 계약 근거는 [07번 1·7절](./07_RETRIEVAL_VIEWS_AND_UX.md)(자연어를 SQL로 만들지 않고 고정 중간 계약으로 변환)과 [04번](./04_AI_PROCESSING_CONTRACTS.md)의 `social_high_risk` 제한이다. 최초 구현은 병렬 agent가 하고 root가 governor 적용 지시·독립 검토·브라우저 실행을 맡았다.

## 사용자 흐름

1. `/v2/search`에 질문을 쓰고 `자연어로 해석`을 **눌렀을 때만** 요청한다. 입력 중 자동 호출은 없다. AI가 꺼져 있으면 버튼을 숨기고 키워드 검색만 남는다.
2. 서버는 질문(300자 이하), 서울 기준 오늘 날짜, 사용자 카탈로그만 main_analyzer에 보낸다.
3. 결과 패널은 `AI가 해석한 조건 · 제안`(칩)과 `내가 입력한 질문`, `반영하지 않은 부분`을 구분한다. `이 조건으로 검색`은 기존 검색 파라미터(표현할 수 없으면 서버 검증되는 `plan=` JSON)로 이동하므로 공유·새로고침이 된다.
4. 결과 페이지는 AI가 아니라 저장된 기록에서 조건과 일치하는 기록을 찾았다고 표시한다.

## 경계

- **카탈로그:** 요청한 owner의, 활성·legacy 표시 가능·**비제한** 문서에 실제로 쓰인 분류 키/라벨, 필드 키/라벨/형식, 대상 종류만 읽는다. **sensitive 전용 분류·필드의 키/라벨도 Google Gemini 검색 해석 요청에 포함한다**(2026-10-01 사용자 승인). 저장된 제목·본문·대상 이름·실제 필드값은 카탈로그에서 읽거나 요청에 덧붙이지 않는다. restricted 전용 분류·필드·대상 종류는 재인증 중에도 보내지 않는다.
- **해석 가능한 필드:** 현재 승인된 값이 모두 `claim_risk='low'`인 필드만 조건 후보다. 감정·기분·의도·성격·관계를 뜻하는 키·라벨은 카탈로그와 검증 양쪽에서 제외한다.
- **검증:** 카탈로그에 없는 키는 버리고 알린다. 검색어·대상 이름·텍스트 값은 질문에 실제로 있는 말만 받는다. 상대 날짜(작년·지난달·최근 2주)는 모델이 종류만 고르고 서버가 계산한다. 결과 수는 최대 100(기본 50)이며, 최종 계획은 `validateV2QueryPlan`을 통과해야 한다. 질문은 데이터로만 취급한다.
- **공급자:** 분석 대기열과 같은 governor를 쓴다. 정지·일일 한도면 호출 없이 429/503과 `retryAt`을 준다. 성공·실패·지연을 기록하고 권한은 `finally`에서 반납한다. 응답 시간 상한은 30초이며, 질문과 모델 응답은 기록하지 않는다.

## 검증

### 2026-10-01 정책 확정 회귀

사용자는 검색 질문과 기록의 유형·필드 이름이 Google Gemini에 전달되고, 이 단계에서 저장된 문서 제목·본문·실제 필드값은 보내지 않는다는 설명을 받은 뒤 **민감 기록의 유형·필드도 검색 해석에 활용하도록 전송**하는 데 동의했다. 기존 SQL·요청 계약이 이 범위와 일치하므로 제품 코드나 전송 범위를 바꾸지 않고 정책과 합성 회귀를 명시했다. 사용자가 직접 입력한 검색 질문은 기존처럼 전송되며, 질문에 직접 쓴 내용까지 제거한다는 뜻은 아니다.

- `natural-search-interpret-route.test.ts`: 실제 `node:sqlite`에 sensitive 전용 분류와 숫자/텍스트 필드를 저장하고, 준비된 Gemini gateway 요청에 키·라벨·형식·허용 연산자만 포함되는지 확인한다. 전체 요청에서 저장된 제목·본문·숫자/텍스트 값·대상 이름이 빠지는지 단정한다.
- restricted 재인증 없음/있음 두 경우에 동일한 경계를 검사한다. restricted 전용·타 owner 메타데이터, low/high-risk 현재 값이 섞인 필드, autobiographical 필드, 감정 의미의 키·라벨은 제외한다. 허용된 sensitive 필드의 `exists` 조건은 검증된 검색 계획으로 이어진다.
- `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/natural-search-interpret-route.test.ts tests/contract/v2/natural-query-v1.test.ts`: **2파일 22/22 PASS**, exit0(새 경계 회귀 2건 포함). 수정 시험 파일 scoped ESLint와 `git diff --check`도 exit0.
- 공급자는 합성 대역이다. 실제 Gemini 호출·자격 증명 추가·원격 변경은 하지 않았다. 이 검사는 실제 해석 품질이나 전체 통합·브라우저 검증을 대신하지 않는다.

### 최초 구현 검증 · 2026-09-28

| 검사 | 결과 |
| --- | --- |
| `tests/contract/v2/natural-query-v1.test.ts`, `natural-search-interpret-route.test.ts` + 인접 검색 회귀 2파일 | agent 실행 4파일 85/85 PASS. 카탈로그 필터, 고정 today 날짜 계산, limit 제한, 주입형 문장, 잘못된 초안 거부, URL 왕복, 실제 node:sqlite 카탈로그 제외·owner 분리·governor 정지/한도 기록·요청 경계·오류 변환, 해석 결과로 기존 `GET /api/v2/search` 호출 |
| agent RED | 카탈로그 쿼리의 restricted 조건을 빼면 2건이 실패함을 확인하고 원복 |
| `tests/e2e/v2-natural-search.spec.ts` | desktop/mobile 8 PASS(root 실행). 첫 실행 6 FAIL은 시험 결함이었다: Next dev route announcer까지 잡는 `getByRole("alert")`, charset 없는 가짜 결과 HTML. 기능 범위로 locator를 좁히고 UTF-8을 지정해 수정 |
| typegen·typecheck·scoped lint | exit0 |

## 남은 범위·검토 메모

- 실제 Gemini로 해석 품질을 확인하지 않았다(설정 모델의 무료 일일 한도 소진). 첫 실행에서 질문 10~20개 표본으로 확인한다.
- sensitive 기록의 분류·필드 이름 포함 여부는 2026-10-01 사용자 승인으로 확정했다. 승인 범위는 검색 해석용 카탈로그이며, 본문·실제 값 전송이나 restricted·owner·위험 필드 경계를 넓히지 않는다.
- AI 후보 상태(`candidate`) 분류는 포함한다. 필드는 현재 승인(`accepted`)된 low-risk 값이 실제로 쓰이는 경우에만 포함한다.
- 최초 구현에서 빠졌던 `written_at` 정렬·방향 선택지는 2026-10-01 Cloud Linux 보완에서 반영했다. [82번](./82_CLOUD_LINUX_COMPLETION_EVIDENCE.md)의 관련 변경·검증을 따른다.
- 의미(벡터) 검색 결합은 측정 후 선택 기능으로 남긴다([50번](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md) G01 메모).
