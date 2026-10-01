ALTER TABLE `prs` ADD `repo_full_name` text;--> statement-breakpoint
ALTER TABLE `prs` ADD `base_ref` text;--> statement-breakpoint
ALTER TABLE `prs` ADD `additions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prs` ADD `deletions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prs` ADD `review_requests` text DEFAULT '[]' NOT NULL;