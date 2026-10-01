# 34. I0 Private Corpus Manifest Evidence

> 상태: `I0-013` harness·20 slot·5 expected draft 완료 · 실제 source 승인 대기  
> 검증일: 2026-08-12  
> 범위: private fixture 격리, schema, hash, 사람 승인, evaluation readiness gate

## 1. 결론

`.private/golden-corpus`는 git에서 제외되는 local-only 영역이다. 20개 case slot manifest와 GC-01·04·09·13·20의 expected draft를 만들었지만 실제 source가 없으므로 `readyCount=0`이다. 이는 실패가 아니라 의도한 준비 상태다.

모델 평가는 case가 다음 조건을 모두 만족할 때만 실행할 수 있다.

1. source path가 private root 내부의 relative path
2. expected result가 `human_approved`
3. expected의 SHA-256 목록과 실제 source가 정확히 일치
4. 20개 case 모두 ready

## 2. 구현 위치

| 계약 | 구현 |
| --- | --- |
| manifest schema | `tools/v2-eval/schemas/golden-corpus-manifest.schema.json` |
| expected schema | `tools/v2-eval/schemas/expected-result.schema.json` |
| validator/hash gate | `tools/v2-eval/manifest.ts` |
| CLI | `tools/v2-eval/validate-manifest.ts` |
| local manifest | `.private/golden-corpus/manifest.yaml` — gitignore |
| local expected drafts | `.private/golden-corpus/expected/GC-01·04·09·13·20.yaml` — gitignore |
| contract tests | `apps/web/tests/contract/v2/golden-corpus-manifest.test.ts` |

## 3. 검증 결과

```text
npm.cmd run eval:private:validate
→ structurallyValid=true
→ caseCount=20, expectedDraftCount=5, readyCount=0

npm.cmd run eval:private:gate
→ exit 1 (expected)
→ readyForPrivateEvaluation=false

manifest contract tests
→ 3 tests PASS
→ approved hash success, traversal reject, hash mismatch reject
```

`eval:private:gate`가 현재 성공하면 오히려 오류다. 실제 자료를 사용자가 선정하고 expected를 source 기준으로 검토하기 전에는 AI prompt 최적화나 baseline 실행으로 넘어가지 않는다.
