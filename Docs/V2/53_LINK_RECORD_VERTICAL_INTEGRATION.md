# 링크 정리 Record 경로 · 통합 검증

기준일: 2026-09-08. 52번의 저장/실행 기반을 실제 Record 입력·조회·분석·검토 경로로 연결한다. **이 문서는 진행 기록이며 전체 제품 완료 또는 원격 배포 승인서가 아니다.**

## 1. 사용자 경로

1. 기존 수동 링크 자료가 있는 Record에서 **링크 정리** 패널을 연다. 본문·개인 Knowledge와 분리한다.
2. 기존 외부 원문/보관 첨부를 선택하거나 URL과 원문을 추가하고 **새 자료 버전 저장**을 누른다. GET이나 버전 저장은 AI 작업을 만들지 않는다.
3. **AI로 정리**를 명시적으로 누른다. 현재 본문 revision·snapshot·manifest와 결합된 작업이 저장되고, 기존 인증된 처리 실행기가 텍스트를 분석한다.
4. 모델이 선택한 범위는 서버가 정확히 잘라 제시한다. **발췌 원문 복사**와 **AI 해석만 복사**를 구분한다. AI 해석을 보관해도 원문이나 내 개인 사실로 승격하지 않는다.
5. **발췌 확인 / 이 해석 보관 / 제안 거절**은 별도의 fragment 검토다. 개인 Knowledge용 Review API는 재사용하지 않는다.
6. 원문 버전과 분석 실행 이력을 각각 선택할 수 있다. 과거 결과는 읽기 전용이다. 재분석해도 이전 사용자가 확인한 조각을 삭제하지 않는다.

현재 직접 처리하는 자료는 사용자 지정 외부 텍스트다. 첨부·URL-only·미처리 자료와 원문 확보 범위를 따로 표시한다. 자동 수집·OCR·영상 분석·이미지 대응·프롬프트 조립은 후속 범위다.

새 원문 editor는 패널을 접어도 입력을 유지하고, 충돌/네트워크 실패 시 입력과 재시도 키를 유지한다. 저장 전 이탈 경고와 화면 안내를 제공하지만, **페이지 이동·새로고침 후 draft 복구는 아직 구현하지 않았다.** 민감/잠금 자료를 새 평문 로컬 캐시에 넣어 해결하지 않으며 기존 소유자·privacy 정책에 맞춘 내구성 작업으로 남긴다.

## 2. HTTP 및 저장 경계

`/api/v2/records/[recordId]/links` 아래:

| 경로 | 동작 |
| --- | --- |
| GET `/` | 현재 또는 지정 snapshot/run 조회, 이력 cursor. 부작용 없음 |
| POST `/snapshots` | revision+snapshot+version CAS로 원문 버전 생성 |
| POST `/analyze` | revision+snapshot+manifest+사용자 요청 키로 명시 작업 enqueue |
| PATCH `/fragments/[fragmentId]` | 현재 published run과 fragment stateVersion CAS로 confirm/reject |

모든 요청에 소유자·legacy 공개·현재 상태 경계를 적용한다. Mutation은 동일 origin과 JSON을 요구하며 body 크기를 제한한다. 클라이언트의 잠금 해제 주장은 받지 않고 서버가 확인한 재인증 grant만 사용한다. Restricted 텍스트는 잠금 해제돼도 현재 AI 실행기에 전송하지 않는다. 성공·실패 응답은 `private, no-store`다.

첫 원문 버전 생성도 명시적 POST다. 자동 bootstrap을 조회에 숨기지 않는다. 새 원문 입력은 `link`의 허용된 수동 메타데이터만 정규화하고 임의 metadata를 저장 인자로 넘기지 않는다.

## 3. 재시도와 재분석

- 한 사용자 동작의 요청 키는 네트워크 재시도에도 유지한다. 같은 요청 키가 다른 입력에 재사용되면 conflict다.
- 같은 입력을 여러 탭에서 요청하더라도 실행 중인 작업 하나를 공유하고, 각 요청의 receipt를 남긴다. 기존 작업의 lease·실행 상태를 초기화하지 않는다.
- 종료 후 사용자가 다시 분석하면 새로운 요청 키로 새 작업을 만든다. 이전 fragments와 runs는 보존한다.
- 복원된 미완료 작업은 52번 정책대로 audit-only다. 새로운 명시 요청 없이 제공자를 호출하지 않는다.

