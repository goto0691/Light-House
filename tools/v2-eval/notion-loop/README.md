# Notion loop evaluation

A standing real-data check of the core loop: Notion pages are imported with their database as an imported type and their relation properties as imported links, analyzed by the production runner, observed for templates, grouped as connections and searched. It runs in an isolated in-memory SQLite with the actual V2 migrations. Nothing is written to the app's local D1, a remote database or R2.

## Scope and privacy

- The owner-approved scope (2026-10-17) is fixed in [`scope.ts`](./scope.ts): standard 60 (영상 로그 15, 컨텐츠 로그 15, 게임 로그 12, 1 지식 창고 12, 묵상 6) and a smoke 15 subset. Diary, network, contacts, work, career, gift, project and life-log databases are excluded.
- `prepare` writes the deterministic page selection to the git-ignored `.private/notion-eval/scope.json`. `run` refuses any page, database or count outside it, and any other export file.
- Relation property values (people, linked pages) never reach the provider. They become imported links locally. Pages of the network database become person entities by name only.
- Live runs use the owner's ChatGPT plan only (no Gemini fallback), one call per record, and stop after three consecutive provider failures.
- Raw results stay in `.private/notion-eval/runs/`. Only aggregate numbers belong in repository documents.

## Commands

```powershell
npm run eval:notion -- prepare
npm run eval:notion -- run --set smoke --dry-run
npm run eval:notion -- run --set smoke --live
npm run eval:notion -- run --set standard --live
npm run test:eval:notion
```

`--dry-run` imports, links, groups and searches without any provider call. `--live` needs the ChatGPT plan connected in the app's local D1 (`apps/web/scripts/chatgpt-plan-login.ts`, then `chatgpt-plan-install.ts`). Each run prints its headline next to the previous run of the same set and mode.

## Metrics

| Area | Measure |
| --- | --- |
| Analysis | successes, failures, latency p50/p90 |
| Types | distinct AI type keys per database, rate of reusing the imported type |
| Fields | Notion property values found in AI fields (dates by day, Yes/No, lists as sets), per property and the keys used |
| Templates | `generated_draft` templates and their items |
| Review | open review items per record, by kind |
| Entities | AI entity records vs distinct names, AI persons matching imported persons |
| Relations | Notion links, imported links created, mirrored pairs merged, targets outside the sample, preservation |
| Grouping | connected items placed in the group of their Notion database |
| Search | title query top-1 and top-10 |
| Registry | AI-proposed type and field definitions |
