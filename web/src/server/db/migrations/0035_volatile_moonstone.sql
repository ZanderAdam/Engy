CREATE TABLE `inbox_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`kind` text NOT NULL,
	`actor` text,
	`summary` text NOT NULL,
	`url` text,
	`at` text NOT NULL,
	`source_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inbox_events_source_key` ON `inbox_events` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_inbox_events_item_at` ON `inbox_events` (`item_id`,`at`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_full_name` text NOT NULL,
	`pr_number` integer NOT NULL,
	`github_thread_id` text,
	`workspace_id` integer,
	`repo_path` text,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`latest_reason` text,
	`bucket` text DEFAULT 'other' NOT NULL,
	`unread` integer DEFAULT true NOT NULL,
	`last_event_at` text NOT NULL,
	`last_read_at` text,
	`snoozed_until` text,
	`done_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inbox_items_repo_pr` ON `inbox_items` (`repo_full_name`,`pr_number`);--> statement-breakpoint
CREATE INDEX `idx_inbox_items_workspace` ON `inbox_items` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_inbox_items_done_at` ON `inbox_items` (`done_at`);