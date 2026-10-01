ALTER TABLE `review_worktrees` ADD `auto_reviewed_sha` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `auto_review_on_request` integer DEFAULT false;