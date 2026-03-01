CREATE TABLE `comment_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`document_path` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `thread_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text,
	`reactions` text DEFAULT '[]',
	`metadata` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `comment_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
