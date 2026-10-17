# 현재 작업 상태 · 재개 진입점

## AI 언급의 기존 개체 재사용 · 2026-10-17 KST

사용자 요청으로 기준선의 개체 중복(1.48배)을 다뤘다. [06번](./06_ENTITY_ENRICHMENT_AND_PROVENANCE.md) 2절의 내부 후보 검색을 따르고, 10절의 자동 병합 금지를 지킨다(D-117).

- **동작:** AI가 언급한 개체와 종류·이름(앞뒤 공백·공백·ASCII 대소문자 무시)이 같은 활성 개체가 정확히 하나면, 새로 만들지 않고 그 개체에 연결한다. 후보가 없거나 둘 이상이면 지금처럼 새로 만든다. 기존 개체끼리는 병합하지 않는다.
  - 다른 소유자, 보관된 개체, legacy 숨김 개체는 후보가 아니다. 노션에서 가져온 사람 개체는 후보다.
  - 연결은 계속 `proposed`이고, 검토 항목에 `reusedExisting`을 표시한다. 한 기록 안의 같은 언급은 연결 하나로 합치고, 근거는 모두 남긴다.
- **함께 고친 위험:** 검토 '거절'이 개체를 무조건 보관 처리했다. 이제는 이 실행에서 만든 개체이고 다른 살아 있는 연결이 없을 때만 보관한다. 검토 대상은 이 실행의 연결 ID로 찾는다.
- **파일:** [`knowledge-reconciler.ts`](../../apps/web/src/lib/v2/infrastructure/d1/knowledge-reconciler.ts), [`review-repository.ts`](../../apps/web/src/lib/v2/infrastructure/d1/review-repository.ts), `processing-queue-repository.ts`(legacy 숨김 판정 전달), 새 [`entity-reuse.test.ts`](../../apps/web/tests/contract/v2/entity-reuse.test.ts), 평가 도구 지표(`mentionLinks`·`reusedMentions`).
- **검증:**
  - 새 계약 시험 4/4 PASS. 바꾼 소스 3개를 이전 상태로 되돌리면 4/4 FAIL(RED)이고, 복원 후 해시가 일치한다.
  - 관련 Vitest 45파일 **968/968 PASS, exit0, 1,217초**. web typecheck, `typecheck:eval:notion`, 변경 파일 lint 모두 exit0.
- **노션 기본 60건 재측정(60/60, 호출 60회, 30분):**
  - 개체 중복 **1.48 → 1.00**. AI 언급 연결 86개 중 26개(30%)가 기존 개체를 재사용했다.
  - 필드 정확도 92.9 → 94.1%(모델 변동 범위), AI 분류 정의 4 → 3. 템플릿 3, 연결 보존·묶음 100%, 제목 검색은 변화 없다.
  - 검토 항목은 기록당 p50 3·p90 6 → 5로 거의 같다. 재사용 연결도 사용자 확인 대상이라 검토 수는 줄지 않는다.
- **실행 핸들:** 없음.
- **다음:** 검토함 소음 정리(재사용 연결·개체 확인 묶기), 거의 같은 템플릿 정리, 연결 묶음 화면, V1 이관 어댑터에 D-115 반영.

## 노션 상시 평가 도구와 가져온 분류·연결 · 2026-10-17 KST

사용자 결정: 노션 DB는 가져온 분류, 노션 연결 속성은 가져온 연결로 만든다(D-115, D-089의 관계 부분 대체). 연결은 상대 쪽 카테고리별 묶음으로 보여 준다(D-116). 평가 도구부터 만들어 첫 기준선을 잡는다.

- **제품 코드(새 파일, 기존 동작 불변):**
  - [`imported-knowledge-repository.ts`](../../apps/web/src/lib/v2/infrastructure/d1/imported-knowledge-repository.ts): 가져온 분류(`imported`·`active`, 대표 배정 `import`·`accepted`), 이름 기준 개체 재사용, 가져온 연결(`imported`·`accepted`, 노션 속성 이름은 `form_field` 근거). 반복 실행에도 중복이 없고, 사용자 거절·잠금은 덮어쓰지 않는다.
  - [`connection-groups-repository.ts`](../../apps/web/src/lib/v2/infrastructure/d1/connection-groups-repository.ts): `connection-groups-v1` 읽기 모델. 양방향 연결을 상대 쪽 확정 분류나 개체 종류로 묶는다. 요약 개수, 최근순 N건을 제공한다. restricted는 제외하고 sensitive는 개수만, AI 추정 연결은 `pendingCount`로 분리한다.
  - 화면 연결과 V1 이관 어댑터 변경은 아직이다.
- **평가 도구:** [`tools/v2-eval/notion-loop`](../../tools/v2-eval/notion-loop/README.md), `npm run eval:notion`. 승인 범위는 `scope.ts`와 git 제외 `.private/notion-eval/scope.json`에 고정했다. 기본 60건(영상 15·컨텐츠 15·게임 12·지식 창고 12·묵상 6)과 빠른 점검 15건이다. 연결 값은 AI에 보내지 않는다. ChatGPT 플랜만 쓴다.
- **검증:**
  - 계약 시험 `connection-groups.test.ts` 5/5 PASS(Node SQLite, migration 0006–0033). restricted 제외와 sensitive 닫힘 조건을 빼는 변이에서 각각 실패함을 확인했고, 원본 해시를 복원했다.
  - 도구 단위 시험 5/5 PASS. web typecheck, `typecheck:eval:notion`, `lint:eval`, 변경 파일 lint 모두 exit0.
- **첫 기준선(기본 60건 live, 60/60 성공, 호출 60회, 30분, p50 28.7초·p90 44.7초):**
  - 분류: 영상 15/15·게임 12/12·묵상 6/6이 가져온 분류를 재사용했다. 컨텐츠 로그는 가져온 분류를 대표로 둔 채 AI가 영상/게임 분류를 보조로 붙였다. 지식 창고는 주제 분류 6종이 붙었다. AI가 새로 만든 분류 정의는 4개, 필드 정의는 17개다.
  - 필드 정확도: 노션 값 235/253 = **92.9%**. 구조형 DB(영상·컨텐츠·게임·묵상)는 206/206이다. 놓친 값은 지식 창고의 메타 속성(유형 3/11, 한 줄 요약 1/5, 상태 1/5)이다.
  - 포맷: `generated_draft` 3개(묵상 3필드, 작품 5필드·6필드). 작품 템플릿 2개는 날짜 필드 하나 차이로 거의 겹친다.
  - 검토 항목: 기록당 p50 3·p90 6. 개체: AI 개체 95건이 고유 이름 64개로, 중복 비율 1.48이다.
  - 연결: 노션 링크 57개 → 가져온 연결 30개(기록끼리 15, 사람 15). 양방향 중복 15개를 합쳤고, 표본 밖 대상은 12개다. 보존율 100%, 묶음 정확도 60/60이다. 제목 검색은 top-1 75%·top-10 100%다.
  - 관찰: 게임 '상태'가 영상의 `viewing_status` key를 재사용했다(기존 key 재사용의 부작용). 지식 창고 '출처'가 `director_creator`로 잘못 대응된 경우가 1건 있다.
- **실행 기록:** 첫 기본 실행은 도구가 대기열을 한 번(최대 50건)만 채워 10건이 미분석이었다. 대기열을 다시 채우도록 고친 뒤 전체를 재실행했다. 불완전 실행은 `incomplete-` 접두어로 비교에서 뺐다. 이날 호출 수는 빠른 15건 1회, 기본 50+60회다.
- **실행 핸들:** 없음.
- **다음:** 개체 재사용(AI 언급이 기존 개체에 붙도록), 비슷한 템플릿 정리, 연결 묶음 화면, V1 이관 어댑터에 D-115 반영. 각 변경 뒤 `eval:notion` 기준선과 비교한다.

## 노션 실데이터 분류·포맷 시험 · 2026-10-17 KST

사용자 요청: 기획대로 원문을 넣으면 분류(태그)가 생기고, 반복되면 포맷(S2 템플릿)이 생기는지 노션 자료로 확인한다.

- **방법:** 골든 코퍼스의 콘텐츠 DB 행 5건을 썼다. 같은 속성 구조이고 노션 날짜가 서로 다른 3건, 그리고 속성이 적은 2건이다. 노션 날짜를 기록일(`capturedAt`)로 넣었다.
  - 격리 메모리 SQLite에 실제 V2 migration을 적용하고, 실제 분석 runner와 S2 관찰기를 그대로 썼다.
  - 공급자는 ChatGPT 플랜만 썼다(Gemini 폴백 끔). 호출 5회, 모두 `openai-plan:gpt-6.1-sol` 성공, 237초.
  - 하네스·결과는 git 제외 `.private/notion-format-trial/`에 있다. 앱 로컬 D1·원격에는 쓰지 않았다.
