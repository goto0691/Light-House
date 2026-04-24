# Data Reclassification Plan

## 0. Goal

Notion data has already been migrated into Light House, but many records are still hard to read because the original Notion schema, relations, rollups, and database-specific meanings were flattened during import. This document is the handoff plan for GPT or an agentic worker to inspect the imported D1 data, compare it with the original Notion export, and reclassify the data into useful Light House views.

The first priority is not to improve future imports. The priority is to make the current migrated data readable, searchable, and safely disposable where it is only an automation shell.

Core decisions:

- This is not a full re-migration. It is a reclassification and enrichment pass over the existing migrated D1 data.
- The original Notion export should be used as reference material to recover missing fields, relations, and intent. It should not blindly replace the existing database.
- If the current Light House schema cannot represent useful AS-IS data, add small schema extensions before applying the data move.
- Use tags, saved views, relations, and soft deletion instead of creating one-off silo pages.
- Preserve meaningful content even when the original Notion page is deleted or hidden.
- Move generated Daily Log shell pages into Life Ops data, then remove those source pages from active Vault/PRM views.
- Treat the original Notion zip as the source-of-truth for missing schema fields.
- Run every destructive-looking operation as a dry run first, with counts and samples.

### 0.1 Migration Mode Decision

Use a three-layer approach:

| Layer | Meaning | When to use |
| --- | --- | --- |
| Reclassify existing rows | Tag, merge, soft-hide, and link data already in D1 | Default path |
| Enrich from original export | Read Notion zip/CSV/Markdown to recover fields or relations lost during import | When D1 has only flattened content or missing relation metadata |
| Targeted schema upgrade | Add columns/tables only for AS-IS data that cannot be represented cleanly today | When tags/content blobs would make the data hard to browse or query |

Do not run a fresh import into empty tables unless the current database is proven too corrupted to repair. A fresh import risks losing user edits made after migration and duplicates records that already have Light House ids, UI state, tags, attachments, and audit logs.

## 1. Source Inventory

### 1.1 Original Notion Export

Observed from `migrations/Master DB-from notion.zip`:

| Notion source | Rows | Key fields | Target |
| --- | ---: | --- | --- |
| `1 지식 창고` | 129 | 이름, 카테고리, 유형, 상태, 한 줄 요약, 출처, 생성 일시, 관련인물, 묵상 로그 | Vault zettels, faith/writing/sermon saved views |
| `컨텐츠 로그` | 327 | 이름, 날짜, 유형, 평가, 플랫폼, 장르, 한줄평, 감독, 게임 로그, 도서 로그, 영상 로그, 제작사 | Media shelf canonical index |
| `영상 로그` | 145 | 이름, 날짜, 감독/크리에이터, 제작사, 리뷰, 유형, 장르, 평점, 플랫폼, 관련 네트워크, 다시 볼 가치, 시청상태 | `media_logs` screen records |
| `게임 로그` | 25 base / 172 all | 이름, 날짜, 리뷰, 플랫폼, 장르, 개발사, 평점, 플레이 타임, 컨텐츠 로그, 상태 | `media_logs` game records |
| `도서 로그` | 1 | 이름, 날짜, 리뷰, 분류, 장르, 저자, 출판사, 평점, 컨텐츠 로그, 상태 | `media_logs` book records |
| `일기` | 54 | 제목, 날짜, 감정, 사건, 관련인물, 태그, 라이프 로그 | `daily_logs.journal`, PRM relations, journal archive |
| `묵상` | 43 | 본문말씀, 날짜, 라이프 로그, 배경지식 | `daily_logs.meditation`, `daily_logs.meditation_verse`, meditation archive |
| `라이프 로그` | 107 | 이름, 날짜, 오늘 일기, 오늘 묵상, 오늘 운동, 일기, 묵상, 운동 로그 | Life Ops date anchor and rollup linkage |
| `운동 로그` | 3 base / many duplicated nested exports | 이름, 날짜, 운동 종류, 라이프 로그 | `workouts`, deduped by date/category/source |
| `3 네트워크` | 6 | 이름, 그룹, 생일, 마지막 연락일, 상태, 사건, linked projects/zettels/life ops | PRM people and relations |
| `선물` | 1 | 품목명, 사람, 날짜, 만족도, 비용, 사이즈/옵션, 선물 사유, 이미지 | PRM gifts |
| `커리어&히스토리` | 1 | 이름, 근무기간, 조직/소속, 카테고리 | Life Ops career history |
| `외출자 특이사항` | 9 | 이름, 날짜, 연락처, 외출목적, 외출자, 외출자 이름, 외출할 곳 | Archive only, hidden from default views |
| `국군수도병원 DEMIS 3.0` | 4 | 화면이름, 아이디어 내용, 반응 | Archive only or old work project reference |

