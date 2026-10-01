# 29. I0 Editor Spike Evidence

> 상태: `I0-008` 기술 spike 완료 · Milkdown 유지  
> 검증일: 2026-08-12  
> 범위: D-012, D-017, D-050의 Markdown 편집기 기술 선택과 상호작용 계약

## 1. 결론

Milkdown `7.22.0`과 CodeMirror 6 조합은 현재 제품 기획에 사용할 수 있다. 치명적인 Markdown 의미 손실, 한글 조합 중 저장 shortcut 오작동, 모드 간 상태 단절, 5만 자 fixture 실패가 재현되지 않았으므로 Tiptap fallback은 발동하지 않는다.

시각 문서·Markdown 소스·읽기 모드는 React 부모가 가진 하나의 `body_markdown` working copy를 공유한다. 이 spike는 서버 revision이나 D1 저장을 흉내 내지 않으며, 다음 `I0-009`에서 실제 source transaction 경계를 연결한다.

## 2. 구현 계약

| 영역 | 구현 |
| --- | --- |
| 공통 정본 상태 | `apps/web/src/components/v2/editor/editor-fixture.tsx`의 단일 Markdown working copy |
| 시각 문서·읽기 | Milkdown commonmark + GFM + history + clipboard + listener |
| Markdown 소스 | CodeMirror Markdown language, line number, controlled update adapter |
| 선택 서식 | 굵게, 기울임, H2, 인용문 selection toolbar |
| 문서 보조 | 제목, 개요, 문자·줄·단어·checksum inspector, focus mode |
| 위치 복원 | visual/source/read별 selection anchor·head와 scroll snapshot |
| 저장 계약 | 350ms local save 상태, 수동 checkpoint, `Ctrl/Cmd+Enter` |
| IME 방어 | composition 중 수동 저장 shortcut 무시 |
| 대용량 fixture | 5만 자 이상 Markdown 생성과 visual round-trip |

추가한 직접 dependency는 다음과 같다.

- `@milkdown/kit` `7.22.0`
- `@milkdown/react` `7.22.0`
- `codemirror` `6.0.2`
- `@codemirror/lang-markdown` `6.5.2`
- `@codemirror/state` `6.7.1`
- `@codemirror/view` `6.43.8`

에디터는 `next/dynamic`의 client-only boundary에서 불러온다. 초기 Library surface의 bundle과 SSR 경계에 편집기 DOM 의존성을 섞지 않는다.

## 3. Markdown 왕복 결과

검증 fixture는 한국어 산문, H2/H3, 굵게, 인용문, GFM task list, 표, 강제 줄바꿈, custom URI link를 포함한다. visual → source → read → source 왕복 뒤 다음 의미 구조가 유지됐다.

- 선택한 한국어 단어에 적용한 굵게 표시
- 완료·미완료 task와 label
- 표의 `평점 = 4.5 / 5`
- backslash hard break
- `lighthouse://entity/01EDITORFIXTURE` 링크 목적지
- source mode에서 추가한 문장

Milkdown은 시각 모드를 거치면 Markdown을 의미가 같은 canonical form으로 직렬화한다. 예를 들어 task list marker `-`가 `*`로 바뀌고 표의 공백 폭이 정렬될 수 있다. 따라서 계약은 byte-for-byte 동일성이 아니라 문서 의미와 구조의 보존이다. exact source 표기가 필요한 작업은 source mode에서 할 수 있지만, 이후 visual mode를 거치면 다시 정규화될 수 있다. 최초 Capture 원본과 과거 revision은 이 editor working copy와 별도로 보존해야 한다.

## 4. 상호작용에서 발견해 고친 문제

### 4.1 selection toolbar

React 상태 갱신이 브라우저 native selection을 먼저 접어 toolbar command가 빈 selection에 적용되는 문제가 있었다. toolbar를 DOM에서 안정적으로 유지하고, 마지막 ProseMirror selection을 복원한 뒤 command를 실행하며, 실행 직후 Markdown을 공통 상태에 동기화하도록 수정했다. 선택→굵게→즉시 source 전환 시 `**침묵**`이 유지되는 자동 테스트가 통과한다.

### 4.2 mobile save reachability

첫 mobile projection은 긴 문서에서 전체 페이지가 스크롤되어 저장 footer가 화면 밖으로 밀릴 수 있었다. editor shell을 viewport 높이에 고정하고 본문만 내부 스크롤하도록 바꿨다. 390×844에서 세 모드와 `로컬에 저장됨`, `지금 저장`이 동시에 접근 가능하다.

### 4.3 개발 중 Hot Reload 로그

구현 중 plugin 구성이 교체될 때 발생한 과거 Milkdown context/Next error-boundary 로그가 dev log history에 남아 있었다. 새 URL로 깨끗하게 탐색해 editor를 다시 mount한 뒤 수집한 error·warning은 0건이었다. production build와 Playwright의 새 context에서도 재현되지 않았다.

## 5. 자동 검증

```text
npm.cmd run typecheck
→ PASS

npm.cmd test
→ 4 files, 26 tests PASS
→ editor contract 7 tests 포함

npm.cmd run build
→ PASS, Next.js 16.3.0

npm.cmd run test:e2e
→ 18 cases: 11 PASS, 7 expected project skips
→ editor 왕복, selection toolbar, IME shortcut, source selection 복원,
  5만 자 fixture, mobile editor reachability PASS
→ Library와 Editor surface의 WCAG 2 A/AA critical axe violation 0

npm.cmd audit --omit=dev --json
→ production vulnerability 0
```

5만 자 fixture는 12초 gate 안에서 visual round-trip을 마쳤다. 현재 자동 IME 검증은 실제 한글 문자열을 조합하는 OS 입력기 자체가 아니라 browser `compositionstart`/`compositionend`와 `isComposing` event contract를 확인한다. 실제 Windows·Android 한글 입력기의 조합·삭제·undo 검토는 I2 승격 전 수동 기기 QA 항목으로 남긴다.

## 6. 시각 검토

in-app browser에서 desktop light/dark와 390×844 mobile을 직접 확인했다.

- A+ warm editorial surface에서 문서 본문이 application chrome보다 우세하다.
- desktop의 개요·본문·inspector 3열은 역할이 분명하고 focus mode로 주변 정보를 제거할 수 있다.
- CodeMirror source는 행 번호와 syntax color를 제공하되 visual mode와 같은 title/save shell을 유지한다.
- dark theme에서도 제목·본문·인용문·저장 action의 위계가 유지된다.
- mobile은 side panel을 제거하고 mode switch와 저장 footer를 남겨 핵심 편집 흐름을 보존한다.

## 7. Gate 판정과 다음 작업

`I0-008`은 완료다.

- Milkdown 유지
- Tiptap fallback 보류
- semantic round-trip을 편집기 acceptance contract로 사용
- 실제 IME 수동 QA는 I2 release evidence에 포함

다음 작업은 `I0-009 D1 binding transaction spike`다. Capture·Source·attachment link·idempotency result·processing outbox가 하나의 binding batch transaction에서 함께 성공하거나 rollback되는지 failure injection으로 증명한다.
