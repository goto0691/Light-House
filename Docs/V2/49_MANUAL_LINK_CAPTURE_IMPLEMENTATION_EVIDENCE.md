# 수동 링크·원문 보관 — 첫 실제 저장 경로

작성일: 2026-09-08. 범위: **L0 수동 원문 입력 + L1의 개별 원문 표시·복사 부분**. 45·47·48번 전체 링크 기능의 완료 선언이 아니다.

## 1. 이번에 연결한 사용자 흐름

`/v2/capture`의 본문은 내 메모로 유지한다. 본문 아래 **링크 자료 추가**를 열어 URL과 확보한 외부 원문을 별도로 입력한다. URL 칸에 여러 줄을 붙여넣으면 각각 독립 자료가 된다. 기존 첨부 기능으로 이미지·스크린샷도 같은 기록에 보관할 수 있다.

이 경로는 데스크톱/모바일 웹의 새 입력 패널에 적용된다. **휴대폰 OS 공유 버튼에서 들어오는 기존 Share Target 자료는 아직 자동 전환하지 않는다.** 공유 텍스트가 외부 원문인지 사용자의 덧말인지 자동으로 결정하지 않도록, 명시적 출처 전환 UX는 후속 작업으로 둔다. 기존 공유 URL 전송은 유지되지만 새 provenance 카드/AI-off 정책까지 적용되었다고 주장하지 않는다.

| 입력 | 실제 저장·표시 |
| --- | --- |
| URL만 제공 | 링크 저장, 원문 미확보 표시. 외부 페이지 내용을 생성하지 않음 |
| 분할 프롬프트 | 출처별 문자열·역할·사용자가 기재한 조각 번호 보관. 개별 원문 복사만 제공 |
| 인사이트 | 외부 원문·작성자 표시와 내 메모 분리. 사용자 동의나 실제 경험으로 전환하지 않음 |
| 이미지·구도 팁 | 수동 캡션과 기존 private 첨부를 함께 표시. 대응 관계나 시각 해석 자동 생성 안 함 |
| 영상 링크 + 자막 | 사용자 제공 자막과 선택 시간 범위 보관. 전체 영상 분석·원본 영상 다운로드로 표시하지 않음 |

보관 목적은 일반 자료·프롬프트 재사용·인사이트 기억·이미지/구도 팁·영상 메모다. 원문 역할은 원문/인용·프롬프트·네거티브 프롬프트·설정값·캡션/설명란·사용자 제공 자막/전사다. 둘은 플랫폼과 별개이며 하나의 기록에 혼합할 수 있다.

기록 상세에는 원문 확보·분석·첨부 보관 상태를 따로 표시한다. 각 자료의 원문·출처·사용자 기재 작성자·조각 번호·시간 범위·해시를 볼 수 있다. 복사는 저장한 문자열을 그대로 전달하며 성공 Promise 이후에만 완료를 표시한다. 실패하면 원문 선택/수동 복사 대안을 제공한다.

## 2. 저장 계약과 경계

- 기존 `v2_source_items.source_metadata`에 `{ manualLinkV1: ManualLinkSourceV1 }`를 저장한다. 새 테이블이나 migration은 추가하지 않았다.
- contract는 `manual-link-source.v1`. URL 자료의 `raw_text`에는 붙여넣은 원문, metadata에는 URL·목적·역할·확보 상태 등을 둔다. 기존 metadata 없는 공유 URL은 계속 지원한다.
- 서버는 provider와 비교용 URL을 다시 계산하고 지정한 metadata 키만 보존한다. 원래 URL은 유지하며 비교 URL에서만 알려진 추적 매개변수를 제거한다. 다른 URL·다른 원문 구간을 자동 병합하지 않는다.
- 앱에서 받은 원문 문자열의 SHA-256을 서버에서 재계산한다. 공백·줄바꿈·한글·이모지를 수정하거나 프롬프트 설정값을 본문에 섞지 않는다. 웹사이트 원본 byte 복제나 브라우저 입력 이전의 줄바꿈 인코딩 보장과는 다르다.
- `complete`는 **사용자가 선택한 원문 범위를 확보했다는 기재**다. 전체 스레드/영상 수집 완료, 관계·순서 확인, OCR 검증을 뜻하지 않는다. 빈 원문은 complete로 저장할 수 없다.
- HTTPS URL만 허용하고 URL 내 로그인 정보는 거부한다. URL 입력만으로 서버 fetch나 외부 이미지 요청을 실행하지 않는다.
- 기록당 링크 자료 최대 20개, 수동 원문 UTF-8 합계 100,000 bytes, URL 최대 2,048자. Capture JSON은 Content-Length 유무와 무관하게 실제 수신량 1 MiB를 제한한다. 오류가 나도 입력 중인 기록을 삭제하지 않는다.
- 기존 source immutable 경로와 문서 revision을 유지한다. 메모 수정은 당시 출처를 덮어쓰지 않는다. source metadata에 DB row ID를 넣지 않아 canonical restore의 ID 재매핑과 충돌하지 않는다.

