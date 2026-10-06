CREATE TABLE `review_worktrees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_path` text NOT NULL,
	`repo_full_name` text NOT NULL,
	`pr_number` integer NOT NULL,
	`worktree_path` text NOT NULL,
	`head_ref_name` text NOT NULL,
	`head_sha` text NOT NULL,
	`created_by_review` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_worktrees_pr_unique` ON `review_worktrees` (`repo_full_name`,`pr_number`);