# Data Reclassification Plan

## Direction

Notion migration is complete. We will not optimize future imports first. The next step is to read the current D1 data and the original Notion export, then normalize the existing records into usable Light House views.

We should avoid creating separate silo pages such as a fixed "Sermon Library". Instead, we will use shared tags, saved views, and filters so the same records can appear naturally in Vault, Life Ops, Media, or search depending on their metadata.

## AS-IS Findings

### Notion Sources

The imported Notion export contains several datasets whose properties are not fully represented in the current app schema.

| Notion source | Rows | Key fields | Current gap |
| --- | ---: | --- | --- |
| `1 지식 창고` | 129 | category, type, status, summary, source, created time, related people, meditation log | Zettels store category/type/summary but relation metadata and Notion status are weak. |
| `컨텐츠 로그` | 327 | media type, evaluation, platform, genre, short review, director, linked game/book/screen logs, studio | Media model has most fields, but content-log rollup pages also landed as raw Zettels. |
| `영상 로그` | 145 | creator, studio, review, type, genre, rating, platform, related people, rewatch value, watch status | Rewatch value, related people, and status normalization need repair. |
| `게임 로그` | 172 in `_all` | developer, date, review, status, genre, rating, platform, play time | Some detail pages remain as raw Zettels. |
| `도서 로그` | 1 | author, publisher, review, genre, rating | Mostly mapped, but should share media views. |
| `일기` | 54 | title, date, mood, event/body, related people, tags, linked life log | Daily logs currently keep only part of this and do not expose an archive view. |
| `묵상` | 43 | verse, date, linked life log, background knowledge | Daily logs keep verse/meditation, but there is no browse/search view. |
| `라이프 로그` | 107 | date, daily journal, meditation, workout rollups | Some rollup shell pages landed as raw Zettels and should be ignored or used only as linkage. |
| `운동 로그` | 324 currently in D1 including duplicates | date, workout kind, linked life log | Duplicates and empty automated logs should be collapsed. |
| `외출자 특이사항` | 9 | patient leave notes | Previous workplace operational documents. Keep archived or soft-delete from active views. |

### Current D1 Symptoms

- PRM contains non-person media records such as `오징어 게임`.
- Vault Zettels contain raw media detail pages such as `오징어 게임`, `51가지 세계의 게임`.
- Vault Zettels contain Life Ops shell pages such as `🗓️@오늘`, `🏃@... 운동 완료`.
- Daily logs contain useful journal/meditation data but no archive UI.
- Workout logs include repeated automated placeholders.
- Sermons and faith notes are present as Zettels, but the app only shows a generic Zettel list.

## Target Model

### Tags As The Primary Lens

Use tags and saved views to expose records without splitting them into artificial domains.

Recommended canonical tags:

| Tag | Applies to | Purpose |
| --- | --- | --- |
| `journal` | daily_log, zettel | Personal diary and reflective entries. |
| `meditation` | daily_log, zettel | QT, verse-based meditation, devotional notes. |
| `sermon` | zettel | Sermon manuscripts and sermon notes. |
| `faith` | zettel | Broader faith/religion writings. |
| `writing` | zettel | Poems, fiction, essays, creative drafts. |
| `media` | media, zettel | Media records and media-derived notes. |
| `game`, `book`, `screen` | media | Media subtype filters. |
| `workout` | daily_log, workout | Exercise records. |
| `archive-work` | zettel | Old workplace operational documents hidden from active default views. |
| `auto-log` | zettel, daily_log, workout | Notion automation shell records with little standalone meaning. |

### Saved Views

Saved views should be the user's main access point.

| View | Domain/scope | Filter |
| --- | --- | --- |
| Journal Archive | Life Ops / daily | `tag:journal`, sorted by date desc. |
| Meditation Archive | Life Ops / daily | `tag:meditation`, sorted by date desc. |
| Sermons & Faith Notes | Vault / zettels | `tag:sermon OR tag:faith`, sorted by created/date desc. |
| Creative Writing | Vault / zettels | `tag:writing`, sorted by updated desc. |
| Media Shelf | Vault / media | `type:game/book/screen`, status and rating filters. |
| Archived Work Docs | Vault / zettels | `tag:archive-work`, hidden from default view. |

## Reclassification Rules

### Move To Media

Move or merge into `media_logs` when title/content/person fields contain explicit media schema:

- `감독/크리에이터`, `감독`, `개발사`, `제작사`, `플랫폼`, `플레이 타임`, `시청상태`, `다시 볼 가치`, `영상 로그`, `게임 로그`, `도서 로그`, `컨텐츠 로그`.
- If a duplicate already exists in `media_logs`, preserve the raw Zettel content in `media_logs.content`, add missing fields, then soft-delete the raw Zettel from active views.
- If a PRM person matches these rules, create or merge a media row and soft-delete the person.

### Move To Life Ops

Extract data into Life Ops when content contains real journal, meditation, or workout data:

- Diary: `제목`, `날짜`, `감정`, `사건`, `태그`.
- Meditation: `본문말씀`, `배경지식`, `묵상`.
- Workout: `운동 종류`, explicit exercise note.

Rules:

- Daily journal and meditation should be accessible by date.
- Empty Notion rollup shells such as `오늘 일기 ❌`, `오늘 묵상 ❌`, `오늘 운동 ❌` should not appear in active views.
- Workout placeholders with no real category/detail should be collapsed or tagged `auto-log`.

### Keep In Vault

Keep as Zettels but tag and improve discoverability:

- Sermon manuscripts: `유형: 설교문`, `본문:`, Bible passage patterns.
- Faith/religion notes: `카테고리: 신앙/종교`.
- Creative writing: `카테고리: 창작`, `유형: 시`, `세계관 설정`, `아이디어`.
- Reference notes and prompt guides: retain as Zettels with source/category tags.

### Archive From Active Views

Do not delete old workplace documents. Tag them `archive-work` and hide from default views:

- Patient leave notes and hospital operational notes.
- Titles/content with `외출자`, `외출목적`, `간병인`, `환자`, `병원`, `국군수도병원`.

## Implementation Plan

1. Add a dry-run D1 reclassification script.
2. The script prints candidate counts and examples before mutation.
3. Add tags and taggings for detected records.
4. Merge PRM/Zettel media records into `media_logs`.
5. Extract useful diary/meditation/workout records into Life Ops.
6. Soft-hide meaningless automation shells with `auto-log`, not delete.
7. Seed saved views for Journal, Meditation, Sermons/Faith, Creative Writing, Media Shelf, and Archived Work Docs.
8. Update list UIs to support tag filters and saved views.

## Safety

- Never hard-delete migrated records in the first pass.
- Use `deleted_at` only when a record is a duplicate or wrong-domain artifact.
- Keep `notion_source_id`, `import_batch_id`, and audit log entries.
- Write a reclassification audit log with moved/merged/tagged counts.
