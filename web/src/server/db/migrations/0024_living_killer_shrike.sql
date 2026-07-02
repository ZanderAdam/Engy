ALTER TABLE `prs` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `prs` ADD `last_failed_head_sha` text;--> statement-breakpoint
ALTER TABLE `prs` ADD `auto_fix_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prs` ADD `attention_reason` text;