- **결과:** 분류·필드는 생겼다. 근거가 직접 있는 저위험 필드는 자동 확정됐다. 하지만 **템플릿은 0개**다.
  - 분류 key가 5건 모두 달랐다: `content_viewing_log`, `movie`, `film_viewing_log`, `film`, `drama_work_note`. 모두 `propose_new`였고, 분류 정의는 전부 `candidate`(사용 1회)에 머물렀다.
  - 필드 key도 흔들렸다: `genre`/`genres`, `director`/`director_creator`, `platform`/`viewing_platform`, `production_company`/`production_companies`. 우연히 같은 이름만 `observed`로 올랐다(`production_company` 4회 등).
  - 그래서 구조 서명 5개가 모두 달라 "같은 구조 3건·3일" 조건에 도달하지 못했다.
  - 기타: 같은 날짜 필드의 위험도 분류가 기록마다 달랐다(`low`/`autobiographical`). 열린 검토 항목은 기록당 4–11개였다.
- **원인:** [04번](./04_AI_PROCESSING_CONTRACTS.md) 3절의 분석 입력 계약에는 `registry_context`(관련성 높은 기존 유형·필드 후보)가 있다. 실제 입력([processing-runner.ts](../../apps/web/src/lib/v2/ai/processing-runner.ts) `inputText`)에는 이 항목이 없다. 지시문도 "고정 목록 없이 key를 제안"이라, 모델이 재사용할 기존 key를 모른다. [12번](./12_ADAPTIVE_CAPTURE_TEMPLATES.md)의 alias 재사용도 reconciler에 구현돼 있지 않다(key 문자열 일치만 합친다).
- **구현(사용자 요청):** 04번 계약대로 분석 입력에 `registry_context`를 넣었다.
  - 새 [`analysis-registry-context-repository.ts`](../../apps/web/src/lib/v2/infrastructure/d1/analysis-registry-context-repository.ts): 소유자의 문서 분류(최대 40)·필드(최대 80)를 고른다. key·label·data type·status·사용 수만 읽는다.
  - 경계는 S5 카탈로그와 같다: 활성·legacy 표시 가능·restricted가 아닌 문서가 뒷받침해야 한다. 제목·본문·값·entity 이름은 읽지 않는다. 개인 진술·제안 상태 필드도 key 안정성을 위해 포함한다.
  - 정렬: active/observed 우선, 그다음 사용 수. 문서에 label이 나오는 분류를 앞에 둔다. 텍스트·임베딩 관련도 선별은 registry가 상한을 넘을 때의 후속이다.
  - 지시문: 맞는 기존 분류는 정확한 key와 `reuse`로, 같은 의미·형식의 필드는 같은 key로 반환한다. 맞는 것이 없을 때만 새 key를 만든다.
  - 버전: `ANALYSIS_PROMPT_VERSION` `analysis-main-multimodal-v3`, `ANALYSIS_REGISTRY_VERSION` `registry-context-v1`.
- **검증:** 새 계약 시험 1건 PASS(16초).
  - 시험 내용: 첫 분석은 빈 후보, 다른 소유자와 restricted 전용 정의는 제외, 다음 분석에 기존 분류·필드 전달, `reuse` 시 정의 1개 유지(사용 2).
  - restricted 조건을 빼는 변이에서 이 시험이 `restricted_only_type` 누출로 실패함을 확인했고, 원본 해시를 복원했다.
  - web typecheck exit0, 변경 5파일 lint exit0.
- **노션 5건 재시험(같은 조건, 플랜만, 호출 5회, 225초):**
  - 분류: 1건째 `media_log`(콘텐츠 감상 기록)를 만든 뒤 4건 모두 `reuse`. 3건째에 `observed`가 됐고, 4·5건째에는 분류 배정이 자동 `accepted`.
  - 필드: key 8개가 끝까지 같았고 모두 `observed`에 올랐다.
  - **포맷: 3건째(날짜 다른 3건)에서 `generated_draft` 템플릿 1개가 생성됐다.** 항목은 같은 구조 4필드(`director_creator`·`genre`·`media_type`·`production_company`)다. 속성이 적은 2건은 3필드 구조로 따로 관찰됐다(같은 날 2건이라 미생성).
  - 남은 관찰: 템플릿 이름·질문은 기획대로 중립 문구("반복 기록 안내", "반복 항목 N")라 무엇을 묻는지 드러나지 않는다. 2건째에 `registry_conflict` 검토 1건이 생겼다. 열린 검토는 분류 확정 전 기록당 7–12개, 확정 후 2–3개다.
- **관련 회귀:** 변경 모듈을 쓰는 Vitest 34파일 **816/816 PASS, exit0, 525초**(`--maxWorkers=1`). 전체 suite·브라우저·Worker build는 실행하지 않았다.
- **실행 핸들:** 없음.
- **다음:** 링크 분석 경로(`link-processing-runner`)에는 아직 `registry_context`가 없다. 템플릿 이름·질문 문구를 사용자에게 의미 있게 보여 줄지는 결정 대상이다.

## 이 체크아웃 로컬 정비 · 2026-10-17 KST

`origin/main` `13c1cea`로 fast-forward한 뒤 이 폴더를 새 코드에 맞췄다. Claude Code 세션이 사용자 요청으로 진행했다.

- **발견:** 아래 항목의 "로컬 D1 0000–0033 적용·플랜 연결 설치"는 다른 체크아웃에서 한 작업이다. 이 폴더는 로컬 D1이 비어 있었고, `.env.local`에 `V2_AI_CREDENTIAL_KEY`·`OPENAI_PLAN_MODEL`이 없었으며, `.private/chatgpt-plan/`도 없었다. 이 상태에서는 분석이 플랜 대신 Gemini로 넘어간다.
- **zip 보존:** pull이 `migrations/*.zip` 2개를 작업 트리에서 지우므로 미리 백업했다가 복원했다. SHA-256이 같고, 이제 git 무시 대상이다.
- **검증(코드 `13c1cea`):**
  - typegen·전체 `npm run typecheck` exit0, 변경 TS 22파일 lint exit0, `db:check` exit0.
  - 변경 모듈을 쓰는 관련 Vitest 34파일 **815/815 PASS, exit0, 629초**(`--maxWorkers=1`). 전체 suite·브라우저·Worker build는 실행하지 않았다.
- **로컬 D1:** 기존 파일을 백업한 뒤 저장소 루트에서 `npx wrangler d1 migrations apply light_house_db --local --persist-to apps/web/.wrangler/state`로 파일 42개(0000–0033)를 적용했다.
  - 결과: 테이블 170개, FK 위반 0, 연결 정보 0행. 앱 스크립트와 같은 경로(`getPlatformProxy`, cwd `apps/web`)에서도 42개를 확인했다. 루트 `.wrangler`는 만들지 않았다.
- **정정:** 86번의 로컬 D1 절차, `chatgpt-plan-install.ts` 주석(루트에서 `--local`만 쓰면 앱이 쓰지 않는 루트 `.wrangler`에 적용됨), 50번 G05 행과 10-17 기록.
- **플랜 연결(사용자 요청):** 사용자가 브라우저에서 로그인하고 플랜 사용을 승인했다(`planUsageGranted: true`). 이 폴더용 새 앱 등록이다.
  - `chatgpt-plan-install.ts --model=gpt-6.1-sol` exit0. 로컬 D1에 `openai_plan` 1행이 `active`·암호화 상태로 들어갔다. 로그인 파일의 토큰은 지워졌다.
  - `apps/web/.env.local`에는 `V2_AI_CREDENTIAL_KEY`·`OPENAI_PLAN_MODEL`만 덧붙였다. 기존 내용은 그대로임을 확인했다.
- **실제 확인(10-17, 합성 자료만):**
  - S1 `verify-s1-live-synthetic.ts --live`: 공급자 호출 2회, 글·이미지 모두 `openai-plan:gpt-6.1-sol` 성공, exit0, 46초. 근거 `"별점 4.5/5"`·`"ORBIT RATING 4.5 / 5"`가 원문과 일치했고 검색으로 다시 찾았다.
  - S5 `verify-s5-live-natural-query.ts --live`: 8/8 `openai-plan:gpt-6.1-sol` 응답, exit0, 118초. 주입형·감정 질문은 조건 없이 처리했다.
  - S5 품질 메모: "평점 높은 순"은 계약에 속성 정렬이 없어 `dropped`로 표시됐다. "5km 넘게 달린"에는 불필요한 검색어 `달린`이 붙었다. 둘 다 비차단이다.
- **실행 핸들:** 없음. 시험·감시·로그인 작업은 종료했다.
- **다음:** 원격 배포 계획(`.private/release-preflight`, 0032 기준)에 0033을 반영한다. 분석 실행 위치를 정한다: A 원격 Gemini만 / B 저장은 Worker, 분석은 PC 로컬 runner(플랜) / C OpenAI 호스팅 대기 목록.

## ChatGPT 플랜 주 분석 · 2026-10-17 KST

사용자 결정(2026-10-16): 주 분석은 사용자의 ChatGPT 구독(Sign in with ChatGPT 플랜 사용)으로 처리한다. 구독이 끝나거나 쓸 수 없으면 Gemini 3.6 Flash로 넘어간다. Gemini는 무료 등급을 유지한다. 상세·검증은 [86번](./86_CHATGPT_PLAN_MAIN_ANALYZER.md)이다. 이 변경은 Claude Code 세션이 로컬 `00df2cc`로 만들고, `origin/main`(`0c4c0bc`) 위에 옮겨 게시했다.

