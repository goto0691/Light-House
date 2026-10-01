CREATE TABLE `v2_analysis_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `run_id` text NOT NULL,
  `user_id` text NOT NULL,
  `capture_id` text NOT NULL,
  `object_id` text NOT NULL,
  `input_revision_id` text NOT NULL,
  `input_hash` text NOT NULL,
  `output_hash` text NOT NULL,
  `schema_version` text NOT NULL,
  `validator_version` text NOT NULL,
  `proposal_json` text NOT NULL,
  `status` text NOT NULL CHECK (`status` in ('validated','stale','needs_review','superseded')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `v2_processing_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `v2_processing_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`capture_id`) REFERENCES `v2_capture_bundles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`object_id`) REFERENCES `v2_objects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_analysis_proposal_job` ON `v2_analysis_proposals` (`job_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_analysis_proposal_object` ON `v2_analysis_proposals` (`user_id`,`object_id`,`created_at`);
