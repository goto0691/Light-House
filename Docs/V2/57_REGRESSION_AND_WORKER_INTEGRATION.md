# G10 · 회귀 복원과 Worker 통합 확인

2026-09-08 로컬 작업. Astra 지침 정비 이후, 전체 회귀에서 남았던 4개 실패를 처리했다. 원격 호출·배포·migration·과금/모델 변경은 없었다. 전체 제품 goal과 G06–G11의 미완료 범위는 그대로다.

## 1. 기존 실패 4건

| 대상 | 원인과 수정 | 최종 근거 |
| --- | --- | --- |
| canonical owner closure 1건 | descriptor는 0031인데 fixture는 0023. 기존 손상/타 소유자 자료를 먼저 seed하고 0024–0031 적용. 최신 guard를 제거하지 않음 | 해당 파일 1/1 PASS, exit 0, 41.21초. 변경 파일 lint exit 0 |
| backup lease 2건 | `pruning`만 지정해 `prune_run_id`/실행 소유권 없음. 완료 checkpoint와 실행 중 retention을 준비하고 실제 claim 함수 호출 | 해당 파일 10/10 PASS, exit 0, 61.30초 |
| restore lease 1건 | backup restore에 실제 source snapshot/reference 없음. same-owner succeeded source를 준비하고 missing-source 거절도 확인 | 기존 파일 11/11 PASS, exit 0. 후속 오류 분기 검사는 아래와 별도 |

canonical 검사는 정상/비정상 mapping 5개와 review receipt 2개의 실재를 확인한 뒤, 43개 descriptor의 plain/full-fidelity/no-history scope에서 binding 수·FK·polymorphic 참조·소유권 제외를 검사한다. setup은 약 28.76초로 기존 30초 한도에 가깝지만 timeout을 늘리지 않았다.

stable PUT 대기를 실제 저장 **앞**으로 옮겼다. retention 삭제 → 늦은 PUT이 실제 객체 재생성 → 오래된 publisher의 cleanup → 객체 부재를 검사한다. 객체 부재 검사가 후속 retention 완료보다 먼저여서 잘못된 stale cleanup을 숨기지 않는다. 정상 winner의 객체 보존 검사도 통과했다.

첫 결합 실행은 20 PASS/1 FAIL(90.81초)이었다. 앞 검사에서 running으로 남긴 retention이 다음 완료 snapshot을 보호하는 정상 trigger가 원인이었다. 보호 row를 지우지 않고 실제 retention을 terminal까지 완료하게 수정했다. 최종 backup 파일 전체 10/10이 이를 검증한다. 보호 소유자 없는 pruning 거절도 유지했다.

## 2. Retention 제품 수정 재검증

앞 작업의 0031 수정(새 canonical 경로 4개 허용 목록 추가)을 반영한 `resumable-backup-retention.test.ts` **전체 6/6 PASS**, exit 0, 253.78초. 첫 사례 99.223초다.

33개 snapshot/조상 보존, V1·V2 metadata 삭제 receipt, 신규 네 경로의 실제 합성 R2 존재→삭제, 재시작/idempotency, 7일 blob GC, cycle 차단, 단일 소유권, 실행 중 backup/restore 의존성, cross-owner 삭제 거절, 사용자 순환 처리를 검증했다. 호출당 SQL·R2·삭제 키 상한은 원래 검사를 유지했다.

이는 로컬 D1/R2 및 합성 checkpoint 검증이다. 7일은 시험 시계이며 실제 7일 운영 관찰이 아니다.

## 3. 추가 일반 오류의 늦은 실패 저장

기존 delayed coordinator 검사는 `WorkflowLeaseLostError` 조기 재전파 경로였다. 별도로 deterministic(`restore_`) 오류와 일시 transport 오류를 주입해 실제 catch의 실패 저장 batch를 보류하고, 새 lease가 성공한 후 재개하는 두 검사를 추가했다. 부모 성공·revision·오류 없음, rollback 자식 무변경, 정본 row 보존, assertion 잔여 0을 함께 확인한다.

