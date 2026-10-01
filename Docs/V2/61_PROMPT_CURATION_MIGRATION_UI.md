# G06 · 이관 확인 UI 검증

2026-09-08. [54번 계약](./54_PROMPT_CURATION_IMPLEMENTATION_CONTRACT.md)과 [60번 API](./60_PROMPT_CURATION_SNAPSHOT_MIGRATION.md)에 실제 Record UI를 연결했다. 원격 데이터 이관이나 제품 전체 완료 판정은 아니다.

이 문서의 메모리 전용 초안·당시 지문과 검사는 역사 기록이다. 2026-09-12의 기기 초안/중단 요청 복구와 후속 UI 검증은 [68번](./68_PROMPT_CURATION_MIGRATION_RECOVERY.md)을 따른다.

## 사용자 흐름과 보호

- 과거 자료의 정리본에서 명시적으로 미리보기를 요청한다. 선택한 정리본 revision을 고정하고 현재 자료의 쓰기 capability·원문/이미지 대응을 읽는다. 조회만으로 저장하지 않는다.
- 원본/대상 버전, 역할별 정확 문자열·순서·중복·UTF-16 범위, 전체/항목 예시와 대응 확인 상태를 표시한다. 이미지 원본은 기존 인증 경로로 연다. 누락·변경·복수 후보가 있으면 일부 저장도 막는다.
- AI가 선택한 범위를 수동 선택으로 보관한다는 의미를 설명하고 체크박스와 별도 저장을 요구한다. 부분 원문·OCR·외부 전체 범위 미확인 등의 경고는 유지한다.
- browser-safe 응답 검증기는 계획 hash/identity/모든 item·image·issue·AI 선택 목록을 확인한다. 저장 receipt는 보존한 target 원문으로 기존 `preparePromptCuration`을 다시 계산해 새 그룹/revision1/based-on·정확 문자열·역할/중복·이미지·manifest·경고를 대조한다.
- rawText·권한·서버 proof를 POST body로 보내지 않는다. 원래 API의 여섯 기대 버전/plan/group/request 필드만 보낸다. 서버는 실제 소유권과 원문을 다시 검증한다.
- 같은 미리보기의 요청 키는 응답 유실·재확인 실패·확인 화면 닫기/다시 열기에서 유지한다. 409는 새 미리보기와 해제된 체크박스에서 다시 확인해야 한다. 새 기준으로 자동 저장하지 않는다.
- 늦은 응답은 부모 record/snapshot/권한 scope를 바꾸지 못한다. 저장 성공 뒤 별도 버튼으로 부모의 해당 자료 버전을 열고 목록에서 새 그룹을 확인한다. 자식만 새 snapshot으로 바꾸지 않는다.
- 자식 저장 요청의 401/403/423/record404는 정리본과 입력을 폐기한다. 저장된 자료로 이동하는 부모 GET의 인증/잠금 거절도 링크 원문·편집기·자식 정리본을 폐기한다. 503 같은 가용성 오류는 유지한다.

## 발견과 수정

독립 읽기 검토에서 P2 두 건을 발견했다. 미리보기 GET 전에 기존 review를 지우면 재확인 실패 뒤 요청 키를 잃어 같은 내용을 중복 그룹으로 저장할 수 있었다. 성공 전에는 기존 review와 키를 유지하도록 고쳤다. 부모 navigation GET가 인증 오류를 일반 오류로 표시하며 기존 원문을 남기는 경계도 typed status/code를 확인해 폐기하도록 고쳤다. 두 시나리오는 실제 컴포넌트 회귀에 포함했다.

첫 브라우저 실행 `31651`: **22 PASS / 10 FAIL, exit 1, 1.3분**. 새 HTTP 대역이 `extractManualPromptFragment`에 범위 세 필드 대신 전체 fragment를 넣어 엄격한 parser가 거절했다. 대역의 입력만 고쳤고 제품 검증을 완화하지 않았다. 함께 발견한 React setter의 두 번째 callback 인자 경고는 `operate`에 람다를 전달해 제거했다. 최초 실패 산출물은 `apps/web/test-results/curation-migration-ui-2320`에 있다.

## 최종 검사 범위

