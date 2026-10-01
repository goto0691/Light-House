CREATE TABLE `v2_type_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `key` text NOT NULL,
  `label` text NOT NULL,
  `applies_to_kind` text NOT NULL CHECK (`applies_to_kind` in ('document','entity','event')),
  `status` text NOT NULL DEFAULT 'candidate' CHECK (`status` in ('candidate','observed','active','archived','merged')),
  `origin` text NOT NULL CHECK (`origin` in ('system_seed','ai_proposed','user_created','imported')),
  `definition` text NOT NULL,
  `schema_version` integer NOT NULL DEFAULT 1 CHECK (`schema_version` >= 1),
  `usage_count` integer NOT NULL DEFAULT 0 CHECK (`usage_count` >= 0),
  `user_pinned` integer NOT NULL DEFAULT 0 CHECK (`user_pinned` in (0,1)),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_type_definition_user_key` ON `v2_type_definitions` (`user_id`,`key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_type_definition_user_status` ON `v2_type_definitions` (`user_id`,`status`,`usage_count`);
--> statement-breakpoint
CREATE TABLE `v2_field_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `key` text NOT NULL,
  `label` text NOT NULL,
  `definition` text NOT NULL,
  `data_type` text NOT NULL CHECK (`data_type` in ('short_text','long_text','integer','decimal','boolean','date','datetime','duration','measurement','rating','enum_value','object_reference','url','geo_point','ordered_list','structured_json')),
  `canonical_unit` text,
  `status` text NOT NULL DEFAULT 'candidate' CHECK (`status` in ('candidate','observed','active','archived','merged')),
  `origin` text NOT NULL CHECK (`origin` in ('system_seed','ai_proposed','user_created','imported')),
  `semantic_fingerprint` text,
  `filterable` integer NOT NULL DEFAULT 0 CHECK (`filterable` in (0,1)),
  `sortable` integer NOT NULL DEFAULT 0 CHECK (`sortable` in (0,1)),
  `facetable` integer NOT NULL DEFAULT 0 CHECK (`facetable` in (0,1)),
  `schema_version` integer NOT NULL DEFAULT 1 CHECK (`schema_version` >= 1),
  `usage_count` integer NOT NULL DEFAULT 0 CHECK (`usage_count` >= 0),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_field_definition_user_key` ON `v2_field_definitions` (`user_id`,`key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_field_definition_user_status` ON `v2_field_definitions` (`user_id`,`status`,`usage_count`);
--> statement-breakpoint
CREATE TABLE `v2_object_type_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `object_id` text NOT NULL,
  `type_definition_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` in ('primary','secondary','inferred')),
  `source_class` text NOT NULL CHECK (`source_class` in ('user','ai','import')),
  `review_status` text NOT NULL CHECK (`review_status` in ('accepted','proposed','rejected','superseded')),
  `processing_run_id` text,
  `locked_by_user` integer NOT NULL DEFAULT 0 CHECK (`locked_by_user` in (0,1)),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`type_definition_id`) REFERENCES `v2_type_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`processing_run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_object_type_assignment` ON `v2_object_type_assignments` (`object_id`,`type_definition_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_object_type_user_status` ON `v2_object_type_assignments` (`user_id`,`review_status`,`object_id`);
--> statement-breakpoint
CREATE TABLE `v2_property_values` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `owner_object_id` text NOT NULL,
  `field_definition_id` text NOT NULL,
  `proposal_temp_id` text,
  `value_kind` text NOT NULL CHECK (`value_kind` in ('text','number','boolean','date','rating','json')),
  `value_text` text,
  `value_number` real,
  `value_boolean` integer CHECK (`value_boolean` is null or `value_boolean` in (0,1)),
  `value_date` text,
  `value_json` text NOT NULL,
  `unit_key` text,
  `source_class` text NOT NULL CHECK (`source_class` in ('user_locked','user_explicit','user_context','image_ocr','transcript_extract','exif','external_grounded','calculated','ai_inferred','imported')),
  `claim_risk` text NOT NULL CHECK (`claim_risk` in ('low','autobiographical','social_high_risk')),
  `confidence` real CHECK (`confidence` is null or (`confidence` >= 0 and `confidence` <= 1)),
  `review_status` text NOT NULL CHECK (`review_status` in ('accepted','proposed','disputed','rejected','superseded')),
  `confirmed_by_user_at` text,
  `locked_by_user` integer NOT NULL DEFAULT 0 CHECK (`locked_by_user` in (0,1)),
  `supersedes_value_id` text,
  `processing_run_id` text,
  `created_at` text NOT NULL,
  `superseded_at` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`owner_object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`field_definition_id`) REFERENCES `v2_field_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`supersedes_value_id`) REFERENCES `v2_property_values`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`processing_run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_property_run_temp` ON `v2_property_values` (`processing_run_id`,`proposal_temp_id`) WHERE `processing_run_id` is not null AND `proposal_temp_id` is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_property_current_accepted` ON `v2_property_values` (`owner_object_id`,`field_definition_id`) WHERE `review_status`='accepted' AND `superseded_at` is null;
--> statement-breakpoint
CREATE INDEX `idx_v2_property_user_field_status` ON `v2_property_values` (`user_id`,`field_definition_id`,`review_status`);
--> statement-breakpoint
CREATE TABLE `v2_evidence_refs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `target_kind` text NOT NULL CHECK (`target_kind` in ('type_assignment','property_value','entity','event','relation')),
  `target_id` text NOT NULL,
  `source_item_id` text,
  `locator_kind` text NOT NULL CHECK (`locator_kind` in ('text_span','image_region','transcript_time','form_field','external_url','exif')),
  `locator_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_item_id`) REFERENCES `v2_source_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_v2_evidence_target` ON `v2_evidence_refs` (`target_kind`,`target_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_evidence_source` ON `v2_evidence_refs` (`user_id`,`source_item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_evidence_locator` ON `v2_evidence_refs` (`target_kind`,`target_id`,`source_item_id`,`locator_kind`,`locator_json`);
--> statement-breakpoint
CREATE TABLE `v2_review_items` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `object_id` text NOT NULL,
  `processing_run_id` text,
  `kind` text NOT NULL CHECK (`kind` in ('registry_conflict','value_conflict','high_risk_claim','analysis_review','analysis_warning')),
  `status` text NOT NULL DEFAULT 'open' CHECK (`status` in ('open','resolved','dismissed')),
  `payload_json` text NOT NULL,
  `created_at` text NOT NULL,
  `resolved_at` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`processing_run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_v2_review_user_status_time` ON `v2_review_items` (`user_id`,`status`,`created_at`);
