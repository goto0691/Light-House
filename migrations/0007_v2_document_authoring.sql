DROP INDEX IF EXISTS `uq_v2_revision_document_hash`;
--> statement-breakpoint
CREATE INDEX `idx_v2_revision_document_hash` ON `v2_document_revisions` (`document_object_id`,`content_hash`);
--> statement-breakpoint
ALTER TABLE `v2_document_revisions` ADD COLUMN `revision_status` text NOT NULL DEFAULT 'committed' CHECK (`revision_status` in ('committed','fork'));
--> statement-breakpoint
ALTER TABLE `v2_document_revisions` ADD COLUMN `revision_number` integer NOT NULL DEFAULT 1 CHECK (`revision_number` >= 1);
--> statement-breakpoint
ALTER TABLE `v2_document_revisions` ADD COLUMN `forked_from_version` integer;
--> statement-breakpoint
CREATE INDEX `idx_v2_revision_document_status` ON `v2_document_revisions` (`document_object_id`,`revision_status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `v2_restricted_grants` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `session_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `revoked_at` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_restricted_grant_token` ON `v2_restricted_grants` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restricted_grant_session_expiry` ON `v2_restricted_grants` (`user_id`,`session_id`,`expires_at`);
