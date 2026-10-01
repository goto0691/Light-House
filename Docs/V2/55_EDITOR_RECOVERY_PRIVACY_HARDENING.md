# 편집 복구 사본 · 탭 간 privacy 보강

기준일: 2026-09-08. G05의 새 원문 editor에 reload 복구를 연결하기 전, 기존 문서 editor의 저장소를 검토하면서 발견한 G01 결함을 보강한다. **새 링크 draft 복구의 구현 완료 문서가 아니다.**

후속: 2026-09-09의 공통 IndexedDB v3 및 snapshot 편집 복구는 [62번](./62_LINK_SNAPSHOT_DRAFT_RECOVERY.md)에 기록한다. 아래 v2·13개 검사 수치는 당시 이력으로 보존한다.

## 1. 재현한 결함

같은 IndexedDB에 연결한 두 store 중 한 곳이 normal v1을 저장하고, 다른 곳이 restricted v2 정책으로 사본을 정리한 후, 첫 store가 오래된 normal v1/generation 2를 저장했다. 기존 저장소는 이를 `accepted=true`로 처리해 평문 사본을 다시 만들었다. fake IndexedDB 단독 재현 1건은 RED였다.

인스턴스 내부 Promise 직렬화만으로는 다른 탭/인스턴스의 늦은 쓰기를 차단할 수 없다. 암호화 여부와 사본 generation만 비교해도 기록 단위의 privacy 변경은 보호하지 못한다.

## 2. 채택한 보호 경계

- 기존 owner+record namespace, 탭별 사본, generation 비교, sensitive 동의와 AES-GCM을 유지한다.
- IndexedDB v2에 record별 policy를 추가하고 사본과 같은 read/write transaction 안에서 다시 검사한다.
- 인증된 서버의 `document.current_version`과 privacy만 새 서버 정책의 근거로 사용한다. 문서 저장은 privacy 변경과 current_version 증가를 같은 D1 UPDATE로 처리한다.
- 미저장 privacy 강화는 즉시 로컬 보호 수준을 높일 수 있다. 오래된 탭/임의 draft version은 이를 낮추지 못한다. 실제 더 새로운 서버 revision의 normal 복귀는 허용한다.
- 암호화 준비가 끝난 뒤에도 쓰기 transaction에서 최신 policy를 다시 확인한다. 제한된 뒤 도착한 normal/sensitive 사본은 저장하지 않는다.
- restricted의 잠금 해제 여부는 복구 사본 저장 허가가 아니다. restricted 사본은 저장하지 않고 정리한다.

서버 metadata는 `getRecoveryPolicy(recordId)`로 owner·Capture·현재 revision의 문서 연결·legacy 공개 경계를 검증한 `recordId/currentVersion/privacyLevel` 세 필드만 제공한다. 제목·본문·원문·revision ID는 포함하지 않는다. 잠긴 기존 Record의 `currentVersion=null` 계약은 그대로 유지하고 별도의 `recoveryPolicy`로 구분한다.

Record/편집 SSR의 잠금 화면에서도 작은 정책 컴포넌트를 실행해 이미 남은 사본을 정리할 수 있게 한다. 기기 저장소 적용 실패를 성공으로 표시하지 않는다. 이전 앱 버전의 열린 IndexedDB 연결로 업그레이드가 막히는 경우도 보호 실패/오래된 탭 종료 안내를 제공해야 한다.

## 3. 조회 중 변경과 재인증 만료

기존 Record GET이 본문을 읽은 뒤 최종 정책과 privacy/version이 달라지면 409, owner/legacy 연결이 사라지면 404로 전체 응답을 차단한다. 응답은 `private, no-store`다.

독립 후속 검사에서는 재인증 grant가 본문 조회 후 또는 마지막 정책 조회 직전에 만료될 때, 링크 패널은 잠기지만 top-level 본문은 200으로 반환되는 경합도 재현했다. 최종 expiresAt 검사로 **423 / restricted_record_locked / error-only** 응답이 되도록 수정했다. 두 SSR 경로도 만료 시 내용을 전송하지 않는다.

## 4. 확인된 결과와 진행 중 항목

