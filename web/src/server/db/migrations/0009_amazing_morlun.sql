ALTER TABLE `agent_sessions` ADD `task_id` integer REFERENCES tasks(id);--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `execution_mode` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `completion_summary` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `worktree_path` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `sub_status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `feedback` text;