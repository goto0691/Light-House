# 83. Private Evaluator Foundation

> 상태: 오프라인 기록 관측 evaluator·비교·비공개 내용 없는 보고서 기반 구현
>
> 검증일: 2026-10-01
>
> 실제 private corpus·Gemini 실행·품질 통과·출시 승격은 미확인

## 1. 결과와 범위

[25번](./25_GOLDEN_CORPUS_AND_VALIDATION_HARNESS.md)의 누락된 `run.ts`·`compare.ts`를 오프라인 **기록 관측 비교** 범위로 구현했다. 기존 `expected-result.v1`과 manifest schema·검증 의미는 변경하지 않았다. 기존 validator의 YAML parse 두 곳만 경고 원문이 stderr에 나오지 않도록 `logLevel: silent`를 적용했다. 기존 expected 파일을 자동 마이그레이션하거나 `human_approved`로 바꾸지 않는다.

- `synthetic`: 저장소의 합성 fixture에서 실행. private readiness·실제 공급자 실행의 증거가 아니다.
- `private-recorded`: 현재 20개 source/expected의 준비 상태를 먼저 검사하고, 별도로 기록된 관측 파일을 승인된 expected와 비교한다. 공급자·검색·DB를 실행하지 않는다.
- **실제 Gemini 호출·응답 검증·운영 자격 증명·네트워크 경로가 없다.** 관측이 실제 모델에서 왔다는 자체 진술은 검증된 실호출 증거로 승격하지 않는다.
- app 실행 경로와 Vitest에는 추가하지 않았다. 원래 app 전체 회귀의 시험 개수에 합산하지 않는다. root `test:tools`는 기존 migration4개와 evaluator32개를 함께 실행한다.

파일:

| 경로 | 역할 |
| --- | --- |
| `tools/v2-eval/contracts.ts` | 엄격한 기록 관측 입력·해시 identity·지원 값 계약 |
| `tools/v2-eval/evaluator.ts` | 명시적 결정적 subset의 측정·unknown/failure 분리 |
| `tools/v2-eval/recorded-input.ts` | 현재 private readiness·snapshot 재검증·신규 보고서 쓰기 |
| `tools/v2-eval/report.ts` | 허용 목록 기반 보고서 검증·집계·promotion 차단 |
| `tools/v2-eval/run.ts` | 명시적 mode CLI |
| `tools/v2-eval/compare.ts` | 호환성 gate와 metric 차이 |
| `tools/v2-eval/evaluator.test.ts` | 격리 Node 합성·파일 경계 시험 |
| `tools/v2-eval/fixtures/synthetic-demo.json` | 합성 입력·기록 관측 예시 |
| `tools/v2-eval/fixtures/synthetic-demo.report.json` | 재현 가능한 내용 비포함 합성 보고서 |

## 2. 입력 identity와 provenance

기록 관측 계약 이름은 `recorded-evaluation-v1`이다. 기존 expected v1 전체의 자동 의미 해석 계약은 아니다.

관측 envelope:

```json
{
  "contract": "recorded-evaluation-v1",
  "mode": "synthetic 또는 private-recorded",
  "identity": {
    "build_sha": "40자리 소문자 Git SHA",
    "schema_sha256": "sha256:64자리 소문자 hex",
    "model_config_sha256": "sha256:64자리 소문자 hex",
    "prompt_sha256": "sha256:64자리 소문자 hex",
    "registry_sha256": "sha256:64자리 소문자 hex"
  },
  "corpus_sha256": "sha256:64자리 소문자 hex",
  "cases": []
}
```

