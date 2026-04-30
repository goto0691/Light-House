alter table zettels add column aliases text;
alter table zettels add column source_reliability text;
alter table zettels add column review_cadence text;
alter table zettels add column review_due_at text;

create index idx_zettel_source_reliability on zettels(user_id, source_reliability);
create index idx_zettel_review_due on zettels(user_id, review_due_at);
