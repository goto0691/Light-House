# 2026-09-08 감사 개선 · 로컬 검증 근거

> 상태: 16개 감사 개선 구현 및 로컬 통합 회귀 통과. 이 문서는 배포·마이그레이션 적용·cutover 승인이 아니다.

## 범위

현재 작업 트리의 감사에서 확인한 저장 유실, 권한, 백업, AI 처리, 탐색 문제를 수정한다. 기존 사용자 변경은 유지한다. 실제 개인정보·API 키를 테스트 fixture 또는 보고서에 복사하지 않는다. 원격 D1/R2 변경, Gemini 실호출, 배포는 수행하지 않는다.

새 요구인 Threads/영상 링크 보관은 [45_LINK_CAPTURE_AND_PROMPT_LIBRARY.md](./45_LINK_CAPTURE_AND_PROMPT_LIBRARY.md)의 제품·데이터·UI 계약으로 추가했다. 자동 수집 adapter, 프롬프트 갤러리/복사 화면, 영상 분석 기능은 아직 구현 완료가 아니다.

## 개선 항목

| ID | 문제 | 구현 방향 / 검증 경계 |
| --- | --- | --- |
| A01 | 업로드 중 새 편집을 이전 저장 응답이 삭제 | outbox operation/hash가 일치할 때만 로컬 payload 삭제. 다른 창에서 바뀐 초안은 보존하고 자동 재전송 중단 |
| A02 | 본문 편집이 서버 debounce에만 의존 | owner별 편집 복구 사본, 저장 generation에 따른 정리, 이탈/백그라운드 시 flush. 잠금 기록은 로컬 보존 금지, 민감 기록은 명시 동의 시 암호화 |
| A03 | 잠금 기록 수정·등급하향에 재인증 누락 | revision 저장/replay 권한 확인 및 저장 직전 SQL guard |
| A04 | 새 entity/event 부모 object가 증분 백업에서 누락 | `0030` object 변경 이벤트 trigger와 기존 object backfill, 실제 full→incremental→새 DB 복원 회귀 |
| A05 | 빌드 플래그 검사가 Worker 초기화를 차단 | runtime config를 부작용 없이 import. Next-for-Worker 실행 스크립트로 검사 이동, safe wrapper가 플래그 없이 compiled config import까지 검증 |
| A06 | 이미지/음성 분석에 첨부 메타데이터만 전달 | owner·MIME·크기·hash 검증한 R2 bytes를 model part로 전달. OCR/전사를 별도 불변 source와 evidence로 저장 |
| A07 | 만료된 running 작업이 영구 정지 | 만료 lease 회수, 최대 재시도, 시도별 token, 늦게 도착한 성공·실패·외부 호출 차단 |
| A08 | 편집 후 AI 필드가 옛 본문에 머묾 | 저장된 revision의 불변 text source와 revision별 재분석 outbox. AI 동의가 없는 Capture와 충돌 fork에는 새 분석을 등록하지 않으며 사용자 잠금값은 유지 |
| A09 | 보관함·검색의 50건 이후 접근 불가 | 보관함 cursor와 검색/저장 뷰 페이지 탐색, 소유자·visibility 조건 유지 |
| A10 | revision 내보내기에 번호·상태·fork 정보 누락 | canonical revision 보존 필드 확장 및 충돌 revision 왕복 검사 |
| A11 | 모바일 탭이 숨겨진 preview만 선택 | 작은 화면의 레코드 행 탭은 상세로 이동 |
| A12 | 표시 문자열을 정정 입력으로 써 boolean/date 변형 | canonical 값으로 폼 초기화·검증, 표시 형식과 직렬화 분리 |
| A13 | AI 평점 100점 허용과 5점 UI 불일치 | 0..5 계약 통일, 원래 척도가 명시된 경우만 정규화. 기존 범위 밖 값은 척도 확인 필요로 표시 |
| A14 | 재연결 시 현재 열린 queued 초안 제외 | 현재 대기 초안도 안전한 snapshot으로 재전송 |
| A15 | Server Component에서 stale grant cookie 삭제 시 예외 | read 경로는 mutation 없이 grant 없음으로 처리 |
| A16 | 백업 envelope의 schema_version이 DB 동명 열을 덮어씀 | 추가 회귀에서 발견. 새 `v2-030` envelope에 원래 행 버전 보존, 공통 encode/decode 적용. 옛 archive의 소실값은 추정하지 않음 |

