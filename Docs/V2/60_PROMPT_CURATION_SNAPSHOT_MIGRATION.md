# G06 · 명시 snapshot 이관 구현 증거

작성: 2026-09-08. 새 정리본 이관 API의 로컬 구현·검증 기록이다. 전체 제품 완료·운영 데이터 전환·원격 migration을 의미하지 않는다.

## 구현 범위

[54번 계약](./54_PROMPT_CURATION_IMPLEMENTATION_CONTRACT.md)의 이관 v1을 구현했다. 현재 자료로의 GET 미리보기와 POST 명시 확인, 정확 member/fingerprint·범위/문자열/hash·이미지 대응, 원문 확보 범위 상향 금지, 새 manual fragment/evidence와 based-on 새 그룹의 atomic 저장, old/new proof·권한·receipt 재검증을 포함한다. 이 API checkpoint 당시 이관 UI와 draft reload 복구는 미연결이었다. 후속 이관 UI는 [61번](./61_PROMPT_CURATION_MIGRATION_UI.md)에 기록하며 reload 내구성은 남아 있다.

주요 파일:

- `apps/web/src/lib/v2/domain/prompt-curation-migration.ts`: 정확 후보와 누락/변경/모호함 판정, 미리보기 digest.
- `apps/web/src/lib/v2/domain/prompt-curation-request.ts`: 명시 이관 요청의 엄격한 데이터 캡처.
- `apps/web/src/lib/v2/infrastructure/d1/prompt-curation-catalog.ts`: 기존 catalog 검증 공통화, 서버가 새로 발췌한 pending manual 자료와 전체 target 원문/첨부 proof.
- `apps/web/src/lib/v2/infrastructure/d1/prompt-curation-repository.ts`: 이관 미리보기, 7-statement atomic batch, 원래 요청에 결합한 재생과 최종 읽기.
- `apps/web/src/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/[revisionId]/migration/route.ts`: 인증·동일 origin·feature flag·private no-store GET/POST.

스키마는 기존0032의 migrate/based-on 정규 FK와 append-only 구조를 사용한다. 추가 migration이나 원격 실행은 없다. 원래 정리본·사용자 데이터·환경 파일은 유지한다.

Cloudflare 스킬을 사용해 [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)의 순차 실행·실패 시 전체 rollback 계약을 확인했다. 실제 D1 검사는 [getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)의 `persist:false`, `remoteBindings:false`와 dispose 경계를 사용한다. 실제 원격 D1/Worker quota와 같다는 주장은 하지 않는다.

## 검사 이력

| 실행 | 최종 결과 | 범위/한계 |
| --- | --- | --- |
| `75649`,22:37:07 | 280 PASS/1 FAIL,exit1,36.55초 | migration42 중41 PASS. write flag가 기존 계약대로503인데 새 검사가4xx만 기대한 fixture 오류. 기존 parser141+repository34+HTTP64는 PASS |
| `49962`,22:39:22 | 140/140 PASS,exit0,35.83초 | 기대 HTTP 상태를 정확히 고친 migration42+기존repository34+HTTP64. target 첨부 집합 fence 추가 포함. 실제 Node SQLite/HTTP, workerd 아님 |
| 1차 타입 `42274` | exit0 | route typegen 이전 중간 결과. 후속 D1 검사 추가 이후 최종 타입과 구분 |
| 1차 scoped lint | exit0,오류/경고0 | 당시 수정 TS6파일. 후속 추가 변경은 최종 lint로 확인 예정 |

순수/parser·Node SQLite/HTTP는 owner/restricted/동일 origin·write flag, 미리보기 무변경, fingerprint 대체/모호함/누락,64중복·원문 CRLF/공백/이모지·확보 경고, source/target/privacy/snapshot 경합, 최종 receipt 실패 전체 rollback, 같은/다른 요청 키 동시 생성, 응답 유실 및 이후 snapshot에서 재생을 검사한다.

기존 실제 workerd D1 파일에64항목/64이미지 이관과 전체 rollback/동시 재생 두 검사를 추가해 실행했다. 새 API 기반 전체 백업/ZIP/fresh/repeat 복원은 [59번](./59_PROMPT_CURATION_API_PORTABILITY.md)의 별도 범위다.

## 최종 API checkpoint · 23:01 KST

| 실행 | 최종 결과 | 범위/한계 |
| --- | --- | --- |
| `67718`,22:45:17 | 46/46 PASS,exit0,11.63초 | 이관+첨부 추가 fence+원문 변경 순수 사례. 이후 AI 사례를 추가했으므로 아래가 최종 |
| `54639`,22:47:42 | 47 PASS/1 FAIL,exit1,12.32초 | AI fragment의 selection_unverified와 원문 unknown을 동일 확보 상태로 취급한 구현 때문에 정상 정확 이관이 차단됨. 실제 결함/정책 보완 근거 |
| `56226`,22:50:33 | 53/53 PASS,exit0,109.68초 | 위 정책 보완 후 이관48+workerd5. 아래 query 최적화 이전이므로 최종 제품 근거로 합산하지 않음 |
| `55121`,22:52:34 | 50/50 PASS,exit0,12.29초 | 최종 SQL39문장 이관.2개 문장수 검사 포함 |
| `97378`,22:54:50 | **7파일369/369 PASS,exit0,132.27초** | pure67+독립pure8+parser141+repository34+HTTP64+이관50+실제workerd5. 최종 제품 코드 포함 |
| `90703`,22:57:55 | **53/53 PASS,exit0,13.21초** | 제품 변경 없이 AI complete/partial/OCR 3사례 추가. 기존 unknown 포함4개 확보 범위와 새 user-selected evidence/FK/역할별 이관 재이관 검사 |
| Next route typegen | **exit0** | 신규 GET/POST route 타입 생성 |
| 타입 `48729` | exit1 | 새 순수 시험에서 readonly snapshot fixture를 직접 수정한 TS2540 3곳. immutable map 기반 새 객체로 수정 |
| 타입 `38677`, 최종 `91807` | **각 exit0** | 38677은 위 fixture 정정,91807은 최종 AI3사례 추가 포함 |
| 최종 scoped lint | **오류/경고0,exit0** | 제품/시험7개 TS파일 확인, 이후 변경한 migration 시험파일만 마지막 재확인(exit0) |