`/api/v2/processing/run`은 main analyzer 작업 3개의 기존 처리 예산 안에서 개인 분석과 외부 링크 분석을 번갈아 처리한다. 한 종류가 비어 있으면 다른 종류에 슬롯을 넘긴다. 기존 grounded 단계의 예산은 늘리지 않았다. 두 텍스트 경로는 같은 quota governor를 사용한다.

현재 운영 스케줄은 기존 `*/5` 처리 주기를 사용한다. 버튼 응답은 enqueue 확인이지 즉시 분석 완료가 아니다. 로컬 개발의 일반 Next 서버만 실행하면 예약 처리기가 자동으로 돌지 않는다. 실 공급자/원격 cron 검증 전에는 이를 실제 운영 완료로 표시하지 않는다.

## 4. 기존 검토의 재인증 경계 개선

G01 감사에서 정상 로그인한 소유자가 restricted 기록의 review ID를 알고 있을 때 재인증 없이 `accept`를 실행할 수 있는 결함을 재현했다. 타인 계정 소유권 우회는 아니었다.

기존 검토 API가 서버 grant를 repository에 전달하도록 수정하고, 미전달 시 기본 잠금·receipt 재생·읽기 중 privacy 변경을 검사했다. 쓰기 직전 privacy 변경은 동일 batch 안의 NOT NULL assertion으로 전체 롤백한다.

수정 전 실제 POST는 201이었고 수정 후 해당 조건은 423이다. 실제 라우트·repository와 로컬 SQLite 전체 migration을 사용한 신규 회귀 13/13 PASS. 세션·grant resolver만 합성 fixture다.

## 5. 검증 기록

| 검사 | 결과 |
| --- | --- |
| 정확 원문 계약·실행기 | 40 + 31 PASS. 원문 본문 외에 반복 근거 인용문의 전체 byte 한도도 추가 |
| Snapshot/분석 POST·실제 SQL·인증된 처리 경로 | 23/23 PASS. 사용자 POST 시 provider 호출 0, 처리 실행기의 provider만 대역 |
| 실제 repository/governor 링크 실행 통합 | 7/7 PASS. provider 대역, 개인 reconciliation 없음 |
| restricted 기존 검토 | 13/13 PASS |
| 기존 예약 처리 계약 | 5/5 PASS |
| 위 6개 파일 중간 결합 실행 | **118/118 PASS**, exit 0, 16.28초. 40번째 원문 계약 추가 전 결과이며 최신 단일 전체 실행으로 읽지 않음 |
| 인용 증폭 방지 후 선택 결합 실행 | 원문 계약 40 + 실행기 31 + HTTP 23 = **94/94 PASS**, exit 0, 17.69초 |
| 실제 Wrangler D1 저장/동시성 | 링크 저장 **15/15 PASS**. 기존 processing 17/legacy 6/owner 1과 결합 **39/39 PASS**, exit 0, 334.29초. 일반 분석 경합 후속 수정 전 결과 |
| GET projector/전용 fragment 검토 | **33/33 PASS**, exit 0, 7.56초. 실제 repository/SQL과 route, 세션/grant는 대역 |
| Record 컴포넌트 브라우저 | 새 UI 22 + 기존 공유/내구성 34 = **56/56 PASS**, 4.4분. editor 접기 입력 보존 후 새 UI **24/24 PASS**, 1.7분. 58개의 단일 결합 재실행은 아님 |
| 접근성·시각 확인 | desktop/mobile Record 및 열린 editor의 scoped axe·가로 넘침 0. Root도 최종 PNG 4장을 확인. 합성 자료이며 실제 공급자 화면 아님 |
| 타입·lint | `next typegen`, `tsc --noEmit` exit 0. 전체 ESLint exit 0, **오류 0·경고 34**. 경고 없는 전체 lint로 표시하지 않음 |
| G05 Worker package | `build:worker` exit 0. masked_env_files=2, audited_files=6439, secret_hits=0. 환경 파일 2개 SHA-256 전후 일치. 아래 후속 편집 privacy 변경 이전 산출물 |
| 전체 unit/contract | **91파일, 675 PASS/13 FAIL, exit 1**, 3562.03초. fixture 8개와 retention 1개는 별도 수정 후 선택 PASS, 4개 미해결. 자세한 재개 위치는 `CURRENT_WORK_STATE.md`. 배포·원격 migration 없음 |