Observed from `migrations/Pneos' Master Dashboard-from notion.zip`:

- A smaller dashboard export repeats core `_all.csv` files for projects, network, knowledge, and life logs.
- It contains several person pages and the generated `🗓️@오늘` page.
- Treat this zip as supplemental evidence, not the canonical full export.

### 1.2 Current App Schema Gaps

The app already has suitable core tables:

- Vault: `zettels`, `media_logs`, `assets`, `places`, zettel/media/person relation tables.
- Life Ops: `daily_logs`, `workouts`, `habits`, `habit_logs`, `health_metrics`, `career_history`.
- PRM: `people`, `interactions`, `gifts`, `network_edges`.
- Shared: `tags`, `taggings`, `saved_views`, `audit_logs`, `import_jobs`, `backup_snapshots`.

Known gaps after migration:

- Some original Notion relation fields are not restored or visible.
- Some generated rollup pages were imported as normal zettels.
- Some media detail pages and content-rollup pages appear as raw zettels or PRM people.
- Daily journal and meditation data exists but does not have archive-grade browsing.
- Workouts may contain placeholders or nested export duplicates.
- Existing source code contains mojibake in import/reclassification matching rules, so Korean detection rules should be rewritten from the clean zip headers and sampled page text.

### 1.3 Schema Gap Decision

Most AS-IS records can be represented with the current schema, but several fields should not be forced into generic text blobs if the goal is efficient review.

| AS-IS data | Current support | Decision |
| --- | --- | --- |
| Diary title/event/date/mood | `daily_logs.date`, `mood`, `journal` | Add optional `journal_title` and `journal_source` only if sampled data shows titles are meaningful beyond the first journal line. Otherwise merge title + event into `journal`. |
| Diary related people | No direct daily-log/person relation | Add `daily_log_people_relations` so Life Ops can answer "who appeared in this day?" and PRM can show diary mentions. |
| Diary tags | Generic `tags`/`taggings` supports `daily_log` | Use existing tags. No schema change. |
| Meditation verse/background | `meditation_verse`, `meditation` | Current schema is enough. Add tags and FTS coverage. |
| Life log rollup anchor | `daily_logs.date`, `notion_source_id`, `import_batch_id` | Current schema is enough for the canonical daily row. Store source-page extraction in `audit_logs`. |
| Workout date/category/note | `workouts.date`, `categories`, `notes` | Current schema is mostly enough. Add optional `daily_log_id` only if UI needs explicit joins beyond same-date matching. |
| Workout duplicates/placeholders | `deleted_at`, tags, audit logs | Current schema is enough for soft-hide. |
| Content log plus game/book/screen subtype logs | `media_logs` supports most fields | Current schema is enough for the first pass. Add `media_relations` later only if content-log parent/subtype relations matter in UI. |
| Media related people | `media_people_relations` | Current schema is enough. Restore relations. |
| Zettel related people | `zettel_people_relations` | Current schema is enough. Restore relations. |
| Gift import identity | D1 migration adds `notion_source_id`/`import_batch_id`, but `packages/db/schema/prm.ts` does not define them on `gifts` | Fix Drizzle schema so code and database agree. |
| Old workplace docs | `zettels`, tags, `deleted_at` | Current schema is enough. Tag `archive-work`; do not hard-delete. |

