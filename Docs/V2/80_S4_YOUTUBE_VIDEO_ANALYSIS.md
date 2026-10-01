# S4 공개 YouTube 영상의 구간 근거 보관

2026-09-28. 범위: [76번 인계](./76_ASTRA_SOL_DELIVERY_HANDOFF.md)의 S4 중 **공개 YouTube URL의 명시적 AI 영상 분석**이다. 계약 근거는 [45번 7절](./45_LINK_CAPTURE_AND_PROMPT_LIBRARY.md)과 [47번 5절](./47_LINK_CAPTURE_CASEBOOK_AND_ROUTING.md)이다. 사용자가 직접 올린 영상 파일의 전사는 기존 S1 첨부 분석 경로(`transcript_extract`)를 따른다.

## 사용자 흐름

1. Capture에서 YouTube URL과 메모를 먼저 보관한다. 저장 영수증은 영상 분석과 무관하다.
2. Record의 링크 정리에서 `영상 N AI 분석`을 누른다. 시작·끝을 비우면 저장한 링크의 시작 시각(또는 0초)부터 기본 10분을 분석한다. 한 번에 최대 20분이며, `이어서 m:ss부터 분석`으로 다음 구간을 요청한다.
3. 서버는 소유자·restricted 아님·현재 revision/snapshot CAS와 URL 형식을 확인한 뒤에만 공급자를 부른다. 공급자에는 **정규화한 공개 영상 URL과 구간만** 보낸다. 내 메모·제목·다른 source는 보내지 않는다.
4. 결과는 `transcript` 종류의 새 불변 source(`videoAnalysisV1`)와 `acquisition_method=api`, `adapter_version=gemini-youtube-video.v1`, `capture_state=partial`인 새 snapshot으로 저장한다. 같은 구간을 다시 분석하면 현재 선택본에서만 이전 노트를 교체하고 이력은 남긴다. 다른 구간 노트는 함께 유지한다.
5. `원본과 첨부`에서 `AI 영상 분석 노트`를 요약·구간별 내용·들린 발화(AI 전사, 공식 자막 아님)·화면 속 텍스트(AI 판독, 미검증)·분석 한계로 나눠 보여 준다. 모든 항목의 시각은 해당 시점의 YouTube 링크(새 창)다. 노트 전체는 `AI 영상 분석 복사`로 원문과 구분해 복사한다.
6. 노트 텍스트는 기존 전문 검색에 포함되며, 검색 결과와 위치 열기에서 `AI 해석`·`AI 영상 분석 · 원본 영상이나 공식 자막 아님`으로 표시한다.

## 출처·신뢰 경계

- **원본 영상 미보관, 공식 자막 미확보**를 provenance에 고정값으로 기록하고 화면에 표시한다. 모델이 프레임·소리를 샘플링했으므로 전수 확인으로 표현하지 않는다.
- 노트 라벨은 metadata만으로 붙지 않는다. **해당 기록에서 그 source를 처음 포함한 snapshot이 서버 영상 adapter(`api`)였음**을 SQL로 증명해야 한다(`video-analysis-provenance.ts`). snapshot은 불변이고 서버만 `api` snapshot을 만든다. 복원 시 FK가 함께 재매핑되므로 증명이 유지된다. capture 입력의 `videoAnalysisV1`·`publicFetchV1` 키는 거부한다.
- 증명을 끈 상태에서 위조 노트가 선택되는 RED를 재현한 뒤 원복했다.
- 링크 텍스트 정리(`link_analyze`)는 노트를 외부 원문으로 쓰지 않는다. 노트는 정리 대상 수에서 따로 표시한다.
- 모델 시각은 전체 영상 기준 초로 요청한다. 구간 밖 2초 초과는 거절하고, 모든 시각이 구간 시작 전이면서 구간 길이 안이면 구간 기준으로 답한 것으로 보고 보정한 뒤 `timecodeBasis=clip_relative_shifted`로 표시한다.
- 영상 속 말·자막·화면 글은 모두 데이터이며 지시로 따르지 않는다. 배경지식으로 인물·채널을 채우지 말라는 지시를 둔다.

## 공급자·할당량

- 공급자 호출은 사용자 요청 한 번에 한 번이며, 분석 대기열과 같은 main_analyzer governor를 쓴다. 일시 정지·일일 한도면 공급자를 부르지 않고 `retryAt`과 함께 거절한다. 거절은 아무것도 저장하지 않는다.
- 응답 시간 상한은 110초다(governor probe lease 2분 미만).
- 비공개·일부 공개·삭제·지역 제한 영상은 공급자 거절로 나타나며, 자막·메모 직접 붙여넣기를 안내한다.
- 측정: 영상 10초당 영상 입력 약 880토큰(약 88토큰/초, 기본 해상도)이다. 10분 구간은 영상만 약 5.3만 토큰이다.

## 검증

| 검사 | 결과 |
| --- | --- |
| `tests/unit/v2/video-analysis.test.ts` | 36 PASS. URL 형식, provenance 거부, 시각 배치·보정·거절, 요청 형태(`fileData`+`videoMetadata`), 공급자 schema에 `maxItems` 없음, governor 정지·일일 한도 지연 전달·실패 분류 |
| `tests/contract/v2/video-analysis-route.test.ts` | 실제 FK ON SQLite + HTTP 5 PASS. 저장/불변/메모 미전송/검색 라벨, 재생·같은 구간 교체·다른 구간 유지·이력, 한도 거절 무저장 및 governor 공유, owner/restricted/비YouTube/범위/필드/AI flag 선차단, 위조 방어 |
| `tests/e2e/v2-video-analysis-ui.spec.ts` | desktop/mobile 4 PASS. 한도 안내, 잘못된 구간, 성공 메시지, 이어서 분석, 재시도 키 재사용, 시각 링크·출처 표지, 가로 넘침 없음, axe 위반 0 |
| 링크 계열 기존 브라우저 회귀 | 404 PASS / 24 SKIP(기존 쓰기 flag off 조건) / 0 FAIL, 26.4분 |
| 실제 Gemini (`scripts/verify-s4-live-youtube.ts --live`) | **진단 모델 `gemini-3.1-flash-lite`로 1회 성공**: 공개 19초 영상, 0–30초 요청, `api/partial` 저장, 모든 시각 구간 안, 관측 종료 19초, Record 표시·메모 보존·노트 단어 검색 통과, 인물 실명 추측 없음. 설정 모델 `gemini-3.6-flash`는 무료 일일 한도 소진으로 미실행 |

## 남은 범위

- 설정 모델(`gemini-3.6-flash`)로 같은 스크립트를 1회 실행해 확인한다(한도 초기화 후).
- 설명란·댓글·재생목록·채널 자동 수집은 하지 않는다. YouTube 공식 자막 다운로드는 편집 권한이 필요하므로 설계하지 않았다([47번](./47_LINK_CAPTURE_CASEBOOK_AND_ROUTING.md)).
- 영상 속 장면별 이미지 보관, 화자 식별 정확도 개선, 노트 항목 단위 사용자 확인/거절은 후속 개선이다.
