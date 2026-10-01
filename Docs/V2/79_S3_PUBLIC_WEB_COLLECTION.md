# S3 공개 URL의 제한 수집과 원문 보관

2026-09-23. 범위: [76번 인계](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 S3 중 **서버가 정확히 허용한 일반 공개 웹 호스트의 텍스트 수집**과 Threads·Instagram의 URL/사용자 입력 보존 및 수동 보완이다. 일반 웹 임의 도메인과 SNS 자동 원문 확보는 완료 범위가 아니다.

## 사용자 흐름과 출처 경계

1. Capture에서 URL과 사용자 메모를 먼저 보관한다. `manualLinkV1`의 URL·목적·역할은 사용자 제공 정보로 남고, 수집 실패가 이를 지우거나 AI 작업을 시작하지 않는다.
2. Record의 링크 정리에서 일반 웹 URL-only 자료를 명시적으로 선택해 `/api/v2/records/[recordId]/links/collect`로 수집한다. 서버는 소유자·Capture·현재 revision/snapshot 버전과 URL 원본을 확인한 후에만 외부 요청을 시도한다. restricted 기록은 수집하지 않는다.
3. 읽은 텍스트가 있으면 별도 immutable `v2_source_items`에 원문으로 저장하고 `publicFetchV1`에 요청 URL·최종 URL·확보 시각·MIME·추출 방식을 기록한다. `v2_link_snapshots`의 새 버전은 `acquisition_method=public_fetch`, 확보 상태와 제한 사유, source manifest hash를 보관한다. 기존 URL source와 이전 snapshot은 수정하지 않는다. 재수집이 성공하면 현재 선택본에서 같은 URL의 이전 확보 텍스트를 새 텍스트로 교체하고 이전 버전은 이력에 남긴다.
4. 차단·로그인벽·미허용 호스트·타임아웃·지원하지 않는 형식은 새 원문을 만들어내지 않는다. `needs_input` 또는 `unavailable` snapshot에 사유 코드를 보관하고 사용자에게 직접 붙여넣기·첨부를 안내한다. 실패한 재수집은 앞서 확보한 원문을 현재 선택본에도 유지한다.
5. Record는 사용자 제공 원문, 공개 웹에서 읽은 텍스트, AI 추출을 구분한다. 복사는 **보관한 텍스트 문자열 그대로** 수행하며 HTML 페이지 전체나 보이지 않는 부분을 원문 확보로 주장하지 않는다. HTML의 표시 가능한 텍스트 추출은 항상 `partial`; `text/plain`은 받은 텍스트에 한해 `captured`이고 연결된 글·이미지·댓글 범위는 미확인이다.

Threads·Instagram URL은 자동 수집 버튼 없이 보존한다. 공식 [Meta Embeds 저장소](https://github.com/facebook/meta-embeds-for-wordpress/blob/main/readme.txt)의 oEmbed는 미리보기/임베드 경로이며, 게시물 본문·이미지 파일·댓글·작성자 이어쓰기의 보관 근거로 사용하지 않는다. [Threads API](https://www.postman.com/meta/threads/collection/dht3nzz/threads-api) 및 [Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)의 권한 있는 상세 자료 adapter는 이번에 연결하지 않았다. 사용자가 실제로 확인한 텍스트의 붙여넣기 또는 이미지·캡처 첨부가 대체 경로다.

## 외부 요청 경계

- `V2_PUBLIC_WEB_ALLOWED_HOSTS`는 서버 운영자가 지정하는 쉼표 구분 **정확한 호스트명**이다. 기본 빈 값은 외부 수집을 모두 거부한다. URL로 자동 추가하거나 wildcard/suffix로 넓히지 않는다. 이번 작업은 원격 설정을 변경하지 않았다.
- HTTPS·사용자 정보 없는 URL·기본 포트만 허용한다. IP literal·내부/특수 호스트를 거부하고 모든 A/AAAA 응답 주소를 공인 범위로 사전 검사한다. redirect는 자동 추적하지 않고 최대 3회, 매 hop 동일 조건과 정확한 호스트 허용을 다시 확인한다. Cookie/Authorization은 보내지 않고 `credentials=omit`이다.
- 총 8초 기본 제한(최대 10초), 100 KiB 본문 상한, UTF-8 `text/plain`/`text/html`만 허용한다. 초과·오류·로그인벽은 텍스트 없이 상태를 남긴다. 동적 렌더링, 미노출 이미지/댓글, 접속 차단을 우회하지 않는다.
- Worker의 `node:dns`는 [Cloudflare 문서](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/)에 따라 DNS 사전 검사에 사용한다. 이 검사와 Worker `fetch` 사이에서 실제 접속 IP를 원자적으로 고정한다는 보장은 없다. 따라서 임의 공개 도메인 수집은 별도 egress 설계가 필요한 미완료 범위다.

## 검증 범위

| 검사 | 결과 |
| --- | --- |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/public-web-fetch.test.ts tests/contract/v2/public-web-collection-route.test.ts` | 합성 resolver/transport와 실제 FK ON SQLite HTTP 경계 **33 PASS, exit0**. 허용 호스트·redirect·사설 DNS·MIME·크기·시간·로그인벽 및 URL/메모 보존과 AI 무호출을 확인했다. |
| `npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/public-web-collection.test.ts` | 실제 로컬 Workerd D1·FK ON **7 PASS, exit0, 59.09초**. immutable source/manifest, 성공·실패 재수집 이력, owner/restricted, idempotency, CAS 직전 경합의 전체 rollback을 확인했다. |
| `npm exec --workspace @light-house/web -- playwright test tests/e2e/v2-public-web-collection-ui.spec.ts` | desktop/mobile 합성 API 화면 **4 PASS, exit0**. 차단→부분 확보→재수집 표시와 SNS 수동 경계를 확인했다. 실제 사이트 fetch는 수행하지 않았다. |
| `npm exec --workspace @light-house/web -- next typegen`; `npm run typecheck --workspace @light-house/web`; 변경 S2/S3 TS·TSX·시험 scoped ESLint | 각 exit0. 새 수집 route type을 포함한다. |
| `npm run build:worker --workspace @light-house/web` | **exit0**, OpenNext Worker 생성과 safe build 검사 `audited_files=6665`, `secret_hits=0`. Windows OpenNext 호환성 및 Next middleware 경고는 있었다. 원격 운영 확인은 아니다. |
| 기존 링크 저장·분석 회귀 | snapshot foundation18, presentation22, analysis request23 PASS. 백업 fixture migration 상한이 0031에 머문 초기 실행에서 portability suite 9 SKIP 및 manual-link 저장 2 FAIL(`v2_link_curation_revisions` 미생성)이었다. 0032로 fixture를 맞춘 2026-09-28 재실행: manual-link 7 PASS, public-web-collection 8 PASS(문서 기록 뒤 추가된 백업 시험 1건의 export 메타 열 비교 단정을 부분 일치로 수정), link-snapshot-portability 9 PASS(739.7초; 0032로 복원 단계가 늘어 단독 184초가 걸린 시험 1건의 제한을 180→300초로 조정, 단정 불변). |

이번 증거는 허용 호스트에 대한 실제 공개 사이트 접근 성공, Threads/Instagram 자동 확보, 임의 도메인 DNS rebinding 방어, 전체 웹 페이지/연속 글·이미지 coverage, 원격 배포를 증명하지 않는다. 새 migration은 없고 기존 0031 source/snapshot 및 백업 경로를 사용한다.

## 2026-09-29 사용자 결정

Threads·Instagram은 자동 수집하지 않고 URL 보관과 직접 붙여넣기·첨부로 운영한다. 서버 수집 차단 도메인에 `instagr.am`, `cdninstagram.com`, `fbcdn.net`을 추가했다. 운영자 허용 목록에 넣어도, 리다이렉트로 도달해도 네트워크 요청 없이 `unsupported_provider`/`redirect_blocked`로 끝난다(`tests/contract/v2/public-web-fetch.test.ts` 40 PASS, route 2 PASS). Meta API adapter는 만들지 않는다.
