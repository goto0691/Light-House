# 36. I2 Authoring and Library Evidence

> 상태: coded vertical slice 완료 · private account promotion gate 대기  
> 검증일: 2026-08-12

## 구현 결과

- 실제 `/v2/library`: normal은 짧은 본문 preview, sensitive는 제목만, restricted는 제목·본문·version·작성일을 보내지 않는 행 projection
- desktop list+Peek, Arrow Up/Down·Space·Enter·Esc, mobile 고정 bottom navigation
- 실제 `/v2/records/{id}/edit`: Milkdown 시각 문서, CodeMirror Markdown, 읽기 모드가 하나의 `body_markdown` 사용
- 1.2초 autosave와 Ctrl/Cmd+Enter 저장, IME composition 중 저장 차단
- `expectedVersion`+`expectedRevisionId` optimistic concurrency
- 경쟁 저장은 한쪽만 current로 승격하고 다른 편집은 `fork` immutable revision으로 보존; UI는 자동 저장을 중지하고 최신본 열기를 요구
- title, written time, document status, privacy를 같은 revision transaction에서 저장
- password 재인증 뒤 current session에만 10분 유효한 restricted grant; HTTP-only token의 SHA-256만 D1 저장
- user-scoped committed attachment 조회 뒤 private R2 stream으로 `원본 열기`; 공개 URL 없음

## Migration과 API

- `migrations/0007_v2_document_authoring.sql`
- `POST /api/v2/records/{id}/revisions`
- `GET /api/v2/records`
- `POST|DELETE /api/v2/auth/restricted-grants`
- `GET /api/v2/attachments/{id}`

## 검증

`document-authoring.test.ts` 6건은 revision 원자성, idempotent replay, 동시 충돌 fork, idempotency payload conflict, 과거 본문 재사용 이력 보존, privacy별 Library projection을 실제 workerd D1에서 확인한다. 실제 편집기 Playwright는 autosave 성공과 409 conflict 이후 추가 자동 overwrite가 없음을 확인한다.

I2 coded gate는 완료했지만 실제 owner 계정 재인증·R2 stream과 copied staging migration은 private deployment 승격 전 gate로 남는다.