| 검사 | 상태 |
| --- | --- |
| 기존 저장소 탭 간 경합 | RED 재현 후 transaction policy fence 구현 |
| 저장소 회귀 | 첫 11/11 PASS 후 blocked/versionchange와 반복 open 보강 포함 **13/13 PASS**. 브라우저 StrictMode가 드러낸 두 번째 RED는 아래 기록 |
| 실제 GET·SQLite 정책 | **21/21 PASS**, exit 0, 8.55초. 세션/grant는 대역이며 원격 실행 아님 |
| 서버 정책 검토 범위 | normal/sensitive/restricted 최소 metadata, foreign owner·불일치 Capture/revision·숨겨진 legacy, read 중 변경, grant 만료 2지점, 200/401/404/409/423/500 no-store |
| 실제 SSR·SQLite 정책 | **12/12 PASS**, exit 0, 5.61초. 잠긴 응답 최소 props, 최종 grant 만료, privacy/version/owner/legacy 변경을 Record/편집 두 화면에서 차단. React component type만 직렬화에서 제외하며 모든 props/children은 검사 |
| 브라우저 | 수정 후 **18/18 PASS**, exit 0, 1.9분. 정책 8 + 기존 durability 10, desktop/mobile. root도 최종 정보 패널 PNG 두 장 확인 |
| 타입·Worker package | 최신 `tsc --noEmit` exit 0. SSR purity lint 지적은 요청 시점 grant helper로 옮겨 해결하고 API/SSR 결합 회귀 통과; 전체 lint 재검증 대기. Worker는 이 변경 전 G05 package와 구분 |

정책 API 독립 검사 전후 해시는 동일했다.

아래 해시는 해당 독립 검사 시점의 기록이다. 이후 테스트 payload의 명시 TypeScript 타입 보강과 SSR의 요청 시점 grant helper 분리 후 API 21/SSR 12를 다시 실행해 PASS했으며, 기존 테스트 파일 해시는 최신 것과 다르다.

모바일에서는 기존 정보 inspector가 숨겨져 공개 범위를 변경할 수 없었다. 같은 패널을 여닫는 `기록 정보` 버튼과 aria-expanded/controls, 44px 영역을 추가했다. desktop만 검사하도록 범위를 줄이지 않는다.

구버전 IndexedDB 연결이 upgrade를 막는 첫 오류 처리 뒤 React 개발 StrictMode가 새 open 요청을 만들면, 취소할 수 없는 첫 native 요청 뒤에 대기하여 두 번째 효과의 경고가 멈췄다. 반복 open의 250ms pending을 RED로 재현했다. 막힌 native 요청이 끝날 때까지 같은 실패 Promise를 유지하고, 뒤늦은 성공 연결은 닫도록 보강했다. 첫 브라우저 실행 16/18 PASS의 두 blocked 실패와 수정 후 결과를 구분한다.

| 파일 | SHA-256 |
| --- | --- |
| `source-foundation-repository.ts` | `ebf15382ce9b82d8fedd4e75c51951248c3340f2f89e6b6cdfcf5b189a7a7b36` |
| Record GET `route.ts` | `9e8e6fe77c5beaddc3a6029c3691a1bfd613619125b3433e083a316464261016` |
| `record-recovery-policy.test.ts` | `204b8b7cb2f63a8ed1465ec38fd19605a23d6928b72cf02a5ff3474df9bb83c7` |

## 5. 한계와 다음 연결

이 보호는 같은 기기에서 관측된 서버 정책에 대한 탭 간 저장 경합을 막는다. 오프라인의 다른 기기에서 일어난 privacy 변경을 즉시 알거나, 이미 화면/메모리에 열린 내용을 원격으로 지우는 기능이 아니다. XSS나 같은 origin의 악성 코드에 대한 보안 경계로 IndexedDB 암호화를 주장하지 않는다.

새 링크 editor에는 별도 링크 draft 계약/namespace와 명시적 복구 선택, 미완성 입력 보존, pending 요청 키·fingerprint, 409 재기준화, 성공 generation까지만 삭제하는 내구성 작업이 남는다. Capture outbox 저장소에 링크 editor JSON을 넣어 새 Capture로 동기화하는 방식은 사용하지 않는다.