- **경로:** `gpt-6.1-sol`이 먼저 처리하고 Gemini가 폴백한다. 대상은 글·이미지·PDF 분석, 링크 텍스트 정리, 자연어 검색 해석이다. YouTube 영상 분석과 grounded 보강은 Gemini를 유지한다. 실행마다 `model_id`에 공급자가 남는다.
- **실제 확인(10-16):**
  - 설정 Gemini 모델: S1 0/4, S4 0/1(모두 503), S5 7/8.
  - ChatGPT 플랜 경로: S1 글·이미지 성공(근거 원문 일치·검색 회수), S5 8/8.
- **보완:** 할당량·과부하 실패는 72시간 동안 시도 횟수를 소모하지 않는다. governor는 최대 1시간 간격까지 물러난다([77번 2026-10-16](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md)).
- **연결 정보:** 작업한 체크아웃의 로컬 D1(`apps/web/.wrangler/state`)에 migration 0000–0033을 적용하고, 플랜 연결 정보를 암호화해 설치했다. 이 폴더에는 없었다(위 10-17 로컬 정비). 토큰은 `.private`·`.env.local`·D1에만 있고 git에는 없다. 원격 D1·배포는 변경하지 않았다.
- **git:** `migrations/*.zip`(Notion 내보내기 2개)을 사용자 요청으로 추적에서 빼고 `.gitignore`에 넣었다. 파일은 로컬에 남는다. 과거 커밋 이력에는 남아 있으며, 이력 제거는 별도 승인이 필요한 강제 push다.
- **남은 판단:** OpenAI 셀프 등록 플랜 사용은 "로컬에서 실행하는 개인 프로젝트" 대상이다. 원격 호스팅은 대기 목록 조건이고, 무인 cron 규칙은 확인하지 못했다. 원격 배포 시 0033 적용, 연결 정보 이전, Worker secret이 필요하다(사용자 승인 대상).

## main 게시 인계 · 2026-10-03 KST

사용자가 “일단 커밋하고 메인에 푸시합니다.”라고 요청했다. 원격을 fetch해 `origin/main`이 `7a5d771221d7398c1d8e88fb5d4ecca8eeb24ea1`이고 후보보다10커밋 뒤에 있음을 확인했다. V2 후보 `25e4d1ae7b6fb4bed4f550df77eee061c3723f75`를 로컬 `main`에 충돌 없이 fast-forward했다. 현재 작업 브랜치는 `main`이며 `codex/v2-completion-local`은 검증 후보 위치에 보존한다.

- 이 인계 문서만 추가 commit한 뒤 `git push origin main`으로 게시한다. 최종 완료 판정은 `git ls-remote origin refs/heads/main`의 SHA와 로컬 `HEAD` 일치, clean tree, 기존 stash/환경 파일 보존으로 확인한다. 실행 결과는 ignored `.codex/v2-completion/main-push-verification.json`에 남긴다.
- 앱/Worker 구현은 `7e472e4`, 문서 포함 검증 identity는 `25e4d1a`다. 기존 `.codex/v2-completion/final-verification.json`과 private replay의 exact HEAD는 해당 당시 증거로 유지한다. 이번 문서 commit은 제품·시험·migration·dependency를 바꾸지 않으므로 전체 회귀/build를 반복하지 않는다. Git diff/링크·인계 내용만 검사한다.
- 최종 source-clean private20 replay와 `authorized:false` live 요청 준비는 `25e4d1a`에서 완료했다. 원문 hash20/20·제목 top1 19/20·top10 20/20이며 실제 공급자 호출0, 의미 평가 blocked를 유지한다. 이후 실제 실행 요청을 준비할 때는 새 HEAD에 다시 결합해야 하며 기존 요청을 자동 승인하지 않는다.
- 기존 stash `73a8f184160644c6c9d0f36050bca3ec5410aa57`과 환경 파일2개를 보존한다. `.private`·`.codex`·환경 파일은 게시 변경에 포함되지 않는다. root가 Git/인계 소유자이며 기존 agent와 모든 검사/서버 핸들은 종료 상태다.
- 다음 개발은 [50번 완료표](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)와 [85번 후보 증거](./85_WINDOWS_COMPLETION_CANDIDATE.md)의 잔여 gate를 따른다. 별도 원문 전송·Cloudflare 운영 변경 승인, 성공한 모델의 독립 의미 평가, Android 실기기·운영기간은 남아 있다. main push 요청으로 해당 승인을 대체하지 않는다.

## V2 최종 완성 재개 · 2026-10-03 KST

사용자가 V2를 끝까지 완성하도록 요청했다. 작업 브랜치는 `codex/v2-completion-local`, 시작 소스는 `7a5d771`이다. 동기화 때 보존한 stash와 기존 환경 파일은 유지한다. 아래 과거 인계의 완료 구현을 다시 시작하지 않고 50번 완료표의 실제 잔여 작업을 진행한다.

- root: 통합 소스·현재 상태/50번·최종 증거, Next/브라우저/typegen/build 및 긴 workerd/D1 회귀의 단일 실행 소유자.
- `video_review`: 영상 판단·일반 반복 복원과 읽기 전용 recovery helper를 동결했다. 최종 PWA 검증의 activation 이벤트 경합·초안 전체행 비교 누락을 읽기 검토했고 root가 반영했다.
- `eval_observations`: native export collector·승인 query/실제 plan·격리 replay·별도 전송 승인에 결합한 bounded private-live 도구를 동결했다. 실제 개인 공급자 실행은0회다.
- `release_audit`: 공개 resumable 반복 복원·cutover freshness·승인/credential 독립 검토·Windows canonical/license·Worker 최소 pin과 Node 생성 타입 보완을 동결했다. source 변경·새 실행은 root와 소유권을 다시 정한다.
- 사용자는 기존 Notion 백업과 정답 작성을 위임했다. 정확 Markdown20개/expected/독립 proof는 `.private/golden-corpus`에만 있다. 위임20개와 사람 승인0개를 구별하며 다중매체20-slot 전체나 실제 AI 의미 품질을 완료로 취급하지 않는다. Android가 실제 대상이며 아직 실기기 검증은 없다.
- 실제 설정 모델의 합성 S1·공개 S4·합성 S5는 각각 단1회 HTTP503으로 실패했다(총3호출). 개인 자료를 보내거나 모델·과금 설정을 바꾸지 않았다.
- 최종 통합 결과와 한계는 [85번](./85_WINDOWS_COMPLETION_CANDIDATE.md), 전체 종료 조건은 [50번](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)에 있다. 아래 실행 중 표시는 각 과거 checkpoint의 당시 상태다.

실행 핸들과 최종 검사 결과는 확인되는 작업 경계에서 갱신한다. 원격 migration/배포/cutover와 실제 기기 gate는 구체적인 준비 결과를 바탕으로 처리하며 이 문서의 과거 승인 기록만으로 새 원격 작업을 실행하지 않는다.

### 최종 로컬 checkpoint · 2026-10-03 KST

- 앱/Worker 보완은 `7e472e4`까지 commit했다. 영상 판단·일반/public resumable 반복 복원·정답 위임 proof·credential 경계·UI focus/대비·Windows 파일 시스템 guard·Worker/PWA를 포함한다. 문서까지 commit한 정확 HEAD와 새 private replay는 ignored `.codex/v2-completion/final-verification.json`에 결합한다. GitHub에는 새 후보를 push하거나 배포하지 않았다.
- 전체 Vitest `37066`은 최종177파일/3,604개 중3,598 PASS/6 FAIL·exit1·5,897.67초로 종료했다. Windows symlink5/licenseCRLF1을 validator/runtime 변경 없이 보완한 실패2파일전체24/24 PASS·exit0 및 독립24/24 PASS를 확인했다. 나머지175파일3,580개는 해당 전체 실행의 PASS다. 새Wrangler pin 뒤 별도 실제runtime6파일34/34 PASS·exit0·1,045.84초다. 기존 전체를 새 engine의 단일 exit0로 바꾸지 않는다.
- 전체 browser `2714`는883 PASS/21 SKIP/실패0·exit0·30.5분, Capture/Library flag 각1 PASS·exit0다. UI 소스는 `f718743`이며 이후 Worker/SW 변경은 native Worker와 실제Chrome fresh/기존캐시 update로 확인했다. 모든 사용자는 합성/격리 대상이며 실제 Android OS Share나 원격 저장 성공이 아니다.
- 최종 root 도구 `77359`: Node78+replay5+live12=95 PASS/skip0/exit0. Node 타입 normalizer7개를 포함한다. 전체 타입 `83534`와 최종 production app 타입 `71168` exit0. 통합+생성 도구 lint `57951` exit0·오류0/기존경고80. bindings regenerate/check exit0, db check exit0이다.
- 기본 Node24.11.1의 한글 recursive cp 무복사/rm native crash를 synthetic sentinel로 재현했다. 격리 child probe가 자격 증명/환경 가림/삭제 전에 거절하며 intentional old-runtime wrapper exit1에서 기존 산출물·환경2개를 보존했다. task-local Node24.19.0을 사용하고 원래 PATH로 복귀했다.
- Wrangler4.121의 date 미지원/중복Node flag 결함을 공식 최소4.122 pin으로 보완했다. 기본 workerd1.20260811.1은 운영8/12 지원이며 external binary override를 사용하지 않았다. generated Node const가 설치Node타입을 가리는 upstream issue7026를 정확3선언 위임으로 처리했다. Buffer/from/Process가 any로 흐르지 않고 invalid 입력은 거절한다. 앱 암호/토큰/proof 처리는 불변이다.
- 최종 safe Worker `22540` exit0: 가린 환경2개 복원·7,505파일 감사·secret0, compiled env3종빈객체·build-only flag없는 config 초기화. native `24084` exit0: HTTP8개+실제Chrome2시나리오=10검사PASS, D1/R2 workers_binding·capture/manifest·정확HTML·fresh offline·이전307cache→v3 update/동일draftId와전체행 보존. AI/write0·cron없음·fake local binding이다. 위 타입/lint/tools/Vitest/browser/build/native 핸들은 모두 종료했다.
- 원격 D1 ledger18/파일41/pending23, legacy schema 반영8개 단일ledger repair와 V2 migration15개/AI0·cron없는 초기Worker 설정을 private에 준비했다. R2 1,534개4,033,625bytes 읽기 사본과 전체SHA재검증 exit0, HTTP/custom metadata·D1 export/복원 drill은 미포함이다. D1 native export는 조회 일시중단 가능성이 있어 운영 승인이 필요하다. Worker settings403과 실제 limits/복구·원격 쓰기/배포 승인은 남는다. 원격 SQL/ledger/R2 write·migration/deploy/cutover는0회다.
- 다음: source-clean 최종 private20 replay와 unauthorized live approval request를 새 경로에 고정하고 위 verification receipt를 기록한다. 원문20개→GoogleGemini main 최대20회/입력당1회/첫실패중단/재시도0의 별도 전송 승인과, 백업복구를 먼저 검증한 기존Cloudflare 원격 변경 승인을 구체적으로 요청한다. 실제 성공한 모델 응답의 독립 의미 평가·Android·운영 기간까지 전체 goal은 active다.

