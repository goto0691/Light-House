# 03. Refactor Execution Plan

> Goal: move from the previous feature-first implementation to the AS-IS schema-driven v2 system without losing data or useful infrastructure.

## Phase 0. Freeze Legacy Direction

Status: done for docs.

- Move previous docs to Legacy.
- Treat previous UI and schema docs as historical references only.
- Stop adding feature UI that is not mapped to v2 schema.

## Phase 1. Schema Contract

Deliverables:

- Finalize physical table decision: keep current names short-term vs rename.
- Add missing canonical fields only where AS-IS requires frequent display/edit/filter.
- Define relation taxonomy for `entity_links`.
- Define source status taxonomy: `staged`, `mapped`, `active`, `archived`, `ignored`, `needs_review`.
- Define default saved views seed data.

Recommended physical strategy:

| Product Concept | Current Table | Action |
|---|---|---|
| source records | `source_documents` | keep physical, rename UI/docs |
| knowledge items | `zettels` | keep physical for now, alias in code/types |
| daily days | `daily_logs` | keep physical for now |
| daily entries | `daily_log_entries` | keep and expand |
| media items | `media_logs` | keep and enrich |
| people | `people` | keep and enrich UI |
| projects | `projects` | keep and enrich |

## Phase 2. Deterministic Remap

Do not use LLM first. Use AS-IS source database and fields.

Mapping order:

1. `1 지식 창고` -> knowledge items.
2. `라이프 로그` -> daily days.
3. `일기`, `묵상` -> daily entries.
4. `운동 로그` -> workouts.
5. `컨텐츠 로그`, `게임 로그`, `영상 로그`, `도서 로그` -> media items.
6. `3 네트워크` -> people.
7. `선물` -> gifts.
8. `2 프로젝트` -> projects.
9. work-specific databases -> archived source records.

Rules:

- Existing source layer remains the staging ledger.
- Canonical IDs should be stable from source IDs where possible.
- Relations are materialized after canonical records exist.
- LLM handles only ambiguous `document_role`, duplicate resolution, and low-confidence classification.

## Phase 3. Saved Views and Retrieval

Seed saved views before redesigning every page.

Required seed groups:

- Library: All, Sermons, Bible Study, Essays, Prompts, Fiction Ideas.
- Daily: Calendar, Journal, Meditation, Sermon Notes, Emotion Timeline, People Mentions.
- Media: All, Games, Screens, Books, Completed, Backlog, Rewatch.
- People: Core, Active, Dormant, Birthdays, Gift History, Appears In Journals.
- Projects: Active, Important, High Energy, Has Artifact.
- Sources: Needs Review, Low Confidence, Archived Work, Unmapped.

## Phase 4. UI Refactor

Order matters:

1. Build shared `CollectionShell`, `SavedViewTabs`, `RecordTable`, `RecordListItem`.
2. Build `RecordDetailShell`, `CanonicalFieldGrid`, `RelationChips`, `SourceInspector`.
3. Refactor Daily first because it proves date + entry + tag/person retrieval.
4. Refactor Media second because it proves type-specific fields.
5. Refactor People third because it proves relationship memory hub.
6. Refactor Library fourth because it proves long-form reading and saved views.
7. Refactor Projects and Home last.

## Phase 5. Source QA

Build Source QA as an internal workbench:

- grouped by source database
- mapped target preview
- confidence and relation count
- archive/hide controls
- AI suggestion button for selected records

This replaces migration-specific pages and removes legacy platform language from normal product pages.

## Phase 6. Validation

Automated checks:

- all active canonical records have at least one source record or are marked manual
- all source records are mapped, archived, ignored, or needs_review
- no active personal view includes archived work databases by default
- diary count, meditation count, media count, person count match expected source inventory
- no user-facing copy contains legacy platform branding

Manual checks:

- find one diary by date, tag, emotion, and person
- read one sermon as a full document
- inspect one game, one screen, one book media item
- open one person and verify linked journals/media/gifts
- open one project and verify linked knowledge/people/daily records

## Phase 7. Release Gate

v2 is acceptable when:

- AS-IS fields are either canonicalized or visible in Source Inspector.
- Default saved views cover all original high-value use cases.
- Normal pages feel like a coherent product, not migration residue.
- Source QA is the only place where migration mechanics are visible.
- Build and typecheck pass.

## Immediate Next Engineering Tasks

1. Stop current ad hoc UI field additions after compiling the existing work.
2. Normalize Docs references to v2 document map.
3. Add schema aliases/types for `knowledge_items`, `daily_days`, `media_items`, `source_records`.
4. Seed default saved views.
5. Refactor Daily archive to use `daily_entries` instead of only recent `daily_logs`.
6. Refactor Media to show AS-IS type-specific fields in list and detail.
7. Refactor People detail into a relationship memory hub.
