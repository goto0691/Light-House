CREATE TABLE `checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`content` text NOT NULL,
	`is_completed` integer DEFAULT false,
	`display_order` integer DEFAULT 0,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_checklist_task` ON `checklists` (`task_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text,
	`kind` text DEFAULT 'project' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`category` text,
	`start_date` text,
	`target_date` text,
	`progress` integer DEFAULT 0,
	`pinned` integer DEFAULT false,
	`display_order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_proj_user_status` ON `projects` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_proj_slug` ON `projects` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `task_people_relations` (
	`task_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role_context` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pk_task_people` ON `task_people_relations` (`task_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `task_zettel_relations` (
	`task_id` text NOT NULL,
	`zettel_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zettel_id`) REFERENCES `zettels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pk_task_zettel` ON `task_zettel_relations` (`task_id`,`zettel_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`kind` text DEFAULT 'development' NOT NULL,
	`content` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'P2' NOT NULL,
	`brain_energy` text DEFAULT 'normal' NOT NULL,
	`start_at` text,
	`due_at` text,
	`completed_at` text,
	`display_order` integer DEFAULT 0,
	`word_count` integer,
	`episode_number` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_task_user_status` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_task_due` ON `tasks` (`due_at`);--> statement-breakpoint
CREATE INDEX `idx_task_kind` ON `tasks` (`kind`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`hashed_password` text,
	`locale` text DEFAULT 'ko-KR',
	`timezone` text DEFAULT 'Asia/Seoul',
	`preferences` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`input` text NOT NULL,
	`output` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_user_time` ON `ai_conversations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quick_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`raw_text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`suggested_domain` text,
	`suggested_fields` text,
	`confidence` real,
	`routed_entity_type` text,
	`routed_entity_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_qc_user_status` ON `quick_captures` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `career_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization` text NOT NULL,
	`role` text NOT NULL,
	`category` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`location` text,
	`description` text,
	`highlights` text,
	`cover_image_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_career_user_start` ON `career_history` (`user_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `daily_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`mood` integer,
	`energy_level` integer,
	`emotions` text,
	`gratitude` text,
	`journal` text,
	`meditation` text,
	`meditation_verse` text,
	`ai_summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_dl_user_date` ON `daily_logs` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `habit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_hl_habit_date` ON `habit_logs` (`habit_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_hl_user_date` ON `habit_logs` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'boolean' NOT NULL,
	`target_value` integer,
	`unit` text,
	`icon` text,
	`color` text,
	`schedule` text,
	`is_active` integer DEFAULT true,
	`display_order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_habit_user_active` ON `habits` (`user_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `health_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`sleep_hours` real,
	`sleep_quality` integer,
	`weight` real,
	`resting_heart_rate` integer,
	`deep_work_minutes` integer,
	`steps_count` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hm_user_date` ON `health_metrics` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`categories` text NOT NULL,
	`duration_minutes` integer,
	`intensity` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_wo_user_date` ON `workouts` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `gifts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`person_id` text NOT NULL,
	`direction` text NOT NULL,
	`title` text NOT NULL,
	`occurred_at` text NOT NULL,
	`reason` text,
	`cost` integer,
	`satisfaction` text,
	`options` text,
	`image_url` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_gift_person` ON `gifts` (`person_id`);--> statement-breakpoint
CREATE TABLE `interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`person_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`type` text DEFAULT 'meeting' NOT NULL,
	`intensity` integer,
	`summary` text,
	`content` text,
	`protocol` text,
	`place_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_intr_person_time` ON `interactions` (`person_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `network_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_person_id` text NOT NULL,
	`target_person_id` text NOT NULL,
	`relation_type` text,
	`strength` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`source_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_edge_source` ON `network_edges` (`source_person_id`);--> statement-breakpoint
CREATE INDEX `idx_edge_target` ON `network_edges` (`target_person_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`nickname` text,
	`birth_date` text,
	`photo_url` text,
	`groups` text,
	`dunbar_layer` integer,
	`intimacy` integer,
	`core_value` text,
	`bio` text,
	`last_contacted_at` text,
	`contact_cadence_days` integer,
	`phone` text,
	`email` text,
	`address` text,
	`social_links` text,
	`status` text DEFAULT 'active' NOT NULL,
	`is_favorite` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_person_user_status` ON `people` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_person_layer` ON `people` (`user_id`,`dunbar_layer`);--> statement-breakpoint
CREATE INDEX `idx_person_last_contact` ON `people` (`last_contacted_at`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`r2_key` text NOT NULL,
	`cdn_url` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`meta` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_attach_owner` ON `attachments` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_attach_user` ON `attachments` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`snapshot` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_user_time` ON `audit_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `taggings` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`taggable_type` text NOT NULL,
	`taggable_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_taggings_poly` ON `taggings` (`taggable_type`,`taggable_id`);--> statement-breakpoint
CREATE INDEX `idx_taggings_tag` ON `taggings` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text,
	`parent_id` text,
	`usage_count` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_tag_user_slug` ON `tags` (`user_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_tag_parent` ON `tags` (`parent_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`model_name` text,
	`acquired_date` text,
	`acquired_price` integer,
	`current_condition` text,
	`notes` text,
	`cover_image_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `media_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`media_type` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text,
	`platform_or_publisher` text,
	`creator` text,
	`studio` text,
	`genre` text,
	`release_year` integer,
	`status` text DEFAULT 'backlog' NOT NULL,
	`rating` real,
	`evaluation` text,
	`review` text,
	`content` text,
	`play_time` integer,
	`author` text,
	`pages` integer,
	`screen_kind` text,
	`rewatch_value` integer DEFAULT false,
	`cover_image_url` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_media_user_type_status` ON `media_logs` (`user_id`,`media_type`,`status`);--> statement-breakpoint
CREATE TABLE `media_people_relations` (
	`media_id` text NOT NULL,
	`person_id` text NOT NULL,
	`context` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_logs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `place_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`visited_at` text NOT NULL,
	`rating` real,
	`review` text,
	`companion_ids` text,
	`expense` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`address` text,
	`latitude` real,
	`longitude` real,
	`map_url` text,
	`first_visited_at` text,
	`last_visited_at` text,
	`visit_count` integer DEFAULT 0,
	`average_rating` real,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `zettel_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`context` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `zettels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `zettels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_zlink_source` ON `zettel_links` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_zlink_target` ON `zettel_links` (`target_id`);--> statement-breakpoint
CREATE TABLE `zettel_media_relations` (
	`zettel_id` text NOT NULL,
	`media_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`zettel_id`) REFERENCES `zettels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_logs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pk_zettel_media` ON `zettel_media_relations` (`zettel_id`,`media_id`);--> statement-breakpoint
CREATE TABLE `zettel_people_relations` (
	`zettel_id` text NOT NULL,
	`person_id` text NOT NULL,
	`context` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`zettel_id`) REFERENCES `zettels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pk_zettel_people` ON `zettel_people_relations` (`zettel_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `zettels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text,
	`content_text` text,
	`summary` text,
	`type` text DEFAULT 'fleeting' NOT NULL,
	`category` text,
	`source` text,
	`source_url` text,
	`vector_id` text,
	`vector_hash` text,
	`pinned` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_zettel_user_type` ON `zettels` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_zettel_slug` ON `zettels` (`user_id`,`slug`);