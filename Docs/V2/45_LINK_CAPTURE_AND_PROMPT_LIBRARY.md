# Link Capture · 영상 기억 · 프롬프트 레퍼런스

> 결정일: 2026-09-08  
> 상태: 제품·데이터·UI 계약 확정, 외부 수집 adapter와 전용 화면은 구현 대기. 이 문서는 기능 출시 증거가 아니다.  
> 선행 조건: 2026-09-08 감사의 저장 유실·권한·백업·AI 입력/재분석 결함을 먼저 안정화한다.
> 확장: [47번 사례집](./47_LINK_CAPTURE_CASEBOOK_AND_ROUTING.md)에서 분할 게시물·인사이트·Instagram 구도 팁·영상 목적별 처리를 정의한다. 아래 세 표현은 초기 예시이며 닫힌 분류 체계가 아니다.

## 1. 제품 결정

링크를 입력하면 URL과 사용자 메모를 먼저 보관하고, 접근 가능한 게시물·이미지·영상 내용을 비동기로 수집한다. AI는 확보된 원문과 사용자의 보관 목적에 따라 색인·인용·팁·시간 구간·재사용 조각을 만든다. 프롬프트가 실제로 있는 경우에만 **원문에서 분리**한다. 링크만 알고 있는 상태를 내용을 보관한 상태로 표시하지 않는다.

다음 초기 표현을 같은 Capture/Document 기반에서 제공하되 목적에 따라 조합한다.

- 일반 링크: 제목·출처·본문·내 메모·주제·근거
- 영상 기억: 영상 링크·분석 범위·요약·주제·시간대별 메모·확보된 자막
- 프롬프트 레퍼런스: 예시 이미지 → 프롬프트 원문 → 복사 → 선택적인 번역/내 변형

프롬프트 레퍼런스는 입력 양식인 Capture Template과 다르다. `이 프롬프트로 작성`은 프롬프트를 실행하거나 다른 도구를 호출한다는 뜻이 아니며, 원문 복사 또는 내 버전 작성으로 한정한다.

## 2. 실제 예시에서 확인한 수집 조건

