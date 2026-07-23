CREATE TABLE `terminal_session_history` (
	`session_id` text PRIMARY KEY NOT NULL,
	`agent_type` text NOT NULL,
	`working_dir` text NOT NULL,
	`scope_label` text NOT NULL,
	`summary` text NOT NULL,
	`workspace_slug` text,
	`project_slug` text,
	`worktree_branch` text,
	`container_mode` text,
	`started_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_tsh_workspace_started` ON `terminal_session_history` (`workspace_slug`,`started_at`);