- identity는 private 실행 때 `--identity`의 외부 지정 identity와 **전부 정확히 일치**해야 한다. 모델 이름·프롬프트·registry label을 보고서에 복사하지 않도록 설정 내용의 digest를 사용한다.
- digest는 실제로 사용한 설정/파일의 identity를 기록하는 책임을 호출자에게 남긴다. evaluator가 Git checkout·배포·실제 모델 설정을 자동 증명한다는 뜻은 아니다.
- `schema_sha256`는 분석/관측 의미를 결정하는 schema 집합의 digest다. evaluator 코드 의미를 바꿀 때는 `CONTRACT`를 버전 상승해야 한다.
- `corpus_sha256`는 `{corpus_id, expected}`의 정규 JSON SHA-256이다. object key는 정렬, case는 case ID로 정렬하며 expected 전체(승인 상태·원문 SHA·모든 자유 규칙 포함)를 해싱한다. expected 내부 배열 순서는 보존한다. `corpusDigest()`가 정본 helper다.
- corpus_id·원문 해시 목록·원문 경로·expected 내용은 보고서에 표시하지 않는다. 비교에 필요한 전체 corpus fingerprint만 표시한다.
- private corpus fingerprint를 준비하려면 승인된 private 환경에서 `loadPrivateCorpus(manifestPath)`를 사용한다. 반환 expected는 해당 환경 안에 유지하고 출력하지 않는다. 기록 생성 측은 같은 `corpusDigest()`를 사용해야 한다. 별도 공개 fingerprint/원문 export 명령은 없다.

case ID는 GC-01–20만 허용한다. 관측은 expected case 집합과 정확히 일치해야 하고 중복·누락·추가 case는 전체 실행을 차단한다. unknown property, raw response, provider error, 자체 선언 expected는 관측 envelope/case에 허용하지 않는다.

## 3. 이 버전의 결정적 subset

### 3.1 원문 hash 관측

expected의 `source_hashes`와 관측 case의 `source_hashes`를 순서 독립적인 **정확한 집합**으로 비교한다. 누락·추가·변조는 일치하지 않는다. 중복 관측 hash는 입력 오류다. 빈 expected hash 또는 관측 항목 누락은 unknown이다.

`source_hash_equality`는 **기록된 hash 값과 expected의 일치**다. 그 값이 실제 제품 저장소의 bytes에서 올바르게 채집됐음을 자동 검증하지 않는다. private readiness의 현재 로컬 source byte hash 검사와도 별개다. 따라서 이 metric 하나로 제품의 source loss 0이나 export/restore 성공을 선언하지 않는다.

### 3.2 exact typed value

기존 자유 `must_preserve` 안에서 아래의 **정확한 형태만** 지원한다. 새로 작성/수정한 private expected는 모델 실행 전 사람이 다시 승인해야 한다.

```json
{
  "exact_typed_value": {
    "id": "관측과 연결할 private 식별자",
    "value_type": "rating",
    "value": 4.5,
    "scale_max": 5
  }
}
```

관측의 `typed_values` 배열 원소는 내부 object와 같은 형태다. `id`는 case 안에서 유일해야 한다. 보고서에는 출력하지 않는다.

- 지원 `value_type`: `text`, `number`, `boolean`, `date`, `rating`
- text/date는 정확한 문자열, number/rating은 유한 JSON 숫자, boolean은 실제 boolean이다. unsafe integer는 거부한다. null을 빈칸·0·false로 바꾸지 않는다.
- `date`는 작성한 날짜/precision 문자열의 **정확 비교**일 뿐 날짜 해석·precision 허용 규칙을 판단하지 않는다.
- 선택 `unit`은 문자열의 정확 비교다. rating은 양수 `scale_max`가 필수이며 값은 0–scale_max 범위다. 다른 type의 scale_max는 허용하지 않는다.
- scale·단위·공백·출처를 추정하거나 수치/문자열을 변환하지 않는다. typed object 전체가 정확히 같아야 한다.
- 관측 collection 자체가 없으면 unknown, collection은 있지만 요구 id가 없으면 measured miss, 동일 id의 값/type/unit/scale 불일치는 fatal `USER_VALUE_OVERWRITE`다.
- 기존 예시의 `exact_user_rating`, `recommendation_context_contains` 같은 자유 키를 이 형태로 임의 추론하지 않는다. 미지원 키가 더 붙은 규칙도 부분 성공으로 인정하지 않는다.

### 3.3 accepted primary type aliases

`acceptable_variants.primary_type`의 비어 있지 않은 고유 문자열 배열만 지원한다. 관측은 `primary_types` 문자열 배열이다.