최종 결합 명령:

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-v1.test.ts tests/contract/v2/prompt-curation-review.test.ts tests/contract/v2/prompt-curation-request.test.ts tests/contract/v2/prompt-curation-repository.test.ts tests/contract/v2/prompt-curation-routes.test.ts tests/contract/v2/prompt-curation-migration.test.ts tests/contract/v2/prompt-curation-d1.test.ts
```

후속 시험 추가 후에는 같은 npm 명령에서 `tests/contract/v2/prompt-curation-migration.test.ts`만 재실행했다. 이전369에53을 더하지 않는다. 제품 파일5개는369 실행 후 변경하지 않았다.

### 판정과 비용

AI 수집기의 범위 표시는 원문 확보 범위와 다르다. 명시 이관 POST는 preview의 selectionConfirmations에 있는 범위를 새 수동 선택으로 확인한다. source unknown/partial/OCR·파트 미상·외부 전체 범위 미확인은 유지한다. 범위 확인만으로 원문 내용의 진실성이나 완전성이 증명되는 것은 아니다.

독립 agent의 현재 코드 읽기 검토는 source/target 전체 proof, exact receipt binding, atomic7문장, 최종 manual evidence/child fence에서 새 확정 결함을 찾지 못했다. 정적 검토가 실행 검증을 대신하지 않도록 제안된 AI4상태를 실제 대역AI→DB→이관 경로로 추가 확인했다. 실제 Gemini 호출은 아니다.

최초 측정은 인증 제외 cold repository50문장이었다. 최종 응답의 중복 snapshot/row 재조회 대신 이미 검증한 snapshot과 **실제 새 manual catalog + 서버가 작성한 정확 revision/items/examples**를 최종 단일 SQL에서 다시 확인하도록 바꿨다. 같은1항목/64항목에서39문장이다. 검증 생략이나 프로세스 전역 사용자 데이터 캐시는 추가하지 않았다. [현재 D1 문서의 Free50 query/Worker invocation 한도](https://developers.cloudflare.com/d1/platform/limits/)를 고려한 여유이며, HTTP 인증·실패 후 receipt 재시도·전체 Worker CPU/SQL 크기 상한을 포함한 운영 PASS는 아니다.

### 최종 파일 지문

23:01 KST SHA-256, 위 최종 검사 후 제품5개+시험2개다.

| 파일(앱 기준) | SHA-256 |
| --- | --- |
| src/lib/v2/domain/prompt-curation-migration.ts | `b83b3178d3f2d0e223cb0ca0a879d6d23389ece538dcb962bdb4da954ec72402` |
| src/lib/v2/domain/prompt-curation-request.ts | `63752d4d5fa29f518394e4f6b59714593ab4219689a493db144603c52e1b4e32` |
| src/lib/v2/infrastructure/d1/prompt-curation-catalog.ts | `668892bb662c90926e0b92db97175e644a2d5454e4c580de9db3640cd52ec7f4` |
| src/lib/v2/infrastructure/d1/prompt-curation-repository.ts | `81dde87ca6235bf75521d30773017faaae4b71480878b6076662f003ea10429a` |
| src/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/[revisionId]/migration/route.ts | `0ba1dcac63fc7142a5bb343a0a1f1a4a40f572173d0bf655524ec62b98208120` |
| tests/contract/v2/prompt-curation-migration.test.ts | `7ff6508c9ba667533a0c158ad85dd03e2eec6a8a9d81e7510394e04910b3bf9e` |
| tests/contract/v2/prompt-curation-d1.test.ts | `bf55f10ac651b8cfab38f441f72fe69264196b79dc42ccf8a5072663058485b4` |

root 검사 핸들은 모두terminal이다. 22:56 KST root D1 종료 후workerd0을 확인하고59번의 마지막43860 실행에 창을 반환했다. source/target workerd PID24264(3414/3415),23824(3907/3908), 모두127.0.0.1이며agent가dispose를소유한다. 실행 중인43860을root D1/전체suite로대체하거나중복실행하지않는다. 현재 상태는 CURRENT_WORK_STATE와59번의 최신 결과를 따른다.

## 남은 확인

이관 preview/확인 UI, 미저장 reload 내구성, 이관된 새 그룹까지 포함하는 복원 closure 결합, 전체 suite/Worker, 개인 corpus·실기기·실제 외부 제공자·운영 gate는 미검증이다. 안전한 로컬 구현이 남아 있으므로 전체 goal은 active다.