### 통합 검증 checkpoint · 2026-10-03 00:55 KST

- 영상 항목 판단·nonresumable 반복 복원·cutover freshness 계약은 로컬 `bb44d48`에 보존했다. root의 영상 브라우저 최종10/10 PASS/exit0(43.2초), 실제 desktop/mobile screenshot·axe·overflow·복사·재시도/권한 경로를 확인했다. 최초 새 spec6개 실패는 route 등록 순서가 local API mock을 우회한 것으로, `fallback()` 수정 후 전부 통과했다.
- 독립 검토가 실제 `/api/v2/restores/import`의 resumable workflow에도 owner collision 뒤 repeat 결함을 재현했다. 해당 `resumable-restore-v2.ts`와 신규 public workflow 시험은 `release_audit`가 root 승인으로 최소 보완 중이다. 실행 중이던 전체 Vitest `69736`은 수정 전 불완료 실행으로 exit1 중단했고 PASS로 계산하지 않는다. 종료 후 해당 vitest 프로세스0을 확인했다. 완료 후 단일 고정 소스로 전체를 다시 실행한다.
- 전체 Playwright `96412`/root는 현재 진행 중이다. write1/AI0 local dev와 합성 API 대역이며 실제 공급자·실기기·원격 저장을 대신하지 않는다. Next dev/typegen/build의 다른 실행 소유자는 없다.
- root 통합 도구 검사: Node71/71 + 격리 replay5/5 PASS/skip0/exit0. web·evaluator·replay·cutover 전체 타입 exit0. app 전체 lint 오류0/기존 경고80, evaluator/cutover 오류0; 최종 통합 lint 추가 실행 `24651` 확인 중이다.
- 실제 Notion20개 private replay는 capture/getRecord/retrieval/resumable export→ZIP→collector/evaluator를 실행해 source hash20/20, 제목 top1 19/20·top10 20/20을 확인했다. type/typed 추출·live/Worker는 미측정이며 evaluator는 blocked/promotion=false이다. 최종 commit identity로 새 출력 실행을 남겼다.
- 원격에는 SELECT만 보냈다. ledger 로컬41/적용18/pending23/unexpected0, schema metadata144테이블/전체11,176행, R2목록1,534개/4,033,625bytes를 private 폴더에 보존했다. bookmark GET도 성공했다. R2 ETag를 SHA로 간주하거나 이 목록을 검증된 복구 백업으로 승격하지 않는다. V1 8파일은 컬럼이 이미 일치해 ledger 누락 가능성이 높고, V2 0018–0032 정확15파일과 분리해 독립 검토 중이다. 원격 table/ledger/R2 객체를 쓰거나 migration/deploy한 적 없다.
- `inventory-d1.ts`/`inventory-r2.ts`의 tsx 실행에서 `import.meta.dirname`이 비어 실패했다. 지원되는 `fileURLToPath(import.meta.url)` 기반 경로로 바꾼 뒤 실제 read-only 원격 inventory 두 실행이 exit0으로 끝났다. `wrangler migrations list`는 내부에서 migration table 초기화를 하므로 엄밀한 read-only 감사에 사용하지 않았다.

### 현재 실행 checkpoint · Windows 통합 재검증

- 공개 resumable 반복 복원 수정은 `0c9524b`에 보존했다. 실제 SQLite workflow20/20 PASS와 별도 첨부 ZIP의 collision 뒤 repeat2·3에서 reused12/create0/fork0/conflict0/invalid0·canonical/FK/첨부 hash 일치를 확인했다. 전체 Vitest `37066`/root는 수정 후 다시 실행 중이며 최종 exit를 기다린다.
- 첫 전체 Playwright `96412`는 **877 PASS/21 SKIP/6 FAIL/exit1/36.3분**이다. 3종 desktop/mobile 실패는 reader focus 경합·정렬 라벨 대비·lab spec 쓰기 flag 가정이었다. UI 수정은 `f718743`, 영향 범위3파일 브라우저는 **107 PASS/17 SKIP/exit0/2.9분**이다. 수정 후 전체 Playwright `2714`/root를 다시 실행 중이다. reader UI 수정은 server/SQL/권한 로직을 바꾸지 않는다.
- 현재 root lint `37290`, 타입 `27480` 실행 중이다. 이전 타입53792와 inventory 두 파일 lint5638은 exit0이다. secret-safe Worker/build/로컬 runtime 및 capture/library cutover profile 검사는 browser 자원 종료 후 root가 순차 실행한다. agent 소유 변경은 모두 동결했다.
- 원격 구형8파일은 원격 schema와 로컬 baseline 구조 일치0차이/재실행 duplicate column을 독립 확인했다. V2 pending15파일은 빈 원격 schema clone에 적용15/15·FK0, 비V2 정의변화0·추가9테이블 보존이다. 실제 행/hash/운영 recovery 결과는 아니다.
- `.private/release-preflight/approval-plan.json`·`legacy-ledger-repair.sql`·`release-stage.toml`을 준비했다. 정확8이름의 single INSERT는 local UNIQUE/원자적 재실행 거절을 확인했다. 초기 Worker 계획은 write1/AI0/crons없음/defaultlibrary0/legacyreadonly0이다. 원격 실행은 없다. Workers settings HTTP403이므로 존재/권한/설정은 미확인이다.
- 사용자 실기기는 **Android**다. [85번](./85_WINDOWS_COMPLETION_CANDIDATE.md)에 실제 설치·OS Share·기내 모드 종료/재실행·재연결 idempotency·restricted·이동성 체크와 로컬/원격 완료 경계를 작성했다.
- 후속 합성 S5 actual main gateway/query resolver 1회도 HTTP503/provider_server/exit1이었다. 이번 실제 생성은 S1/S4/S5 총3회이며 자동 재시도·모델/과금 변경·private 전송을 하지 않았다. 실제 모델 성공/의미 평가 gate를 통과시키지 않는다. 승인 후 private 평가를 실행할 bounded 도구만 별도로 준비 중이다.
- 기존 설정 Worker HTTPS의 capture/manifest와 native D1/R2 probe는 read-only GET에서200/ready=true/workers_binding이다. 현재 후보 배포나 exact binding target/flag/secret 증거는 아니다. settings API403은 여전히 남아 있다. 기록은 `.private/release-preflight/public-worker-probe.json`; 환경 파일의 자격 증명은 보존하고 기존 known Wrangler auth cache3경로에는 파일0이다.

### 브라우저 종료·평가 도구 후속 checkpoint