- alias precision = 허용 alias인 관측 primary type 수 / 관측 primary type 수
- alias recall = 허용 alias가 하나 이상 관측됐는지(0 또는 1)
- alias 대안 여러 개는 기대 개념 하나다. alias 수로 recall 분모를 늘리지 않는다.
- primary type 관측이 빈 배열이면 recall 0, precision은 분모 0이라 null이다. collection 누락은 unknown이다.
- secondary/multiple type 역할·novel type 적절성·다른 acceptable_variants 키는 이 버전에서 판단하지 않는다.

### 3.4 ranked ID recall

expected `recall_queries`의 원소는 `id`, 고유하고 비어 있지 않은 `required_ids`, `top_k: 10`과 선택 `query`만 가진다. 관측 `recall_results`는 `{id, ranked_ids}`다. id/query/결과 ID는 보고서에서 제외한다.

- `ranked_id_top1/5/10`: 실제 1/5/10위 이내에 들어온 required ID 수 / 전체 required ID 수. 여러 required ID를 가진 query도 micro 집계한다.
- `query_all_required_top10`: 모든 required ID가 top10에 들어온 query 수 / 기대 query 수. 일부 ID만 찾는 경우와 구분한다.
- query ID·required ID·ranked ID 중복은 허용하지 않는다. 기대 recall 규칙의 잘못된/미지원 형태는 unknown, 관측 중복은 입력 오류다.
- query 문자열 자체를 검색하거나 평가하지 않는다. `expected_in_top`만 있고 required_ids가 없는 과거 자유 예시는 unknown이다.
- `allowed_privacy`, `explanation_requires` 등 추가 키가 있으면 규칙 전체를 unknown으로 둔다. 순위 일치가 개인정보 필터·설명·근거 원본 이동까지 검증했다는 오해를 막는다.

## 4. unknown·severity·promotion

자유 `must_create`, `must_not_assert`, `required_evidence`, 미지원 must_preserve/acceptable_variants/recall 항목, `severity_overrides`는 unknown이다. 알려지지 않은 object는 top-level 키마다, 빈 object는 한 항목으로 센다. 지원되지 않은 내부 의미를 새 judge로 만들지 않는다. 관측에만 있는 typed/recall 식별자도 `UNSCOPED_OBSERVATION`으로 센다.

관측의 필수 `fatal_failures`는 25번에 근거한 고정 코드만 받는다: `SOURCE_MUTATION`, `USER_VALUE_OVERWRITE`, `WRONG_ENTITY_MERGE`, `RESTRICTED_EXPOSURE`, `HIGH_RISK_AUTO_ACCEPTED`, `RESTORE_HASH_MISMATCH`, `CANONICAL_DUPLICATE`. 빈 목록은 기록자가 fatal을 보고하지 않았다는 뜻이며 부재의 독립 증명은 아니다. expected severity override로 fatal을 낮추지 않는다.

분모 0 또는 unknown 관측이 포함된 metric의 rate는 null이다. unknown을 성공이나 0으로 메우지 않고 `matched/total/unknown`을 함께 보존한다. source/typed 불일치, type alias 불일치, top10 미회수는 해당 case의 고정 failure code로 표시한다. 전체 평균으로 fatal을 상쇄하지 않는다.

이 foundation은 **promotion eligible을 항상 false**로 출력한다.

- 측정 실패/unknown이 있으면 `blocked`
- 지원 subset이 모두 측정됐더라도 `review_required`
- 16점 사람 rubric을 자동 생성하지 않음: average_points/cases_at_or_above_13는 모두 null
- [01번 §8](./01_GOLDEN_CORPUS_AND_RECALL_SCENARIOS.md), 25번 §15의 평균13/16과 25번 §8의 case별13/16 차이는 `per_case_vs_average_unresolved`로 표시
- [09번](./09_EVALUATION_AND_ROADMAP.md)의 운영/UX/출처·개인정보 gate와 [40번](./40_I6_RETRIEVAL_TEMPLATES_AND_REDISCOVERY_EVIDENCE.md)의 실제 recall·실기기 경계는 여전히 별도

자동16점 환산법이나 release policy를 이 변경에서 임의 확정하지 않는다. cutover evidence/preflight의 PASS 입력을 작성하거나 갱신하지 않는다.

## 5. private readiness와 파일 안전

