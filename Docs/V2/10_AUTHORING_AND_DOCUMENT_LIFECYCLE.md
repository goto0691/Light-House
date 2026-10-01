# 10. Authoring and Document Lifecycle

## 1. 목적

Light House의 편집기는 AI 입력창이 아니라 사용자의 글이 오래 머무는 집필 공간이다. AI 구조화가 성공하지 않아도 글쓰기, 저장, 수정, 복원은 완전하게 동작해야 한다.

핵심 원칙은 다음과 같다.

> 본문은 사용자의 글이고, AI는 본문 밖에서 이해한다. 본문을 바꾸는 작업은 언제나 사용자가 요청하고 승인한다.

## 2. 확정 결정

| 항목 | 결정 |
| --- | --- |
| 정본 본문 | `body_markdown` |
| 제목 | Markdown의 첫 H1이 아니라 별도 `title` 필드 |
| 기본 편집 | Markdown을 직접 보지 않아도 되는 시각적 문서 모드 |
| 소스 편집 | 동일한 `body_markdown`을 수정하는 Markdown 소스 모드 |
| 읽기 | 편집 UI를 숨긴 읽기 모드 |
| 1차 편집기 | Milkdown 기반의 Markdown-first 에디터 |
| 소스 모드 | CodeMirror 기반 Markdown 편집기 |
| 대체안 | 기술 스파이크에서 치명 문제가 확인된 경우에만 Tiptap으로 전환 |
| AI 본문 변경 | 명시 요청 → diff 미리보기 → 사용자 승인 → 새 revision |
| 자동 저장 | 로컬 안전 저장 + 서버 working copy + 불변 revision checkpoint |
| 동시 편집 | 낙관적 버전 검사와 충돌 비교; MVP에서 CRDT 제외 |
| 메타데이터 | 본문 또는 front matter에 섞지 않고 구조화 DB에 저장 |
| front matter | 내보내기 시에만 생성 |

Milkdown을 선택하는 이유는 Markdown이 입출력의 중심이고, 시각 편집과 Markdown 회수가 기본 기능이며, ProseMirror·Remark 기반의 확장 구조가 내부 링크와 첨부 노드를 구현하기에 적합하기 때문이다. Tiptap은 강력하지만 Markdown 계층이 아직 Beta이므로 1차 선택으로 두지 않는다.

## 3. 지원 Markdown 프로필

### 기본 문법

- CommonMark
- GFM 표
- GFM 작업 목록
- 취소선
- 각주
- 제목, 인용문, 코드 블록, 구분선
- 순서·비순서 목록
- 이미지와 링크

### Light House 링크

내부 참조는 사람이 읽을 수 있는 label과 안정된 객체 ID를 함께 가진다.

```markdown
[듄: 파트 2](lighthouse://entity/01ABC)
![가지튀김](lighthouse://attachment/01XYZ)
```

표시 이름이 바뀌어도 ID로 연결을 유지한다. export 시에는 앱 URI를 상대 파일 경로나 manifest 참조로 변환한다.

### 허용하지 않는 것

- raw HTML
- 실행 가능한 script·iframe
- AI 메타데이터용 본문 주석
- 앱에서만 읽을 수 있고 export에서 사라지는 불투명 노드

수식, 다이어그램, 다단 레이아웃, 콜아웃 확장은 MVP 이후 실제 사용 사례가 확인되면 추가한다.

## 4. 문단, 줄바꿈, 시

일반 글과 시를 모두 손실 없이 다룬다.

- `Enter`: 새 문단
- `Shift+Enter`: CommonMark hard break
- 빈 줄: 연 구분
- `시 형식` 명령: 선택 영역의 각 줄바꿈을 hard break로 일괄 변환

정본 Markdown은 CommonMark의 역슬래시 hard break를 사용한다.

```markdown
첫 번째 행\
두 번째 행

다음 연의 첫 행\
다음 연의 둘째 행
```

시를 별도 데이터 타입으로 강제하지 않는다. 글의 유형은 동적 레지스트리에 둘 수 있지만, 행과 연의 구조는 본문 자체에서 보존한다.

## 5. 두 가지 집필 표면

### Quick Capture

