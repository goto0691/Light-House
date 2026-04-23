CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`entity_type` text,
	`entity_id` text,
	`read_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_user_read` ON `notifications` (`user_id`,`read_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_notification_entity` ON `notifications` (`entity_type`,`entity_id`);