[34번](./34_I0_PRIVATE_CORPUS_MANIFEST_EVIDENCE.md)의 현재 20/20 gate가 필수다. 실행 시작에 기존 validator를 호출하고, canonical root 안의 manifest/expected/source를 다시 읽어 exact case·human approval·실제 source hash를 독립 대조한다. 채점 뒤에도 다시 검사해 source/expected 변경을 거부한다. 마지막 검사 시점 이후의 변경까지 막는 파일시스템 lock이나 서명된 attestation은 아니다.

경로 traversal·private root 밖 symlink·case mismatch·source/expected 변경·identity mismatch·관측 누락은 fail closed다. private metadata/관측 JSON 입력은 8 MiB로 제한한다. 원문 bytes는 readiness hash 검사에만 사용하고 복사하지 않는다.

보고서에는 GC case ID, 고정 코드·metric 이름, 수치와 검증된 hex identity만 들어간다. query·label·field value·entity name·원문·raw model response·provider error·credential·OS 경로·AJV/YAML error를 출력하지 않는다. 예상치 못한 오류도 고정 코드로 치환한다. unknown YAML tag의 기본 경고가 원문 행을 stderr로 쓰는 경로를 별도 재현했고, 선행 validator의 경고를 silent로 차단했다. 새 loader는 parseDocument의 errors/warnings가 하나라도 있으면 고정 코드로 거부한다. 기존 `validate-manifest.ts`의 상세 오류 출력은 변경 범위 밖이며 새 run/compare CLI가 해당 내용을 중계하지 않는다.

`--output`은 **새 파일만** 0600으로 생성한다(`wx/O_EXCL`). 기존 input/source/expected/report와 마지막 경로의 symlink(끊어진 링크 포함)를 덮어쓰지 않는다. 상위 디렉터리는 먼저 존재해야 한다. private report도 승인된 private 환경에 보관하는 것이 원칙이다.

## 6. 실행과 비교

저장소 root에서, 설치된 tsx만 사용한다.

통합 npm 명령은 `eval:synthetic`, `eval:private:recorded`, `eval:compare`, `test:eval`이다. `eval:private:recorded`는 실제 공급자 실행을 뜻하는 `eval:private`와 구분한다. root `typecheck`/`lint`는 전용 evaluator 설정도 검사하며 `test:tools`는 총36개 Node 시험을 실행한다. 예: `npm run eval:synthetic -- --fixture tools/v2-eval/fixtures/synthetic-demo.json`.

```sh
node --import tsx tools/v2-eval/run.ts --mode synthetic --fixture tools/v2-eval/fixtures/synthetic-demo.json

node --import tsx tools/v2-eval/run.ts --mode private-recorded \
  --manifest .private/golden-corpus/manifest.yaml \
  --identity .private/golden-corpus/model-runs/identity.json \
  --observations .private/golden-corpus/model-runs/observations.json \
  --output .private/golden-corpus/model-runs/new-report.json

node --import tsx tools/v2-eval/compare.ts \
  --baseline tools/v2-eval/fixtures/synthetic-demo.report.json \
  --candidate tools/v2-eval/fixtures/synthetic-demo.report.json
```

run exit code:

- `1`: 입력/readiness/쓰기 오류 또는 측정 실패/unknown으로 blocked
- `2`: 보고서 생성 완료지만 review_required. **승격 성공 exit0은 존재하지 않는다.**

compare는 동일 corpus+expected fingerprint, 동일 schema 의미, 동일 evaluator contract, 동일 synthetic/private provenance, 동일 case 집합일 때만 metric 차이를 계산한다. build/model/prompt/registry 변경은 실험의 목적이므로 `identity_changes`로 표시하고 비교를 허용한다. 호환되지 않으면 metric/failure 차이는 null이며 exit1이다. 잘못되거나 모르는 report contract는 안전한 `REPORT_INVALID`로 거부한다. 비교 exit0은 **비교 가능**이라는 뜻이며 후보 품질/승격 PASS가 아니다.

보고서를 다시 읽을 때 허용 키·enum·해시·case uniqueness·metric 분모·집계·promotion 일관성을 검증한다. 계산된 matched+unknown이 total보다 크거나 summary/promotion만 편집한 보고서를 거부한다. source/typed/type/recall의 측정 실패·unknown 수와 해당 issue code 간 모순도 거부한다. JSON object 키 순서는 의미에 영향을 주지 않는다. 보고서 서명/신뢰 가능한 제품 관측 채집까지 제공하는 것은 아니다.