목표는 분류가 아니라 원본을 빠르게 안전하게 넣는 것이다.

- 텍스트, 이미지 붙여넣기, 파일, 오디오를 한 번에 받는다.
- 첨부 순서를 즉시 바꿀 수 있다.
- 기본 `빈 기록`에서는 카테고리, 도메인, 세부 필드를 묻지 않는다.
- 진입 즉시 본문에 focus하며 자동 생성 template과 AI cue를 먼저 펼치지 않는다.
- 사용자가 `도움받아 쓰기`를 열어 템플릿을 선택하면 desktop assistance rail 또는 mobile bottom sheet에 core cue 3~5개를 표시한다.
- `Enter`는 줄바꿈이고 `Ctrl/Cmd+Enter`가 저장이다.
- 저장 직후 원본 commit 영수증을 먼저 보여준다.
- `저장 후 AI 정리` toggle은 저장 버튼 가까이에 항상 보인다. `끔`이면 원본 저장·검색 가능한 기본 색인만 수행하고 Gemini 분석을 예약하지 않는다.
- 짧은 메모도 `body_markdown`으로 저장되므로 나중에 Full Writer에서 그대로 이어 쓸 수 있다.

### Full Writer

긴 글을 새로 쓰거나 기존 캡처를 다듬는 공간이다.

- 별도 제목 입력
- 시각 문서 / Markdown 소스 / 읽기 모드
- 본문 폭 680~760px의 집중 영역
- 선택할 때만 나타나는 `SelectionToolbar`와 키보드 단축키
- raw block 이름보다 사용 의도를 먼저 보여주는 `/` command menu
- 제목 기반 outline
- 찾기·바꾸기
- 이미지 붙여넣기와 drag & drop
- 내부 문서·개체 링크 검색
- revision history와 AI diff
- 필요할 때만 여는 구조 정보 inspector
- 선택적 capture template과 recall cue
- sidebar·Inspector를 숨기고 저장 상태만 남기는 focus mode

Quick Capture와 Full Writer는 서로 다른 저장 형식을 사용하지 않는다.

템플릿은 `body_markdown`에 placeholder를 자동 삽입하지 않는다. 구조화 입력은 Source Layer의 form evidence로, recall cue의 답은 사용자가 작성한 본문으로 저장한다. 자세한 계약은 [12_ADAPTIVE_CAPTURE_TEMPLATES.md](./12_ADAPTIVE_CAPTURE_TEMPLATES.md)를 따른다.

### 편집 interaction grammar

`MarkdownCaptureEditor`와 `MarkdownDocumentEditor`는 같은 command와 selection 계약을 공유한다.

`SelectionToolbar`:

- 굵게, 기울임, highlight
- heading, quote
- URL link
- 내부 record·entity link
- 선택 영역을 새 기록으로 만들기
- image caption·alt text

slash menu:

```text
/제목  /인용  /이미지  /파일  /표
/기록 연결  /사람 연결  /장소 연결  /떠올림 단서
```

- raw `block`, `node`, `embed`보다 사용자가 하려는 일을 먼저 표시한다.
- command 실행 전후 Markdown round-trip을 보존한다.
- menu와 toolbar를 닫아도 editor selection과 scroll을 잃지 않는다.
- 한국어 IME composition 중 slash 검색·Enter 확정을 가로채지 않는다.

Focus Mode:

- sidebar와 구조 Inspector를 숨기고 body를 680~760px로 유지한다.
- save state, conflict, offline처럼 글을 잃을 수 있는 상태만 남긴다.
- 종료 후 cursor, selection, scroll, 열린 outline 위치를 복원한다.
- AI chat·template·metadata panel을 자동으로 열지 않는다.

내부 link는 Craft식 block backlink의 장점을 취하되 Markdown 정본을 해치지 않는다. `@` 또는 `[[`로 record·entity를 찾고, link target 상세에서는 source record의 정확한 문맥으로 돌아갈 수 있어야 한다. 시각·interaction 방향은 [17_VISUAL_DESIGN_AND_BENCHMARK_ADOPTION.md](./17_VISUAL_DESIGN_AND_BENCHMARK_ADOPTION.md)를 따른다.

## 6. 본문과 AI의 경계

