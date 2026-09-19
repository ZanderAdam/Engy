CREATE TABLE `usage_call` (
	`session_id` text NOT NULL,
	`call_index` integer NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`session_id`, `call_index`)
);
--> statement-breakpoint
CREATE TABLE `usage_cause` (
	`date` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_turns` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `session_id`, `kind`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_cause_date` ON `usage_cause` (`date`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`date` text NOT NULL,
	`slug` text NOT NULL,
	`model` text NOT NULL,
	`is_subagent` integer DEFAULT false NOT NULL,
	`api_calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`thinking_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_1h_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_5m_tokens` integer DEFAULT 0 NOT NULL,
	`est_cost_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `slug`, `model`, `is_subagent`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_daily_date` ON `usage_daily` (`date`);--> statement-breakpoint
CREATE TABLE `usage_field` (
	`date` text NOT NULL,
	`session_id` text NOT NULL,
	`tool` text NOT NULL,
	`field` text NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`token_turns` integer DEFAULT 0 NOT NULL,
	`attributed_cost_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `session_id`, `tool`, `field`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_field_date` ON `usage_field` (`date`);--> statement-breakpoint
CREATE TABLE `usage_file` (
	`date` text NOT NULL,
	`session_id` text NOT NULL,
	`file_path` text NOT NULL,
	`tool` text NOT NULL,
	`reads` integer DEFAULT 0 NOT NULL,
	`edits` integer DEFAULT 0 NOT NULL,
	`writes` integer DEFAULT 0 NOT NULL,
	`total_chars` integer DEFAULT 0 NOT NULL,
	`tokens_est` integer DEFAULT 0 NOT NULL,
	`attributed_token_turns` integer DEFAULT 0 NOT NULL,
	`attributed_cost_cents` integer DEFAULT 0 NOT NULL,
	`ext` text NOT NULL,
	PRIMARY KEY(`date`, `session_id`, `file_path`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_file_date` ON `usage_file` (`date`);--> statement-breakpoint
CREATE TABLE `usage_pricing` (
	`model` text PRIMARY KEY NOT NULL,
	`input_micro_cents_per_token` integer NOT NULL,
	`output_micro_cents_per_token` integer NOT NULL,
	`cache_write_1h_micro_cents_per_token` integer NOT NULL,
	`cache_write_5m_micro_cents_per_token` integer NOT NULL,
	`cache_read_micro_cents_per_token` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_scan_file` (
	`path` text PRIMARY KEY NOT NULL,
	`size_bytes` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`bytes_scanned` integer DEFAULT 0 NOT NULL,
	`first_line_date` text,
	`last_line_date` text,
	`last_scan_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_sealed_date` (
	`date` text PRIMARY KEY NOT NULL,
	`sealed_at` text NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`reducer_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`cwd` text,
	`git_branch` text,
	`repo_root` text,
	`parent_session_id` text,
	`is_subagent` integer DEFAULT false NOT NULL,
	`agent_type` text,
	`agent_description` text,
	`engy_workspace_id` integer,
	`engy_project_id` integer,
	`model` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`api_calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`thinking_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_1h_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_5m_tokens` integer DEFAULT 0 NOT NULL,
	`web_search_requests` integer DEFAULT 0 NOT NULL,
	`web_fetch_requests` integer DEFAULT 0 NOT NULL,
	`est_cost_cents` integer DEFAULT 0 NOT NULL,
	`first_prompt` text,
	`duration_minutes` real,
	`lines_added` integer,
	`lines_removed` integer,
	`files_modified` integer,
	`git_commits` integer,
	`tool_errors` integer,
	`compactions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`engy_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`engy_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_usage_session_slug` ON `usage_session` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_usage_session_repo_root` ON `usage_session` (`repo_root`);--> statement-breakpoint
CREATE INDEX `idx_usage_session_workspace` ON `usage_session` (`engy_workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_session_project` ON `usage_session` (`engy_project_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_session_parent` ON `usage_session` (`parent_session_id`);--> statement-breakpoint
CREATE TABLE `usage_tool` (
	`date` text NOT NULL,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`result_chars` integer DEFAULT 0 NOT NULL,
	`result_tokens_est` integer DEFAULT 0 NOT NULL,
	`input_chars` integer DEFAULT 0 NOT NULL,
	`attributed_token_turns` integer DEFAULT 0 NOT NULL,
	`attributed_cost_cents` integer DEFAULT 0 NOT NULL,
	`p50_result_chars` integer DEFAULT 0 NOT NULL,
	`p95_result_chars` integer DEFAULT 0 NOT NULL,
	`max_result_chars` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`images` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `session_id`, `tool_name`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_tool_date` ON `usage_tool` (`date`);