Recommended schema changes before applying reclassification:

1. Add `daily_log_people_relations`.
2. Fix `gifts` schema to include `notionSourceId` and `importBatchId`.
3. Consider `daily_logs.journal_title` and `daily_logs.journal_source` after sampling diary rows.
4. Consider `workouts.daily_log_id` only if same-date joins are not enough in the Life Ops UI.

Avoid broad schema changes for the first pass. If a field is useful only for provenance, put it in `audit_logs.snapshot`. If a field is useful for browsing/filtering, model it explicitly.

Implemented in this pass:

- `packages/db/schema/life-ops.ts` now defines `dailyLogPeopleRelations`.
- `migrations/0006_daily_log_people_relations.sql` creates the relation table and indexes.
- `packages/db/schema/prm.ts` now defines `gifts.notionSourceId` and `gifts.importBatchId`, matching the existing D1 migration.
- `apps/web/src/lib/server/life-ops.ts` includes daily-log related people in the daily timeline.
- `scripts/reclassify-data.ts` has been rewritten around clean Korean/English rules, dry-run/apply modes, Life Ops extraction, soft-hide, saved views, FTS refresh, and guarded hard-delete for audited auto logs.
- `migrations/0007_source_documents.sql` and `scripts/rebuild-source-documents.ts` preserve original Notion source document roles, properties, previews, and canonical entity mappings.
- `migrations/0008_migration_review_items.sql` and `scripts/reconcile-migrated-data.ts` add the reconciliation workbench: safe duplicate merges are applied automatically, ambiguous records are queued for review, and source document relations are rebuilt.
- The first reconciliation pass soft-hid 371 duplicate media rows and 214 duplicate workout rows, inserted 299 zettel-media relations, and rebuilt 7,751 source document relations.
- `scripts/refine-migrated-data.ts` runs the second refinement pass: PRM media-title artifacts are moved to media relations, duplicate people are merged, generated media source zettels are hidden after linking, journal/meditation source zettels are moved into Life Ops daily logs, and all active imported zettels receive a classification tag.
- After the second pass, active PRM rows dropped from 322 to 10, active zettels dropped from 1,040 to 557, active imported untagged zettels dropped from 575 to 0, and open migration review items dropped from 800 to 0.
- The default Vault zettel query now excludes `archive-work`, `needs-review`, and `auto-log` tags so operational notes are readable without archive/review noise.

## 2. Classification Principles

### 2.1 Canonical Entity First

Every record should have one canonical place:

| Content type | Canonical table | Secondary visibility |
| --- | --- | --- |
| Daily journal | `daily_logs.journal` | Journal Archive saved view, search |
| Meditation/QT | `daily_logs.meditation`, `daily_logs.meditation_verse` | Meditation Archive, faith tags, search |
| Workout | `workouts` | Daily Life Ops page, workout trends |
| Sermon/faith note | `zettels` | Sermons & Faith saved view |
| Creative writing | `zettels` | Creative Writing saved view |
| Media record | `media_logs` | Media Shelf, related zettels |
| Person | `people` | PRM, relation graph |
| Old workplace operation doc | `zettels` with `archive-work` | Hidden by default, searchable by archive view |
| Generated automation shell | No active canonical page | Extract useful fields, then soft-delete source page |

### 2.2 Tags Are Lenses, Not Destinations

Canonical tags:

