# ChatGPT 플랜 우선 분석과 Gemini 폴백

2026-10-16 사용자 결정: 주 분석(main_analyzer)은 사용자의 ChatGPT 구독을 **Sign in with ChatGPT(플랜 사용 scope)**로 연결해 쓴다. 사용량은 구독 주간 한도에서 차감된다. 구독이 끝나거나 쓸 수 없으면 **Gemini 3.6 Flash**로 넘어간다. Gemini는 계속 무료 등급이다.

## 경로

| 작업 | 1순위 | 2순위 |
| --- | --- | --- |
| 글·이미지·PDF 분석(S1), 링크 텍스트 정리, 자연어 검색 해석(S5) | ChatGPT 플랜 `OPENAI_PLAN_MODEL`(현재 `gpt-6.1-sol`) | Gemini `GEMINI_MAIN_MODEL`(`gemini-3.6-flash`) |
| YouTube 영상 분석(S4), 오디오·영상 첨부 | Gemini(플랜 경로는 영상·오디오 입력 미지원) | 없음 |
| 장소·작품 검색 보강 | Gemini grounded(Google Search 도구) | 없음 |

- 폴백 조건:
  - 미연결
  - 구독 해지·연결 끊김(401/403/`invalid_grant`): 연결을 `inactive`로 바꾸고, 이후 바로 Gemini를 쓴다. 다시 로그인하면 복구된다.
  - 주간 상한(`subscription_sharing_usage_limit_exceeded`): 1시간 일시 정지한 뒤 재시도한다.
  - 5xx·통신 오류·불완전 응답, 영상·오디오 입력.
- 모델 답이 스키마 검증에 실패하면 공급자 장애가 아니므로 폴백하지 않는다.
- 몰래 대체하지 않는다. 모든 실행의 `model_id`에 `openai-plan:<모델>` 또는 Gemini 모델명이 남는다(45번 7절의 "몰래 대체 금지"를 사용자 승인 폴백 + 기록으로 충족).
- governor는 역할 단위로 공유된다. 두 공급자가 모두 실패한 경우에만 대기가 걸린다.

## 연결·보관

- **로그인:** `npm exec --workspace @light-house/web -- tsx scripts/chatgpt-plan-login.ts`
  - 공식 셀프 등록(`dynamic_agent_client`), PKCE, `127.0.0.1:1455` 콜백을 쓴다.
  - 브라우저가 안 열리면 `.private/chatgpt-plan/authorize-url.txt`의 주소를 이 PC 브라우저에 연다.
  - 등록 ID·호스트 ID는 `.private/chatgpt-plan/`(git 제외)에 남는다.
- **설치:** `npm exec --workspace @light-house/web -- tsx scripts/chatgpt-plan-install.ts --model=gpt-6.1-sol`
  - 토큰을 앱 로컬 D1 `v2_ai_provider_credentials`(migration 0033)에 AES-GCM으로 암호화해 옮기고, 로그인 파일의 토큰은 지운다.
  - `apps/web/.env.local`에 `V2_AI_CREDENTIAL_KEY`·`OPENAI_PLAN_MODEL`을 추가한다.
  - refresh token은 갱신마다 바뀌므로 저장 위치는 하나여야 한다. 갱신은 version CAS로 경합을 막는다.
- 이 테이블은 내보내기·백업 대상이 아니다. 토큰·계정 정보는 로그·화면·git에 남기지 않는다.
- **로컬 D1:** 앱(next dev, 스크립트)은 `apps/web/.wrangler/state`를 쓴다. 이번에 0000–0033 migration 34개를 적용했다. 이전까지 로컬 D1은 비어 있었다. 저장소 루트 `.wrangler`에도 같은 적용을 했지만 앱은 쓰지 않는다.

## 요청 계약(공식 문서 기준)

- `POST https://api.openai.com/v1/responses`
  - 필수: `store:false`, `stream:true`. 지시는 `instructions`로 보낸다(system 메시지 거부). `temperature`·`max_output_tokens` 등은 보내지 않는다.
  - `response.completed`만 성공으로 본다. 스트림 중 `response.failed`는 실패다.
- **구조화 출력:** `text.format`에 `json_schema strict`를 쓴다. 문서에는 없지만 실제 호출로 동작을 확인했다.
  - strict 모드 요구에 맞춰 선택 속성은 "필수 + null 허용"으로 보내고, 받은 뒤 null을 제거한다(`openai-wire-schema.ts`).
  - 길이·배열 상한은 로컬 검증이 강제한다.
- **이미지:** `input_image` data URL. PDF는 `input_file`이다.
- **오류:** 상태·allowlist 코드·분류만 보존하고 본문은 버린다.

## 검증 (2026-10-16)

| 검사 | 결과 |
| --- | --- |
| `tests/contract/v2/openai-plan-gateway.test.ts` | 15 PASS. strict 변환·null 제거, 요청 형식(store/stream/instructions/이미지), 토큰 갱신·회전·암호화 보관(평문 미보관), 401/403/429/500/400 분류와 상태 전이, 스트림 중 한도 실패, revoke 비활성, 잘못된 키 거부, 폴백 4경로 |
| 관련 기존 시험 30파일 | 746 PASS |
| lint 전체 / typecheck / `build:worker` | 오류 0 / exit0 / exit0, secret_hits=0 |
| 실제 플랜 probe | 글 strict JSON 성공(약 9.6초), 이미지 OCR 성공(약 6.4초, 첫 시도는 일시 503) |
| `verify-s1-live-synthetic.ts --live` | **글·이미지 모두 성공**, `openai-plan:gpt-6.1-sol`. 근거 `"별점 4.5/5"`·`"ORBIT RATING 4.5 / 5"` 원문 일치, 검색 회수 |
| `verify-s5-live-natural-query.ts --live` | **8/8 성공**. 평점 ≥ 4, 거리 ≥ 5, 날짜 4종, 도시·저자 조건. 주입형·감정 질문은 조건 없이 미반영 |

## 제약·남은 판단

- **OpenAI 문서상 셀프 등록 플랜 사용은 "오픈소스 프로젝트와 로컬에서 실행하는 개인 프로젝트" 대상이다.** 원격 호스팅 앱은 대기 목록 승인이 필요하다.
  - Cloudflare 배포는 이 조건에 걸릴 수 있다.
  - 배포하려면 원격 D1에 0033을 적용하고, 원격으로 연결 정보를 옮기고(로컬 사본 폐기), Worker secret `V2_AI_CREDENTIAL_KEY`와 `OPENAI_PLAN_MODEL`을 설정해야 한다. 모두 사용자 승인 대상이다.
- 5분 cron 같은 무인 백그라운드 사용에 대한 공식 규칙은 확인되지 않았다. ChatGPT 설정 > 사용량에서 앱별 주간 상한을 정할 수 있다.
- 모델 선택은 `OPENAI_PLAN_MODEL`로 바꾼다. 사용량을 줄이려면 목록의 `gpt-6-luna`·`gpt-5.6-luna` 같은 경량 모델을 검토한다(미검증).
