CREATE TABLE `task_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_sessions_task_session_unique` ON `task_sessions` (`task_id`,`session_key`);--> statement-breakpoint
CREATE INDEX `idx_task_sessions_session_key` ON `task_sessions` (`session_key`);