| Tag | Applies to | Purpose |
| --- | --- | --- |
| `journal` | daily_log, zettel | Personal diary and reflective entries |
| `meditation` | daily_log, zettel | QT and verse-based reflection |
| `sermon` | zettel | Sermon manuscripts and sermon notes |
| `faith` | zettel, daily_log | Broader Christian/religion material |
| `writing` | zettel | Poems, fiction, essays, story seeds |
| `media` | media, zettel | Media records and media-derived notes |
| `game` | media | Game records |
| `book` | media | Book records |
| `screen` | media | Movie, drama, anime, video records |
| `workout` | workout, daily_log | Exercise records |
| `archive-work` | zettel | Old work/hospital documents hidden from active defaults |
| `auto-log` | zettel, daily_log, workout | Notion-generated automation shells |
| `needs-review` | any | Ambiguous records requiring manual decision |

## 3. Recommended Ways To View Data Efficiently

### 3.1 Saved Views

Seed these saved views first, then use them to inspect classification quality:

| View | Domain/scope | Query/filter | Sort |
| --- | --- | --- | --- |
| Journal Archive | Life Ops / daily | `tag:journal` or `journal is not null` | date desc |
| Meditation Archive | Life Ops / daily | `tag:meditation OR tag:faith` | date desc |
| Sermons & Faith Notes | Vault / zettels | `tag:sermon OR tag:faith` | created/date desc |
| Creative Writing | Vault / zettels | `tag:writing` | updated desc |
| Media Shelf | Vault / media | media type/status/rating filters | completed/date desc |
| People Mentioned In Notes | PRM / graph | people with zettel/media/daily relations | last activity desc |
| Archived Work Docs | Vault / zettels | `tag:archive-work` | created desc |
| Needs Review | Settings/Data or Vault | `tag:needs-review` | updated desc |
| Auto Logs Hidden | Settings/Data | `tag:auto-log`, `deleted_at is not null` | date desc |

### 3.2 Data QA Views

Add temporary admin/debug queries or a Settings/Data panel for:

- Records by `import_batch_id`.
- Records with `notion_source_id` but no tags.
- Zettels whose title matches generated pages: `🗓️@오늘`, `@오늘`, `운동 완료`, `오늘 일기`, `오늘 묵상`, `오늘 운동`.
- PRM people with media-like fields or names.
- Media logs missing `media_type`, `status`, `rating`, `creator`, or `completed_at`.
- Daily logs with duplicate dates.
- Workouts with same date/category/source.
- Tag usage count and dangling taggings.
- FTS rows missing for active records.

### 3.3 Search Behavior

Search should show canonical records first:

1. Exact title/date match.
2. Tagged canonical records.
3. Related records.
4. Archived records only when archive filters are active.
5. Soft-deleted automation shells never in normal search.

After reclassification, rebuild or refresh FTS tables for zettels, media, people, tasks, and daily logs if daily-log FTS exists.

## 4. Daily Log And Life Ops Policy

### 4.1 What To Move Into Life Ops

Move useful fields into Life Ops:

- `일기.사건` and/or generated markdown body -> `daily_logs.journal`.
- `일기.감정` -> normalized mood or emotions where possible.
- `일기.태그` -> tags on the daily log.
- `묵상.본문말씀` -> `daily_logs.meditation_verse`.
- `묵상.배경지식` -> `daily_logs.meditation`.
- `운동 로그.운동 종류` -> `workouts.categories`.
- `라이프 로그.날짜` -> the date anchor for joining diary, meditation, and workout data.

### 4.2 What Can Be Deleted Or Hidden

The user has explicitly allowed generated Daily Log pages to be sent into Life Ops data and then removed.

Safe-to-hide/delete criteria:

- The page is a Notion automation shell whose value is only rollup linkage.
- Its useful diary, meditation, and workout fields have already been extracted into `daily_logs` or `workouts`.
- It has no unique long-form body beyond repeated rollup text.
- It has a preserved `notion_source_id`, `import_batch_id`, and audit log entry.

Recommended implementation:

- First pass: soft-delete by setting `deleted_at`.
- Add `auto-log` tag before hiding.
- Write an audit row with source id, target daily log/workout ids, and extracted fields.
- Hard delete only after a backup exists and a manual spot-check passes.

Do not hide:

