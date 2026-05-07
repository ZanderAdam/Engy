CREATE TABLE `frontmatter` (
	`workspace_id` integer NOT NULL,
	`collection` text NOT NULL,
	`path` text NOT NULL,
	`data` text NOT NULL,
	`indexed_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `path`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_frontmatter_collection` ON `frontmatter` (`workspace_id`,`collection`);--> statement-breakpoint
CREATE TABLE `permanent_memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`subtype` text DEFAULT 'fact' NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`repo` text,
	`confidence` real DEFAULT 1,
	`keywords` text DEFAULT '[]',
	`themes` text DEFAULT '[]',
	`tags` text DEFAULT '[]',
	`linked_memories` text DEFAULT '[]',
	`scenario_ids` text DEFAULT '[]',
	`sources` text DEFAULT '[]',
	`file_path` text,
	`superseded_by_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `project_memories`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fleeting_memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`content` text NOT NULL,
	`type` text DEFAULT 'capture' NOT NULL,
	`source` text DEFAULT 'agent' NOT NULL,
	`tags` text DEFAULT '[]',
	`promoted` integer DEFAULT false NOT NULL,
	`promoted_from_id` integer,
	`promoted_at` text,
	`sources` text DEFAULT '[]',
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promoted_from_id`) REFERENCES `permanent_memories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_fleeting_memories`("id", "workspace_id", "content", "type", "source", "tags", "promoted", "created_at") SELECT "id", "workspace_id", "content", "type", "source", "tags", "promoted", "created_at" FROM `fleeting_memories`;--> statement-breakpoint
DROP TABLE `fleeting_memories`;--> statement-breakpoint
ALTER TABLE `__new_fleeting_memories` RENAME TO `fleeting_memories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;