결합 명령:

```powershell
npm run test -- tests/contract/v2/link-analysis-request.test.ts tests/contract/v2/link-analysis-v1.test.ts tests/contract/v2/link-processing-runner.test.ts tests/contract/v2/link-analysis-integration.test.ts tests/contract/v2/restricted-review-resolution.test.ts tests/contract/v2/scheduled-jobs.test.ts --maxWorkers=1
```

작업 위치는 `apps/web`이다. 실 Gemini, 실제 사용자 데이터, 원격 D1/R2, 배포, private corpus·OS Share 실기기 및 전체 회귀의 증거와 구분한다.

브라우저 최종 산출물은 `apps/web/test-results/g05-final-ui/` 아래 `link-analysis-record.png`, `link-snapshot-editor.png`다. fixture와 네트워크 대역을 사용해 실제 컴포넌트의 입력·복사·충돌·이력·검토 동작을 검사했다. 처음에는 숨겨진 Next route announcer까지 선택한 locator 3건을 좁혔고, 기존 Capture IndexedDB 대기 1건은 재실행 통과했다. 이 중간 실패를 실제 제공자 성공/실패로 해석하지 않는다.

첫 Worker 빌드는 `failJob`에 추가한 superseded 결과가 테스트 대역에 빠진 타입 오류로 중단됐다. 대역을 실제 반환형과 일치시킨 재실행은 타입·package·secret 검사를 통과했다. Windows OpenNext 지원, middleware→proxy 전환 권고, Next 내부 Edge `process.cwd` 경고는 남아 있으며 경고 없는 빌드로 표시하지 않는다. 이 산출물은 17:29:33 KST attestation 기준이다. 이후 확인된 기존 문서 editor의 탭 간 privacy purge 결함 보강은 별도 변경이므로 그 변경 후 다시 빌드해야 한다.

## 6. 독립 검토 후 일반 분석의 원문 경합 보강

일반 개인 글의 입력 조회 첫 검사 직후 외부 source를 추가하면 이후 조회에 외부 텍스트가 섞이고, 입력 조회 뒤 추가해도 개인 분석 provider lease가 발급되는 두 경합을 실제 SQL로 재현했다(2/2 RED). source 조회와 최종 입력 반환, provider lease, 결과 저장 batch에 외부 source 부재 조건을 추가했다.

후속 provider 오류와 실패 저장 직전 경합도 RED였다. 새 링크 capture의 `pending`을 오래된 개인 작업의 `failed_retryable`로 덮고 개인 작업을 재시도하고 있었다. 실패 batch와 만료 복구에도 같은 원문 경계를 추가했다. obsolete한 개인 attempt는 소유 중인 run/job/lease만 superseded로 정리하고 새 링크 작업이나 capture를 갱신하지 않는다.

독립 후속 **경합 12/12 + 비용 관측 4/4 = 16/16 PASS**, exit 0, 6.00초. 초기 조회·lease 직전은 provider 호출 0, 제공자 응답 뒤·완료 read/batch 직전은 호출 1 후 개인 결과 미반영을 확인했다. 실패 read/batch 직전, 회수된 old attempt, 재시도 잔여/소진 각각의 만료 복구까지 새 job/run/provider lease/capture/document를 보존했다. 로컬 SQLite 전체 schema·대역 제공자이며 모든 동시 실행을 전수 증명한 것은 아니다.

최종 독립 검사 전후 SHA-256은 동일했다.

| 파일 | SHA-256 |
| --- | --- |
| `processing-queue-repository.ts` | `c0eb975a38e0fe83cb7f8e908480d62c110b733264867150f850bd18ac39df93` |
| `processing-runner.ts` | `d47faa6c0932b2f6d97e7fb87e239cf5496079ac2649bae52c865b7a0961e9d5` |
| `link-analysis-interleaving-review.test.ts` | `615daf42eed1250d255c1036c14e4e5255be0c8626e0eec9c30141f1ac22f7cf` |
| `link-worker-budget-observation.test.ts` | `e97e49eabce727b6b3a711699cf94c5d547629128c938f887ea4b96f9c0e32d8` |