| 검사 | 결과 | 한계 |
| --- | --- | --- |
| agent 이관 응답 pure | **42/42 PASS, exit 0, 0.676초**, 23:18 동결 | 별도 입력 캡처/손상/경고/manifest 검사. root가 두 파일 해시 일치를 확인 |
| root 새 이관 UI `39000` | **40/40 PASS, exit 0, 1.3분** | desktop20/mobile20, 320px keyboard/axe, 성공·누락/변경/모호함·권한·503·409·키 재생·응답 손상/지연 |
| root 결합 `5870` | **146/146 PASS, exit 0, 5.0분** | 링크24+수동34+정리본48+이관40. 같은 UI를 포함하므로 결과를 중복 합산하지 않음 |
| root 초기 타입 `70312` | exit 0 | 후속 부모 접근 폐기 변경 전. 최종 타입을 별도로 확인 |
| root 최종 타입 `67473` | **exit 0** | 최종 부모 변경·새 response/시험 포함 |
| root 최종 scoped lint `45361` | **오류/경고 0, exit 0**, TS/TSX 8파일 | 앱 전체 lint/Worker 아님 |

명령은 저장소 루트에서 실행한다.

```text
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-prompt-curation-migration.spec.ts --output=test-results/curation-migration-ui-2326
npm run test:e2e --workspace @light-house/web -- tests/e2e/v2-link-analysis.spec.ts tests/e2e/v2-manual-fragments.spec.ts tests/e2e/v2-prompt-curations.spec.ts tests/e2e/v2-prompt-curation-migration.spec.ts --output=test-results/curation-migration-integration-2329
```

root가 새 UI의 `migration-preview.png` desktop과 `migration-320.png` mobile 캡처를 직접 확인했다. 새 API 저장 자체는60번, 실제 V2 full/delta/ZIP/fresh/repeat 이동성 **4/4 PASS**는 [59번](./59_PROMPT_CURATION_API_PORTABILITY.md)에 별도 근거가 있다.

## 제품/검사 지문

결합 검사 중 읽은 SHA-256. 종료 후 9파일 모두 불일치0, exit0을 확인했다. 23:32 KST 3100 listener0·workerd0이며 실행 중 핸들은 없다.

| 파일 | SHA-256 |
| --- | --- |
| `apps/web/src/components/v2/prompt-curation-migration.tsx` | `E5FB29418D3EF73A576BC08092EBF31FE46118F7B236634875476FA8D00C08DE` |
| `apps/web/src/components/v2/record-prompt-curations.tsx` | `F78E611BE79F33BCB3D152799A2D42775ACF6008193DADEB38B2F0635BBC7BB4` |
| `apps/web/src/components/v2/record-link-analysis.tsx` | `B334601205403B023F8D33F6C8512EE51D6C1B6F230ABF5D7D22021E79E3C395` |
| `apps/web/src/lib/v2/domain/prompt-curation-migration-response.ts` | `0AC9614F17E49BDDF54F971C3C9791F74B2FE4AD6003048132BEFBF797BE3345` |
| `apps/web/src/app/v2/prompt-curations.css` | `0F5124368129285C8134AC5D2E963DD6F3AB7EAC43960382F5693EE04C286B09` |
| `apps/web/tests/contract/v2/prompt-curation-migration-response.test.ts` | `94D242B4E1463C49E970F2E161AE2B78E3EDEC0F65C5A311C273BE131D1629D3` |
| `apps/web/tests/e2e/support/prompt-curation-harness.ts` | `F20405334EBF326C4B097EDD5AE174A3F88C6D0E757AE49423B3E5BA43A43E08` |
| `apps/web/tests/e2e/support/prompt-curation-migration-harness.ts` | `6C488C6F915BCD4BC61C725FEC0E9AAB7B8CAF81A2185EED958992BA29502721` |
| `apps/web/tests/e2e/v2-prompt-curation-migration.spec.ts` | `2A2B86B5204C109074FAB24D397A6119251F2245A4837C41AF3EE75054E51876` |

## 남은 범위

이 UI 검사는 실제 React/Chromium과 로컬 HTTP 대역이며 실제 로그인·원격 Worker·실기기·OS clipboard 성공을 의미하지 않는다. 브라우저 DTO에 없는 full metadata/fingerprint와 DB 소유권 증명은 인증된 서버와 snapshot manifest identity를 신뢰하는 경계다. 이 검증기가 서버 proof를 대체하지 않는다.

draft와 이관 pending 키는 화면 메모리에만 있다. reload·다른 탭·다른 record/기기 복구 및 여러 미확정 이관의 독립 보존은 G05 내구성 작업에 남긴다. 이관한 새 그룹의 cross-snapshot based-on 복원 closure·V2 삭제/tombstone 증분 경로도59번의4검사에 포함되지 않았다. 앱 전체 회귀·최신 secret-safe Worker·실제 제공자·운영 gate는 아직 미완료다. 배포·원격 migration·cutover·과금·환경 파일·앱 Gemini 설정은 변경하지 않았다.
