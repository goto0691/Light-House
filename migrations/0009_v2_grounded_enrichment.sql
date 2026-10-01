CREATE TABLE `v2_grounding_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `analysis_job_id` text NOT NULL,
  `processing_job_id` text NOT NULL,
  `user_id` text NOT NULL,
  `capture_id` text NOT NULL,
  `object_id` text NOT NULL,
  `input_revision_id` text NOT NULL,
  `request_key` text NOT NULL,
  `entity_kind` text NOT NULL CHECK (`entity_kind` in ('place','work','book','game')),
  `query_text` text NOT NULL,
  `query_hash` text NOT NULL,
  `requested_fields_json` text NOT NULL,
  `status` text NOT NULL DEFAULT 'queued' CHECK (`status` in ('queued','running','succeeded','stale','needs_review')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`analysis_job_id`) REFERENCES `v2_processing_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`processing_job_id`) REFERENCES `v2_processing_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`capture_id`) REFERENCES `v2_capture_bundles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_grounding_analysis_request` ON `v2_grounding_requests` (`analysis_job_id`,`request_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_grounding_processing_job` ON `v2_grounding_requests` (`processing_job_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_grounding_request_object` ON `v2_grounding_requests` (`user_id`,`object_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `v2_grounding_results` (
  `id` text PRIMARY KEY NOT NULL,
  `request_id` text NOT NULL,
  `run_id` text NOT NULL,
  `user_id` text NOT NULL,
  `answer_text` text NOT NULL,
  `citations_json` text NOT NULL,
  `queries_json` text NOT NULL,
  `output_hash` text NOT NULL,
  `status` text NOT NULL CHECK (`status` in ('cited','stale','needs_review')),
  `verified_at` text NOT NULL,
  FOREIGN KEY (`request_id`) REFERENCES `v2_grounding_requests`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_grounding_result_request` ON `v2_grounding_results` (`request_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_grounding_result_user_time` ON `v2_grounding_results` (`user_id`,`verified_at`);