## 7. 로컬 처리 비용 관측과 운영 한도

로컬 SQLite 계측은 query를 호출한 binding 횟수와 batch 안의 SQL 문 수를 구분한다.

| 경로 | binding 호출 | SQL 문 |
| --- | ---: | ---: |
| 신규 명시 분석 요청 | 20 | 23 |
| 같은 요청 재생 | 17 | 17 |
| 링크 작업 1개 직접 실행 | 34 | 50 |
| 전체 처리기: 링크 1개 | 65 | 109 |
| 전체 처리기: 링크 3개 | 120 | 189 |
| 전체 처리기: 작업 없음 | 27 | 48 |

계측 4/4 PASS는 숫자의 관측 성공이지 무료 환경 적합 판정이 아니다. 실제 인증·grant, provider transport, Worker CPU는 제외했다. [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)의 query 한도와 [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/#subrequests)의 외부/내부 subrequest를 혼동하지 않는다. 빈 stage 반복 조회와 schema/권한 probe 비용이 있어 호출 구조 개선 및 실제 Worker 환경 확인을 G10에 남긴다. 무료 사용 가능성을 아직 확정하지 않으며 이를 이유로 임의 유료 전환하지 않는다.

## 8. 기존 전체 회귀의 fixture 갱신

031 정본을 대상으로 한 전체 실행에서 resumable restore 2개/export 6개가 실패했다. 복원 자료는 현재 schema manifest를 표시하면서 이전의 4개 canonical 파일만 포함했고, export 시험 DB는 0023까지만 migration되어 있었다. 검증을 완화하지 않고 fixture를 현재 canonical registry 및 0024–0031 migration과 일치시켰다.

43개 canonical 파일을 검증하고 materialize하는 복원 fixture의 80회 반복 상한은 최소 86회보다 작았다. 시험 상한을 registry에서 산출한 `43×2+20=106`으로 변경했다. 제품의 호출당 binding ≤40, 600단계/사용자 동작 상한, 기존 timeout과 잘못된 원본 거절·임시 객체 정리는 변경하지 않았다.

1,500-document 보수적 내보내기 추산은 39→43개 테이블 증가에 따라 595→603단계, 최대 사용자 동작 1→2회다. 기존 UI의 **계속 진행** 경로를 사용하며 무제한 자동 처리로 바꾸지 않았다.

- 8개 선택 첫 재검증: 6 PASS/2 FAIL, 628.75초. 남은 두 실패는 위 반복 상한과 예상 동작 횟수였다.
- 두 기대값 보정 후 선택 재검증: **2 PASS**, exit 0, 201.71초. 누락 원본 거절·82개 임시 객체 정리 117.239초, scale/cap 정리 30.894초.
- 앞 실행에서 source-only/compact/small-original/8 MiB byte identity/corrupt pending/첨부 자동 rollback은 PASS였다. **8개 단일 최종 실행 또는 전체 suite PASS는 아니다.**
- 8 MiB byte identity는 174.810초로 기존 180초 timeout에 가까웠다. 로컬 회귀 성공이며 원격 성능 보장이 아니다.
- 두 시험 파일의 최종 ESLint exit 0. 검사 전후 해시 동일: restore `c6a434100f37fdeef3656fa0b8abda53faf8728b1836e4f5b06f196b8228118e`, export `2fa296b73ccce0818212b040896c8425e03683612684079b832e5adcfb8a0bfe`.

후속 retention 실패는 fixture가 아닌 제품 결함이었다. `0031`의 새 canonical 경로 4개가 `v2_backup_retention_known_metadata_paths`에 없어 기존 V1 백업 정리가 guard에서 중단됐다. 미배포 0031에 정확 네 경로만 추가했고, 실제 로컬 D1/R2의 canonical 43/allowlist 43 일치·네 원본 객체 삭제·정확 deleted receipt를 검사했다. 선택 1 PASS/5 skipped, exit 0, 94.672초이며 guard/작업량/180초 timeout은 유지했다. 최신 migration SHA-256은 `adf696129dbcbe29ad7559332767b7b439499714869a91b922fbd0165d4595fa`다. 나머지 4개 실패와 전체 결합 재검증은 현재 상태 문서에 남겼다.