- Real diary prose.
- Real meditation prose.
- A workout note with unique detail.
- Any page with attachments that are not yet attached to the target Life Ops record.

## 5. Reclassification Rules

### 5.1 Move Or Merge To Media

Move into `media_logs` when fields or content include:

- `감독/크리에이터`, `감독`, `개발사`, `제작사`, `플랫폼`, `플레이 타임`, `시청상태`, `다시 볼 가치`, `영상 로그`, `게임 로그`, `도서 로그`, `컨텐츠 로그`.
- Media-specific ratings, reviews, one-line evaluations, platform/publisher fields.

Rules:

- If a matching `media_logs` row exists, merge missing fields into it.
- Preserve raw zettel body in `media_logs.content` or create a `zettel_media_relations` link if it is a meaningful note.
- Soft-hide raw duplicate media detail pages after merge.
- If a PRM person is actually a media artifact, merge it into media and soft-hide the person only after checking no real person relations depend on it.

### 5.2 Keep In Vault

Keep as zettels when the record is knowledge, writing, sermon, faith, prompt, or reference material.

Tagging rules:

- Sermon: Bible passage patterns, sermon manuscript labels, worship note titles, `본문`, known sermon-note titles.
- Faith: theology, prayer, gospel, church, devotional, meditation-related material.
- Writing: novel ideas, poems, fiction drafts, character/settings notes, essays.
- Reference: prompt guides, study notes, analysis notes, book lists, philosophical notes.

Improve discoverability by:

- Adding canonical tags.
- Restoring `zettel_people_relations` from `관련인물`.
- Linking sermon/meditation records to daily logs when `묵상 로그` or date matches.
- Keeping archived work docs out of the default Vault list.

### 5.3 Move To Life Ops

Move or merge into `daily_logs`, `workouts`, or `career_history` when source fields match Life Ops:

- Diary records from `일기`.
- Meditation records from `묵상`.
- Date anchors from `라이프 로그`.
- Workout records from `운동 로그`.
- Career records from `커리어&히스토리`.

Merge rules:

- Use `(user_id, date)` as the daily log identity.
- Combine diary, meditation, gratitude/emotion, and workout relation data into the same date.
- Do not overwrite richer existing fields with rollup labels.
- If two sources disagree, preserve the losing value in audit or `needs-review`.

### 5.4 Archive From Active Views

Tag `archive-work` and hide from default views:

- `외출자 특이사항`.
- `국군수도병원 DEMIS 3.0`.
- Patient leave notes, hospital operational notes, and old workplace process docs.

Do not hard-delete old work documents in the first reclassification pass. They may not belong in daily usage, but they are still user data.

## 6. Implementation Plan For GPT

### Phase 1: Inspect

1. Read `Docs/09_DATA_RECLASSIFICATION_PLAN.md`, `scripts/reclassify-data.ts`, `apps/web/src/lib/notion-import-core.ts`, and database schemas under `packages/db/schema`.
2. List Notion zip contents and CSV headers from `migrations/*.zip`.
3. Query D1 counts for active/deleted records by table.
4. Sample 20 records each from zettels, media, people, daily_logs, workouts, and tags.
5. Produce an inspection report with counts, suspicious examples, and proposed rule updates.

Minimum D1 queries:

```sql
select count(*) from zettels where user_id = ? and deleted_at is null;
select title, category, type, notion_source_id from zettels where user_id = ? and deleted_at is null order by updated_at desc limit 50;
select date, journal, meditation, meditation_verse from daily_logs where user_id = ? and deleted_at is null order by date desc limit 50;
select date, categories, notes from workouts where user_id = ? and deleted_at is null order by date desc limit 50;
select name, groups, bio, core_value from people where user_id = ? and deleted_at is null order by updated_at desc limit 50;
select media_type, title, creator, status, rating from media_logs where user_id = ? and deleted_at is null order by updated_at desc limit 50;
```

### Phase 2: Repair Rules

