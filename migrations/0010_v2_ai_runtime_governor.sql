CREATE TABLE `v2_ai_runtime_state` (
  `model_role` text PRIMARY KEY NOT NULL CHECK (`model_role` in ('main_analyzer','grounded_enricher')),
  `state` text NOT NULL DEFAULT 'healthy' CHECK (`state` in ('healthy','throttled','quota_exhausted','circuit_open')),
  `consecutive_failures` integer NOT NULL DEFAULT 0 CHECK (`consecutive_failures` >= 0),
  `retry_after` text,
  `probe_owner` text,
  `probe_expires_at` text,
  `last_error_code` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_v2_ai_runtime_retry` ON `v2_ai_runtime_state` (`state`,`retry_after`);
