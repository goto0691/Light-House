# Private S1 evaluation preparation

This tool prepares and, only after separate user permission, evaluates the twenty approved local text sources through the production S1 processing runner. It uses a fresh account in isolated in-memory SQLite, the actual migrations and repositories, production resumable migration export, and the existing read-only collector/evaluator. It never writes to a remote DB or R2 service.

Prepare a reviewable request after committing runtime/tool changes:

```powershell
npm exec -- tsx --tsconfig tools/v2-eval/private-live/tsconfig.json tools/v2-eval/private-live/prepare.ts --manifest .private/golden-corpus/manifest.yaml --output-directory .private/golden-corpus/model-runs/NEW-LIVE-RUN --approval-request .private/golden-corpus/model-runs/NEW-LIVE-REQUEST.json
```

Preparation reads approved local sources and writes a private request with `authorized:false`. It constructs no provider client and reads no credential. The target binds corpus digest, byte total, twenty case IDs, actual Git HEAD and analysis implementation hashes, configured model selectors, a fresh output directory and the fixed call budget. Both preparation and execution use the existing process environment selectors (`GEMINI_MAIN_MODEL` and `GEMINI_GROUNDED_MODEL`, or production defaults); the tool does not load `.env` files or change a selector. The provider key must be supplied through the authorized execution environment, never a command argument or printed script.

The root execution owner must obtain explicit permission to send the twenty approved source titles/raw texts and production analysis prompt to Google Gemini's configured main role. Expected-answer authoring permission and corpus readiness are different permissions. Only after the user's explicit transmission approval may that owner copy the prepared request to a new private authorization file, set `authorized:true`, and record `approval.kind:user_explicit_private_transmission`, the hash of the actual user request and the actual approval-recording UTC timestamp. The tool checks exact target equality and a valid non-future canonical ISO timestamp. This local authorization file is a permission record, not a cryptographic proof of human consent; the execution owner must preserve the real conversation evidence.

The authorized invocation is:

```powershell
npm exec -- tsx --tsconfig tools/v2-eval/private-live/tsconfig.json tools/v2-eval/private-live/run.ts --live --manifest .private/golden-corpus/manifest.yaml --authorization .private/golden-corpus/model-runs/NEW-LIVE-AUTHORIZATION.json --output-directory .private/golden-corpus/model-runs/NEW-LIVE-RUN
```

`--live` and an exact authorization record are both required before key access/provider construction. Runtime source changes in `apps/web/src`, `tools/v2-eval`, `migrations`, root package/lock and the web package reject live execution. Documents and generated `next-env.d.ts` may remain dirty and are reported separately. All inputs and canonical output parents must remain inside the corpus directory. Exclusive creation prevents reuse or replacement of an output. Each call rechecks current corpus/approval/build/config before reserving an invocation; reservations are persisted before a request. No resume mode exists.

There are at most twenty generate attempts and at most one attempt per input hash, including failed attempts. Concurrent reservations enforce the same cap. The installed `@google/genai` transport performs one `fetch` when `retryOptions` is absent; fake HTTP tests prove no retry for 503 and 429 while retaining production safe error classification. The official Google endpoint is fixed, SDK dependency/implementation inputs are bound through the lock and runtime identity, and no fallback model is used. The first provider/validation/non-success outcome ends further invocations. Product retry/grounding jobs may exist in the export but this tool never invokes them. The production per-request deadline remains 90 seconds. Count/latency/token observations are recorded; monetary cost and unreported token usage remain unknown rather than estimated from prices.

Raw sources, model results, product proposals, search query/response text, mapping and export stay in the private output. Stdout emits fixed codes, aggregate counts and metric states; neither exception messages, keys, paths, raw payloads nor model output are emitted. An interrupted run may leave reservation/start files, and must be reconciled without an automatic retry.

Even twenty successful model invocations produce a blocked, non-promotable receipt until independent semantic review. The existing collector's explicit-selector semantics are unchanged: no expected type or value is inserted into product storage, no inferred type is treated as a user-selected primary, and no AI value is fabricated into an approved typed selector. Current minimal expected data has no approved typed selector. Type/typed observations and free semantic rubric remain unknown; source equality and literal title recall remain the supported recorded subset. A returned model JSON or production schema validation is not a quality approval. HTTP/auth/Worker runtime, original multimodal twenty-slot coverage, external grounding and real device UX are outside this local execution.

`run.ts` returns exit 0 only if all twenty production analyses succeeded and artifacts were created; this does not mean semantic evaluation passed. An incomplete/provider-blocked run returns exit 1 and preserves private artifacts when the capture/export boundary remained valid.

Scoped verification without network:

```powershell
npm exec -- tsx --tsconfig tools/v2-eval/private-live/tsconfig.json --test tools/v2-eval/private-live/live.test.ts
npm exec -- tsc --project tools/v2-eval/private-live/tsconfig.json --noEmit
npm exec -- eslint --config tools/v2-eval/eslint.config.mjs tools/v2-eval/private-live/*.ts
```

Tests use twenty synthetic sources, a fake structured gateway or an installed SDK with entirely fake HTTP. The library's `synthetic-no-network` dependency injection is explicitly marked in receipts and is not exposed by the live CLI. These tests are not actual private-source/provider evaluation.
