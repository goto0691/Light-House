# 기존 공유 입력의 명시적 수동 자료 전환

> 기준일: 2026-09-08  
> 범위: 아직 서버에 저장하지 않은 Capture의 기존 URL/text source를 사용자가 확인한 뒤 수동 링크 자료로 전환한다.  
> 상태: 실제 React UI·로컬 draft 경로와 합성 브라우저 검증 완료. 외부 수집·AI 분석·배포의 완료 증거가 아니다.

## 1. 결정과 동작

- 기존 `kind: url` source만 전환 후보로 표시한다. 본문·제목·공유 텍스트에서 URL을 임의 추출하지 않는다.
- 기본값은 **공유 텍스트는 내 메모로 유지**다. 이 상태에서 확인하면 원문이 빈 링크 자료 카드만 추가한다.
- **공유 텍스트를 출처 원문으로 복사**를 선택한 경우에만 해당 text source를 그대로 복사한다. text source가 여러 개면 사용자가 하나를 선택한다.
- URL은 기존 `manualLinkV1` 계약의 HTTPS·인증정보 제외 검증을 통과해야 한다. 잘못된 URL도 원래 draft에서는 삭제하지 않는다.
- 전환 자체는 원래 URL/text/title source와 본문을 수정하지 않는다. 공유 제목을 작성자·제작자 근거로 사용하지 않는다.
- 새 자료는 기존 source 순서를 건드리지 않고 뒤의 빈 순서에 추가한다. 같은 URL이라도 다른 source ID는 별개 입력으로 유지한다.
- 원래 URL source ID에서 만든 결정적인 파생 ID로 반복 전환을 막는다. 기존 파생 자료를 다시 덮어쓰지 않는다.
- 확인해 수동 자료가 생긴 뒤에만 기존 수동 Capture의 AI 비활성 규칙이 적용된다. 라디오를 선택하는 것만으로는 원문이나 AI 설정을 변경하지 않는다.
- 서버 저장 전에는 **전환 되돌리기**를 제공한다. 파생 원문·메타데이터가 전환 직후와 동일할 때만 해당 카드 하나를 제거하고, 원래 source와 이후 사용자 메모 편집은 유지한다.
- 전환 후 자료 내용을 수정했다면 되돌리기는 비활성화한다. 수정한 내용을 자동으로 버리지 않고 사용자가 자료 카드를 직접 검토·제거하도록 안내한다.

## 2. 구현 범위

| 파일 | 책임 |
| --- | --- |
| `apps/web/src/lib/v2/offline/manual-share-conversion.ts` | 후보 판별, 선택한 원문 복사, 결정적 중복 방지, 보수적인 undo |
| `apps/web/src/components/v2/link-capture-panel.tsx` | 기존 공유 링크 표시와 명시적 선택·확인·되돌리기 |
| `apps/web/tests/contract/v2/manual-share-conversion.test.ts` | 순수 변환 계약 12개 검사 |
| `apps/web/tests/e2e/v2-manual-share.spec.ts` | 실제 Capture 복구·입력·전송 경로 4개 시나리오, 2개 viewport |

기존 CaptureComposer의 sourceItems 상태·checkpoint·AI guard를 사용한다. `share-target.ts`의 기존 자동 parser를 변경하지 않았고, 기존 수동 자료 제거→빈 draft 정리 동작도 유지한다.

`shareConversionV1`은 저장 전 로컬 draft에서 중복/되돌리기를 추적하는 보조 메타데이터다. 현재 서버는 검증한 `manualLinkV1`만 정본 메타데이터에 남긴다. 따라서 이 로컬 표지를 서버의 영구 provenance 또는 저장 후 undo 기능으로 설명하지 않는다.

## 3. 검증 결과

`apps/web`에서 실행했다.

```powershell
npx vitest run tests/contract/v2/manual-share-conversion.test.ts
npx eslint src/components/v2/link-capture-panel.tsx src/lib/v2/offline/manual-share-conversion.ts tests/contract/v2/manual-share-conversion.test.ts tests/e2e/v2-manual-share.spec.ts
$env:FLAG_V2_WRITE = '1'
npx playwright test tests/e2e/v2-manual-share.spec.ts tests/e2e/v2-manual-link.spec.ts tests/e2e/v2-product-durability.spec.ts
```