- 최종 전체 Playwright `2714`는 **883 PASS/21 SKIP/실패0/exit0/30.5분**이다. 앱 소스 `f718743` 고정 이후 도구/문서만 변경했다. desktop/mobile 공유·오프라인·편집/검색·영상 판단을 포함한다. root가 수정320px screenshots4개를 `.codex/v2-completion/evidence`에 보존했다.
- Capture flag profile `92338` **1 PASS/exit0/11.9초**, Library flag profile `73068` **1 PASS/exit0/12.7초**. 두 서버 모두 종료했다. 실제 원격 cutover/운영기간 증거로 승격하지 않는다.
- 새 `private-live` 도구는 production S1 pipeline·승인/key/현재HEAD/corpus/fresh output·20상한·첫실패중단·raw CLI 비노출·unknown/blocked 유지까지 준비했다. root package scripts를 연결했고 root `test:tools40419`는71+5+12 PASS/exit0, 새 tsc exit0이었다. 독립 key-present 검사가 Git env 전파1개 RED(11P1F)를 재현해 `eval_observations`에게 boundary/test 최소 수정 소유권을 다시 전달했다. 수정 후 최종 도구 회귀와 `release_audit`의 독립 focused 재검증을 남긴다. 실제 private/provider 호출0이다.
- app 전체 Vitest `37066`는 계속 진행 중이다. secret-safe build/local Worker smoke는 이 긴 SQL 자원 종료 후 root가 실행한다. 승인 요청 대상 파일은 준비만 했고 원격 실행·실제 개인 Gemini 전송 승인은 아직 요청/수행하지 않았다.

### 평가 도구 동결·첨부 사본 checkpoint · 2026-10-03 02:34 KST

- `private-live` 도구의 Git 자식 환경 상속 결함을 system/path allowlist로 보완해 `a0ddeb1`에 보존했다. root 도구 단일 전체 실행 `63483`은71+5+12 PASS/skip0/exit0이며 live12는56.12초였다. 전용 타입/lint `74793`도 exit0이다. 독립 key-present focused1/1 PASS 및 실제 Git/Node의 credential 접근·부모 env 열거·자식 credential 전달·network0을 확인했다. 실제 private/provider 호출0이다.
- root의 read-only R2 사본 `35051`은 exit0, 1,534개/4,033,625 bytes를 fresh private 폴더에 보존했다. 다운로드 바이트와 로컬 SHA/size, 전후 목록, 별도 전체 재해시 모두 일치하며 D1 호출0/원격 write0이다. HTTP/custom metadata·D1 백업·원격 restore drill은 미포함이다. D1 native export가 잠시 조회를 중단할 수 있어 사용자 운영 승인을 받기 전 실행하지 않는다.
- root app 전체 Vitest `37066`만 진행 중이다. 브라우저/도구 검사 서버는 종료했고 Next/typegen/build의 다른 소유자는 없다. 이 실행의 최종 exit를 확인한 뒤 secret-safe Worker build와 production 날짜의 isolated native Worker smoke를 실행한다. 진행 중 결과에 PASS를 부여하지 않는다.

### 전체 회귀 종료·Worker 검사 checkpoint · 2026-10-03 02:47 KST

- root 전체 Vitest `37066` 종료: **177파일/3,604시험, 3,598 PASS/6 FAIL, exit1, 5,897.67초**. 6개는 `private-corpus-manifest`의 Windows symlink EPERM5개와 `local-font-assets`의 checkout CRLF1개다. 제품 validator·runtime 변경 없이 Windows에서는 실제 junction+leaf canonical 경로로 검사하고 POSIX file/dir symlink를 유지했다. 라이선스는 `.gitattributes` LF 고정/실제 파일 정규화로 npm 원문과 exact 비교를 유지한다.
- 보완 소스 `84f47f9`, 실패2파일전체 **24/24 PASS/exit0/1.50초**, 변경 시험 lint/diff exit0. 나머지175파일/3,580시험은 위 전체 실행에서 PASS였으며 소스·입력 불변이다. 전체 exit1과 부분 exit0을 구별하며 새로운 단일 전체exit0으로 기록하지 않는다. 독립 검토는 `release_audit`가 이 두 경계만 맡는다.
- 긴 SQL 회귀는 종료했고 root secret-safe Worker build `63792`가 실행 중이다. 환경 파일2개의 exact-byte hash를 먼저 보존했으며 build 종료 후 복원·secret audit·production 날짜 native Worker smoke를 확인한다. Next/생성물 소유자는 root뿐이고 원격 write/private 공급자 호출은 없다.

## Windows 로컬 개발 재개 · 2026-10-02

사용자가 현재 프로젝트 폴더에서 V2 개발을 이어가기 위해 GitHub 소스 동기화를 요청했다. 원격에는 별도 V2 브랜치 없이 V2가 `main`에 통합되어 있다. 기존 로컬 `460e058`에서 원격 `7a5d771221d7398c1d8e88fb5d4ecca8eeb24ea1`까지 7개 커밋을 정상 fast-forward했고, 최종 원격 조회도 같은 HEAD를 확인했다.

- 미커밋 작업 43개 파일(추적 파일 변경과 새 파일 포함)은 `stash@{0}` / `73a8f184160644c6c9d0f36050bca3ec5410aa57`, 이름 `codex/pre-v2-sync-2026-10-02-local-work`로 보존했다. 최신 V2 소스에 다시 적용하지 않았으며 필요하면 별도 복원·비교한다. 기존 `.env.local`도 보존했다.
- Node `24.11.1`, npm `11.7.0`에서 `npm ci --no-audit --no-fund` exit0. lockfile 기준 의존성 설치를 완료했다.
- `npm exec --workspace @light-house/web -- next typegen` exit0. 첫 타입 검사는 이전 로컬 native 페이지를 참조하는 오래된 `.next/dev/types` 때문에 실패했다. 해당 생성 캐시를 `.codex/pre-v2-sync-2026-10-02-dev-types`로 옮겨 보존한 뒤 최종 root `npm run typecheck`(web + evaluator) exit0을 확인했다. 제품 코드와 검사 기준은 변경하지 않았다.
- 이 로컬 대화가 현재 폴더의 후속 개발·공유 생성물 실행 자원을 맡는다. 종료 확인 시 이 작업 폴더의 Node/workerd/esbuild 프로세스는 0개다. 개발 서버는 실행하지 않았다. 이 상태 문서 외에는 소스 변경이 없다.
- 이번 검증 범위는 Git 동기화·의존성 설치·라우트 타입 생성·전체 타입 검사다. 전체 회귀·브라우저·Worker build·실제 AI·원격 migration·배포는 이번 요청에서 실행하지 않았다.

다음 작업은 사용자의 후속 V2 개발 요청을 이 체크아웃에서 진행한다. 기존 기능별 잔여 작업과 운영 gate는 아래 인계 기록과 [50번 완료표](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)를 따른다. 과거 실행 핸들이나 전체 회귀를 자동으로 재시작하지 않는다.

## Vercel 배포 수정 · 2026-10-02

`e4f4bae`를 GitHub main에 정상 fast-forward push했다. 해당 Vercel Production 배포는 Next 설정의 무조건 Cloudflare 개발 초기화가 `/wrangler.toml`을 읽으려 하며 실패했다. 프로젝트는 `apps/web`, Node `24.x`, `npm install`, `npm run build`다.

Vercel의 `VERCEL=1` 환경에서는 Cloudflare 개발 초기화를 건너뛰도록 Next 설정만 수정했다. 로컬 개발 및 Worker 빌드의 초기화 옵션과 원격 binding 금지는 유지한다. 합성 config 실행에서 기존 오류를 재현하고 Vercel·일반 로컬·명시 `VERCEL=0` 세 경로를 확인했다. 실제 자동 배포 결과는 새 커밋으로 별도 확인하며, 이 수정이 원격 D1 migration 또는 V2 운영 전환을 승인하지 않는다.

첫 수정 `7052292`의 실제 Vercel webpack 컴파일은 성공했다. 다음 TypeScript 단계가 앱 밖의 테스트 전용 `tools/v2-eval`·`packages/db/schema` 및 `drizzle-orm`을 찾지 못했다. Vercel 전용 `tsconfig.vercel.json`으로 앱 런타임 소스·생성된 라우트 타입을 계속 strict 검사하며, 기존 `tsconfig.json`과 전체 `npm run typecheck`의 테스트 검사 범위는 유지한다. 타입 오류 무시 옵션은 사용하지 않는다.

후속 `ca11942`는 테스트 전용 타입 오류를 해소했으나 전용 include에서 Cloudflare의 생성된 `worker-configuration.d.ts`를 빠뜨려 `DB`·`ARCHIVE_ASSETS` 타입을 찾지 못했다. 해당 선언 파일을 Vercel 검사 입력에 명시해 기존 binding 타입을 유지한다.

## main 게시 통합 · 2026-10-01

사용자가 main commit/push와 기존 Vercel 자동 배포를 승인했다. 실제 원격 `460e058`의 22개 커밋을 보존하는 3-way 통합은 `e8317ce`, V2 fixture migration 선택 보완은 `89dffda`다. [84번](./84_MAIN_INTEGRATION_EVIDENCE.md)에 출처와 운영 경계를 기록한다.