## 구현 및 운영 제약

- `0030_v2_object_backup_change_events.sql`은 로컬 코드에만 추가한다. 기존 원격 DB에 적용하지 않는다.
- revision별 outbox를 위해 옛 capture/event unique index를 일반 조회 index로 바꾼다. 구형 스키마의 AI-enabled 편집은 데이터 변경 전에 명시적 오류로 중단해야 한다.
- 첨부 자동 분석의 초기 앱 상한은 파일당 8 MiB, Capture당 10 MiB, 12개다. 초과·미지원·손상 파일도 원본을 삭제하지 않는다. review에서 더 작은 입력을 안내한다.
- Gemini 입력 계약 회귀는 fake model을 사용한다. 실제 OCR 정확도, 제공 모델의 영상 capability 및 quota 통과를 대신하지 않는다.
- 브라우저의 강제 종료·저장소 제거 상황에서 마지막 입력까지 절대 보존한다고 보장하지 않는다. 서버 저장 상태와 기기 복구 상태를 구분한다.
- 비밀값은 출력하지 않으며 safe Worker build가 환경 파일을 임시 격리한 경우 복원을 확인한다.

## 검증 기록

이전 감사의 67개 파일/363개 테스트 통과는 변경 전 기준선이다. 아래는 이번 변경 후 실제 검증 결과이며, 집중 테스트와 전체 테스트의 중복을 합산하지 않는다.

| 검사 | 현재 결과 |
| --- | --- |
| Worker runtime config 및 직접 빌드 차단 회귀 | 2 tests PASS |
| migration private sample 도구 테스트 | 4 tests PASS |
| 수정 영역 집중 회귀 | 데이터 29/29, AI 신규 16/16, offline/editor/helper 25/25, retrieval 13/13 PASS. 서로 겹치는 검증이므로 합산하지 않음 |
| 전체 unit/contract 회귀 | 최종 재실행 **75 files / 414 tests PASS**, exit 0, 875.64초. 첫 실행 실패와 원인은 아래에 별도 보존 |
| TypeScript | `tsc --noEmit --incremental false` PASS, Worker build의 TypeScript도 PASS |
| ESLint | 최종 전체 실행 **0 errors / 34 warnings**, exit 0. hooks·기존 navigation·alt-text 등의 경고는 남아 있음 |
| Drizzle schema / Worker binding types | `npm run db:check`, `npm run bindings:check` PASS |
| safe Worker build 및 secret scan | PASS: `masked_env_files=2`, `audited_files=6366`, `secret_hits=0`; 환경 파일 3개 hash 비교에서 변경/누락 0, hidden 잔여 0 |
| 브라우저 실제 컴포넌트 | 최종 durability spec desktop 5 + mobile 5 = 10/10 PASS |
| 로컬 Worker 기동 | build-only flag 없이 manifest 200/본문 확인, 인증 없는 records API 401. 운영 compatibility date와의 차이는 아래 제한 참조 |

### 실패를 숨기지 않는 재검증 기록

첫 전체 실행은 872.32초였으며, 아래 3개가 실패했다.

- `legacy-projection-read-visibility`: lease 회수 batch가 추가되면서 테스트의 순번 기반 fault 주입이 `beginRun` 직전에서 `claim` 이전으로 이동했다. 실제 결과는 모델 호출 없이 `idle`이었다. 주입 시점을 복원하고 해당 순간 `leased` 상태를 확인하도록 테스트만 수정했다. 해당 파일 6/6 재검증 PASS; 제품 소스 변경 없음.
- `resumable-export-workflow`: 8 MiB 경계·원래 exporter와 byte 동일성 테스트가 180초 제한에 걸렸다.
- `resumable-restore-upload-workflow`: ZIP 업로드·hash·restore handoff 테스트가 60초 제한에 걸렸다.

