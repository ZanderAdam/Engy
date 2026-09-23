CREATE TABLE `usage_context_item` (
	`date` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`token_turns` integer DEFAULT 0 NOT NULL,
	`attributed_cost_micro_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `session_id`, `kind`, `label`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_context_item_date` ON `usage_context_item` (`date`);--> statement-breakpoint
CREATE INDEX `idx_usage_context_item_session` ON `usage_context_item` (`session_id`);--> statement-breakpoint
ALTER TABLE `usage_session` ADD `base_context_tokens` integer DEFAULT 0 NOT NULL;