- 원격의 Notion·출처/속성 매핑·zettel·readmodel/모바일 UI를 보존했다. V2 cutover guard와 shared service worker 충돌은 검증 후 해결했다
- 통합 경계44 PASS, migration 선택 RED→GREEN 및 3개 schema 적용 순서23 PASS, tools36 PASS, typegen/typecheck·bindings/db exit0
- 전체 lint 오류0/경고80(통합된 legacy UI 포함). 변경된 fixture 추가 lint 오류0
- 통합 safe Worker build exit0, audited_files7484/secret_hits0. 이후 변경은 fixture/검증 script와 문서뿐이며 runtime/build 입력은 동일하다
- 첫 통합 전체 실행은 fixture setup 오류 확인 후 **exit130으로 중단한 불완료 실행**이다. 최종 고정 소스 `89dffda1f230075f8d09cea5797e78fcd61d1658`의 단일 전체 회귀는 **174/174파일·3545/3545시험 PASS, 오류0, exit0, 1919.81초**로 10:01 UTC에 종료했다
- 소스 변경·build/test 자원 소유자는 cloud 통합 작업이다. 최종 증거와 증분 bundle로 정상 main push를 이어간다. 이후 문서 갱신은 위 검증 소스의 앱 runtime·검사·migration·dependency를 바꾸지 않는다
- local production server에서 login/sw/manifest200, routes OFF의 V2 capture404를 확인하고 종료했다. 실행 중인 검사나 개발 서버는 없다. 브라우저 interaction은 이번 통합 결과로 주장하지 않는다
- 확인한 Vercel 주소: `https://light-house-inky.vercel.app/login` (게시 전 HTTP200). Cloudflare Worker 배포·원격 D1 migration·유료 서비스·실제 AI/개인 자료 gate는 이번 자동 배포 승인에 포함되지 않는다

## 현재 인계 · 2026-10-01 Cloud Linux

사용자 승인으로 `71ec611`의 sanitized V2 소스를 dot cloud에서 이어받았다. 전체 목표는 계속 **active**이며 원격 push·migration·배포·실제 공급자 호출을 하지 않았다. [82번](./82_CLOUD_LINUX_COMPLETION_EVIDENCE.md)에 기준 소스, 변경, 검증 범위와 운영 gate를 기록한다. 아래 09-28 기록은 이전 환경의 역사 증거다.

- 구현 완료: cross-Capture manual source의 개인 분석 과잉 차단, S2 성공 분석 후 관찰 저장 재시도, S5 작성일·정렬 방향 표시, 고정 로컬 글꼴 기반 Linux build, private manifest schema/hash/realpath gate
- 로컬 `cloud-v2-completion`에 의미별 commit을 보존했다. import `fda539b`는 원래 `71ec611` Git history의 대체물이 아니다
- 변경/인접 결합 회귀 9파일127 PASS, tools4 PASS, 최초 lint 오류0/경고34·typegen/typecheck·bindings/db exit0
- Linux safe Worker build exit0, audited_files6711/secret_hits0. 실제 Next HTTP 렌더와 네 글꼴 자산200도 확인했다
- 최종 typegen/typecheck·lint(오류0/기존 경고34)·bindings/db·Linux safe Worker build exit0. **최종 고정 소스 전체 Vitest172파일3528시험 PASS/오류0/exit0(1986.36초)**. source `6b8be40556b326a8c413f902fc73ec7eecf24816`. 초기 worker OOM 2건도 보완 후 export9/9·restore-upload7/7이 포함된 단일 전체 실행으로 재확인했다
- 최종 package의 local Worker 기동·검색 화면200도 확인했다. fixture 날짜2026-08-11이며 운영2026-08-12와의 완전한 runtime parity는 미확인이다
- 개발 서버는 종료했다. 이번 환경의 Chromium IPC/localhost 미리보기 제한으로 Playwright는 미확인이다. 과거 브라우저 PASS를 현재 결과로 옮기지 않는다
- S5 결정: 2026-10-01 사용자가 민감 기록의 유형·필드 이름을 Google Gemini 검색 해석에 활용하도록 승인했다. 제목·본문·실제값·entity 이름·restricted 범위로 확대하지 않는다. 실제 호출이나 자격 증명 전달은 새로 수행하지 않았다
- **G01 후속 완료:** 별도 worktree의 오프라인 기록 평가/비교 기반을 검토 후 통합했다([83번](./83_PRIVATE_EVALUATOR_FOUNDATION.md)). evaluator32개, migration4개 포함 tools36개, 기존 manifest25개 PASS. root typecheck와 전체 lint도 최종 exit0(기존 app 경고34, evaluator 경고0). app source/package/tests는 위 고정 소스 이후 변경하지 않았다. 자유·의미 규칙과 미채점 rubric은 unknown/review required로 남겨 허위 promotion PASS를 막는다
- 실행 중인 검사·개발 서버는 없다. 소스·patch·검증 기록은 Library 코드 checkpoint에 보존한다. 재개 시 실제 프로세스 상태는 도구로 다시 확인한다
- 다음: 안전한 실행 자격 증명과 승인된 실제 자료가 준비되면 설정 모델 S1/S4·S5 품질 및 private20/20 평가를 실행한다. 실제 관측 수집 adapter와 자유 규칙/사람 rubric 기준은 별도 후속이다. 브라우저/실기기 확인과 대상별 원격 migration·배포·백업/복원·cutover는 승인과 환경 확인 뒤 진행한다. 종료된 전체 suite를 의미 없이 중복 실행하지 않는다

기존 backlog의 S2 관찰 재시도, personalSourceFence 과잉 차단, S5 written_at 표시와 오프라인 기록 비교 기반을 보완했다. 영상 노트 항목별 확인/거절, 실제 관측 수집·의미 품질 판정, 운영 예산과 실기기 검증은 남는다. 원문·자격 증명·원격 자원은 변경하지 않았다.

## 현재 인계 · 2026-09-28

사용자가 이 세션(Claude Code, Opus 5.5)에 **중단 지점부터 이어서 마지막까지 완성**하라고 지시하고 **Gemini 재호출을 승인**했다. 그래서 76번의 Astra 동결 파일(`gemini-role-gateways.ts`, `gemini-wire-schema.ts`, `analysis-envelope-v1.ts`, `verify-s1-live-synthetic.ts`)도 이번 세션이 사용자 지시에 따라 수정했다. 이 세션이 주 구현과 Next/workerd/browser/typegen/build 실행 자원의 소유자였다. S5는 병렬 agent 1개가 구현했고, root가 governor 적용 지시·독립 검토·브라우저 실행을 맡았다. agent는 종료됐다.

### 사용자 시나리오 상태

| 시나리오 | 상태 | 근거 |
| --- | --- | --- |
| S0 처리 상태 화면 | 사용 가능(로컬) | [75번](./75_GLOBAL_PROCESSING_STATUS.md). 일일 한도 재개 시각 표시 |
| S1 글·이미지 분석 → Record/Review → 검색 | **실제 Gemini로 동작 확인(진단 모델)** · 설정 모델 1회 확인 남음 | [77번 후속](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md). HTTP 400 원인은 `maxItems`, 수정 완료. 글·이미지 실제 성공, 근거 인용 재정렬 |
| S2 반복 기록 템플릿 제안 | 코드 연결·합성 검증(선행 결과 유지) | [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md). 실제 분석 성공이 가능해져 실사용에서 관찰이 쌓인다 |
| S3 일반 웹 수집 | 사용 가능(로컬, 운영자 허용 호스트) · SNS 자동 수집은 사용자 결정 | [79번](./79_S3_PUBLIC_WEB_COLLECTION.md). 회귀 닫음 |
| S4 YouTube 영상 구간 근거 | **실제 Gemini로 동작 확인(진단 모델)** · 설정 모델 1회 확인 남음 | [80번](./80_S4_YOUTUBE_VIDEO_ANALYSIS.md) |
| S5 자연어 리콜 | 사용 가능(로컬, 합성 공급자) · 실제 해석 품질 미확인 | [81번](./81_S5_NATURAL_LANGUAGE_RECALL.md) |
| 원격 배포·migration·운영 전환·결제 | 사용자·운영 결정 | 아래 '사용자 결정' |

### 이번 세션의 주요 수정

- **Gemini:** 응답 스키마 `maxItems` 제거(400 원인). 429를 분당/일일로 구분하고, 일일 한도면 태평양 자정까지 governor가 멈춘다. 한도 거절은 시도 횟수를 소모하지 않는다(무료 20회/일 소진 뒤 작업이 영구 정지되던 결함). 요청하지 않은 `source_extractions`는 버리고, 근거는 `quote`로 재정렬한다(validator `analysis-semantic-v3`).
- **S4 신규:** 공개 YouTube 명시 분석, 불변 AI 노트 source + `api` snapshot, SQL 출처 증명(위조 RED 확인), 표시·검색 라벨, lab 화면·시험.
- **S5 신규(agent):** 해석 route·카탈로그·검증·UI, 공유 governor.
- **기존 회귀 수정:**
  - 기록 API 읽기 경합 404→409(09-23 S1 이후 회귀).
  - 링크 표시의 0031 이전 스키마 가드.
  - 0032 누락 fixture 12개.
  - 0032로 늘어난 복원·내보내기 시험 2건의 제한 시간 조정(측정 184s/171s, 단정 불변).
  - 내보내기 용량 단정을 "사용자 동작 1회" 기준으로 변경.
  - ESLint 설정이 `.cjs` fixture에서 멈추던 문제.

### 최종 검사 (2026-09-28~29 KST)

