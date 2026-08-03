ALTER TABLE `prs` ADD `comment_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prs` ADD `authored_by_viewer` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `pr_scope` text DEFAULT 'mine';