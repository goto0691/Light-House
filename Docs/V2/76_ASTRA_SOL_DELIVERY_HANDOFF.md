# Astra / Sol 작업 분담과 인계

2026-09-23 사용자 결정. 새 GPT-6 Sol Ultra 작업은 **기존 Project Light-House 폴더에서 직접 이어받는다**. 현재 V2 대부분이 untracked이므로 깨끗한 HEAD/worktree에서 재시작하거나 임의 commit/reset/대량 정리를 하지 않는다. 기존 Astra 대화는 설계·검토 창으로 남는다. 앱의 Gemini 역할은 변경하지 않는다.

## 1. 책임 분리

| 담당 | 전담 업무 | 결과물·경계 |
| --- | --- | --- |
| Astra Ultra | 원문/저자/AI 해석, 정본·snapshot·schema·권한 의미를 바꾸는 핵심 결정 | 기존 계약으로 해결할 수 없는 경우에만 짧은 결정과 수용 기준. 일반 구현 방법까지 승인하지 않음 |
| Astra Ultra | 외부 수집·영상 capability의 미해결 접근/출처/비용 절충, 실제 AI 품질 판정 기준 | 합법적 접근·부분 확보·원문/추론 구분. 공급자 불가를 무한 재시도로 해결하지 않음 |
| Astra Ultra | Sol이 재현한 고위험 충돌, 데이터 유실/소유자 노출/원문 오염의 독립 검토 | 재현·영향·최소 수정 범위. 모든 파일 재감사 금지. 직접 수정은 파일 소유권 이전 후에만 |
| Astra Ultra | 안정된 통합 후보의 마지막 교차 기능 검토, 운영 전환 판단 자료 | 결과를 사용자에게 보고. 사용자 배포/migration/과금 승인을 대신할 수 없음 |
| Sol Ultra | 실제 UI/API/D1/queue 연결, 기존 결함 수정, 관련 시험과 정상 사용 시연 | 주 구현 소유자. 확정 계약 안에서는 Astra 응답을 기다리지 않고 진행 |
| Sol Ultra | 글·이미지 분석 연결, 자동 템플릿 발견, 자연어 검색 연결, 웹/SNS·영상 adapter 구현 | 아래 순서의 작은 종단 흐름으로 완성. adapter는 45/47/52번의 접근·출처 계약을 준수 |
| Sol Ultra | desktop/mobile, 실패/부분 확보 표시, 최종 통합 suite/타입/lint/secret-safe Worker build 및 운영 절차 준비 | 같은 생성물·서버·긴 회귀의 단일 실행 소유자. 원격 작업은 기존 승인 범위를 확인 |

