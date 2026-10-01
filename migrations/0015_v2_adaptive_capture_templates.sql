CREATE TABLE `v2_capture_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `icon_key` text NOT NULL,
  `origin` text NOT NULL CHECK (`origin` in ('system_seed','user_created','ai_derived','imported')),
  `status` text NOT NULL CHECK (`status` in ('draft','generated_draft','suggested','trial','active','dismissed','archived')),
  `current_version_id` text,
  `pattern_signature` text,
  `pinned` integer NOT NULL DEFAULT 0 CHECK (`pinned` in (0,1)),
  `usage_count` integer NOT NULL DEFAULT 0 CHECK (`usage_count` >= 0),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_v2_capture_template_user_name` ON `v2_capture_templates` (`user_id`,`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_capture_template_pattern` ON `v2_capture_templates` (`user_id`,`pattern_signature`) WHERE `pattern_signature` is not null;
--> statement-breakpoint
CREATE INDEX `idx_v2_capture_template_user_status` ON `v2_capture_templates` (`user_id`,`status`,`pinned`,`usage_count`);
--> statement-breakpoint
CREATE TABLE `v2_capture_template_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL,
  `version_number` integer NOT NULL CHECK (`version_number` > 0),
  `definition_json` text NOT NULL,
  `registry_snapshot_version` text NOT NULL,
  `source_model` text,
  `prompt_version` text,
  `approved_at` text,
  `previous_version_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`template_id`) REFERENCES `v2_capture_templates`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`previous_version_id`) REFERENCES `v2_capture_template_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_capture_template_version` ON `v2_capture_template_versions` (`template_id`,`version_number`);
--> statement-breakpoint
CREATE TRIGGER `v2_capture_template_versions_immutable` BEFORE UPDATE ON `v2_capture_template_versions` BEGIN
  SELECT RAISE(ABORT, 'published template versions are immutable');
END;
--> statement-breakpoint
CREATE TABLE `v2_template_source_links` (
  `template_version_id` text NOT NULL,
  `source_document_id` text NOT NULL,
  `source_revision_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` in ('example','pattern_source','user_selected')),
  `created_at` text NOT NULL,
  PRIMARY KEY (`template_version_id`,`source_document_id`,`source_revision_id`,`role`),
  FOREIGN KEY (`template_version_id`) REFERENCES `v2_capture_template_versions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_document_id`) REFERENCES `v2_documents`(`object_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_revision_id`) REFERENCES `v2_document_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `v2_capture_template_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `draft_id` text NOT NULL,
  `capture_id` text,
  `template_version_id` text NOT NULL,
  `state` text NOT NULL CHECK (`state` in ('active','detached','submitted')),
  `applied_at` text NOT NULL,
  `detached_at` text,
  `submitted_at` text,
  `input_snapshot_json` text NOT NULL DEFAULT '[]',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`capture_id`) REFERENCES `v2_capture_bundles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`template_version_id`) REFERENCES `v2_capture_template_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_capture_template_session_capture` ON `v2_capture_template_sessions` (`capture_id`) WHERE `capture_id` is not null;
--> statement-breakpoint
CREATE INDEX `idx_v2_capture_template_session_draft` ON `v2_capture_template_sessions` (`user_id`,`draft_id`,`applied_at`);
--> statement-breakpoint
CREATE TABLE `v2_capture_input_values` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `user_id` text NOT NULL,
  `item_key` text NOT NULL,
  `binding_snapshot_json` text NOT NULL,
  `value_kind` text NOT NULL CHECK (`value_kind` in ('text','number','boolean','date','rating','json')),
  `value_json` text,
  `input_order` integer NOT NULL DEFAULT 0 CHECK (`input_order` >= 0),
  `blank_state` text NOT NULL CHECK (`blank_state` in ('answered','unanswered','unknown','not_applicable','withheld')),
  `client_timestamp` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `v2_capture_template_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_capture_input_item_order` ON `v2_capture_input_values` (`session_id`,`item_key`,`input_order`);
--> statement-breakpoint
CREATE INDEX `idx_v2_capture_input_user_item` ON `v2_capture_input_values` (`user_id`,`item_key`,`created_at`);
--> statement-breakpoint
CREATE TABLE `v2_template_pattern_observations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `pattern_signature` text NOT NULL,
  `signature_version` integer NOT NULL DEFAULT 1,
  `source_document_id` text NOT NULL,
  `source_revision_id` text NOT NULL,
  `observed_date` text NOT NULL,
  `type_key` text,
  `features_json` text NOT NULL,
  `candidate_definition_json` text,
  `similarity` real,
  `cluster_id` text NOT NULL,
  `outcome` text NOT NULL DEFAULT 'observed' CHECK (`outcome` in ('observed','generated','dismissed','merged')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_document_id`) REFERENCES `v2_documents`(`object_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_revision_id`) REFERENCES `v2_document_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_template_pattern_source` ON `v2_template_pattern_observations` (`user_id`,`pattern_signature`,`source_document_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_template_pattern_threshold` ON `v2_template_pattern_observations` (`user_id`,`pattern_signature`,`observed_date`,`outcome`);
