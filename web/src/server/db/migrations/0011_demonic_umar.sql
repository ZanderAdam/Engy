CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer,
	`session_id` text NOT NULL,
	`document_path` text,
	`question` text NOT NULL,
	`header` text NOT NULL,
	`options` text,
	`multi_select` integer DEFAULT false,
	`answer` text,
	`created_at` text NOT NULL,
	`answered_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
