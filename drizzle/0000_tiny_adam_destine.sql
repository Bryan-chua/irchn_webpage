CREATE TABLE `house_settings` (
	`house_code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `queue_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`queue_number` text NOT NULL,
	`house_code` text NOT NULL,
	`nickname` text NOT NULL,
	`group_size` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`joined_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_entries_queue_number_unique` ON `queue_entries` (`queue_number`);