### AI 처리의 의도적 제한

기존 범용 AI loader는 수동 링크의 외부 저자·확보 범위를 아직 이해하지 못한다. 따라서 이 단계의 수동 링크 기록은 UI에서 AI 정리를 끄고, 서버도 `aiEnabled: true`를 거부한다. 저장 후 재분석이나 본문 수정으로 우회 활성화하지 않는다. 링크가 없는 일반 기록의 기존 AI 선택은 그대로다.

향후 AI를 활성화할 때는 외부 저자의 말/내 메모를 나누는 loader와 전용 결과 계약부터 구현해야 한다. 단순히 이 guard만 제거해서는 안 된다.

## 3. 로컬 내구성·권한·이동성

- 일반 임시 기록과 opt-in 민감 기록은 기존 IndexedDB JSON/encrypted envelope에 metadata까지 보존한다. optional 필드 확장이므로 DB 버전을 올리지 않는다.
- 잠금 기록과 opt-in 없는 민감 기록은 기기에 payload를 남기지 않는다. volatile 경로도 공통 serializer를 사용해 URL·원문·첨부를 누락하지 않는다. 이 과정에서 기존 volatile 공유 URL 누락도 수정했다.
- source 순서는 입력 순서다. 조각 번호가 다르더라도 서버나 화면이 임의로 재배열/이어 붙이기 하지 않는다.
- 전송 중 다른 창의 수정은 기존 checkpoint hash/CAS 규칙으로 유지한다. idempotency payload에는 원문과 metadata가 모두 포함된다.
- Record의 owner/unlocked 조회에서만 allowlisted metadata를 projection한다. 잠금 상태에서는 source 배열 자체가 비어 있고 client로 전달하지 않는다.
- 이미지는 기존 인증된 private attachment 경로로 표시한다. 공개 이미지 최적화 캐시나 외부 원본 URL에 자동 연결하지 않는다.
- canonical export/restore, source change event 기반 full/incremental backup 경로를 그대로 사용한다. 일반 Markdown 보기만을 full-fidelity 정본으로 주장하지 않는다.

## 4. 검증 결과

완료된 로컬 검증:

| 검사 | 결과·범위 |
| --- | --- |
| 계약/API/로컬 저장·전송 | 5개 파일, 63 tests PASS, 최종 exit 0 |
| 실제 로컬 D1/R2 왕복 | 새 `manual-link-storage.test.ts` 7 tests PASS, 최종 exit 0 |
| 기존 source foundation 회귀 | 10 tests PASS, 기존 canonical payload hash 및 replay 호환 포함 |
| D1/R2 검증 항목 | 원문/순서, 재전송·metadata 충돌, owner/잠금/위조 교차소유, 잘못된 metadata fallback, 메모 revision·CAS 원문 보존, 다른 사용자로 canonical 복원·첨부 bytes, source changeevent→증분백업 복원 |
| 관련 계약/회귀 합계 | 7개 파일, 80 tests PASS. 프로젝트 전체 suite 재실행 수치가 아님 |
| 실제 React 브라우저 상호작용 | 26/26 PASS, 최종 exit 0, 1.6분. 신규 링크 8사례 × 데스크톱/모바일 = 16, 기존 durability 5사례 × 2 = 10 |
| 자동 접근성·배치 | Capture 링크 패널/Record 자료 영역의 WCAG 2/2.1 A/AA axe 위반 0, 두 viewport에서 가로 넘침 없음. 수동 접근성 전수 검사나 물리 기기 검증은 아님 |
| TypeScript | 타입 캐시 복구 후 `npm run typecheck --workspace @light-house/web` 최종 exit 0 |
| 변경 TS/TSX·검사 파일 ESLint | 최종 exit 0, 오류 0·Composer 기존 유형 경고 7. 신규 링크 컴포넌트/fixture 자체는 경고 0 |

계약 검사는 실제 로컬 D1/R2 fixture를 사용한다. 브라우저 검사는 실제 Capture/Record React 컴포넌트를 사용하지만 commit 응답과 이미지 오류를 대역으로 주입하고 clipboard 쓰기도 테스트 대역으로 대체한다. 따라서 브라우저→실제 원격 저장 전 구간을 통합 검증했다는 주장은 하지 않는다. 테스트 첨부는 합성 데이터이며 실제 사진/OCR 품질 검증이 아니다. D1/R2 fixture는 `persist:false, remoteBindings:false`인 로컬 시뮬레이터다. 원격 데이터·Gemini·실제 SNS 원문 접근은 실행하지 않았다.

대표 재실행 명령(저장소 루트, PowerShell):