| 검사 | 결과 |
| --- | --- |
| 전체 vitest `npm run test --workspace @light-house/web -- --maxWorkers=1` | 168파일 3,454개 중 **3,451 PASS / 3 FAIL**(6,227초). 3건은 0032 fixture·용량 단정·제한 시간이었다. 수정 뒤 해당 2파일 전체 재실행 **11/11 PASS**(545초). 단일 전체 재실행은 하지 않았다 |
| `npm run test:tools` | 4 PASS |
| 전체 lint `eslint .` | 오류 0 / 경고 34(기존 기준선) |
| `next typegen` + typecheck | exit0 |
| `npm run build:worker` | exit0, audited_files=6700, secret_hits=0(Windows OpenNext 경고만) |
| 전체 Playwright(desktop+mobile, 기본 flag) | **845 PASS / 51 SKIP / 0 FAIL**(896개, 35.3분). skip은 한 화면 크기 전용 lab 시험과 flag 조건이다. 그중 `FLAG_V2_WRITE=1` 대상 4 spec을 따로 실행해 **36 PASS**, cutover capture·library 전용 실행 **각 1 PASS** |
| 실제 Gemini | 진단 모델 `gemini-3.1-flash-lite`: S1 글·이미지 성공, S4 영상 성공. 설정 모델 `gemini-3.6-flash`: 400 원인 수정 뒤 스키마 수용 확인, 전체 경로 실행은 일일 한도로 보류 |

**살아 있는 실행 핸들:** 없음. 2026-09-29 00:24 KST에 port 3100 listener 0, workerd 0을 확인했다. 임시 진단 스크립트와 임시 시험 사본은 삭제했다.

### 다음 작업

1. 설정 모델 한도 초기화 뒤(태평양 자정 ≈ 한국 16:05 이후) 다음을 각 1회 실행한다.
   - `npm exec --workspace @light-house/web -- tsx scripts/verify-s1-live-synthetic.ts --live`
   - `npm exec --workspace @light-house/web -- tsx scripts/verify-s4-live-youtube.ts --live`
2. 사용자 결정을 받은 뒤 운영 작업을 진행한다: 원격 D1 migration 0006–0032 적용 상태 확인·적용, Worker 배포, 실기기 확인.
3. backlog(비차단):
   - S2 관찰 저장 일시 오류의 내구성 재시도
   - `personalSourceFence()` 불필요 차단
   - S5 `written_at` 정렬 표시
   - 영상 노트 항목 단위 확인/거절

### 사용자 결정 (2026-09-29)

- **Gemini 무료 등급 유지.** 개인 단독 사용으로 충분하다. 상용화 때 다시 검토한다. 일일 한도가 소진되면 다음 초기화까지 자동으로 대기한다.
- **Threads·Instagram은 URL 보관 + 직접 붙여넣기·첨부.** 서버 수집은 운영자 허용 목록에 넣거나 리다이렉트로 거쳐도 `threads.com/.net`, `instagram.com`, `instagr.am`, `cdninstagram.com`, `fbcdn.net`을 차단한다(`public-web-fetch.ts`, 시험 40 PASS). 모델 요청에는 URL 열람 도구가 없고, 파일 URL은 YouTube 정규 주소만 보낸다.
- **git:** 사용자 지시로 커밋했다(브랜치 `v2-completion`).
- **남은 결정:**
  - 원격 D1 migration(0006–0032)·Worker 배포·`V2_PUBLIC_WEB_ALLOWED_HOSTS` 지정·AI flag 활성화
  - S5 카탈로그에 sensitive 라벨 포함 여부

## 이전 인계 · 2026-09-23 (역사 기록)

사용자가 **GPT-6 Sol Ultra로 주 구현을 이전하고 Astra Ultra는 핵심 결정·독립 검토를 전담**하도록 지정했다. [76번 분담/인계](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)가 현재 실행 순서다. 현재 Sol 대화가 사용자가 선택한 기존 프로젝트 폴더의 주 구현·Next/workerd/browser/typegen/build 실행 자원 소유자다. S0–S2 인계 배치 뒤 사용자 지시를 받은 Astra가 **S3 공개 웹·Threads·Instagram 수집**을 이번 Sol 배치로 지정했다. 완료 시 Sol은 기존 Astra 작업 `019fef82-eb62-7fc1-87ce-19e13227b4e4`에 완료·미완료·필수 판단과 파일 소유권을 다시 보고한다. Astra는 그 보고를 받아 후속 S3 잔여→S4→S5 순서를 판단·지시하며, Sol은 임의로 다른 배치·새 goal·자동화·원격 배포를 시작하지 않는다.

### 이번 S3 실행 소유권

- **Sol:** S3 공개 URL 수집·저장·API/UI·관련 시험·S3 기능 문서 한 개와 이 상태 문서. 공유 Next/workerd/browser/typegen/build 생성물·서버도 Sol이 단독 관리한다. 기존 수동 스크랩/프롬프트 정리본은 다시 만들지 않는다.
- **Astra:** Gemini HTTP 400 호환성 진단/수정, `apps/web/src/lib/v2/ai/gemini-role-gateways.ts`, 공급자용 새 schema helper, 관련 gateway/schema 시험, `apps/web/scripts/verify-s1-live-synthetic.ts`, [77번](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md). canonical analysis envelope, safe JSON schema, model routing, env도 Sol이 수정하지 않는다. 합성 실호출은 **누적 3/3 소진**, 추가 호출 금지다. Astra 변경 파일은 현재 동결이며 공유 생성물은 Sol이 소유한다.
- **현재 상태:** [79번](./79_S3_PUBLIC_WEB_COLLECTION.md)의 정확 호스트 허용 공개 웹 텍스트 수집·불변 저장·Record 표시/복사를 구현하고 합성 HTTP/SQLite33 PASS, Workerd D1 7 PASS, desktop/mobile browser4 PASS, typecheck exit0을 확인했다. 기존 링크 회귀·Worker build 최종 확인을 진행 중이다. SNS와 임의 공개 도메인 자동 확보는 미완료로 분리한다. S3는 Gemini 성공의 선행 조건을 두지 않는다.

현재 [75번](./75_GLOBAL_PROCESSING_STATUS.md) S0는 관련 로컬 SQL/API/SSR/브라우저 검증을 닫았다. [77번](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md) S1은 로컬 연결과 합성 대역 검증을 마쳤지만 실제 Gemini 합성 글은 누적 3회 모두 실패했고 최신 안전 분류는 HTTP 400 `invalid_request`다. 마지막 요청 호환성 보정과 wire 대역 검사 뒤에도 원인은 미확정이다. [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md) S2는 합성 SQLite/브라우저에서 제안·선택·새 Capture를 검증했고 후속 상태 전이 CAS 경합도 수정했다. S3의 일부 공개 웹 수집은 구현·검증 중이며 SNS 자동 확보·S4 영상·S5 자연어 리콜/전체 통합은 남는다. 완료한74번과 Astra 지침 조사를 다시 시작하지 않는다.

34951/51389/8676은 종료됐다. 선행 S0는 순수·SQLite·API176 PASS, SSR·Workerd5 PASS, desktop/mobile browser40 PASS와 마지막 링크 변경 범위2 PASS였다. 선행 S1은 계약/단위226 PASS, desktop/mobile 자료 UI4 PASS·Record 모듈2 PASS였고, 교차 Capture P1 수정 후 관련 처리 3파일43 PASS·보강 회귀2 PASS였다. Astra의 이번 S1 공급자 wire 관련75 PASS·scoped lint/typecheck exit0이었으나 합성 글 마지막 실호출도 HTTP400/exit1, 누적3/3이다. S2 최신 상태 전이 경합은 수정 전3 FAIL을 재현하고 수정 후 FK ON SQLite14 PASS·scoped lint exit0, 공유 typecheck exit0을 확인했다. S2 desktop/mobile browser2 PASS는 선행 결과다. 처리 pipeline 인접 범위를 함께 실행한 이전 결과는 8 PASS/15 SKIP이었다. 실행 범위가 겹치므로 시험 수를 합산하지 않는다. 상세 명령·범위는75·77·78·79번에 있다. 아래74번 PASS를75번 증거로 재사용하지 않는다.

**진행 보고 방식:** 과거 55%는 11영역 동등가중 점수일 뿐 현재 코드 구현률이 아니다. 사용자 시나리오별 사용 가능/연결·검증 중/미구현/운영 확인을 보고한다. 전체 목표 범위는 유지하며 이 문서는 goal 상태나 실제 실행 모델을 변경하지 않는다.

## 완료한 선행 단위의 기록

### 2026-09-23 S0–S2 인계 결과

