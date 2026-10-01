<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Light House web 작업 범위

저장소 [루트 지침](../../AGENTS.md)과 [현재 상태](../../Docs/V2/CURRENT_WORK_STATE.md)를 따른다. 위 Next 관리 블록은 설치 패키지가 유지하므로 수정/삭제하지 않는다. 관련 Next API 가이드만 확인하며 전체 bundled docs를 읽는 시작 의식으로 확장하지 않는다.

- 현재 앱은 npm workspace `@light-house/web`다. Next/React/TypeScript 버전은 이 폴더의 `package.json`과 설치 패키지에서 확인한다.
- V2 구현은 `src/lib/v2`, `src/components/v2`, `src/app/v2`, `src/app/api/v2`에 있다. legacy 코드는 필요한 호환/격리 경계에만 손댄다.
- 관련 계약 검사는 저장소 루트에서 `npm run test --workspace @light-house/web -- --maxWorkers=1 <test-path>`로 선택 실행한다. 경로는 이 앱 폴더 기준이다. 전체 검증은 root의 자원 창과 조율한다.
- 라우트가 바뀌면 `npm exec --workspace @light-house/web -- next typegen` 후 `npm run typecheck --workspace @light-house/web`를 실행한다. lint는 수정 파일부터, 통합 시 전체를 확인한다.
- Worker package는 루트에서 `npm run build:worker --workspace @light-house/web`의 secret-safe wrapper로 만든다. wrapper를 우회하는 직접 OpenNext build를 사용하지 않는다. `.env.local` 값을 로그/문서/명령 인자로 노출하지 않는다.
- dev/Playwright/typegen/build는 한 소유자만 실행한다. 실행 전 기존 핸들·포트를 확인하고 생성물 경쟁 때문에 생긴 실패를 제품 결함이나 성공으로 오인하지 않는다.
- 테스트 대역·합성 화면·로컬 D1/R2는 실제 Gemini·원격 Cloudflare·실기기 검증을 대신하지 않는다.