```powershell
npm exec --workspace @light-house/web -- vitest run tests/contract/v2/manual-link-source.test.ts tests/contract/v2/capture-route-boundaries.test.ts tests/contract/v2/manual-link-offline.test.ts tests/contract/v2/offline-sync.test.ts tests/contract/v2/indexeddb-share-target.test.ts
npm exec --workspace @light-house/web -- vitest run tests/contract/v2/manual-link-storage.test.ts tests/contract/v2/source-foundation.test.ts
$env:FLAG_V2_WRITE = "1"
npm exec --workspace @light-house/web -- playwright test tests/e2e/v2-manual-link.spec.ts tests/e2e/v2-product-durability.spec.ts
npm exec --workspace @light-house/web -- next typegen
npm run typecheck --workspace @light-house/web
```

브라우저 최종 결과는 `apps/web/test-results/.last-run.json`의 `status: passed`, `failedTests: []`와 최종 26/26 프로세스 결과를 함께 확인했다. 같은 폴더의 `v2-manual-link-real-Captur-6f368-en-submits-with-AI-disabled-{desktop,mobile}-chromium/manual-capture.png`, `v2-manual-link-real-Record-02547-labels-OCR-and-video-limits-{desktop,mobile}-chromium/manual-record.png` 네 화면을 직접 열어 검토했다. 테스트 서버는 종료했으며 3100 포트의 리스너가 남지 않았다.

### 검토 중 발견한 문제와 조치

| 발견 | 조치·검증 |
| --- | --- |
| 공백만 있는 텍스트도 확보된 원문으로 집계 | 확보 여부만 trim으로 판정, 저장 문자열/복사는 그대로 유지 |
| 마지막 링크 제거 시 빈 checkpoint를 건너뛰어 이전 자료가 다시 나타남 | 이미 읽거나 저장 중인 해당 draft만 직렬화해 정리, 초기 복구 중 삭제 금지. 삭제→새로고침 회귀 통과 |
| 이미지 404가 hydration보다 먼저 끝나면 onError 표시가 누락 | 초기 complete/naturalWidth도 확인. 빠른 실패 대역으로 데스크톱/모바일 회귀 통과 |
| OS Share Target은 새 metadata/저자 구분 경로가 아님 | 자동 이관 완료로 주장하지 않고 명시적 전환 UX를 후속 범위로 기록 |

초기 브라우저 검사에는 locator 문제와 이미지 오류 표시 실패가 있었다. 수정을 반영한 **최종 26/26**만 합격 근거로 삼는다.

최종 타입 검사에서는 Next 개발 서버가 생성한 `.next/dev/types/routes.d.ts`에 중복·잘린 후행 내용이 남아 실패했다. 개발 서버 종료를 확인한 뒤 해당 **생성 타입 폴더만** 검증된 절대경로에서 `C:/Users/James-office/AppData/Local/Temp/lighthouse-next-types-recovery-b27e261139a84a3293f6308321d027fd/dev-types`로 옮겨 보존했다. 앱 원본 코드는 삭제하지 않았다. 공식 `next typegen`으로 정상 production route 타입과 `next-env.d.ts`를 생성하고 최종 typecheck exit 0을 확인했다. 원인 전부를 Next 자체 결함으로 단정하지 않는다. 이번에는 Worker production bundle/전체 414건 suite를 다시 빌드·실행하지 않았다.

## 5. 아직 하지 않은 일과 다음 구현 순서

1. **snapshot 및 파생 조각 모델**: 이어 수집/수정 시 source manifest와 현재 snapshot pointer를 별도로 관리. job identity/CAS, export closure, ID 재매핑, changeevent를 함께 추가한다. 이번 namespace는 `LinkSnapshotV1` 또는 `PromptFragmentV1` 전체 구현이 아니다.
2. **외부 저자 구분 AI 경로**: 붙여넣은 자료에서 인용/프롬프트/팁을 추출하되 byte/문자 범위 근거와 누락 상태를 보존. 무근거 자동 완성 금지.
3. **관계와 재사용 UX**: 사용자가 확인한 조각 연결·순서·이미지 대응, 파생 조립본 복사, 목적별 저장 뷰·검색 필터와 50건 탐색 검증. OS Share Target의 기존 공유글/URL을 새 출처로 명시적으로 전환하는 기능도 포함한다. 이번에는 Record 개별 복사만 구현했다.
4. **수집 adapter**: 권한 있는 Threads/Instagram 접근과 YouTube 텍스트/영상 확보 경로를 각각 검증한 뒤 활성화. 로그인 우회나 임의 전체 스크래핑 없음.
5. 실제 비공개 corpus/물리 모바일/한국어 IME·사용성 확인과 기존 배포·cutover gate는 별도다.

이번 작업은 Cloudflare/Workers/Wrangler 스킬의 기존 binding 재사용·비공개 첨부·bounded 요청 원칙에 맞춰 진행했다. 배포, remote migration, 기존 데이터 cutover는 수행하지 않았다.
