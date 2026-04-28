# Project Light House v2 Docs

> Status: v2 redesign baseline, created on 2026-04-26.
> Rule: legacy plans are reference-only. New product and schema work starts from the AS-IS export schema.

## Document Map

| Order | Document | Purpose |
|---:|---|---|
| 00 | [AS-IS Schema Audit](./00_AS_IS_SCHEMA_AUDIT.md) | Inventory of the original exported databases, fields, relationships, and current-system strengths to preserve. |
| 01 | [TO-BE Schema Blueprint](./01_TO_BE_SCHEMA_BLUEPRINT.md) | Canonical v2 data model, source preservation layer, entity relationships, and migration mapping. |
| 02 | [TO-BE UI/UX Specification](./02_TO_BE_UI_UX_SPECIFICATION.md) | Product navigation, page structure, view model, component behavior, and editing UX based only on the v2 schema. |
| 03 | [Refactor Execution Plan](./03_REFACTOR_EXECUTION_PLAN.md) | Order of operations for schema migration, data remap, UI refactor, QA, and release. |

## Legacy Plans

The previous planning set has been moved to:

`./Legacy/2026-04-26_pre_asis_planning`

Those documents are preserved for historical context, but they are no longer the source of truth. If a legacy decision conflicts with the v2 docs, the v2 docs win.

## v2 Product Thesis

Light House is not a generic productivity dashboard. It is a personal archive and operating system whose first obligation is to preserve the user's existing information shape:

- Long-form writings, sermons, reflections, and knowledge notes must remain readable as documents.
- Daily logs, journals, meditations, workouts, and routines must remain date-addressable.
- Media history must retain type-specific fields such as game platform, play time, screen rewatch value, book publisher, and review.
- People must retain relationship context, gifts, birthdays, addresses, values, and linked documents.
- Projects must retain linked knowledge, life logs, people, energy cost, importance, artifacts, and status.

The current implementation still contributes strong infrastructure: D1/R2/Auth, Source Trace, entity links, tags, saved views, command palette, layout shell, and context panels. v2 keeps those foundations and rebuilds the product information architecture around the AS-IS schema.

## Design Rules

1. The AS-IS export decides the canonical domain model.
2. Canonical tables store fields that the user needs to sort, filter, edit, or see often.
3. Source records store every original field, raw body, and relation even when no canonical column exists.
4. Saved views and tag-filtered collections replace one-off archive pages.
5. UI must expose both clean canonical fields and a collapsible source inspector.
6. Data migration must be reversible until the v2 QA checklist passes.