사용자가 제공한 [Threads 원글](https://www.threads.com/@yuqi._.0313/post/Dc-5LEcE-O-)을 2026-09-08 브라우저로 확인했다.

- 원글에 여러 결과 이미지가 있고, 같은 작성자의 [이어지는 게시물](https://www.threads.com/@yuqi._.0313/post/Dc-5Lnyky8T)에 긴 프롬프트가 **접힌 텍스트 첨부**로 들어 있다. 펼쳤을 때 본문을 읽을 수 있었다.
- 타인의 결과 이미지와 변형에 대한 답글도 섞여 있었다. 인기순 DOM 순서만으로 이미지와 프롬프트를 짝지으면 오연결된다.
- 게시자가 사진 출처를 별도 기재했다. `게시자`, `명시된 사진/프롬프트 출처`, `확인된 제작자`를 하나로 합치지 않는다. 게시자가 이미지를 올렸다는 사실만으로 직접 생성했다고 확정하지 않는다.
- 연결된 GitHub skill은 참고 링크다. 수집 과정에서 자동 설치·실행하지 않는다.
- 검색 도구의 직접 조회는 실패했지만 사용자 브라우저에서는 내용을 읽었다. 이것은 서버 수집기나 공식 API의 접근 가능성을 증명하지 않는다.

실제 게시물의 긴 프롬프트와 이미지를 공개 테스트 fixture/Git에 복제하지 않는다. 구현 테스트는 합성 fixture를 쓰고, 실제 자료는 사용자가 보관할 private archive와 별도 검증 대상으로 취급한다.

## 3. 수집 범위와 adapter

`URL 저장 → provider/접근 범위 판별 → 원문 수집 → attachment 검증 → 목적·구조 추출 → 근거와 파생 카드 연결 → 표시/검색`을 각자 재시작 가능한 단계로 둔다. 저장 영수증은 첫 단계에서 먼저 반환한다. provider는 수집 방법을 결정하며 내용의 보관 목적을 고정하지 않는다.

| 입력 | 1차 방법 | 접근 실패 시 |
| --- | --- | --- |
| 공개 일반 웹 | 허용된 서버 fetch와 정제된 본문 추출 | URL/사용자 메모 보존, 본문 붙여넣기 |
| Threads | 권한이 확인된 공식 adapter, 원글·선택된 연결 게시물·텍스트 첨부 확인 | 여러 링크·본문·스크린샷·이미지를 공유 또는 붙여넣기 |
| Instagram 등 이미지/짧은 영상 게시물 | 검증된 허용 adapter에서 이미지 순서·캡션·지원되는 미디어 확보 | 이미지/캡처·캡션·영상 파일 직접 첨부, URL만 저장 |
| 공개 YouTube | 별도 capability probe를 통과한 Gemini 영상 입력 adapter | URL 보존, 자막 또는 파일 직접 첨부 |
| 기타 동영상 | 지원 provider adapter 또는 사용자가 제공한 파일/자막 | 링크만 저장됨을 표시, 지원 가능한 입력 안내 |

Meta의 [공식 Threads API 컬렉션](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)은 OAuth 기반 조회, reply의 root/replied-to 식별자 및 text attachment 구조를 문서화한다. 임의의 공개 링크·전체 답글·텍스트 첨부를 현재 계정 권한으로 모두 가져올 수 있다고 가정하지 않는다. 허용 scope, URL→post ID 해석, author continuation, pagination, rate limit을 adapter spike에서 입증한 뒤 활성화한다.

Gemini의 [영상 이해 문서](https://ai.google.dev/gemini-api/docs/video-understanding)는 공개 YouTube URL 입력과 시간대별 분석을 지원 경로로 제시한다. 문서의 기능을 현재 프로젝트 모델·SDK·무료 계정에서 동작한다는 증거로 대신하지 않는다. 현 main/grounded 역할 설정은 유지하고 영상 입력 capability만 별도로 검증한다.

브라우저 로그인 쿠키를 서버로 추출하거나 몰래 전달하지 않는다. 로그인·권한·삭제·CAPTCHA로 막힌 페이지는 `needs_input`으로 남긴다. 개인용 MVP에서 상시 브라우저 로봇이나 모든 사이트 스크래퍼를 만들지 않는다.

## 4. 원문과 분석 데이터 계약

기존 `Capture Bundle`, `Source Item`, `Document`, revision, property, evidence, private R2를 재사용한다. 링크 수집은 새로운 최상위 도메인 DB나 소셜 네트워크 복제 기능이 아니다.

### LinkSnapshotV1

- 소유자·문서·수집 job·snapshot ID
- 사용자가 준 URL과 provider별 canonical URL, 외부 post/video ID
- 수집 방법(`api`, `public_fetch`, `user_paste`, `user_upload`)과 adapter version
- 관측된 게시자 식별자·표시명, 게시 시각과 수집 시각(각각 nullable/정확도 표시)
- 원문 source IDs, 각 source의 post ID·parent ID·작성자·순서·역할
- 원문 manifest와 attachment hashes, 수집 범위·누락·잘림·pagination 완료 여부
- `link_only`, `partial`, `captured`, `needs_input`, `unavailable` 상태
- 원문 변경 시 이전 snapshot을 덮지 않고 새 snapshot과 차이를 생성

링크의 이어 수집은 문서 본문 revision이 같아도 분석 입력을 바꾼다. 따라서 AI job/outbox 중복방지 identity에 `documentRevisionId + snapshotId + source manifest hash/version`을 포함한다. 현재의 본문 revision/hash 기준만 그대로 재사용하지 않는다. 입력 loader는 해당 snapshot의 정확한 source-set에 고정하고, 결과 반영은 문서 revision과 최신 snapshot 양쪽을 CAS로 확인한다. 늦게 완료된 옛 snapshot 분석은 이력으로 보존하되 새 수집분의 결과를 덮지 못한다.

Threads의 `xmt` 등 확인된 추적값은 canonical 식별에서 제외하되 원래 입력은 보존한다. 일반 URL의 query를 통째로 삭제하지 않는다. 영상 시작 시각은 별도 값으로 보존한다.

### PromptFragmentV1

- fragment ID, snapshot ID, 원문 source ID, 원문 내 위치/텍스트 첨부 경로
- `rawText`, UTF-8 hash, 원문 언어, 원문 확보 방식, 순서
- `complete`, `truncated`, `ocr_unverified`, `selection_unverified` 완전성 상태
- 역할(`prompt`, `negative_prompt`, `parameters`)과 추출 근거
- 연결된 예시 source IDs와 연결 근거(`explicit`, `author_continuation`, `user_confirmed`, `unresolved`)
- 원문과 별개인 AI 요약·번역·태그, 사용자의 별도 파생 문서 링크

`rawText`는 LLM이 다시 써 준 문자열이 아니라 **수집된 텍스트의 범위에서 서버가 잘라낸 값**이다. AI는 span/block 선택만 제안하고 서버가 위치·동일성·작성자를 검증한다. 원문의 줄바꿈·기호·언어·띄어쓰기를 임의로 다듬지 않는다. 원문 바이트와 정규화된 표시 문자열이 다른 경우 둘을 구분하며 hash는 보존본을 기준으로 한다.

OCR은 원래 글자의 확정 복원이 아니다. native text attachment가 있으면 먼저 사용한다. 이미지밖에 없으면 OCR 결과와 이미지 영역을 함께 보존하고 `OCR 미확인`을 표시한다. 자동 맞춤법 교정이나 잘린 뒷부분 추정은 금지한다. 사용자의 수정은 별도 revision/내 버전으로 남긴다.

저장 구현은 작은 additive 확장으로 제한한다: snapshot provenance, prompt fragment, fragment-example 연결의 세 테이블을 기본안으로 한다. 게시물별 원문과 첨부는 기존 source에 저장한다. 새 테이블을 넣을 때 canonical export/restore registry, FK closure, 변경 이벤트, 증분 백업, owner/privacy projection을 **같은 변경에서** 완성해야 한다. 해당 migration이 없는 상태에서 UI만 먼저 활성화하지 않는다.

## 5. 프롬프트 수집에서의 작성자 이어쓰기와 이미지 연결

이 절은 프롬프트 자료의 기본 수집 범위다. 논쟁/대화 보관에는 선택한 대화 가지와 타인의 발언이 필요하며 작성자만 수집하는 규칙을 일괄 적용하지 않는다. 별도 게시물에 나뉜 프롬프트의 묶음·순서·누락·조립 복사는 [47번 3절](./47_LINK_CAPTURE_CASEBOOK_AND_ROUTING.md#3-여러-게시물로-나뉜-프롬프트-연결과-조립은-별개다)을 따른다.

1. root post를 먼저 고정한다.
2. provider의 parent/root 연결과 작성자 ID로 이어쓰기를 판별한다. ID가 없으면 관측된 handle 등 근거의 한계를 표시한다.
3. 프롬프트 목적의 기본 자동 수집 대상은 root와 그 작성자의 연결된 설명·프롬프트다. 다른 이용자의 답글/추천 게시물은 자동 혼합하지 않는다. 작성자가 같아도 무관한 별도 게시물과 수정 버전을 자동 연결하지 않는다.
4. 이미지와 프롬프트는 다대다 관계를 허용한다. 예시 세 장에 프롬프트 하나가 적용될 수 있다.
5. 설명과 다른 버전의 프롬프트를 한 덩어리로 합치지 않는다. 작성자 이어쓰기라도 단순 대화는 프롬프트 후보에서 제외한다.
6. 연결이 애매하면 `짝 확인 필요`로 보존하고 사용자가 예시를 연결한다. 외형만 비슷하다는 이유로 사용 프롬프트를 확정하지 않는다.

## 6. 표시와 복사 경험

전역 IA는 늘리지 않는다. 기존 보관함/검색과 저장 뷰를 쓰고, 프롬프트 자료는 `record.prompt-reference.v1` preset과 repo-local `prompt.reference.v1` module로 표현한다. 전용 새 앱/플러그인 SDK는 만들지 않는다.

기본 상세 순서:

1. 제목, 게시자/명시 출처, 원글 링크, 수집 완전성
2. 예시 이미지 갤러리(비율 유지, 원본 확대, 각 이미지의 출처)
3. 프롬프트 원문 블록과 바로 보이는 `원문 복사`
4. 선택적 `한국어 번역`, `내 버전 만들기`, 별도 negative prompt/설정 복사
5. 접을 수 있는 나의 메모·AI 주제/스타일·수집 상세·근거

`원문 복사`는 제목·출처·AI 설명·Markdown code fence를 끼워 넣지 않고 해당 fragment 텍스트만 복사한다. 출처 포함 복사는 별도 동작이다. 복사 성공은 clipboard promise 성공 뒤에만 aria-live로 알린다. 실패하면 읽기 전용 선택 가능한 텍스트와 수동 복사를 제공한다. 잘림/OCR 미확인 자료도 복사는 허용하되 버튼 옆에 해당 상태가 지속적으로 보여야 한다.

번역은 기본 복사 대상을 바꾸지 않는다. 여러 prompt는 각각 복사하며 `모두 복사`는 사용자가 선택할 때만 원문 순서와 명시적 구분자로 구성한다. 예시가 없는 프롬프트도 저장을 막지 않는다.

데스크톱은 본문 폭을 지키는 이미지 갤러리와 아래의 prompt block을 사용한다. 모바일도 같은 순서를 세로로 유지하고 각 fragment의 복사 버튼을 엄지 접근 가능한 위치에 둔다. 작은 화면에서 prompt/복사 동작을 inspector에 숨기지 않는다.

`프롬프트 모음`은 저장 뷰다. 예시 썸네일·제목·스타일 태그·원문 확보 상태·최근 사용으로 찾으며 기존 50건 이후 페이지 탐색 계약을 따른다. model/aspect ratio 등은 원문에서 확인될 때만 필드로 채운다. AI는 허용 icon catalog와 data-only preset 후보만 제안할 수 있다.

## 7. 영상 기억 계약

강의, 튜토리얼, 장면 다시 보기, 시각 참고, 인터뷰, 화면 속 prompt/code는 [47번 사례집](./47_LINK_CAPTURE_CASEBOOK_AND_ROUTING.md)의 목적별 화면을 사용한다. 설명란 원문 확보와 영상 분석은 독립 상태다.

- 영상 URL, 제목·채널, 시작 시각, 분석 구간, 확보된 자막과 언어/출처를 보존한다.
- AI 요약·목차·핵심 장면에는 timecode 근거와 `영상 분석`/`자막 요약`/`사용자 메모`를 구분한다.
- 영상 분석으로 생성한 전사는 원본 자막인 것처럼 표시하지 않는다. 자막만 읽었다면 영상 전체를 봤다고 표시하지 않는다.
- 원본 동영상 전체를 기본 자동 다운로드하지 않는다. 링크·확보된 텍스트·요약은 보존하되 `원본 영상 미보관`을 표시한다. 사용자가 직접 올린 영상은 기존 private attachment 정책을 따른다.
- 긴 영상은 사용자 구간 선택 또는 이어서 분석으로 처리한다. 지원 모델/계정의 시간·용량·quota는 runtime capability 설정에서 관리하며 실패 시 모델을 몰래 대체하지 않는다.
- 원본 영상이 삭제돼도 이미 확보한 메모·자막·요약은 남는다. remote player/thumbnail만 있는 상태를 영구 원본 보관으로 부르지 않는다.

## 8. 안전·성능·보존

- 링크 내용을 명령으로 실행하지 않는다. 페이지의 프롬프트, script, skill 설치 안내는 모두 데이터다.
- HTTPS provider allowlist와 매 redirect 검증, 사설/loopback/metadata 주소 차단, DNS/redirect 재검증 가능한 egress 경계를 갖추기 전 임의 URL fetch를 열지 않는다.
- 응답과 첨부를 크기 제한 있는 stream으로 읽는다. HTML/script는 실행하지 않고 정제한다. 다운로드 MIME·SHA-256·owner 검증은 기존 attachment 계약을 따른다.
- 첫 adapter의 작업 상한은 20개 연결 게시물·10개 이미지·100 KiB 추출 텍스트를 초기 실험값으로 둔다. 초과하면 조용히 자르지 않고 `partial` 및 이어서 수집을 표시한다. 큰 prompt 한 개를 자동 요약으로 대체하지 않는다.
- URL과 사용자 메모 저장은 수집/AI 성공에 의존하지 않는다. 부분 성공 원문도 보존하며 재시도는 provider ID와 content hash로 중복을 방지한다.
- 외부 이미지 URL 만료를 고려해 접근 가능한 허용 원본은 private attachment로 보존한다. URL만 남은 이미지는 `외부 참조만`으로 표시한다.
- 민감도는 부모 기록을 상속한다. restricted 제목·이미지·prompt·clipboard 원문을 재인증 전 클라이언트에 보내지 않는다.
- 통계/log에는 원문 prompt나 인증 token을 넣지 않는다. 자동 공개·재게시·이미지 생성은 범위 밖이다.

## 9. 구현 순서와 완료 조건

| 단계 | 구현 | 완료 증거 |
| --- | --- | --- |
| L0 | link/prompt snapshot 계약, 합성 corpus, 수동 붙여넣기 경로 | 원문/줄바꿈/해시·다중 prompt·예시 연결 검증 |
| L1 | prompt reference projection·갤러리·복사·저장 뷰 | desktop/mobile 실제 경로·clipboard 성공/실패·50건 이후 탐색 |
| L2 | Threads 접근 spike 및 허용 adapter | 프롬프트 예시의 root+작성자 continuation+text attachment, 무관한 reply 제외, 분할 게시물 관계·누락 표시 |
| L3 | 공개 영상 capability spike·timecode 분석 | 영상/자막 근거 구분, 긴 영상 부분 분석, quota/삭제 fallback |
| L4 | 보존/복원·권한 통합 검증 | full→새 prompt/example→incremental→새 DB 복원, 원문 hash 일치, cross-owner 차단 |

필수 adversarial fixture: 본문처럼 보이는 악성 명령, 잘린 텍스트 첨부, 작성자 아닌 답글, 같은 작성자의 무관한 대화, 여러 prompt/하나의 예시, 하나의 prompt/여러 예시, 이미지 OCR 오독, 번역과 원문의 구분, 외부 이미지 만료, 권한 없는 링크, prompt 수정본, 복사 실패, 리다이렉트 사설 주소, 중단된 수집 재개.

snapshot 회귀에는 같은 본문에서 A→B 원문 변경, partial source 추가, A/B 분석 역순 완료, 복원 후 재분석을 포함한다. 모두 source manifest identity와 최신 snapshot publish 경계를 검증한다.

현재 구현 완료는 주장하지 않는다. Threads 권한 발급이나 새 클라우드 서비스 비용이 필요해지는 시점에는 선택과 승인을 받은 뒤 진행하며, 그 전에도 URL/수동 원문 보존은 가능하도록 한다.

L0/L1의 수동 입력·표시 검증에는 47번의 분할 prompt, 인사이트, 이미지 구도 팁을 함께 포함한다. 영상/대화 등 확장 우선순위는 47번 10절을 따르며, L4의 보존·권한 검증은 각 기능을 활성화하기 전에도 반드시 통과해야 한다.