빌드·브라우저 종료 후 원래 한도를 유지한 전체 재실행에서 해당 export 파일 9/9, restore-upload 파일 7/7, visibility 파일 6/6이 통과했다. 대용량 동일성 검사는 174.124초, 업로드/handoff 검사는 39.770초였다. 추가된 object-change-events 회귀까지 포함해 최종 **75개 파일/414개 테스트, exit 0**을 확인했다. 대용량 검사는 시간 한도에 가까우므로 다른 무거운 로컬 작업과 동시에 실행하지 않는 것이 재현에 유리하다.

주요 재현 명령:

- repo root: `npm run test --workspace @light-house/web -- --no-cache`
- repo root: `npm run test:tools`, `npm run bindings:check`, `npm run db:check`
- repo root: `npm run build:worker --workspace @light-house/web`
- `apps/web`: `npx tsc --noEmit --incremental false`, `npx eslint . -f json`
- `apps/web`: `npx playwright test tests/e2e/v2-product-durability.spec.ts` — 해당 로컬 harness에서 `FLAG_V2_WRITE=1`, desktop/mobile 두 프로젝트 실행

테스트용 Next/Worker 서버는 종료했고 3100/18788/18789 listener가 없음을 확인했다. 루트와 `apps/web`의 `.env.local`은 Git ignore 대상이며 내용은 변경하지 않았다.

로컬 Worker smoke가 만든 중첩 `.wrangler/tmp` bundle을 ESLint가 소스로 읽는 문제도 확인해 `**/.wrangler/**` 생성물 제외를 추가했다. 실제 `src`와 `tests`는 제외하지 않았으며 이 정리 후 위 최종 lint 결과를 확인했다. 최종 `git diff --check`도 exit 0이다.

### 브라우저 및 Worker 확인의 한계

브라우저 회귀는 실제 컴포넌트에 합성 fixture와 mock transport를 사용한다. 운영 백엔드 통합 결과가 아니다. 모바일은 Pixel 7 Chromium 에뮬레이션이며 iOS/Android 실기기 증거를 대체하지 않는다. Capture 관련 2개 시나리오는 `FLAG_V2_WRITE=1`인 명시적 로컬 harness에서 실행했으며 기본 write-off 실행에서는 skip한다.

`wrangler.worker-smoke.toml`은 가짜 local D1/R2 이름, 쓰기·AI 비활성화, 운영 자격 증명 미사용을 명시한다. 설치된 Wrangler 4.121.0의 workerd는 `2026-08-11`까지만 지원해 운영 `2026-08-12` 설정 그대로의 기동은 거부됐다. 로컬 전용 fixture에서만 `2026-08-11`로 검증했으며 운영 설정은 바꾸지 않았다. 따라서 build-flag 없는 Worker 초기화는 확인했지만 정확한 운영 compatibility-date parity는 호환 실행기로 별도 확인해야 한다.

Worker 빌드에는 Windows/OpenNext 호환 경고, Next middleware→proxy 권고, Next 내부 Edge `process.cwd` 경고가 남는다. 이를 실제 운영 Worker 실행 성공의 증거로 대신하지 않는다.

## 남는 출시 조건

로컬 검증 통과와 개인용 출시 가능 여부는 구분한다. 원격 migration 상태는 이번 작업에서 다시 확인하지 않았다. 승인된 release snapshot/백업, 원격 additive migration, read-only 검증, 배포 smoke 및 별도 cutover 절차를 유지한다. private corpus, live Gemini, 실제 Windows IME·모바일 공유·보조공학 검증 등 기존 미충족 gate를 이 변경만으로 통과 처리하지 않는다.

이번 재실행한 `eval:private:validate`는 구조 유효, 20 slots / ready 0이다. `cutover:preflight`는 `eligible=false`, 15 blockers로 종료했다. 구현 테스트가 늘었다는 이유로 기존 승인/실사용 증거를 변경하지 않았다.
