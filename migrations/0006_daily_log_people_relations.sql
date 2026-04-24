CREATE TABLE IF NOT EXISTS `daily_log_people_relations` (
  `daily_log_id` text NOT NULL,
  `person_id` text NOT NULL,
  `context` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`daily_log_id`) REFERENCES `daily_logs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pk_daily_log_people` ON `daily_log_people_relations` (`daily_log_id`,`person_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_daily_log_people_person` ON `daily_log_people_relations` (`person_id`);
