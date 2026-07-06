CREATE TABLE `prs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`head_branch` text NOT NULL,
	`head_sha` text,
	`author` text NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`ci_status` text DEFAULT 'unknown' NOT NULL,
	`checks` text NOT NULL,
	`review_decision` text,
	`last_failed_head_sha` text,
	`auto_fix_attempts` integer DEFAULT 0 NOT NULL,
	`auto_fix_total_attempts` integer DEFAULT 0 NOT NULL,
	`attention_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prs_repo_number_unique` ON `prs` (`repo`,`number`);--> statement-breakpoint
CREATE INDEX `idx_prs_repo` ON `prs` (`repo`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `auto_ci_fix` integer DEFAULT false;