선택적 root script 통합 제안(이 작업에서는 package.json을 수정하지 않음):

```json
{
  "eval:private:recorded": "node --import tsx tools/v2-eval/run.ts --mode private-recorded",
  "eval:synthetic": "node --import tsx tools/v2-eval/run.ts --mode synthetic",
  "eval:compare": "node --import tsx tools/v2-eval/compare.ts",
  "test:eval": "node --import tsx --test tools/v2-eval/evaluator.test.ts"
}
```

## 7. 검증 증거

분리 worktree `cloud-v2-eval-foundation`, 기준 commit `6b8be40556b326a8c413f902fc73ec7eecf24816`에서 수행했다. 원래 app checkout·생성물·실행 중 전체 suite는 변경하지 않았다.

| 실행 | 결과 |
| --- | --- |
| `node --import tsx --test tools/v2-eval/evaluator.test.ts` | 신규32/32 PASS, exit0 |
| `npm run test --workspace @light-house/web -- tests/unit/v2/private-corpus-manifest.test.ts tests/contract/v2/golden-corpus-manifest.test.ts --maxWorkers=1` | 기존 manifest2파일25/25 PASS, exit0, 1.33초 |
| 아래 scoped tsc | exit0 |
| 아래 scoped ESLint | exit0, 오류/경고0. root 실행에 대한 Next pages 경로 안내만 출력 |
| 위 synthetic CLI | exit2, review_required, live_provider_verified=false, promotion eligible=false |
| 위 self compare CLI | exit0, compatible=true, 모든 delta0, promotion eligible=false |
| `git diff --check` | exit0 |

통합 후 root 명령도 검증했다: `test:tools`36 PASS(평가기32+기존 migration4), 기존 manifest25 PASS, root `typecheck`(app+eval) exit0, root `lint` exit0(app 기존 경고34, eval 오류/경고0). 전용 `tools/v2-eval/tsconfig.json`과 ESLint 설정이 도구 파일을 검사한다. 앱 source/package/tests diff는 고정 소스 `6b8be40` 대비0이며, 기존 앱 전체172파일3528 PASS를 새 Node32개 결과에 합산하지 않는다. synthetic npm 명령 exit2와 self-compare npm 명령 exit0도 확인했다.

```sh
node_modules/.bin/tsc --noEmit --strict --skipLibCheck --module esnext \
  --moduleResolution bundler --target es2022 --esModuleInterop --resolveJsonModule \
  tools/v2-eval/contracts.ts tools/v2-eval/evaluator.ts tools/v2-eval/report.ts \
  tools/v2-eval/recorded-input.ts tools/v2-eval/run.ts tools/v2-eval/compare.ts tools/v2-eval/manifest.ts \
  tools/v2-eval/evaluator.test.ts

node_modules/.bin/eslint --config apps/web/eslint.config.mjs \
  tools/v2-eval/contracts.ts tools/v2-eval/evaluator.ts tools/v2-eval/report.ts \
  tools/v2-eval/recorded-input.ts tools/v2-eval/run.ts tools/v2-eval/compare.ts tools/v2-eval/manifest.ts \
  tools/v2-eval/evaluator.test.ts
```

합성 demo는 GC-01 한 건이다. hash/typed/alias 측정은 각각1/1, required ID는 실제5위라 top1=0/1, top5=1/1, top10=1/1, all-required query=1/1이다. fatal/major/unknown 기록은0이지만 16점 rubric·기타 release gate를 채점하지 않았으므로 review_required다. checked-in report bytes를 CLI 재생 결과와 시험에서 정확히 대조한다.

시험의 20/20 private-mode 파일은 임시 디렉터리에 만든 **합성** 자료다. 실제 private corpus 선정·사람 승인·실제 Gemini baseline·비용/usage·UX/실기기·원격 운영 검증은 수행하지 않았다. source hash 관측·typed/alias/ranked-ID 결과를 제품에서 신뢰 가능하게 채집하는 adapter와 자유 의미 규칙의 사람 판정 계약이 후속 작업이다.