이 구분은 프로젝트의 책임 배분이지 측정된 모델 성능 비교가 아니다. OpenAI Docs 지침에 따라 사용자 지정 모델을 유지한다. [공식 Sol 안내](https://developers.openai.com/api/docs/models/gpt-6-sol). 새 작업은 앱 도구가 지원하는 `model=gpt-6-sol`, `thinking=ultra`로 생성하며, API 문서의 reasoning 목록과 앱 옵션을 동일시하지 않는다.

## 2. Sol 구현 순서와 이번 착수 범위

| 순서 | 사용자 결과 | 완료 조건 |
| --- | --- | --- |
| S0 | 중단된 처리 상태 화면을 정상적으로 사용 | 75번의 현재 변경만 닫는다. 저장과 분석 분리, 현재 입력별 상태, 권한, desktop/mobile, 관련 SQL/API/브라우저·타입/lint 검증. 추가 상태 엔진/새 retry API/관련 없는 손상 시나리오 확장 금지 |
| S1 | 글·이미지를 넣으면 분석값이 저장되고 다시 검색됨 | 기존 Capture→R2/analysis→Review/Record→검색 흐름을 연결·실증. 작은 합성 글1개/이미지1개로 실제 제공자 결과와 대역 결과를 구분. 실패 시 원문 보존. 새 기능보다 끊긴 연결 보완 우선 |
| S2 | 반복해서 쓰는 글의 템플릿이 제안됨 | 실제 처리 흐름에서 observePattern 호출. 기존 서로 다른3일/3문서·동의·비자동활성 규칙 유지. 시험에서만 호출하는 상태를 완료로 세지 않음 |
| S3 | 일반 웹·Threads/Instagram URL에서 확보 가능한 원문을 보관·재사용 | 기존 수동 source/snapshot/fragment를 재사용. 허용된 자동 수집, 작성자 이어쓰기·이미지/프롬프트/인사이트 구분, 부분/차단 상태와 수동 보완. 로그인 우회 금지 |
| S4 | YouTube/영상 내용을 구간 근거와 함께 보관·검색 | 실제 지원 경로의 자막/영상/메모 구분, timecode, 긴 영상·접근 불가 fallback. URL 저장만으로 완료 처리 금지 |
| S5 | 자연어 리콜·현재 전체 통합·실사용 준비 | 허용된 query plan으로 의도 연결, 실제 자료 회수 품질, 통합 후보 검사, 사용자 운영 확인 항목 분리 |

**새 Sol 작업의 첫 실행은 S0와 S1에 집중한다.** 완료 후 무엇이 실제 사용 가능해졌는지 보고하고 다음 S2–S5를 남긴다. 한 번의 요청을 끝없는 goal/무한 자체 감사로 바꾸지 않는다. S1 공급자가 현재 접근 불가이면 원인·단일 시도 결과와 미검증 범위를 남기고, 안전한 로컬 연결은 완료한다. 같은 외부 실패를 반복하지 않는다.

S1 live 확인은 기존 계정·모델·설정 안의 작은 비개인 합성 입력에만 한정한다. 기존 승인 범위에서 가능한 호출만 하며 이번 확인의 상한은 총3회다. 제한 해제·결제·모델 역할 변경·개인 corpus 전송은 별도 사용자 결정이다. 공개 원격 배포/migration은 수행하지 않는다.

## 3. 75번 실제 중단 지점

- 현재 파일: `apps/web/src/lib/v2/domain/processing-status.ts`, `infrastructure/d1/processing-status-repository.ts`, `app/api/v2/processing/status/route.ts`, `app/v2/processing/page.tsx`, `components/v2/processing-status-view.*`, lab fixture·route, mobile-navigation/library-view, 관련 시험.
- 순수 query/cursor107 PASS 보고가 있었으며 날짜 정규화 오류8건을 수정했다. 실제 workerd34951은 SQLITE_NOMEM 3 FAIL. CTE를 materialized로 바꾼51389는2 PASS/1 FAIL이었으며, 남은 실패는 D1 내부 읽기 회계에도 변하는 total_changes 비교였다. 애플리케이션 처리 상태 before/after 비교로 고친8676은3 PASS,exit0,43.70초다.
- **8676 뒤 repository와 workerd fixture를 다시 수정했다. 따라서3 PASS는 현재 최종본의 PASS가 아니다.** 마지막 변경은 current-input published run의 partial/미검토 조각을 재분석 중에도 유지, review의 own run/job 연결, run/input hash 결합, 성공 run 없는 succeeded job을 확인 필요로 표시하는 것이다.
- SQLite/API 시험2파일은 작성돼 있으나 최종 실행 결과를 인계받지 못했다. 최신 성공 run 조건 때문에 기존 succeeded-only 시험 fixture가 계약과 어긋나는지 확인해야 한다. 제품 검증을 낮춰 fixture를 통과시키지 않는다.
- 처리 상태 UI/browser 시험은 작성됐다. 현재본의 실제 browser/SSR·타입/lint 최종 결과는 없다. stage+status별 집계이므로 같은 stage가 여러 줄 가능하다. 실제 SSR은 UI 자체 shell을 사용하여 main/mobile navigation을 중복 생성하지 않는다.
- 과거34951/51389/8676은 종료됐다. 2026-09-23 인계 확인에서 port3100 listener와 workerd 프로세스는 없었다. 문서의 옛 agent 이름/핸들을 재시작 명령으로 읽지 않는다.
- 이전 agent의 사용량 제한은 반복 호출하거나 임의 reset/모델 전환으로 우회하지 않는다. 현재 모델·접근 가능 여부는 새 작업 실행 결과로 확인한다.

## 4. 읽기·검증·보고의 상한

처음에는 AGENTS→CURRENT→이 문서→75번 및 실제 변경 코드만 읽는다. S1은 04/05/37/46번에서 필요한 계약과 실제 runner/attachments/knowledge/retrieval 경로로 이동한다. 전체 역사·모델 문서·지난 증거를 다시 통독하지 않는다.

검증은 새 변경의 관련 경로부터 실행한다. 데이터 유실·소유자/잠금 누출·정확 원문 훼손·정상 사용 실패는 필수 수정이다. 독립 후순위 개선은 backlog로 기록하고 현재 단위의 새 종료 조건으로 만들지 않는다. 같은 검사 재실행은 변경/실패 근거가 있을 때만 한다. 새 문서는 기능별1개를 갱신하며 인계 문서를 계속 분화하지 않는다.

보고는 `사용 가능(검증 환경 명시) / 코드 연결·검증 중 / 미구현 / 사용자·운영 확인`의4상태와 사용자 시나리오 단위로 한다. 50번55%는 옛 동등 가중치 기준선으로 남기되 현재 구현률이나 토큰 대비 성과를 뜻한다고 반복하지 않는다. 전체 범위는 삭제하지 않는다.

검토가 필요하면 Astra에 재현, 영향, 관련 파일, 선택지, 질문1개만 전달한다. 검토 대기와 무관한 승인된 구현은 계속할 수 있다. 구현과 최종 검토는 같지 않으며 사용자 승인도 대체하지 않는다.
