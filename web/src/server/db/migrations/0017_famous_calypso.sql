PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`task_group_id` integer,
	`task_id` integer,
	`execution_mode` text,
	`completion_summary` text,
	`worktree_path` text,
	`branch` text,
	`state` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_group_id`) REFERENCES `task_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions`("id", "session_id", "task_group_id", "task_id", "execution_mode", "completion_summary", "worktree_path", "branch", "state", "status", "created_at", "updated_at") SELECT "id", "session_id", "task_group_id", "task_id", "execution_mode", "completion_summary", "worktree_path", "branch", "state", "status", "created_at", "updated_at" FROM `agent_sessions`;--> statement-breakpoint
DROP TABLE `agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_sessions_session_id_unique` ON `agent_sessions` (`session_id`);