| 검증 | 최종 결과 | 의미 |
| --- | --- | --- |
| 순수 계약 | 12/12 PASS | 원본 identity·문자열·순서, 선택 복사, 중복 방지, 안전한 undo, 잘못된 URL, 20개 제한 |
| 변경 파일 ESLint | 오류 0, 경고 0 | 새 helper·panel·unit/e2e 파일 검사 |
| 결합 브라우저 검사 | 34/34 PASS, exit 0, 약 2.6분 | 새 공유 전환 8 + 수동 링크 16 + 기존 durability 10 |
| 새 공유 영역 접근성 | 데스크톱/모바일 axe 자동 위반 0 | `.v2-link-capture`, WCAG 2 A/AA·2.1 A/AA 자동 범위 |
| 새 공유 화면 배치 | 데스크톱/모바일 가로 넘침 없음 | 화면 폭보다 문서 scrollWidth가 크지 않음 |
| 화면 직접 검토 | 데스크톱/모바일 캡처 확인 | A+ 배치, 선택/미선택 radio, 원문 귀속 확인 동작 점검 |
| 테스트 종료 | `.last-run.json`: passed, failedTests 빈 배열; 3100 listen 없음 | 테스트 서버 종료 확인 |

첫 결합 실행도 34/34였다. 직접 화면을 보고 OS dark native radio 색상 때문에 미선택 항목이 진하게 보이는 문제를 발견했다. 두 radio의 light color scheme과 A+ accent를 명시하고 새 공유 영역 접근성/가로 넘침 검사를 추가한 뒤 **전체 34개를 다시 실행한 최종 결과**를 위에 기록했다.

최종 테스트 중 Next dev의 `destination stream closed early` 로그가 한 번 나왔으나 해당 내비게이션 회귀 검사와 전체 runner는 통과했다. 생성된 Next 파일을 수동으로 편집하지 않았고, 이 하위 작업에서 별도 typegen/typecheck를 동시에 실행하지 않았다.

## 4. 증거 파일과 제한

화면은 아래 로컬 테스트 출력에 있으며 다음 Playwright 실행에서 덮일 수 있다.

- 데스크톱: `apps/web/test-results/v2-manual-share-legacy-mob-0caa4-after-explicit-confirmation-desktop-chromium/explicit-share-choice.png`
- 모바일: `apps/web/test-results/v2-manual-share-legacy-mob-0caa4-after-explicit-confirmation-mobile-chromium/explicit-share-choice.png`

| 대상 | SHA-256 |
| --- | --- |
| `manual-share-conversion.ts` | `31C577C92BCC361651520C5D75BD72E77912A25319B50E89A0966ED4C46DC7DF` |
| `manual-share-conversion.test.ts` | `10E4794FF015E3F155A9135F475FA8401B268040EFA3F958F8E18D716BC87D24` |
| `v2-manual-share.spec.ts` | `B03C1863ED48ABE8E6A66D7961ABFBB24EA8AEA7D2F8A0F8B42BBC09B468B951` |
| 데스크톱 캡처 | `447B81CF5721522B507688EEEF5C64E2301FFEF7C684F9E87E5EEC3A4E41406C` |
| 모바일 캡처 | `87B512780338F554ED35BCC53ABD812E668EFAA73D31D36BB06FBEA80AA33A53` |

브라우저 테스트는 합성 legacy draft를 IndexedDB에 넣고 실제 Capture를 열었다. 전송 응답은 테스트 대역이며 외부 요청은 차단했다. 실제 모바일 OS의 Share 메뉴/설치 PWA 전달, 실제 사이트 권한, 원격 저장, 모델의 텍스트 귀속 판별을 검증한 것이 아니다.

변환은 이미 draft에 들어 있는 문자열의 CRLF·앞뒤 공백을 보존한다. OS 공유·기존 parser·브라우저 입력 이전의 변환까지 복구하거나 보장하지 않는다. 사용자가 본문을 나중에 직접 편집하는 행위를 이 전환이 취소하지 않으며, 본문 편집의 이전 버전을 새 영구 source로 자동 만들지 않는다.

자동 수집, 영상/이미지 분석, prompt 조립, 영구 snapshot의 완전한 계보, 저장 후 source 수정·재수집은 다른 구현 단계의 책임이다.