### 저장 후 자동으로 해도 되는 일

- 글 유형·주제·키워드 제안
- 명시된 날짜·평점·수치 추출
- 개체·사건·관계 생성
- 요약과 검색 색인 생성
- OCR·녹취 정규화
- 외부 사실 보강

이 결과는 구조화 데이터와 검색 투영에 저장하며 `body_markdown`을 바꾸지 않는다.

### 명시 요청이 있어야 하는 일

- 맞춤법·문장 교정
- 문체 변경
- 문단 재배열
- 요약문을 본문에 삽입
- 제목 변경
- 확장·축약·번역
- 녹취를 에세이로 재작성

AI가 본문을 제안할 때는 전체를 조용히 교체하지 않는다.

```text
사용자 요청
→ 현재 revision 고정
→ AI 제안 생성
→ inline 또는 split diff
→ 전체/부분 수락
→ 새 revision 저장
→ 새 revision 기준 재분석
```

## 7. 문서 생명주기

```text
inbox → draft → revising → finished → archived
          ↑         ↓          ↓
          └─────────┴──────────┘
```

| 상태 | 의미 |
| --- | --- |
| `inbox` | 빠르게 저장되어 아직 정리·집필 여부를 정하지 않은 기록 |
| `draft` | 사용자가 쓰는 중인 글 |
| `revising` | 내용은 있으나 계속 다듬는 글 |
| `finished` | 사용자가 현재 완성본으로 표시한 글 |
| `archived` | 기본 목록에서는 숨기지만 보존하는 글 |

AI는 상태를 제안할 수 있지만 `finished`로 자동 전환하지 않는다.

### 날짜의 분리

| 날짜 | 의미 |
| --- | --- |
| `captured_at` | 시스템에 들어온 시각 |
| `written_at` | 실제로 글을 쓴 시각 |
| `updated_at` | working copy의 마지막 수정 시각 |
| `occurred_at` | 글에서 다루는 사건의 시각 |
| `finished_at` | 사용자가 완성으로 표시한 시각 |

한 날짜를 모든 의미에 재사용하지 않는다. 과거 글을 오늘 이관해도 `captured_at`과 `written_at`을 구분한다.

## 8. 저장과 revision

### 세 단계 저장

1. **로컬 안전 저장**: 입력 후 약 300ms 안에 IndexedDB working copy 갱신
2. **서버 working copy**: 마지막 입력 약 1.5초 후 debounce 저장
3. **불변 revision**: 의미 있는 checkpoint마다 새 revision 생성

revision checkpoint는 다음에 만든다.

- 30초 이상 편집이 멈췄을 때
- 문서를 닫거나 다른 문서로 이동할 때
- 사용자가 직접 저장할 때
- AI 본문 변경 전과 승인 후
- 한 번에 큰 내용이 붙여넣어졌을 때
- `finished` 상태로 바꿀 때

### 데이터 계약

```text
Document
├── current_revision_id
├── current_version
├── working_copy_updated_at
└── analyzed_revision_id

DocumentRevision
├── id
├── document_id
├── parent_revision_id
├── body_markdown
├── content_hash
├── author_kind: user | ai_accepted | import
├── change_reason
└── created_at
```

`editor_state_json`, `rendered_html`, `plain_text`는 빠른 재개와 렌더링을 위한 파생 캐시다. 정본은 아니다.

### 분석 stale 처리

AI 결과는 반드시 `analyzed_revision_id`에 묶는다. 현재 revision이 바뀌면 기존 분석은 삭제하지 않고 `stale`로 표시한 뒤 새 분석을 비동기로 생성한다. stale 메타데이터는 검색 오염을 막기 위해 새 분석 완료 전 랭킹을 낮춘다.

## 9. 여러 탭과 기기 충돌

저장 요청에는 편집을 시작한 `base_version`을 포함한다.

```text
base_version = server.current_version
→ 저장 성공

base_version < server.current_version
→ 자동 덮어쓰기 금지
→ 내 변경 / 서버 변경 비교
→ 병합, 내 버전 사본 저장, 서버 버전 유지 가운데 선택
```