첫 fixture는 완료 단계의 plan/row/file receipt 조건을 충족하지 못해 두 검사가 실패했다. 완료 보호 trigger를 유지하면서 실제 저장된 정본 row의 JSON/hash·적용 수·소비 완료 file receipt를 채웠다. 최종 파일 **13/13 PASS, exit 0, 48.68초**다. 이 오류 주입은 commit 전 실패이며 commit 후 응답 유실의 전수 증명은 아니다.

독립 읽기 검토는 race 제어 흐름과 assertion 순서의 의미를 확인했다. checkpoint 유효성은 정적 검토 PASS를 대신 사용하지 않고 실제 실행으로 보완했다.

## 4. 정적 검사와 Worker

- 전체 `npm run lint --workspace @light-house/web`: **exit 0, 오류 0/기존 경고 34**. SSR 시간 판정을 요청 시점 auth helper로 분리한 이전 수정을 포함한다. 이후 변경 테스트 파일은 별도 scoped lint로 확인한다.
- 최종 테스트 수정 후 `npm run typecheck --workspace @light-house/web`: **exit 0**. 변경 시험 세 파일 scoped lint도 exit 0.
- `npm run build:worker --workspace @light-house/web`: **exit 0**, 18:41 KST. `masked_env_files=2 audited_files=6438 secret_hits=0`.
- wrapper 실행 전 `.next`/`.open-next` 절대 경로·reparse point 부재와 Next/build 프로세스·lock 부재를 확인했다. 두 환경 파일은 빌드 중 숨김과 종료 후 복원 해시가 동일했고, hidden 파일과 build lock은 남지 않았다.
- Windows OpenNext 지원, middleware→Proxy 전환, Next 내부 Edge `process.cwd` 경고는 남아 있다. build 성공을 원격 runtime 적합성으로 해석하지 않는다.

Worker는 editor privacy·G06 순수 계약·Record 복구 정책을 포함한 현재 제품 코드의 package다. 0031 SQL은 위 별도 D1 회귀로 확인한 것이며 Worker 배포에 SQL이 자동 적용된다는 뜻이 아니다. 후속 테스트-only 수정은 앱 bundle을 변경하지 않는다. 실제 무료 D1 처리량과 제공자·기기·운영 gate는 미검증이다.

## 5. 재현 산출물

명령은 저장소 루트에서 실행한다. 공통 접두사는 `npm run test --workspace @light-house/web -- --maxWorkers=1`이며 해당 `tests/contract/v2/<파일>`을 전달한다.

- `apps/web/test-results/g10-lease-regression.json`: 첫 결합 20/21; restore 기존 11개 PASS와 backup fixture 간섭 1개를 보존.
- `apps/web/test-results/g10-backup-lease-final.json`: backup 최종 10/10.
- `apps/web/test-results/g10-retention-complete.json`: retention 전체 6/6.
- `apps/web/test-results/g10-restore-lease-final.json`, `g10-restore-lease-verified.json`: 추가 두 오류 분기의 준비 데이터 실패 이력. PASS 자료가 아님.
- `apps/web/test-results/g10-restore-lease-complete.json`: 추가 두 분기까지 포함한 최종 13/13.

최종 시험 파일 SHA-256: canonical `a1271108081b51b58d1e2919410825c9bf7910963cbc2787a0eaea71c3d6a06e`, backup lease `a7bb9b6c2a2af9458d6050c6a3d97b93a8d61775aef4e3a21a2bd65a1de7f435`, restore lease `0c342bbdc5f202ac35d9975eb43c585d8d2ffeb99d236e66321e59117f53dfff`, retention `224a44ef4fa78fdb4c68f4fec9bf453753e84fe4781d76e313d2c5392a945341`.

기존 `g05-complete-contract-unit.json`의 전체 675 PASS/13 FAIL, exit 1은 역사 결과로 보존한다. 후속 선택/파일 검증으로 13개 원인에 조치했지만 **현재 제품 전체 suite PASS 또는 출시 완료는 아니다**. 통합 후보가 안정된 뒤 전체 회귀를 수행한다.

연결: [현재 상태](./CURRENT_WORK_STATE.md) · [전체 완료표](./50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md) · [기존 G05 근거](./53_LINK_RECORD_VERTICAL_INTEGRATION.md).
