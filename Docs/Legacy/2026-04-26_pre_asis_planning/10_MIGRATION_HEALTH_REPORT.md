# Migration Health Report

Checked on 2026-04-24 against the configured D1 database after the second refinement pass.

## Verdict

The migration succeeded as a broad capture of the Notion workspace, but it is not yet a clean operational model. The right path is not a full re-migration. Keep the imported data, then normalize, merge, enrich, and expose it through the current Light House schema and UI.

## What Is Working

| Area | Status | Evidence |
| --- | --- | --- |
| Vault import | Much cleaner active surface | 557 active zettels, 543 active imported, 0 active imported zettels without tags |
| Daily logs | Mostly usable | 91 active daily logs, 56 with journal text |
| Media shelf | Captured and deduped | 486 active media rows after duplicate cleanup and one recovered media artifact |
| People/PRM | Cleaned to real-person candidates | 10 active people after media artifacts and duplicate people were merged/hidden |
| Relation memory | Valuable AS-IS strength preserved and redirected | 705 zettel-media links, 466 zettel-person links, 239 media-person links, 318 task-person links, 214 task-zettel links |
| Auto daily shells | Cleaned from active Vault | 114 auto-log source pages hidden, 0 active detected auto shells |
| Review queue | Cleared | 1,385 migration review items are applied, 0 open |
| Search seed | Available for current data | FTS tables now match active zettels and people after soft-hide cleanup |

## Main Gaps

| Gap | Why It Matters | Next Action |
| --- | --- | --- |
| Daily person links | Diary source pages mention people, but exact PRM alias matching is still conservative | Add an alias table or manual PRM review for names like nicknames/relationship aliases before creating daily-person links |
| Saved views not fully operational | Views are seeded in DB, but main screens only expose basic filters today | Wire saved views into Vault, Media, Life Ops, and Settings/Data workflows |
| FTS triggers incomplete | FTS tables are populated, but D1 API trigger creation failed | Apply full FTS migration through Wrangler or rely on app-level index refresh after writes |

## Current App Support Added

Settings/Data now exposes migration review signals:

- Entity counts include media and workouts.
- Relation health includes zettel-media and daily-people gaps.
- Review queues show needs-review, hidden auto logs, and untagged imported zettels.
- Saved migration views are visible.
- Duplicate media candidates are visible.

The second refinement pass also added `scripts/refine-migrated-data.ts` and ran it against D1:

- Reclassified PRM media-title artifacts into media/zettel-media relations.
- Merged duplicate person rows into canonical people.
- Tagged every active imported zettel or moved it into a canonical surface.
- Soft-hid generated media source pages and journal/meditation source pages after preserving their canonical data.
- Kept archive-work and needs-review records in the database, but removed them from the default Vault zettel surface.

## Recommended Execution Order

1. Alias-aware daily-log/person relation recovery.
2. Saved view integration in the main browsing screens.
3. Full FTS trigger migration or app-level refresh verification.
4. Optional richer media subtype normalization for recovered `other` media rows.

## Decision

Treat this as a redistribution and system-fit project, not a re-migration. Re-migration should only be used surgically if a specific source database contains fields that were never captured and cannot be reconstructed from the current D1 rows.