| 사용자 시나리오 | 현재 상태 | 근거·한계 |
| --- | --- | --- |
| 저장 기록의 분석 진행을 desktop/mobile에서 확인 | 사용 가능(로컬 합성·SQLite·Workerd·브라우저 검증) | [75번](./75_GLOBAL_PROCESSING_STATUS.md). 저장과 분석 분리, 현재 입력별 상태, owner/restricted, 실패·경합 표시. 실제 개인 자료/원격 운영 확인은 별도다. |
| 글·이미지에서 AI 제안·근거를 Record/Review에 저장하고 검색 | 코드 연결·검증 중 | [77번](./77_S1_CAPTURE_ANALYSIS_RECALL_EVIDENCE.md). 합성 이미지 대역 전체 연결과 실제 SQLite 보안 경계는 통과. 실제 Gemini 글 3회는 실패했고 최신 안전 분류는 HTTP400이다. 실호출 예산3/3 소진, 이미지 실호출 없음, 원문 보존. |
| 반복 기록의 자동 템플릿 제안→명시 선택→새 Capture | 코드 연결·합성 검증 중 | [78번](./78_S2_ADAPTIVE_TEMPLATE_CONNECTION.md). 3문서·3일, 비활성 초안, 동의 철회·privacy 전환 뒤 노출/승격 제한과 재분석·네 번째 기록 회복, try/keep, 새 입력을 SQLite와 desktop/mobile에서 검증. 실제 Gemini 성공은 미확인. |
| 웹/SNS 수집·영상·자연어 리콜/전체 통합 | 코드 연결·검증 중 | [79번](./79_S3_PUBLIC_WEB_COLLECTION.md)의 서버 정확 허용 호스트 공개 웹 텍스트만 구현·로컬 검증 중. 기본 허용 목록은 비어 있다. SNS 자동 원문·임의 호스트·S4 영상·S5 자연어 리콜/통합은 미구현이다. |
| 실제 계정의 제공자 접근·원격 배포/migration·운영 전환 | 사용자·운영 확인 | HTTP400의 정확 원인은 미확정이고 사용자 계정 조치를 요구할 근거는 없다. 과금 확대·모델 역할 변경·원격 자원 변경을 하지 않았다. |

Sol root가 제품 변경·공유 Next/workerd/browser/typegen 자원과 로컬 통합 검사를 소유했다. S1 agent는 별도 파일의 연결·보안 수정과 RED→GREEN 재현을 맡았다. S2 독립 읽기 검토는 과거 관찰의 AI 동의 철회 누락과, 생성된 초안의 사후 적격성·회복 누락을 찾아 root가 수정·회귀 검증했다. 검토자는 최종 SQL에 추가 필수 결함을 찾지 못했으나 테스트/브라우저/제공자를 독립 재실행하지 않았다. 기존 Astra 대화는 제품 파일을 동시에 수정하지 않았다. 최종 port3100 listener 0, workerd process 0을 확인했다.
기존 Astra 대화(019fef82-eb62-7fc1-87ce-19e13227b4e4)의 최종 검토가 분석 입력 `loadAnalysisInput()`에서 같은 owner·다른 Capture restricted source의 원문 누출 P1을 실제 SQLite로 재현했다. Sol root가 해당 SQL의 document·source·Capture 경계를 수정했다. 추가 독립 읽기 검토는 모델 입력 누출 차단을 확인했고, 새 회귀 2건은 RED→GREEN을 확인했다. 다른 Capture의 잘못 연결된 수동 source가 정상 분석을 불필요하게 차단할 수 있는 `personalSourceFence()` 경계는 비차단 후속 개선으로 남겼다. 검토 결과를 이전 작성자 PASS로 대체하지 않는다.

갱신: 2026-09-22 22:16 KST. 전체 goal은 **active**, 진행률은 **약55%**(G01–G11 동일 비중 단계 달성도,600/1100=54.55%). 시간·코드·시험 수의 비율이 아니다. 완료한 Astra 지침 정비·G06 이동성·70–74번 단위를 다시 시작하지 않는다.

## 완료한 현재 단위 · Record 맞춤 보기 경계

[74번 계약/증거](./74_RECORD_MODULE_BOUNDARIES.md)에 따라 실제 Record와 현재 workout 모듈의 개인정보·version/shape/fallback·본문 우선·정확 JSON 전송을 구현하고 검증했다.

- 서버가 실제 DB privacy/owner/canonical/legacy를 읽는다. sensitive 모듈은 빈 데이터의 redacted DTO, restricted 모듈은 재인증 뒤에도 생략한다. 허용된 본문/기본 필드 읽기는 유지한다.
- 연결된 restricted 기록의 제목과 제3 restricted 원문의 인용을 차단한다. 최종 한 SQL snapshot에서 관계/evidence identity와 source/capture/document 권한을 다시 확인한다. 같은 ID의 target 교체·늦은 privacy 변경·다른 owner/손상 canonical을 시험했다.
- 설치된 preset/module만 허용하고 전체 JSON 깊이32/노드10000·불변 복제·중복/renderer/evidence를 검사한다. 모듈 오류는 개별 catchError/Suspense로 격리한다. 본문/일반 필드는 계속 보인다.
- 실제 Record/Review는 권한 검사가 끝난 JSON 문자열을 client에 전달한다. Flight의 null prototype 거부와 own __proto__ 소실을 재현하고 exact encode/decode·실제 lab browser에서 원래 키 보존을 확인했다. 정본 DB/백업은 바꾸지 않았다.
- 빈 boolean을 '아니요'로 단정하지 않는다. 320px/긴 값·출처·키보드 근거·고정 개인정보 안내·색상 대비·긴 값 옆 태그 정렬을 보완했다.
- 원문·자격 증명·Gemini 역할·원격 자원은 그대로다. 직전 탐색/목록의 증거는 [73번](./73_COMPLETE_CATALOG_DISCOVERY.md)에 보존한다.

## 최종 검사와 실행 핸들

| 실행 | 최종 결과와 범위 |
| --- | --- |
| module_contract_audit 21:59:33 | 순수120+기존3+actual Flight9=132 PASS,exit0,6.85초 |
| module_privacy_audit89629 | 실제 SQL/SSR63+기존 정책12=75 PASS,exit0,21.45초 |
| root20196 | actual 격리 workerd/D1 module5+processing17+legacy6=28 PASS,exit0,213.81초 |
| root41234 | 최종 browser42 PASS/4 SKIP,exit0,1.3분. module36/기존 내구성6 |
| root95372 / root37733+62246 | 최종 타입 exit0 / 변경 TS15파일 lint 및 마지막 시험 변경 lint exit0 |

서로 다른 서버/계약/SQL/transport 검사235개(132+75+28)다. 중간 결과/재실행을 더하지 않는다. browser4 SKIP은 기존 capture 쓰기 flag off의2개 시험×desktop/mobile이다. 전체 suite·Worker build·실제 개인 자료/제공자·실기기 검증은 아니다.

초기 RED·시험 harness 수정·브라우저 색상 대비 실패 및 보완은74번에 보존했다. 기준/timeout을 낮추지 않았다. 최종4화면을 다시 렌더해 시각 확인했다. 당시 `evidence/74-record-modules-hashes.json`은 source/test17개+화면4개+실패 관찰 요약1개를 고정했다. 해당 과거 manifest 파일은 현재 Windows checkout에 포함되어 있지 않으며 새로 만들어 당시 증거를 대체하지 않는다. 당시 최종 검사 후 제품/시험 변경은 없었다.

**살아 있는 root 실행 핸들은 없다.** dev94277도 의도적인 Ctrl+C(exit1)로 종료했다. 22:13:09 KST port3100 listener0/workerd0을 확인했다. 다음 실행 때 실제 생존 여부를 다시 확인한다. 기본 git diff --check exit0이며 기존 CRLF 안내는 임의 개행 변환으로 처리하지 않았다.

마지막 대조: manifest22개 hash 불일치0·문서4개 로컬 링크96개 누락0. README6행의 기존 Markdown 줄바꿈 공백2개는 의미가 있어 유지하고 일반 후행 공백과 구분했다. 독립 read-only 문서 감사도 수치/범위/핸들/다음 작업의 모순을 발견하지 못했다.

## 74번 당시 소유권 · 역사 기록

- root: 계약·registry/D1·실제 route/공통 연결·Next/workerd/browser/type 실행 창·문서/최종 검사.
- module_contract_audit: 독립 순수/Flight 위험 시험. 완료·동결.
- module_privacy_audit: 실제 SQL/SSR 권한·근거·경합 시험과 읽기 감사. 완료·동결.
- module_fallback_ui: 모듈 UI/fixture/브라우저 시험. 완료·동결. 이후 root가 역할 기반 locator와 대비 specificity·태그 정렬을 보완했다.
- 문서의 agent 이름만 보고 실행 중으로 가정하지 않는다. 실제 도구에서 확인하며 한 파일의 작성자는 한 명이다.

## 다음 구체 작업

1. 실제 Gemini HTTP400의 요청 호환성 원인을 좁힌다. `responseJsonSchema`의 미지원 키/복잡도는 강한 후보지만 미확정이다. 실호출은 누적2/3회이고 이번 배치에서는 더 호출하지 않았다. 이미지 실호출·분석 성공·품질은 미확인이다.
2. S2 관찰 저장 자체의 일시 오류는 분석 성공을 보존하지만 해당 관찰을 누락시킬 수 있다. 내구성 재시도와 사용자가 이미 선택한 `trial`/`active` 템플릿의 사후 출처 정책은 후속 결정/개선이다. [76번](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 S3 웹/Threads/Instagram 원문 수집→S4 영상 구간 근거→S5 자연어 리콜·최종 통합은 별도 배치로 남긴다.
3. 전체 범위와 운영 경계는50번에 유지한다. 원격 배포/migration/cutover·과금 확대·모델 역할 변경은 이번 실행에서 하지 않았다.

이번 단위는 완료했지만 전체 goal은 완료가 아니다. 승인되지 않은 배포/migration/cutover/과금 확대는 수행하지 않았다.
