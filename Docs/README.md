# Light House 문서

현재 개발은 [프로젝트 지침](../AGENTS.md) → [V2 현재 작업 상태](./V2/CURRENT_WORK_STATE.md) → [V2 완료표](./V2/50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)에서 시작한다. 자유 입력·멀티모달·동적 스키마를 기준으로 하는 2026-08 이후 V2 계약이 현행 정본이다.

## 현재 V2

- [V2 문서 색인](./V2/README.md)
- [Cloud Linux 검증 기록](./V2/82_CLOUD_LINUX_COMPLETION_EVIDENCE.md)
- [오프라인 기록 평가 기반](./V2/83_PRIVATE_EVALUATOR_FOUNDATION.md)

## 원격 main의 2026-04~05 재분류·UI 작업

아래 문서와 관련 legacy 구현은 병합에서 보존했다. 당시의 “v2” 명칭은 현재 `src/lib/v2` 계약과 다르며, 현재 V2 구현·데이터 전환의 완료 증거로 사용하지 않는다.

- [AS-IS Schema Audit](./00_AS_IS_SCHEMA_AUDIT.md)
- [TO-BE Schema Blueprint](./01_TO_BE_SCHEMA_BLUEPRINT.md)
- [TO-BE UI/UX Specification](./02_TO_BE_UI_UX_SPECIFICATION.md)
- [Refactor Execution Plan](./03_REFACTOR_EXECUTION_PLAN.md)
- [Property Control UI/UX Refactor](./04_PROPERTY_CONTROL_UI_UX_REFACTOR_PLAN.md)
- [UI/UX System Criteria and Audit](./05_UI_UX_SYSTEM_CRITERIA_AND_AUDIT.md)

## 역사 자료

원래 V1 계획은 [Legacy 색인](./Legacy/README.md)과 [2026-04-26 이전 계획](./Legacy/2026-04-26_pre_asis_planning/README.md)에 보존한다. 역사 문서의 모델·원격 배포·초기화 지시를 현재 실행 명령으로 사용하지 않는다. 원격 migration·배포·cutover는 대상 환경과 사용자 승인 범위를 별도로 확인한다.
