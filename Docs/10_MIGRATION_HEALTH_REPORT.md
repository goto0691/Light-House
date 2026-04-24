# Migration Health Report

Checked on 2026-04-24 against the configured D1 database.

## Verdict

The migration succeeded as a broad capture of the Notion workspace, but it is not yet a clean operational model. The right path is not a full re-migration. Keep the imported data, then normalize, merge, enrich, and expose it through the current Light House schema and UI.

## What Is Working

| Area | Status | Evidence |
| --- | --- | --- |
| Vault import | Good coverage, noisy shape | 1,154 zettels total, 1,040 active, 1,139 imported |
| Daily logs | Mostly usable | 91 active daily logs, 56 with journal text |
| Media shelf | Captured but over-expanded | 856 active media rows, 482 imported |
| People/PRM | Captured but mixed with artifacts | 322 people, 161 imported from Notion source IDs |
| Relation memory | Valuable AS-IS strength preserved | 5,794 zettel-person links, 868 media-person links, 318 task-person links, 214 task-zettel links |
| Auto daily shells | Cleaned from active Vault | 114 auto-log source pages hidden, 0 active detected auto shells |
| Search seed | Available for current data | FTS tables contain zettels 1,154, media 856, people 322, daily 91 |

## Main Gaps

| Gap | Why It Matters | Next Action |
| --- | --- | --- |
| Media duplicates | Source exports and nested pages produced repeated rows, e.g. several titles have 4 copies | Add a media merge pass that keeps the richest canonical row and soft-hides duplicates |
| People overcount | AS-IS relation artifacts and names became PRM rows | Split real people from extracted mentions/artifacts; add review queue before deletion |
| Workout overcount | 324 active workouts is far above the meaningful source set | Collapse generated completion logs and duplicated workout pages |
| Untagged imported zettels | 575 active imported zettels have no taggings, so they remain hard to browse | Add a second classifier pass using category, source folder, and content headings |
| Missing cross-domain bridges | `zettel_media_relations` and `daily_log_people_relations` are currently empty | Rebuild links from source relations and content mentions |
| Saved views not fully operational | Views are seeded in DB, but main screens only expose basic filters today | Wire saved views into Vault, Media, Life Ops, and Settings/Data workflows |
| FTS triggers incomplete | FTS tables are populated, but D1 API trigger creation failed | Apply full FTS migration through Wrangler or rely on app-level index refresh after writes |

## Current App Support Added

Settings/Data now exposes migration review signals:

- Entity counts include media and workouts.
- Relation health includes zettel-media and daily-people gaps.
- Review queues show needs-review, hidden auto logs, and untagged imported zettels.
- Saved migration views are visible.
- Duplicate media candidates are visible.

## Recommended Execution Order

1. Media dedupe and merge.
2. Workout generated-log cleanup.
3. People/PRM artifact separation.
4. Untagged zettel classification pass.
5. Cross-domain relation rebuild for zettel-media and daily-people.
6. Saved view integration in the main browsing screens.
7. Full FTS trigger migration or app-level refresh verification.

## Decision

Treat this as a redistribution and system-fit project, not a re-migration. Re-migration should only be used surgically if a specific source database contains fields that were never captured and cannot be reconstructed from the current D1 rows.