1. Apply the minimal schema fixes needed for useful browsing:
   - `daily_log_people_relations`
   - `gifts.notionSourceId` / `gifts.importBatchId` in Drizzle schema
   - optional daily/workout fields only after sample-based confirmation
2. Replace mojibake regexes in the reclassification script with clean Korean/English rules.
3. Add an explicit candidate type for generated Daily Log shell pages.
4. Add dedupe keys:
   - daily log: `(user_id, date)`
   - workout: `(user_id, date, normalized categories, notion_source_id)`
   - media: `(user_id, normalized title, media_type)`
   - zettel: `(user_id, notion_source_id)` and title fallback
5. Add `--dry-run`, `--apply`, and `--hard-delete-auto-logs` flags. The last flag must require a backup id.
6. Print JSON summaries that include scanned rows, candidates, actions, tags, examples, and warnings.

### Phase 3: Apply Safe Mutations

Order matters:

1. Create/ensure tags.
2. Merge Life Ops data by date.
3. Merge media records.
4. Restore people/media/zettel/daily relations, including daily-log/person relations if the schema exists.
5. Soft-hide source pages that are duplicates or automation shells.
6. Seed saved views.
7. Rebuild FTS/search indexes.
8. Write `audit_logs` with before/after snapshots.

### Phase 4: Manual Review

Create a `needs-review` queue for:

- Generated pages with non-empty unique content.
- Conflicting daily log fields for the same date.
- PRM records that look like media but have people relations.
- Media records with the same title but different media type.
- Zettels with attachments whose canonical target is unclear.
- Archived work docs that might also be project notes.

## 7. Acceptance Criteria

- Journal entries are browsable by date in Life Ops.
- Meditation entries are browsable by date and searchable by verse/text.
- `🗓️@오늘` and similar generated pages are not visible in normal Vault or search after extraction.
- Media pages appear in Media Shelf, not as random PRM people or raw zettel duplicates.
- Sermons, faith notes, and creative writing can be opened through saved views.
- Old workplace documents are hidden from active views but remain retrievable through Archived Work Docs.
- Every hidden/deleted imported record has an audit trail.
- Dry-run output gives enough samples to approve or reject the apply step.

## 8. Safety Rules

- Never hard-delete before backup and manual spot-check.
- Never overwrite richer human-written content with rollup text.
- Preserve `notion_source_id` and `import_batch_id`.
- Keep source-to-target ids in audit logs.
- Prefer soft deletion for source pages and duplicate artifacts.
- If the classifier is uncertain, tag `needs-review` instead of moving.
- Any hard deletion of auto logs must be limited to records already audited as extracted.

## 9. Suggested Prompt For GPT Worker

Use this prompt when delegating the next implementation pass:

```text
You are working in Project Light-House. The Notion data is already migrated, but classification is messy. Read Docs/09_DATA_RECLASSIFICATION_PLAN.md and implement the next safe pass.

Priorities:
1. Inspect current schemas, import code, reclassification code, and migrations/*.zip.
2. Treat this as existing-data reclassification plus targeted enrichment from the original export, not a full re-migration.
3. Add minimal schema support if current tables cannot represent useful AS-IS data, especially daily-log/person relations and the gifts import identity schema mismatch.
4. Replace mojibake-based classification rules with clean Korean/English rules based on the source zip headers and sampled data.
5. Make scripts/reclassify-data.ts produce a reliable dry-run report before mutation.
6. Move useful generated daily log content into Life Ops daily_logs/workouts, then soft-delete the generated source pages from active views.
7. Seed saved views for Journal, Meditation, Sermons/Faith, Creative Writing, Media Shelf, Archived Work Docs, Needs Review, and Auto Logs Hidden.
8. Do not hard-delete anything unless a backup exists and the record is audited as an extracted auto-log.

Deliverables:
- Updated script and/or supporting helpers.
- A dry-run command and example output shape.
- Any schema/UI notes required to make the data browsable.
- No broad refactors.
```
