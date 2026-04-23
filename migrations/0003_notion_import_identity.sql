ALTER TABLE `audit_logs` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_audit_batch` ON `audit_logs` (`user_id`,`import_batch_id`);
--> statement-breakpoint
ALTER TABLE `projects` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_proj_notion_source` ON `projects` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_task_notion_source` ON `tasks` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `people` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_person_notion_source` ON `people` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `gifts` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `gifts` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_gift_notion_source` ON `gifts` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_dl_notion_source` ON `daily_logs` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `workouts` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `workouts` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_wo_notion_source` ON `workouts` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `career_history` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `career_history` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_career_notion_source` ON `career_history` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `zettels` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `zettels` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_zettel_notion_source` ON `zettels` (`user_id`,`notion_source_id`);
--> statement-breakpoint
ALTER TABLE `media_logs` ADD `notion_source_id` text;
--> statement-breakpoint
ALTER TABLE `media_logs` ADD `import_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_media_notion_source` ON `media_logs` (`user_id`,`notion_source_id`);
