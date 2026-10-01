CREATE TABLE `v2_review_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `review_item_id` text NOT NULL,
  `user_id` text NOT NULL,
  `object_id` text NOT NULL,
  `action` text NOT NULL CHECK (`action` in ('accept','reject','correct','dismiss')),
  `target_kind` text NOT NULL CHECK (`target_kind` in ('property_value','type_assignment','entity','event','relation','review_item')),
  `target_id` text,
  `prior_status` text,
  `result_status` text NOT NULL,
  `high_risk_confirmed` integer NOT NULL DEFAULT 0 CHECK (`high_risk_confirmed` in (0,1)),
  `corrected_value_json` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`review_item_id`) REFERENCES `v2_review_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_review_receipt_item` ON `v2_review_receipts` (`review_item_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_review_receipt_user_time` ON `v2_review_receipts` (`user_id`,`created_at`);