개인용 제품이므로 MVP에서 CRDT와 실시간 공동 편집은 도입하지 않는다. 데이터 유실을 막는 낙관적 버전 검사부터 구현한다.

## 10. 첨부와 붙여넣기

### 두 가지 첨부 역할

- `capture attachment`: 캡처 원본과 근거로 보존되는 파일
- `inline attachment`: 본문 안의 특정 위치에 배치된 표현

같은 R2 원본을 두 역할이 참조할 수 있다. 본문에서 이미지를 지워도 원본 attachment를 즉시 삭제하지 않는다.

### 업로드 UX

- 붙여넣는 즉시 로컬 placeholder 표시
- 업로드 진행률과 재시도
- 성공 후 안정된 attachment ID로 치환
- 이미지 alt text와 선택적 caption
- 원본 열기
- 업로드 실패 중에도 본문 텍스트 저장

### 외부 HTML 붙여넣기

1. Clipboard HTML sanitize
2. 지원하는 제목·문단·목록·링크·표·강조를 Markdown으로 변환
3. 추적 script·inline style 제거
4. 원본 URL과 캡처 시각을 source metadata로 보존
5. 사용자가 원하면 `서식 없이 붙여넣기` 제공

## 11. 화면 구성 원칙

- 본문 주변에 카드 테두리를 반복하지 않는다.
- 도구막대는 선택 상태나 `/` 명령 때만 확장한다.
- selection toolbar와 slash menu는 서로 다른 command 체계를 만들지 않고 같은 action registry를 사용한다.
- AI 대화 패널을 항상 열어 두지 않는다.
- 메타데이터와 revision은 오른쪽 inspector 또는 모바일 bottom sheet에 둔다.
- 사용자 입력이 아닌 구조화 값에는 `원문에서 추출`, `이미지에서 읽음`, `외부 출처`, `AI 해석`의 의미적 출처를 지속적으로 표시한다.
- `조용히`, `균형`, `안내 중심`의 안내 밀도는 사용자가 선택하며 시스템이 작성 습관만 보고 자동 변경하지 않는다.
- 저장 상태는 `저장 중`, `저장됨`, `오프라인`, `충돌` 네 가지 사람이 읽을 수 있는 상태로 표시한다.
- 글자 수보다 revision과 저장 안전 상태를 우선 표시한다.
- 한국어 IME 조합 중에는 단축키 제출이나 자동 변환을 실행하지 않는다.
- focus mode와 시각 문서·소스·읽기 mode 전환 뒤 cursor·selection·scroll을 복원한다.

## 12. 편집기 기술 스파이크

Milkdown 구현을 다음 자료로 검증한다.

1. 긴 에세이
2. 여러 연으로 된 시
3. 중첩 목록과 작업 목록
4. 표와 각주
5. 이미지 여러 장
6. `lighthouse://` 내부 링크
7. 웹페이지 HTML 붙여넣기
8. 기존 Markdown import

통과 조건:

- Markdown 왕복 후 의미 손실 없음
- 한국어 IME 입력 오류 없음
- 시의 행·연 보존
- 이미지 업로드 실패가 본문 저장을 막지 않음
- 내부 링크 label 변경과 ID 연결 유지
- 5만 자 문서에서 실사용 가능한 반응성
- 모바일 selection·붙여넣기 기본 동작
- 키보드만으로 핵심 편집 가능

치명 실패가 두 번 이상 재현되고 Milkdown plugin으로 합리적으로 해결되지 않을 때만 Tiptap 비교 구현으로 전환한다.

## 13. Editor MVP

### 포함

- Markdown 정본
- 시각 문서 / 소스 / 읽기 모드
- 자동 저장과 복구
- 불변 revision과 비교
- 버전 충돌 보호
- 이미지 붙여넣기·업로드
- 제목, 목록, 인용, 코드, 표, 각주
- 내부 문서·개체 링크
- 시 hard break 지원
- focus mode
- selection toolbar와 intent-based slash menu
- 내부 record·entity link와 정확한 backlink context 이동
- AI diff 승인

### 이후

- 공동 편집
- 댓글과 제안 모드
- 수식·다이어그램
- 다단 레이아웃
- 출판용 테마
- AI 연속 공동 집필
- CRDT
