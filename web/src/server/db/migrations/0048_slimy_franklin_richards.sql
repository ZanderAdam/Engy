CREATE TABLE `dispatch_notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin_session_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dispatch_notices_origin` ON `dispatch_notices` (`origin_session_id`);--> statement-breakpoint
CREATE TABLE `dispatches` (
	`correlation_id` text PRIMARY KEY NOT NULL,
	`worker_session_id` text NOT NULL,
	`origin_session_id` text,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`notify_on_reply` integer DEFAULT false NOT NULL,
	`settled_by` text,
	`delivery_prompt_id` text,
	`stop_reason` text,
	`last_output` text,
	`evidence` text,
	`created_at` text NOT NULL,
	`written_at` text,
	`delivered_at` text,
	`replied_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_dispatches_worker_status` ON `dispatches` (`worker_session_id`,`status`);