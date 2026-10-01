CREATE TABLE `v2_rediscovery_preferences` (
  `user_id` text PRIMARY KEY NOT NULL,
  `enabled` integer NOT NULL DEFAULT 0 CHECK (`enabled` in (0,1)),
  `include_sensitive` integer NOT NULL DEFAULT 0 CHECK (`include_sensitive` in (0,1)),
  `enabled_at` text,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `v2_rediscovery_events` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `record_id` text NOT NULL,
  `event_kind` text NOT NULL CHECK (`event_kind` in ('shown','opened','dismissed')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`record_id`) REFERENCES `v2_documents`(`object_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_v2_rediscovery_event_user_record_time` ON `v2_rediscovery_events` (`user_id`,`record_id`,`created_at`);
