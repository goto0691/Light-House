CREATE TABLE `v2_entity_records` (
  `object_id` text PRIMARY KEY NOT NULL,
  `proposal_temp_id` text,
  `processing_run_id` text,
  `entity_kind` text NOT NULL,
  `canonical_name` text NOT NULL,
  `resolution_status` text NOT NULL CHECK (`resolution_status` in ('local_candidate','external_required','unresolved','resolved')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`processing_run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_entity_run_temp` ON `v2_entity_records` (`processing_run_id`,`proposal_temp_id`) WHERE `processing_run_id` is not null AND `proposal_temp_id` is not null;
--> statement-breakpoint
CREATE INDEX `idx_v2_entity_kind_name` ON `v2_entity_records` (`entity_kind`,`canonical_name`);
--> statement-breakpoint
CREATE TABLE `v2_event_records` (
  `object_id` text PRIMARY KEY NOT NULL,
  `proposal_temp_id` text,
  `processing_run_id` text,
  `event_type_key` text NOT NULL,
  `occurred_at_start` text,
  `occurred_at_end` text,
  `time_precision` text NOT NULL DEFAULT 'unknown' CHECK (`time_precision` in ('exact','day','month','year','unknown')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`processing_run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_event_run_temp` ON `v2_event_records` (`processing_run_id`,`proposal_temp_id`) WHERE `processing_run_id` is not null AND `proposal_temp_id` is not null;
--> statement-breakpoint
CREATE INDEX `idx_v2_event_type_time` ON `v2_event_records` (`event_type_key`,`occurred_at_start`);
--> statement-breakpoint
CREATE TABLE `v2_predicate_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `key` text NOT NULL,
  `label` text NOT NULL,
  `definition` text NOT NULL,
  `inverse_key` text,
  `status` text NOT NULL DEFAULT 'candidate' CHECK (`status` in ('candidate','observed','active','archived','merged')),
  `origin` text NOT NULL CHECK (`origin` in ('system_seed','ai_proposed','user_created','imported')),
  `schema_version` integer NOT NULL DEFAULT 1 CHECK (`schema_version` >= 1),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_predicate_user_key` ON `v2_predicate_definitions` (`user_id`,`key`);
--> statement-breakpoint
CREATE TABLE `v2_relation_edges` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `subject_object_id` text NOT NULL,
  `predicate_definition_id` text NOT NULL,
  `object_object_id` text NOT NULL,
  `source_class` text NOT NULL CHECK (`source_class` in ('user_explicit','external_grounded','ai_inferred','imported')),
  `claim_risk` text NOT NULL CHECK (`claim_risk` in ('low','autobiographical','social_high_risk')),
  `review_status` text NOT NULL CHECK (`review_status` in ('accepted','proposed','disputed','rejected','superseded')),
  `processing_run_id` text,
  `locked_by_user` integer NOT NULL DEFAULT 0 CHECK (`locked_by_user` in (0,1)),
  `created_at` text NOT NULL,
  `superseded_at` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`subject_object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`predicate_definition_id`) REFERENCES `v2_predicate_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`object_object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`processing_run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_relation_run_triple` ON `v2_relation_edges` (`processing_run_id`,`subject_object_id`,`predicate_definition_id`,`object_object_id`) WHERE `processing_run_id` is not null;
--> statement-breakpoint
CREATE INDEX `idx_v2_relation_subject_status` ON `v2_relation_edges` (`user_id`,`subject_object_id`,`review_status`);
--> statement-breakpoint
CREATE INDEX `idx_v2_relation_object_status` ON `v2_relation_edges` (`user_id`,`object_object_id`,`review_status`);
--> statement-breakpoint
CREATE TABLE `v2_unit_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `key` text NOT NULL,
  `label` text NOT NULL,
  `dimension` text NOT NULL,
  `canonical_unit_key` text NOT NULL,
  `conversion_factor` real NOT NULL DEFAULT 1,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` in ('candidate','active','archived')),
  `origin` text NOT NULL CHECK (`origin` in ('system_seed','user_created','imported')),
  `schema_version` integer NOT NULL DEFAULT 1 CHECK (`schema_version` >= 1),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_unit_user_key` ON `v2_unit_definitions` (`user_id`,`key`);
--> statement-breakpoint
CREATE TABLE `v2_type_presentation_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `type_definition_id` text NOT NULL,
  `icon_key` text,
  `accent_role` text NOT NULL DEFAULT 'neutral' CHECK (`accent_role` in ('neutral','primary','warm')),
  `default_collection_preset_key` text,
  `default_record_preset_key` text,
  `source` text NOT NULL CHECK (`source` in ('system','ai_suggested','user')),
  `version` integer NOT NULL DEFAULT 1 CHECK (`version` >= 1),
  `status` text NOT NULL DEFAULT 'candidate' CHECK (`status` in ('candidate','active','archived')),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`type_definition_id`) REFERENCES `v2_type_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_type_profile_version` ON `v2_type_presentation_profiles` (`type_definition_id`,`version`);
--> statement-breakpoint
CREATE INDEX `idx_v2_type_profile_active` ON `v2_type_presentation_profiles` (`user_id`,`status`,`type_definition_id`);
